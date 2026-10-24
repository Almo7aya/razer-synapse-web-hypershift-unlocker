import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { installExperimentalPatch } from '../src/experimental-runtime.mjs';
import { installHypershiftPatch } from '../src/runtime.mjs';
import { createModTapProbe } from '../src/modtap-probe.mjs';
import { EXPERIMENTS, normalizeExperiments, withExperimentEnabled, effectiveDisabledExperiments, migrateExperiments, EXPERIMENT_REVISION } from '../src/experiments.mjs';
import { experimentalRegistrations, syncExperimentalRegistrations } from '../src/preferences.mjs';

// A small local Webpack/React double, not a browser or Razer device emulator.
function harness(product = '688', options = Object.fromEntries(EXPERIMENTS.map(item => [item.id, true])), writer = true, probe = false) {
    const tasks = [];
    const context = vm.createContext({
        location: { origin: 'https://synapse.razer.com', pathname: `/products/${product}/` },
        console: { info() {}, warn() {} },
        queueMicrotask: fn => tasks.push(fn), setTimeout() {},
        document: { body: { append() {} }, createElement: () => ({ style: {}, setAttribute() {} }) },
    });
    const run = code => vm.runInContext(code, context);
    run(`window = globalThis; __razerExperimentalOptions = ${JSON.stringify(options)};
        class Storage { getItem(key) { return this.data[key] ?? null; } constructor() { this.data = { enableLog: 'false', other: 'unchanged' }; } }
        window.localStorage = new Storage(); window.sessionStorage = new Storage();`);
    run(`(${installHypershiftPatch.toString()})(); (${installExperimentalPatch.toString()})(${probe ? createModTapProbe.toString() : ''});`);
    run(`
        const cache = {};
        function req(id) {
            if (cache[id]) return cache[id].exports;
            const module = cache[id] = { exports: {} };
            req.m[id](module, module.exports, req);
            return module.exports;
        }
        req.d = (target, definitions) => {
            for (const key of Object.keys(definitions)) Object.defineProperty(target, key, { enumerable: true, get: definitions[key] });
        };
        req.m = {
            react(module) { module.exports = { Component: class {} }; },
            jsx(module) { module.exports = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; },
            layout(module, exports) {
                Object.defineProperty(exports, '__esModule', { value: true });
                req.d(exports, { groupList: () => layout });
                const layout = ['KEY_WINDOWS', 'KEY_FN', 'KEY_APPLICATION', 'LeftClick'].map(buttonKey => ({
                    buttonKey, inputID: buttonKey, functionList: ['DEFAULT', 'KEYBOARD_FUNCTION'],
                    isEnabled: false, isSidePanelList: false, disableHypershiftMapping: true,
                }));
            },
            capabilities(module, exports) {
                req.d(exports, { lp: () => device, P7: () => engine, DeviceInfo: () => device });
                const device = { productId: ${product}, OBMSpecs: { supportedFeature: { dpi: true }, supportedMappings: { mouseGroup: true } } };
                const engine = { engineType: 'obmEngineMouse', obmSupportFeature: device.OBMSpecs.supportedFeature };
            },
            constants(module, exports) {
                const list = ['KEY_WINDOWS', 'KEY_FN', 'DIAL_CLICK'];
                req.d(exports, { IOh: () => list });
            },
            drag(module, exports) {
                const guard = (drag, target) => !drag || (!drag.dragCustomize && drag.data[0].controllerGroup?.controllerAssignment === 'blocked')
                    || (drag.data[0].outputType === 'hyperShiftGroup' && ['KEY_TAB', 'KEY_CAPS_LOCK'].includes(target.buttonKey))
                    || drag.originalButton === target.inputID;
                req.d(exports, { z: () => guard });
            },
        };
        ${writer ? `req.m.writer = (module, exports) => {
            const save = async (engine, mapping) => {
                const tag = 'setKeyMapping';
                const outputType = mapping.mapping?.[0]?.outputType || mapping.outputType;
                return engine.setSingleButtonMapping(0, { ...mapping, outputType, tag });
            };
            req.d(exports, { e: () => save });
        };` : ''}
        const name = ${JSON.stringify(product === '688' ? 'webpackChunkproject_anne_taliat160' : 'webpackChunkproject_anne_wilmat1')};
        const chunks = window[name] = window[name] || [];
        function callback(parent, [ids, modules, runtime]) {
            Object.assign(req.m, modules);
            if (runtime) runtime(req);
            if (parent) parent([ids, modules, runtime]);
        }
        chunks.forEach(callback.bind(null, null));
        chunks.push = callback.bind(null, chunks.push.bind(chunks));
    `);
    return { run, context, flush() { while (tasks.length) tasks.shift()(); } };
}

