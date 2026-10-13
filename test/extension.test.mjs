import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

test('popup uses Synapse-only access and delegates startup filtering to registered scripts', () => {
    assert.equal(manifest.content_scripts, undefined, 'Static injection would bypass saved off switches');
    assert.equal(manifest.options_ui, undefined);
    assert.equal(manifest.options_page, undefined);
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.deepEqual(manifest.host_permissions, ['https://synapse.razer.com/*']);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.equal(manifest.background.type, 'module');
});

test('built script identifies each iframe URL without a preset or extension API', () => {
    for (const productId of ['688', '229', '123456']) {
        const context = vm.createContext({
            location: { origin: 'https://synapse.razer.com', pathname: `/products/${productId}/` },
            console: { info() {}, warn() {} },
            setTimeout() {}, queueMicrotask() {},
        });
        vm.runInContext('window = globalThis;', context);
        vm.runInContext(source, context);
        assert.equal(context.__razerHypershiftPatch.productId, productId);
        assert.equal(context.__razerHypershiftPatch.state, 'waiting');
    }
});

test('popup has no manual ID or preset controls', async () => {
    const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
    assert.equal(/<select|<form|product-id|keyboard-name/i.test(html), false);
    assert.match(html, /id="products"/);
    assert.match(html, /id="reload"/);
});
