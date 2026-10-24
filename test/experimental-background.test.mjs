import test from 'node:test';
import assert from 'node:assert/strict';

test('background persists local experiment switches, rejects page messages and rolls back failed saves', async () => {
    let listener, registered = [], stored = { disabledExperiments: ['controller', 'polling', 'fn'] }, rejectSave = false;
    const previous = globalThis.chrome;
    globalThis.chrome = {
        runtime: {
            id: 'local-test', getURL: path => `chrome-extension://local-test/${path}`,
            onInstalled: { addListener() {} }, onStartup: { addListener() {} },
            onMessage: { addListener(fn) { listener = fn; } },
        },
        storage: { local: {
            async get() { return structuredClone(stored); },
            async set(value) { if (rejectSave) throw new Error('Storage unavailable'); Object.assign(stored, structuredClone(value)); },
        } },
        scripting: {
            async getRegisteredContentScripts() { return structuredClone(registered); },
            async registerContentScripts(items) { registered.push(...structuredClone(items)); },
            async updateContentScripts(items) { registered = registered.map(old => structuredClone(items.find(item => item.id === old.id) || old)); },
            async unregisterContentScripts({ ids }) { registered = registered.filter(item => !ids.includes(item.id)); },
        },
    };
    const request = message => new Promise(resolve => listener(message, {
        id: 'local-test', url: 'chrome-extension://local-test/popup.html',
    }, resolve));
    try {
        await import('../extension/background.mjs');
        let answered = false;
        assert.equal(listener({ type: 'setExperiment', experiment: 'fn', enabled: false }, {
            id: 'local-test', url: 'https://synapse.razer.com/products/688/',
        }, () => { answered = true; }), undefined);
        assert.equal(answered, false);
        assert.equal(listener({ type: 'modTapTest', action: 'apply', tabId: 7 }, {
            id: 'local-test', url: 'https://synapse.razer.com/products/688/',
        }, () => { answered = true; }), undefined);
        assert.equal(answered, false, 'Site messages cannot trigger the extension write coordinator');
        const initial = await request({ type: 'getPreferences' });
        assert.equal(initial.developerMode, false);
        assert.equal(initial.experimentalMode, false);
        assert.equal(registered.length, 3);
        assert.equal(registered.some(item => item.js.includes('diagnostics.js')), false);
        assert.equal((await request({ type: 'setExperiment', experiment: 'drag', enabled: true })).ok, false);
        assert.equal((await request({ type: 'setExperiment', experiment: 'macros', enabled: true })).ok, false);
        assert.equal((await request({ type: 'setExperiment', experiment: 'keyboardLogs', enabled: true })).ok, false);
        assert.equal((await request({ type: 'setExperiment', experiment: 'fn', enabled: true })).ok, false);
        assert.equal((await request({ type: 'setDeveloperMode', enabled: 'true' })).ok, false);
        assert.equal((await request({ type: 'setExperimentalMode', enabled: 'true' })).ok, false);
        assert.equal(listener({ type: 'setDeveloperMode', enabled: true }, {
            id: 'local-test', url: 'https://synapse.razer.com/products/688/',
        }, () => { answered = true; }), undefined);
        assert.equal(answered, false);
        assert.equal(listener({ type: 'setExperimentalMode', enabled: true }, {
            id: 'local-test', url: 'https://synapse.razer.com/products/688/',
        }, () => { answered = true; }), undefined);
        assert.equal(answered, false);
        assert.equal((await request({ type: 'setDeveloperMode', enabled: true })).developerMode, true);
        assert.equal(stored.developerMode, true);
        assert.equal(registered.length, 4);
        assert.deepEqual(stored.disabledExperiments, ['dualPurpose', 'macros']);
        assert.equal(stored.experimentRevision, 3);
        assert.equal((await request({ type: 'setExperiment', experiment: 'drag', enabled: true })).ok, false, 'Developer mode does not enable experimental options');
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), false);
        assert.equal((await request({ type: 'setExperimentalMode', enabled: true })).experimentalMode, true);
        assert.equal(stored.developerMode, true);
        assert.equal(stored.experimentalMode, true);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), true);
        assert.equal(registered.some(item => item.id.endsWith('-modtap-editor')), false, 'Experimental mode alone does not opt into dual-purpose');
        assert.equal((await request({ type: 'setExperiment', experiment: 'dualPurpose', enabled: true })).ok, true);
        assert.equal(registered.some(item => item.id.endsWith('-modtap-editor')), true);
        const response = await request({ type: 'setExperiment', experiment: 'windows', enabled: false });
        assert.deepEqual(response.disabledExperiments, ['macros', 'windows']);
        assert.deepEqual(stored.disabledExperiments, ['macros', 'windows']);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/fn.js'), false);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/windows.js'), false);
        await request({ type: 'setExperiment', experiment: 'drag', enabled: false });
        await request({ type: 'setExperiment', experiment: 'keyboardLogs', enabled: false });
        const savedChoices = structuredClone(stored.disabledExperiments);
        assert.equal((await request({ type: 'setDeveloperMode', enabled: false })).developerMode, false);
        assert.deepEqual(stored.disabledExperiments, savedChoices);
        assert.equal(registered.some(item => item.js.includes('diagnostics.js')), false);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), false);
        const experimentalOnly = await request({ type: 'getPreferences' });
        assert.equal(experimentalOnly.developerMode, false);
        assert.equal(experimentalOnly.experimentalMode, true);
        assert.equal((await request({ type: 'setExperiment', experiment: 'mouseLogs', enabled: true })).ok, false);
        await request({ type: 'setExperimentalMode', enabled: false });
        await request({ type: 'setExperimentalMode', enabled: true });
        assert.deepEqual(stored.disabledExperiments, savedChoices);
        await request({ type: 'setDeveloperMode', enabled: true });
        assert.equal((await request({ type: 'getPreferences' })).developerMode, true, 'Mode survives reopening the popup');
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), false, 'Individual off choices survive mode changes');
        assert.ok(registered.find(item => item.id.endsWith('-diagnostics')).excludeMatches.includes('https://synapse.razer.com/products/688/*'));
        await request({ type: 'setExperiment', experiment: 'drag', enabled: true });
        await request({ type: 'setExperiment', experiment: 'keyboardLogs', enabled: true });
        const snapshot = structuredClone(registered);
        rejectSave = true;
        assert.equal((await request({ type: 'setDeveloperMode', enabled: false })).ok, false);
        assert.equal(stored.developerMode, true);
        assert.equal((await request({ type: 'setExperimentalMode', enabled: false })).ok, false);
        assert.equal(stored.experimentalMode, true);
        assert.equal((await request({ type: 'setExperiment', experiment: 'dualPurpose', enabled: false })).ok, false);
        assert.equal(stored.disabledExperiments.includes('dualPurpose'), false);
        assert.equal((await request({ type: 'setProduct', productId: '688', enabled: false })).ok, false);
        assert.deepEqual(registered.toSorted((a, b) => a.id.localeCompare(b.id)), snapshot.toSorted((a, b) => a.id.localeCompare(b.id)));
        assert.deepEqual(stored.disabledProducts, []);
        assert.equal((await request({ type: 'setExperiment', experiment: '../unsafe', enabled: true })).ok, false);
        rejectSave = false;
        await request({ type: 'setExperiment', experiment: 'macros', enabled: true });
        assert.deepEqual((await request({ type: 'getPreferences' })).disabledExperiments, ['windows'], 'Migration must not repeat after a deliberate opt-in');
        await request({ type: 'setDeveloperMode', enabled: false });
        assert.equal(registered.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'), true, 'Developer mode does not control mouse macros');
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), true);
        await request({ type: 'setExperimentalMode', enabled: false });
        assert.equal(registered.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'), false);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), false);
        assert.deepEqual(stored.disabledExperiments, ['windows'], 'Turning off Experimental features does not erase the macro opt-in');
        await request({ type: 'setDeveloperMode', enabled: true });
        assert.equal(registered.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'), false);
        assert.equal(registered.some(item => item.id.endsWith('-diagnostics')), true);
        await request({ type: 'setExperimentalMode', enabled: true });
        assert.equal(registered.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'), true);
        await request({ type: 'setProduct', productId: '229', enabled: false });
        assert.equal(registered.some(item => item.id.endsWith('-229')), false);
        assert.equal(registered.some(item => item.id.endsWith('-diagnostics')), true);
        assert.equal(listener({ type: 'modTapTest', action: 'apply', tabId: 7 }, {
            id: 'local-test', url: 'chrome-extension://local-test/popup.html',
        }, () => { answered = true; }), undefined, 'The legacy test command is no longer available, including to the popup');
        assert.equal(answered, false);
        const sender = { id: 'local-test', url: 'https://synapse.razer.com/products/688/', tab: { id: 7 }, frameId: 42 };
        const editorRequest = message => new Promise(resolve => listener(message, sender, resolve));
        const editorCalls = [];
        globalThis.chrome.scripting.executeScript = async options => {
            editorCalls.push(options);
            return [{ result: { ok: true, keys: [] } }];
        };
        assert.equal(listener({ type: 'modTapEditor', action: 'catalog' }, { ...sender, url: 'https://synapse.razer.com/products/229/' }, () => {}), undefined);
        assert.equal((await editorRequest({ type: 'modTapEditor', action: 'catalog', tabId: 999, frameId: 999 })).ok, true);
        assert.deepEqual(editorCalls[0].target, { tabId: 7, frameIds: [42] }, 'Route only to the sender frame, ignoring caller-supplied IDs');
        stored.localBackslashModTapTest = { backup: { id: 'original-backup' }, state: 'applied' };
        const backup = structuredClone(stored.localBackslashModTapTest);
        stored.localModTapEditor = { entries: { savedKey: { baseline: { target: 'KEY_H' } } } };
        const editorBackup = structuredClone(stored.localModTapEditor);
        assert.equal((await request({ type: 'setExperiment', experiment: 'dualPurpose', enabled: false })).ok, true);
        assert.ok((await request({ type: 'getPreferences' })).disabledExperiments.includes('dualPurpose'), 'Choice survives reopening');
        assert.equal(registered.some(item => item.id.endsWith('-modtap-editor')), false);
        assert.equal(registered.find(item => item.id.endsWith('-688')).js.includes('experimental/dualPurpose.js'), false);
        for (const action of ['catalog', 'highlights', 'read', 'save', 'restore']) {
            const blocked = await editorRequest({ type: 'modTapEditor', action, inputID: 'KEY_H' });
            assert.equal(blocked.ok, false);
            assert.match(blocked.error, /Turn on Experimental features and Dual-purpose keys/);
        }
        assert.equal(editorCalls.length, 1, 'Turning off the feature blocks even already-injected editors before device access');
        assert.deepEqual(stored.localBackslashModTapTest, backup);
        assert.deepEqual(stored.localModTapEditor, editorBackup, 'Turning off the editor preserves original mappings and recovery data');
        await request({ type: 'setExperiment', experiment: 'dualPurpose', enabled: true });
        assert.ok(registered.some(item => item.id.endsWith('-modtap-editor')));
        await request({ type: 'setExperimentalMode', enabled: false });
        assert.equal((await editorRequest({ type: 'modTapEditor', action: 'catalog' })).ok, false, 'Mode off also blocks an already-injected editor');
        assert.equal(registered.some(item => item.id.endsWith('-modtap-editor')), false);
        assert.equal(stored.disabledExperiments.includes('dualPurpose'), false, 'Mode off retains the saved opt-in');
        await request({ type: 'setExperimentalMode', enabled: true });
        assert.equal((await editorRequest({ type: 'modTapEditor', action: 'catalog' })).ok, true);
        stored.localModTapEditor = { entries: { existing: { baseline: { target: 'KEY_BACKSLASH' } } } };
        await request({ type: 'setProduct', productId: '688', enabled: false });
        assert.equal((await editorRequest({ type: 'modTapEditor', action: 'catalog' })).ok, false);
        assert.equal(registered.some(item => item.id.endsWith('-modtap-editor')), false);
        assert.equal(editorCalls.length, 2, 'Master-off must also block already-injected editor buttons');
    } finally { globalThis.chrome = previous; }
});
