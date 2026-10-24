import { discoverProducts } from './lib/products.mjs';
import { normalizePreferences } from './lib/preferences.mjs';
import { EXPERIMENTS, normalizeExperiments, normalizeDeveloperMode, normalizeExperimentalMode } from './lib/experiments.mjs';
import { collectDiagnostics } from './lib/diagnostics.mjs';
import { collectModTapProbeInPage } from './lib/modtap-probe.mjs';
import { MODTAP_STORAGE_KEY } from './lib/modtap-storage.mjs';
import { MODTAP_EDITOR_STORAGE_KEY } from './lib/modtap-editor-session.mjs';

const $ = selector => document.querySelector(selector);
let tabId;
let products = [];
let disabledProducts = [];
let disabledExperiments = [];
let developerMode = false;
let experimentalMode = false;
let busy = false;
let scanning = false;
let exporting = false;
let fingerprint = '';
let editedControl;
const reloadDialog = $('#reload-dialog');

function notice(text, error = false) {
    $('#notice').textContent = text;
    $('#notice').hidden = !text;
    $('#notice').classList.toggle('error', error);
}

function render() {
    const focused = document.activeElement?.dataset.control;
    $('#developer-mode').checked = developerMode;
    $('#developer-mode').disabled = busy || exporting;
    $('#experimental-mode').checked = experimentalMode;
    $('#experimental-mode').disabled = busy || exporting;
    $('#developer-tools').hidden = !developerMode;
    $('#export-diagnostics').disabled = busy || exporting;
    $('#count').textContent = products.length;
    $('#empty').hidden = products.length > 0;
    $('#empty').textContent = 'No products found. Open a product in Synapse Web.';
    $('#products').replaceChildren();
    for (const product of products) {
        const enabled = !disabledProducts.includes(product.productId);
        const row = document.createElement('article');
        row.className = 'product';
        row.innerHTML = '<div class="product-heading"><img class="thumbnail" alt=""><div class="product-info"><p class="product-name"></p><p class="product-state"></p></div><label class="switch"><input type="checkbox"><span></span></label></div>';
        row.querySelector('.product-name').textContent = product.name;
        const state = row.querySelector('.product-state');
        state.textContent = product.loading ? 'Loading…' : '';
        state.hidden = !product.loading;
        const image = row.querySelector('img');
        image.src = product.image || 'icons/48.png';
        image.addEventListener('error', () => { image.src = 'icons/48.png'; }, { once: true });
        const toggle = row.querySelector('input');
        toggle.checked = enabled;
        toggle.disabled = busy || exporting;
        toggle.dataset.product = product.productId;
        toggle.dataset.control = product.productId;
        toggle.setAttribute('aria-label', `Enable Hypershift Mapping Unlocker for ${product.name}`);
        toggle.addEventListener('change', () => setPreference({ type: 'setProduct', productId: product.productId, enabled: toggle.checked }, product.productId));
        const experiments = EXPERIMENTS.filter(item => item.product === product.productId
            && (developerMode || !item.devOnly) && (experimentalMode || !item.experimental));
        if (experiments.length) {
            const list = document.createElement('div');
            list.className = 'experiments';
            for (const experiment of experiments) {
                const label = document.createElement('label');
                label.className = 'experiment';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = !disabledExperiments.includes(experiment.id);
                checkbox.disabled = busy || exporting || (!enabled && !experiment.diagnostic);
                checkbox.dataset.product = product.productId;
                checkbox.dataset.control = experiment.id;
                checkbox.addEventListener('change', () => setPreference({ type: 'setExperiment', experiment: experiment.id, enabled: checkbox.checked }, product.productId));
                const text = document.createElement('span');
                text.textContent = experiment.label;
                label.append(checkbox, text);
                if (experiment.experimental || experiment.devOnly) {
                    const badge = document.createElement('small');
                    badge.className = 'feature-status';
                    badge.textContent = experiment.experimental ? 'Experimental' : 'Developer';
                    badge.title = experiment.experimental ? 'Available with Experimental features enabled.' : 'Available in Developer mode.';
                    label.append(badge);
                }
                list.append(label);
            }
            row.append(list);
        }
        $('#products').append(row);
        [...row.querySelectorAll('input')].find(input => input.dataset.control === focused)?.focus();
    }
}

async function preferences(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Could not read the product preferences.');
    return response;
}

async function scan() {
    if (busy || scanning || reloadDialog.open || tabId === undefined) return;
    scanning = true;
    try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: discoverProducts });
        const next = Array.isArray(result?.result) ? result.result : [];
        const value = JSON.stringify(next);
        if (value !== fingerprint) {
            products = next;
            fingerprint = value;
            render();
        }
    } catch {
        notice('Could not load products from Synapse Web. Reload the page and try again.', true);
    } finally { scanning = false; }
}