test('mouse macros default off and retired app-dependent options migrate cleanly', () => {
    assert.deepEqual(normalizeExperiments(), ['dualPurpose', 'macros']);
    assert.deepEqual(normalizeExperiments(['controller', 'dynamic', 'polling', 'fn']), []);
    assert.deepEqual(withExperimentEnabled([], 'macros', false), ['macros']);
    assert.deepEqual(withExperimentEnabled(['macros'], 'macros', true), []);
    assert.throws(() => withExperimentEnabled([], '../content', true));
    assert.throws(() => withExperimentEnabled([], 'fn', true));
    assert.throws(() => normalizeExperiments(['unknown']));
});

test('release migration requires dual-purpose opt-in without repeating the macro rollback', () => {
    assert.deepEqual(migrateExperiments(undefined), ['dualPurpose', 'macros']);
    assert.deepEqual(migrateExperiments([], 1), ['dualPurpose', 'macros']);
    assert.deepEqual(migrateExperiments([], 2), ['dualPurpose'], 'Retain a deliberate macro opt-in');
    assert.deepEqual(migrateExperiments([], EXPERIMENT_REVISION), [], 'Never undo a new explicit opt-in');
    assert.deepEqual(migrateExperiments(['windows', 'fn'], 2), ['dualPurpose', 'windows']);
});

test('read probe captures only application-initialized singleton modules, including lazy chunks', async () => {
    const app = harness('688', { dualPurpose: true }, false, true);
    assert.ok(app.context.__razerModTapProbe);
    assert.equal((await app.context.__razerModTapProbe.run()).ok, false);
    app.run(`let exportsRead = 0;
        chunks.push([[9000], {
            liveDevice(module, exports) {
                // initializeRzDevice [WebRzDevice] get obmEngine()
                const device = {_initialized:false,_obm:{}};
                Object.defineProperty(exports, 'A', {get() { exportsRead++; return device; }});
            },
            liveProfiles(module, exports) {
                // current profile changed currentProfile obmSlotId
                const profiles = {currentProfile:{},profiles:[]};
                Object.defineProperty(exports, 'A', {get() { exportsRead++; return profiles; }});
            },
            liveUiStore(module, exports) {
                // customizeReducer: modTapReducer:
                Object.defineProperty(exports, 'A', {get() { exportsRead++; return {getState(){},subscribe(){}}; }});
            },
            unrelated(module, exports) { Object.defineProperty(exports, 'A', {get() { throw Error('Unrelated getter'); }}); },
        }]);`);
    assert.equal(app.run('exportsRead'), 0, 'The probe must not initialize an application module');
    app.run('req("liveDevice"); req("liveProfiles"); req("liveUiStore"); req("unrelated");');
    assert.equal(app.run('exportsRead'), 3);
    assert.deepEqual(Array.from(app.context.__razerExperiments.errors), []);
    assert.equal((await app.context.__razerModTapProbe.run()).ok, false, 'Uninitialized hardware must remain unread');
    assert.equal(harness('229', {}, false, true).context.__razerModTapProbe, undefined);
});

