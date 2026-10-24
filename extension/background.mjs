import { normalizePreferences, syncExperimentalRegistrations, withProductEnabled } from './lib/preferences.mjs';
import { EXPERIMENTS, EXPERIMENT_REVISION, normalizeDeveloperMode, normalizeExperimentalMode, migrateExperiments, effectiveDisabledExperiments, withExperimentEnabled } from './lib/experiments.mjs';
import { runModTapEditor, modTapEditorSender } from './lib/modtap-editor-session.mjs';

let queue = Promise.resolve();
function serialized(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
}

async function preferences() {
    const { disabledProducts, disabledExperiments, experimentRevision, developerMode, experimentalMode } = await chrome.storage.local.get(['disabledProducts', 'disabledExperiments', 'experimentRevision', 'developerMode', 'experimentalMode']);
    return {
        disabledProducts: normalizePreferences(disabledProducts), disabledExperiments: migrateExperiments(disabledExperiments, experimentRevision),
        developerMode: normalizeDeveloperMode(developerMode), experimentalMode: normalizeExperimentalMode(experimentalMode),
    };
}

const sync = value => syncExperimentalRegistrations(chrome.scripting, value.disabledProducts, value.disabledExperiments, value.developerMode, value.experimentalMode);

async function reconcile() {
    const value = await preferences();
    await sync(value);
    const { experimentRevision } = await chrome.storage.local.get('experimentRevision');
    if (experimentRevision !== EXPERIMENT_REVISION) await chrome.storage.local.set({ ...value, experimentRevision: EXPERIMENT_REVISION });
    return value;
}

async function setProduct(message) {
    const previous = await preferences();
    const next = { ...previous };
    if (message.type === 'setDeveloperMode') {
        if (typeof message.enabled !== 'boolean') throw Error('Invalid developer mode toggle.');
        next.developerMode = message.enabled;
    } else if (message.type === 'setExperimentalMode') {
        if (typeof message.enabled !== 'boolean') throw Error('Invalid experimental features toggle.');
        next.experimentalMode = message.enabled;
    } else if (message.type === 'setExperiment') {
        if (!previous.developerMode && EXPERIMENTS.some(item => item.id === message.experiment && item.devOnly)) {
            throw Error('Turn on Developer mode to change this option.');
        }
        if (!previous.experimentalMode && EXPERIMENTS.some(item => item.id === message.experiment && item.experimental)) {
            throw Error('Turn on Experimental features to change this option.');
        }
        next.disabledExperiments = withExperimentEnabled(previous.disabledExperiments, message.experiment, message.enabled);
    }
    else next.disabledProducts = withProductEnabled(previous.disabledProducts, message.productId, message.enabled);
    try {
        await sync(next);
        await chrome.storage.local.set({ ...next, experimentRevision: EXPERIMENT_REVISION });
    }
    catch (error) {
        await sync(previous);
        throw error;
    }
    return next;
}

const onStart = () => serialized(reconcile).catch(error => console.error('Could not register the Synapse Web patch:', error));
chrome.runtime.onInstalled.addListener(onStart);
chrome.runtime.onStartup.addListener(onStart);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'modTapEditor') {
        const frame = modTapEditorSender(sender, chrome.runtime.id);
        if (!frame) return;
        serialized(async () => {
            const value = await preferences();
            if (value.disabledProducts.includes('688')) throw Error('Enable the keyboard product in the extension and reload Synapse.');
            if (effectiveDisabledExperiments(value.disabledExperiments, value.developerMode, value.experimentalMode).includes('dualPurpose')) {
                throw Error('Turn on Experimental features and Dual-purpose keys in the extension, then reload Synapse Web.');
            }
            return runModTapEditor(chrome, message, frame);
        }).then(respond).catch(error => respond({ ok: false, error: error.message }));
        return true;
    }
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (!['getPreferences', 'setProduct', 'setExperiment', 'setDeveloperMode', 'setExperimentalMode'].includes(message?.type)) return;
    serialized(async () => {
        return message.type === 'getPreferences' ? reconcile() : setProduct(message);
    })
        .then(value => respond({ ok: true, ...value }))
        .catch(error => respond({ ok: false, error: error.message }));
    return true;
});
