import { normalizePreferences, syncRegistration, withProductEnabled } from './lib/preferences.mjs';

let queue = Promise.resolve();
function serialized(task) {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
}

async function preferences() {
    const { disabledProducts } = await chrome.storage.local.get('disabledProducts');
    return normalizePreferences(disabledProducts);
}

async function reconcile() {
    const disabledProducts = await preferences();
    await syncRegistration(chrome.scripting, disabledProducts);
    return disabledProducts;
}

async function setProduct(message) {
    const previous = await preferences();
    const next = withProductEnabled(previous, message.productId, message.enabled);
    await syncRegistration(chrome.scripting, next);
    try { await chrome.storage.local.set({ disabledProducts: next }); }
    catch (error) {
        await syncRegistration(chrome.scripting, previous);
        throw error;
    }
    return next;
}

const onStart = () => serialized(reconcile).catch(error => console.error('Could not register the Synapse Web patch:', error));
chrome.runtime.onInstalled.addListener(onStart);
chrome.runtime.onStartup.addListener(onStart);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    if (!['getPreferences', 'setProduct'].includes(message?.type)) return;
    serialized(() => message.type === 'setProduct' ? setProduct(message) : reconcile())
        .then(disabledProducts => respond({ ok: true, disabledProducts }))
        .catch(error => respond({ ok: false, error: error.message }));
    return true;
});