async function setPreference(message, productId) {
    if (busy || exporting || reloadDialog.open) return;
    const previous = { disabledProducts, disabledExperiments, developerMode, experimentalMode };
    let saved = false;
    busy = true;
    $('#refresh').disabled = true;
    notice('');
    render();
    try {
        const value = await preferences(message);
        disabledProducts = value.disabledProducts;
        disabledExperiments = value.disabledExperiments;
        developerMode = value.developerMode;
        experimentalMode = value.experimentalMode;
        saved = true;
    } catch (error) {
        ({ disabledProducts, disabledExperiments, developerMode, experimentalMode } = previous);
        notice(error.message, true);
    }
    finally {
        busy = false;
        render();
        $('#refresh').disabled = false;
    }
    if (saved) {
        editedControl = productId ?? (message.type === 'setExperimentalMode' ? 'experimental-mode' : 'developer-mode');
        $('#reload-error').hidden = true;
        reloadDialog.showModal();
    }
}

$('#refresh').addEventListener('click', scan);
$('#developer-mode').addEventListener('change', () => setPreference({ type: 'setDeveloperMode', enabled: $('#developer-mode').checked }));
$('#experimental-mode').addEventListener('change', () => setPreference({ type: 'setExperimentalMode', enabled: $('#experimental-mode').checked }));
async function probeStatus() {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: collectModTapProbeInPage });
    return Array.isArray(result?.result) ? result.result : [];
}

$('#export-diagnostics').addEventListener('click', async () => {
    if (!developerMode || busy || exporting || reloadDialog.open || tabId === undefined) return;
    exporting = true;
    render();
    notice('Collecting diagnostics…');
    try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: collectDiagnostics });
        const frames = result?.result;
        if (!Array.isArray(frames) || !frames.length) throw new Error('No Synapse frames found. Reload the tab and try again.');
        const modTapProbes = await probeStatus();
        if (!frames.some(frame => frame.recording) && !modTapProbes.some(probe => probe.last)) throw new Error('No logs recorded yet. Reload Synapse, reproduce the issue, then export.');
        const report = {
            schemaVersion: 1, exportedAt: new Date().toISOString(),
            extension: { version: chrome.runtime.getManifest().version },
            // Saved choices can differ from appliedOptions until the next reload.
            savedPreferences: { disabledProducts, disabledExperiments, developerMode, experimentalMode },
            products: products.map(({ productId, name }) => ({ productId, name })),
            frames,
            modTapProbes,
            modTapTest: (await chrome.storage.local.get(MODTAP_STORAGE_KEY))[MODTAP_STORAGE_KEY] || null,
            modTapEditor: (await chrome.storage.local.get(MODTAP_EDITOR_STORAGE_KEY))[MODTAP_EDITOR_STORAGE_KEY] || null,
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `hypershift-diagnostics-${report.exportedAt.replace(/[:.]/g, '-')}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        const missing = frames.filter(frame => !frame.recording).length;
        notice(`Diagnostic download started.${missing ? ` ${missing} frame(s) had no recording; see the report.` : ''}`);
    } catch (error) { notice(error.message, true); }
    finally { exporting = false; render(); }
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.disabledProducts && !changes.disabledExperiments && !changes.developerMode && !changes.experimentalMode) || busy) return;
    try {
        if (changes.disabledProducts) disabledProducts = normalizePreferences(changes.disabledProducts.newValue);
        if (changes.disabledExperiments) disabledExperiments = normalizeExperiments(changes.disabledExperiments.newValue);
        if (changes.developerMode) developerMode = normalizeDeveloperMode(changes.developerMode.newValue);
        if (changes.experimentalMode) experimentalMode = normalizeExperimentalMode(changes.experimentalMode.newValue);
        render();
    } catch { /* Leave the last valid preferences displayed. */ }
});
$('#reload').addEventListener('click', async () => {
    if (busy || tabId === undefined) return;
    busy = true;
    $('#reload').disabled = true;
    $('#later').disabled = true;
    $('#reload-error').hidden = true;
    try { await chrome.tabs.reload(tabId); window.close(); }
    catch {
        $('#reload-error').textContent = 'Could not reload Synapse. Try again or reload the tab manually.';
        $('#reload-error').hidden = false;
    } finally {
        busy = false;
        $('#reload').disabled = false;
        $('#later').disabled = false;
    }
});
$('#later').addEventListener('click', () => reloadDialog.close());
reloadDialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
});
reloadDialog.addEventListener('close', () => {
    const toggle = [...$('#products').querySelectorAll('input')]
        .find(input => input.dataset.control === editedControl);
    (toggle || $(`#${editedControl}`))?.focus();
});

try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentUrl = tab?.pendingUrl || tab?.url;
    if (!currentUrl || new URL(currentUrl).origin !== 'https://synapse.razer.com') {
        await chrome.tabs.create({ url: 'https://synapse.razer.com/dashboard', active: true });
        window.close();
    } else {
        $('main').hidden = false;
        tabId = tab.id;
        ({ disabledProducts, disabledExperiments, developerMode, experimentalMode } = await preferences({ type: 'getPreferences' }));
        render();
        await scan();
        setInterval(() => { if (!document.hidden) void scan(); }, 2000);
    }
} catch (error) {
    $('main').hidden = false;
    $('#empty').hidden = true;
    notice(error.message, true);
}