test('Dual-purpose keys toggle controls the editor, highlights and page probe independently of other features', () => {
    for (const developerMode of [false, true]) for (const experimentalMode of [false, true]) {
        const on = experimentalRegistrations([], [], developerMode, experimentalMode);
        assert.equal(on.some(item => item.js.includes('modtap-editor.js')), experimentalMode);
        assert.equal(on.find(item => item.id.endsWith('-688')).js.includes('experimental/dualPurpose.js'), experimentalMode);
        const off = experimentalRegistrations([], ['dualPurpose'], developerMode, experimentalMode);
        assert.equal(off.some(item => item.js.includes('modtap-editor.js')), false, 'Editor and its highlighter must not be injected');
        assert.equal(off.find(item => item.id.endsWith('-688')).js.includes('experimental/dualPurpose.js'), false);
        assert.ok(off.find(item => item.id.endsWith('-688')).js.includes('experimental/windows.js'));
        assert.ok(off.find(item => item.id.endsWith('-688')).js.includes('content.js'), 'Core Hypershift unlock remains enabled');
    }
    const off = harness('688', { windows: true }, true, true);
    assert.equal(off.context.__razerModTapProbe, undefined, 'No Mod Tap reads or writer API when the feature is disabled');
    assert.equal(off.run('req("layout").groupList[0].isEnabled'), true);
    assert.equal(harness('688', {}, true, true).context.__razerExperiments, undefined);
    assert.equal(harness('229', { dualPurpose: true }, false, true).context.__razerModTapProbe, undefined);
});

