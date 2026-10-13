import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installHypershiftPatch } from '../src/runtime.mjs';

function harness(pathname = '/products/688/', origin = 'https://synapse.razer.com') {
    const tasks = [], timers = [], warnings = [];
    const context = vm.createContext({
        location: { origin, pathname },
        console: { info() {}, warn(...args) { warnings.push(args); } },
        queueMicrotask: task => tasks.push(task),
        setTimeout: task => timers.push(task),
    });
    const run = source => vm.runInContext(source, context);
    run('window = globalThis; originalDefine = Object.defineProperty;');
    const inject = () => run(`(${installHypershiftPatch.toString()})();`);
    inject();
    return { context, run, inject, warnings, flush: () => { while (tasks.length) tasks.shift()(); }, timeout: () => timers.forEach(task => task()) };
}

const defineLayout = `
const exported = {};
Object.defineProperty(exported, '__esModule', {value: true});
Object.defineProperty(exported, 'groupList', {enumerable: true, get: () => layout});
const layout = [{ group: { buttonList: [{disableHypershiftMapping: true, isEnabled: true}] } }];
`;

test('changes flags on first read, before consumer cloning, preserving other values', () => {
    const app = harness();
    app.run(defineLayout);
    assert.equal(app.run('layout[0].group.buttonList[0].disableHypershiftMapping'), true);
    assert.equal(app.run('JSON.parse(JSON.stringify(exported.groupList))[0].group.buttonList[0].disableHypershiftMapping'), false);
    assert.equal(app.run('layout[0].group.buttonList[0].isEnabled'), true);
    app.flush();
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 1);
});

test('patches all unselected layouts after initialization and later exports', () => {
    const app = harness();
    app.run(`for (let n=0;n<8;n++) { const target={}; Object.defineProperty(target,'__esModule',{value:true}); Object.defineProperty(target,'groupList',{get:()=>data}); const data=Array.from({length:4},()=>({disableHypershiftMapping:true})); }`);
    app.flush();
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 32);
    assert.equal(app.context.__razerHypershiftPatch.hookedLayouts, 8);
    app.run(defineLayout); app.flush();
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 33);
});

test('handles cycles and skips unrelated getters and non-module properties', () => {
    const app = harness();
    app.run(defineLayout);
    app.run(`layout.push(layout); Object.defineProperty(layout[0], 'unrelated', {get(){throw Error('Do not call');}});
        const plain={}; Object.defineProperty(plain,'groupList',{get:()=>[{disableHypershiftMapping:true}]});`);
    app.flush();
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 1);
    assert.equal(app.run('plain.groupList[0].disableHypershiftMapping'), true);
});

test('does not break the app when a flag is frozen', () => {
    const app = harness();
    app.run(defineLayout);
    app.run('layout.push(Object.freeze({disableHypershiftMapping:true}));');
    assert.doesNotThrow(() => app.run('exported.groupList'));
    app.flush();
    assert.equal(app.context.__razerHypershiftPatch.state, 'partial');
    assert.equal(app.context.__razerHypershiftPatch.failedFlags, 1);
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 1);
});

test('distinguishes already false flags from unsupported layouts', () => {
    const app = harness(); app.run(defineLayout);
    app.run('layout[0].group.buttonList[0].disableHypershiftMapping=false;');
    app.flush(); app.timeout();
    assert.equal(app.context.__razerHypershiftPatch.state, 'active');
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 0);
    const empty = harness(); empty.timeout();
    assert.equal(empty.context.__razerHypershiftPatch.state, 'no-flags-found');
    assert.deepEqual(empty.warnings, [], 'Having no flags is a normal no-op');
});

test('rechecks changed flags, without stacking duplicate hooks', () => {
    const app = harness(); app.run(defineLayout); app.flush();
    const hook = app.run('Object.defineProperty'); app.inject();
    assert.equal(app.run('Object.defineProperty'), hook);
    app.run('layout[0].group.buttonList[0].disableHypershiftMapping=true; exported.groupList;');
    assert.equal(app.context.__razerHypershiftPatch.changedFlags, 2);
    assert.equal(app.context.__razerHypershiftPatch.matchedFlags, 1);
});

test('automatically detects arbitrary product IDs and keeps each frame independent', () => {
    const frames = ['/products/688/', '/products/229/', '/products/9999', '/products/229/settings'].map(path => harness(path));
    for (const app of frames) {
        app.run(defineLayout); app.flush();
        assert.equal(app.context.__razerHypershiftPatch.changedFlags, 1);
        assert.equal(app.run('layout[0].group.buttonList[0].disableHypershiftMapping'), false);
    }
    assert.deepEqual(frames.map(app => app.context.__razerHypershiftPatch.productId), ['688', '229', '9999', '229']);
    assert.notEqual(frames[0].context.__razerHypershiftPatch, frames[1].context.__razerHypershiftPatch);
});

test('ignores dashboards and paths without a numeric product ID', () => {
    for (const path of ['/products/688suffix/', '/products/foo/', '/products/', '/dashboard/', '/other/products/688/']) {
        const app = harness(path);
        assert.equal(app.context.__razerHypershiftPatch, undefined);
        assert.equal(app.run('Object.defineProperty === originalDefine'), true);
    }
});

test('ignores other origins', () => {
    for (const origin of ['http://synapse.razer.com', 'https://example.com', 'https://synapse.razer.com.example.com']) {
        const app = harness('/products/688/', origin);
        assert.equal(app.context.__razerHypershiftPatch, undefined);
        assert.equal(app.run('Object.defineProperty === originalDefine'), true);
    }
});
