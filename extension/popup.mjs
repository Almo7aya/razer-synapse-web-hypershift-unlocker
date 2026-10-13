import { discoverProducts } from './lib/products.mjs';
import { normalizePreferences } from './lib/preferences.mjs';

const $ = selector => document.querySelector(selector);
let tabId;
let products = [];
let disabledProducts = [];
let busy = false;
let scanning = false;
let fingerprint = '';
let editedProductId;
const reloadDialog = $('#reload-dialog');

function notice(text, error = false) {
    $('#notice').textContent = text;
    $('#notice').hidden = !text;
    $('#notice').classList.toggle('error', error);
}

function render() {
    const focused = document.activeElement?.dataset.product;
    $('#count').textContent = products.length;
    $('#empty').hidden = products.length > 0;
    $('#empty').textContent = 'No products detected yet. Open a product in Synapse Web.';
    $('#products').replaceChildren();
    for (const product of products) {
        const enabled = !disabledProducts.includes(product.productId);
        const row = document.createElement('article');
        row.className = 'product';
        row.innerHTML = '<img class="thumbnail" alt=""><div class="product-info"><p class="product-name"></p><p class="product-state"></p></div><label class="switch"><input type="checkbox"><span></span></label>';
        row.querySelector('.product-name').textContent = product.name;
        const state = row.querySelector('.product-state');
        state.textContent = product.loading ? 'Loading…' : '';
        state.hidden = !product.loading;
        const image = row.querySelector('img');
        image.src = product.image || 'icons/48.png';
        image.addEventListener('error', () => { image.src = 'icons/48.png'; }, { once: true });
        const toggle = row.querySelector('input');
        toggle.checked = enabled;
        toggle.disabled = busy;
        toggle.dataset.product = product.productId;
        toggle.setAttribute('aria-label', `Enable Hypershift unlocker for ${product.name}`);
        toggle.addEventListener('change', () => setProduct(product.productId, toggle.checked));
        $('#products').append(row);
        if (focused === product.productId) toggle.focus();
    }
}

async function preferences(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Could not read the product preferences.');
    return response.disabledProducts;
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
        notice('Could not read this Synapse page. Reload it and try again.', true);
    } finally { scanning = false; }
}

async function setProduct(productId, enabled) {
    if (busy || reloadDialog.open) return;
    const previous = disabledProducts;
    let saved = false;
    disabledProducts = enabled ? previous.filter(id => id !== productId) : [...new Set([...previous, productId])];
    busy = true;
    $('#refresh').disabled = true;
    notice('');
    render();
    try {
        disabledProducts = await preferences({ type: 'setProduct', productId, enabled });
        saved = true;
    } catch (error) { disabledProducts = previous; notice(error.message, true); }
    finally {
        busy = false;
        render();
        $('#refresh').disabled = false;
    }
    if (saved) {
        editedProductId = productId;
        $('#reload-error').hidden = true;
        reloadDialog.showModal();
    }
}

$('#refresh').addEventListener('click', scan);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.disabledProducts || busy) return;
    try {
        disabledProducts = normalizePreferences(changes.disabledProducts.newValue);
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
        .find(input => input.dataset.product === editedProductId);
    toggle?.focus();
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
        disabledProducts = await preferences({ type: 'getPreferences' });
        await scan();
        setInterval(() => { if (!document.hidden) void scan(); }, 2000);
    }
} catch (error) {
    $('main').hidden = false;
    $('#empty').hidden = true;
    notice(error.message, true);
}