test('product scripts are disjoint, preference files run first, and master off excludes experiments', () => {
    const registrations = experimentalRegistrations([], ['fn'], true, true);
    assert.equal(registrations.length, 5);
    const editor = registrations.find(item => item.id.endsWith('-modtap-editor'));
    assert.equal(editor.world, 'ISOLATED');
    assert.equal(editor.runAt, 'document_idle');
    assert.equal(editor.allFrames, true);
    assert.deepEqual(editor.js, ['modtap-editor.js']);
    assert.equal(experimentalRegistrations(['688']).some(item => item.id.endsWith('-modtap-editor')), false);
    const keyboard = registrations.find(item => item.id.endsWith('-688'));
    assert.equal(keyboard.js[0], 'experimental/reset.js');
    assert.deepEqual(keyboard.js.slice(-2), ['content.js', 'experimental.js']);
    assert.ok(!keyboard.js.includes('experimental/fn.js'));
    assert.ok(!keyboard.js.includes('experimental/macros.js'));
    assert.ok(registrations[0].excludeMatches.includes('https://synapse.razer.com/products/688/*'));
    assert.equal(experimentalRegistrations(['688']).some(item => item.id.endsWith('-688')), false);
    assert.equal(experimentalRegistrations([], EXPERIMENTS.map(item => item.id)).find(item => item.id.endsWith('-229')).js.length, 3);
    const diagnostics = experimentalRegistrations(['229'], ['mouseLogs'], true).find(item => item.id.endsWith('-diagnostics'));
    assert.deepEqual(diagnostics.js, ['diagnostics.js']);
    assert.ok(diagnostics.excludeMatches.includes('https://synapse.razer.com/products/229/*'));
    assert.deepEqual(experimentalRegistrations(['229'], undefined, true).find(item => item.id.endsWith('-diagnostics')).excludeMatches, []);
    assert.ok(!experimentalRegistrations([]).find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'));
});

test('Developer and Experimental modes default off and gate their own features without changing saved choices', () => {
    const saved = ['mouseLogs'];
    assert.deepEqual(effectiveDisabledExperiments(saved), ['drag', 'dualPurpose', 'keyboardLogs', 'macros', 'mouseLogs']);
    assert.deepEqual(saved, ['mouseLogs']);
    const off = experimentalRegistrations([], saved);
    assert.ok(!off.some(item => item.js.includes('diagnostics.js')), 'Dashboard and other product logs must also be off');
    assert.ok(!off.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'));
    assert.ok(!off.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'));
    assert.ok(!off.some(item => item.js.includes('modtap-editor.js')), 'The experimental editor starts disabled');
    for (const dev of [false, true]) for (const experimental of [false, true]) {
        const registrations = experimentalRegistrations([], saved, dev, experimental);
        const diagnostics = registrations.find(item => item.id.endsWith('-diagnostics'));
        assert.equal(!!diagnostics, dev);
        if (dev) assert.ok(diagnostics.excludeMatches.includes('https://synapse.razer.com/products/229/*'));
        assert.equal(registrations.find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'), experimental);
        assert.equal(registrations.find(item => item.id.endsWith('-229')).js.includes('experimental/macros.js'), experimental);
        assert.equal(registrations.some(item => item.js.includes('experimental/fn.js')), false);
    }
    assert.ok(!experimentalRegistrations([], ['drag'], true, true).find(item => item.id.endsWith('-688')).js.includes('experimental/drag.js'));
    assert.deepEqual(effectiveDisabledExperiments(saved, true, true), saved);
    assert.throws(() => experimentalRegistrations([], [], 'true'), /developer mode/);
    assert.throws(() => experimentalRegistrations([], [], false, 'true'), /experimental features/);
});

test('registration reconciliation handles off, on and repeated startup', async () => {
    let current = [], calls = [];
    const scripting = {
        async getRegisteredContentScripts() { return current; },
        async registerContentScripts(items) { current.push(...items); calls.push('add'); },
        async updateContentScripts(items) { current = current.map(old => items.find(next => old.id === next.id) || old); calls.push('update'); },
        async unregisterContentScripts({ ids }) { current = current.filter(item => !ids.includes(item.id)); calls.push('remove'); },
    };
    await syncExperimentalRegistrations(scripting, [], []);
    await syncExperimentalRegistrations(scripting, [], []);
    await syncExperimentalRegistrations(scripting, ['688'], []);
    await syncExperimentalRegistrations(scripting, [], ['menu']);
    assert.deepEqual(calls, ['add', 'remove', 'add']);
    assert.ok(!current.find(item => item.id.endsWith('-688')).js.includes('experimental/menu.js'));
});

test('old local registrations are removed before replacement and their legacy files remain harmless', async () => {
    let current = experimentalRegistrations([], []), calls = [];
    current.find(item => item.id.endsWith('-229')).js.unshift('experimental/mouseLogs.js');
    current.find(item => item.id.endsWith('-688')).js.unshift('experimental/dynamic.js', 'experimental/keyboardLogs.js', 'experimental/fn.js');
    const scripting = {
        async getRegisteredContentScripts() { return structuredClone(current); },
        async unregisterContentScripts({ ids }) { current = current.filter(item => !ids.includes(item.id)); calls.push('remove'); },
        async updateContentScripts() { assert.fail('Stale file lists must be replaced'); },
        async registerContentScripts(items) {
            for (const item of items) assert.ok(!current.some(old => old.id === item.id));
            current.push(...items); calls.push('add');
        },
    };
    await syncExperimentalRegistrations(scripting, [], []);
    assert.deepEqual(calls, ['remove', 'add']);
    const sort = items => items.toSorted((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(sort(current), sort(experimentalRegistrations([], [])));
    for (const id of ['mouseLogs', 'keyboardLogs', 'controller', 'dynamic', 'polling', 'fn']) {
        const source = await readFile(new URL(`../extension/experimental/${id}.js`, import.meta.url), 'utf8');
        const context = vm.createContext({});
        vm.runInContext(source, context);
        assert.deepEqual(Object.keys(context), [], `${id} must not reactivate retired experiments`);
    }
});

test('hooks startup and lazy modules, preserves normal layouts and primary mouse click lock', () => {
    const app = harness();
    assert.equal(app.context.__razerExperiments.state, 'hooked');
    assert.equal(app.run('req("layout").groupList[0].isEnabled'), true);
    assert.equal(app.run('req("layout").groupList[0].disableHypershiftMapping'), false);
    assert.equal(app.run('req("layout").groupList[2].isEnabled'), false);
    assert.equal(app.run('req("layout").groupList[2].functionList.includes("DYNAMIC_KEY_STROKE")'), false);
    assert.equal(app.run('req("constants").IOh.join(",")'), 'KEY_FN,DIAL_CLICK');
    app.run('chunks.push([[999], { late(module) { module.exports = { value: 42 }; } }]);');
    assert.equal(app.run('req("late").value'), 42);
    const mouse = harness('229');
    assert.equal(mouse.run('req("layout").groupList[3].isEnabled'), false);
    assert.equal(mouse.run('req("layout").groupList[3].functionList.includes("MACRO")'), true);
    assert.equal(mouse.run('req("capabilities").lp.OBMSpecs.supportedFeature.macros'), true);
    assert.equal(mouse.run('req("capabilities").P7.obmSupportFeature.macros'), true);
    assert.equal(mouse.run('req("capabilities").DeviceInfo.OBMSpecs.supportedMappings.macroGroup'), true);
});

test('unknown writer shapes leave new keyboard editor paths closed', () => {
    const app = harness('688', { fn: true, windows: true, controller: true, dynamic: true }, false);
    assert.equal(app.run('req("layout").groupList[0].isEnabled'), false);
    assert.equal(app.run('req("layout").groupList[0].functionList.includes("CONTROLLER")'), false);
    assert.equal(app.run('req("constants").IOh.length'), 3);
});

test('unsupported saves never call the device; supported assignments and Windows canonical mapping do', async () => {
    const app = harness();
    app.run(`let writes = []; const engine = {
        inputIDToMapping: { keyboard: { NormalMode: { KEY_LEFT_GUI: { fwID: 127 } } } },
        async setSingleButtonMapping(slot, data) { writes.push(data); return data; }
    };`);
    for (const outputType of ['controllerGroup', 'joystickGroup', 'dynamicKeyStrokeGroup']) {
        await assert.rejects(app.run(`req('writer').e(engine, { inputID: 'KEY_A', mapping: [{ outputType: '${outputType}' }] })`), /no Web save implementation/);
    }
    await assert.rejects(app.run(`req('writer').e(engine, { inputID: 'KEY_FN', mapping: [{ outputType: 'keyboardGroup' }] })`), /Fn mappings cannot be saved/);
    assert.equal(app.run('writes.length'), 0);
    await app.run(`req('writer').e(engine, { inputID: 'KEY_WINDOWS', mapping: [{ outputType: 'keyboardGroup' }] })`);
    assert.equal(app.run('writes[0].inputID'), 'KEY_LEFT_GUI');
    await app.run(`req('writer').e(engine, { inputID: 'KEY_A', mapping: [{ outputType: 'keyboardGroup' }] })`);
    assert.equal(app.run('writes[1].inputID'), 'KEY_A');
    await assert.rejects(app.run(`req('writer').e({}, { inputID: 'KEY_WINDOWS', outputType: 'defaultGroup' })`), /does not expose/);
});

test('Hypershift drag unlock preserves self-drop and other assignment eligibility checks', () => {
    const app = harness();
    assert.equal(app.run(`req('drag').z({ data: [{ outputType: 'hyperShiftGroup' }] }, { buttonKey: 'KEY_TAB', inputID: 'KEY_TAB' })`), false);
    assert.equal(app.run(`req('drag').z({ originalButton: 'KEY_TAB', data: [{ outputType: 'hyperShiftGroup' }] }, { buttonKey: 'KEY_TAB', inputID: 'KEY_TAB' })`), true);
    assert.equal(app.run(`req('drag').z({ data: [{ outputType: 'controllerGroup', controllerGroup: { controllerAssignment: 'blocked' } }] }, { buttonKey: 'KEY_TAB' })`), true);
});

test('Menu handler retains pending-change checks and restores Hypershift props immediately', async () => {
    const app = harness();
    app.run(`
        class Button extends req('react').Component {
            constructor() {
                super(); this.selected = []; this.props = { isHyperShiftOn: true, setDefaultActuation() {}, setActiveSelectedKeys: key => this.selected.push(key) };
                this.clickBtn = async key => {
                    if (key === 'KEY_APPLICATION' && this.props.isHyperShiftOn) return;
                    if (this.props.isMappingChanged) return;
                    this.props.setDefaultActuation({}); this.props.setActiveSelectedKeys(key);
                };
                this.checkNotRemapped = button => button.isSidePanelList === false || button.inputID === 'KEY_WINDOWS' || !!button.hasHWFunc;
            }
        }
        const button = new Button();
    `);
    await app.run(`button.clickBtn('KEY_APPLICATION')`);
    assert.equal(app.run('button.selected[0]'), 'KEY_APPLICATION');
    assert.equal(app.run('button.props.isHyperShiftOn'), true);
    app.run('button.props.isMappingChanged = true;');
    await app.run(`button.clickBtn('KEY_APPLICATION')`);
    assert.equal(app.run('button.selected.length'), 1);
    assert.equal(app.run(`button.checkNotRemapped({ inputID: 'KEY_WINDOWS', isSidePanelList: true })`), false);
    assert.equal(app.run(`button.checkNotRemapped({ inputID: 'KEY_WINDOWS', isSidePanelList: true, hasHWFunc: true })`), true);
});

test('retired previews are inert, and mouse diagnostics alone install no application hooks', () => {
    const mouse = harness('229', { polling: true, mouseLogs: true });
    assert.equal(mouse.context.__razerExperiments, undefined);
    assert.equal(mouse.run(`req('jsx').jsx('component', { supportInGamePollingRate: false }).props.supportInGamePollingRate`), false);
    assert.equal(mouse.run(`req('jsx').jsxs('component', { unrelated: false }).props.unrelated`), false);
    assert.equal(mouse.run('req("layout").groupList[3].functionList.includes("MACRO")'), false);
    const keyboard = harness('688', { menu: true, controller: true, dynamic: true, fn: true });
    assert.equal(keyboard.run('req("layout").groupList[0].isEnabled'), false);
    assert.equal(keyboard.run('req("layout").groupList[0].functionList.includes("DYNAMIC_KEY_STROKE")'), false);
    const windows = harness('688', { windows: true, fn: true });
    assert.equal(windows.run('req("layout").groupList[0].isEnabled'), true);
    assert.equal(windows.run('req("layout").groupList[1].isEnabled'), false, 'Stale Fn opt-ins cannot unlock its editor');
    assert.equal(windows.run('req("layout").groupList[1].isSidePanelList'), false);
    assert.equal(windows.run('req("constants").IOh.includes("KEY_FN")'), true);
    const off = harness('688', { fn: true });
    assert.equal(off.context.__razerExperiments, undefined);
});

test('the optional mouse macro experiment leaves DPI configuration and React JSX untouched', () => {
    const on = harness('229', { macros: true });
    assert.equal(on.run('req("capabilities").lp.OBMSpecs.supportedFeature.dpi'), true);
    assert.equal(on.run(`req('jsx').jsx('component', { supportInGamePollingRate: false }).props.supportInGamePollingRate`), false);
    assert.equal(on.run(`req('jsx').jsxs('component', { dpiStages: [400, 800, 1600], activeStage: 2 }).props.dpiStages.join(',')`), '400,800,1600');
    const off = harness('229', { mouseLogs: true });
    assert.equal(off.run('req("capabilities").lp.OBMSpecs.supportedFeature.macros'), undefined);
    assert.equal(off.run('req("capabilities").lp.OBMSpecs.supportedFeature.dpi'), true);
});
