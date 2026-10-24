import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installDiagnostics, collectDiagnostics } from '../src/diagnostics.mjs';

function harness() {
    const calls = [], listeners = {};
    let clock = 100000;
    const context = vm.createContext({
        URL,
        Date: class extends Date { static now() { return clock; } },
        location: { origin: 'https://synapse.razer.com', pathname: '/products/229/', href: 'https://synapse.razer.com/products/229/?token=private#session' },
        navigator: { userAgent: 'Test Chrome' },
        document: { scripts: [{ src: 'https://synapse.razer.com/products/229/static/js/main.test.js?token=private' }] },
        console: Object.fromEntries(['log', 'info', 'debug', 'warn', 'error', 'assert', 'clear'].map(method => [method, (...args) => { calls.push({ method, args }); return 'forwarded'; }])),
        addEventListener: (type, listener) => { listeners[type] = listener; },
    });
    const run = code => vm.runInContext(code, context);
    run(`window = globalThis; frames = [];
        class Storage { constructor() { this.data = { enableLog: 'false', other: 'same' }; } getItem(key) { return this.data[key] ?? null; } }
        localStorage = new Storage(); sessionStorage = new Storage();`);
    const inject = () => run(`(${installDiagnostics.toString()})();`);
    inject();
    return { run, context, calls, listeners, inject, tick: () => { clock += 1000; }, snapshot: () => JSON.parse(JSON.stringify(context.__razerDiagnostics.snapshot())) };
}

test('buffers routine output without invoking getters and preserves limited warning forwarding', () => {
    const app = harness();
    assert.equal(app.run(`let hits = 0; const data = { stages: [400, 800, 1600], active: 2, get surprise() { hits++; throw Error('getter'); } }; console.log('DPI stages', data);`), undefined);
    app.run('data.stages[0] = 1200;');
    const logged = app.snapshot().entries.at(-1);
    assert.deepEqual(logged.args[1].stages, [400, 800, 1600]);
    assert.equal(logged.args[1].surprise, '[accessor omitted]');
    assert.equal(app.run('hits'), 0);
    assert.equal(app.calls.length, 0, 'Routine logs must not flood DevTools');
    assert.equal(app.run(`console.warn('example warning', data)`), 'forwarded');
    assert.equal(app.calls.at(-1).args[1].stages[0], 1200);
    app.inject();
    app.run(`console.info('single capture');`);
    assert.equal(app.snapshot().entries.filter(entry => entry.args[0] === 'single capture').length, 1);
});

test('enables site logging without persistent changes or Webpack hooks', () => {
    const app = harness();
    assert.equal(app.run(`localStorage.getItem('enableLog')`), 'true');
    assert.equal(app.run('localStorage.data.enableLog'), 'false');
    assert.equal(app.run(`sessionStorage.getItem('enableLog')`), 'false');
    assert.equal(app.run(`localStorage.getItem('other')`), 'same');
    assert.equal(app.run('Object.hasOwn(window, "webpackChunkproject_anne_wilmat1")'), false);
});

test('redacts common secrets, removes URL queries and handles circular and binary data', () => {
    const app = harness();
    app.run(`const cycle = {}; cycle.self = cycle;
        console.warn({ access_token: 'private', serialNumber: 'private-serial', dpi: 1600, cycle, bytes: new Uint8Array([1,2,3]) }, 'Bearer secret-token user@example.com https://example.com/log?token=private', '{"password":"private"}');`);
    const report = app.snapshot(), text = JSON.stringify(report);
    assert.equal(text.includes('private'), false);
    assert.equal(text.includes('secret-token'), false);
    assert.equal(text.includes('user@example.com'), false);
    assert.equal(report.url, 'https://synapse.razer.com/products/229/');
    assert.equal(report.scripts[0], 'https://synapse.razer.com/products/229/static/js/main.test.js');
    assert.equal(report.entries.at(-1).args[0].dpi, 1600);
    assert.deepEqual(report.entries.at(-1).args[0].bytes.bytes, [1, 2, 3]);
    assert.equal(report.entries.at(-1).args[0].cycle.self, '[circular/repeated]');
});

test('redacts abbreviated Razer serial fields in objects and serialized messages', () => {
    const app = harness();
    app.run(`console.log('bigdata startup event', { Device: { SN: 'device-private', PID: '688' } }, '{"SN":"text-private","PID":"688"}', 'sn=lower-private');`);
    const report = app.snapshot(), text = JSON.stringify(report);
    assert.equal(text.includes('private'), false);
    assert.equal(report.entries.at(-1).args[1].Device.SN, '[redacted]');
    assert.equal(report.entries.at(-1).args[1].Device.PID, '688');
    assert.match(report.entries.at(-1).args[2], /"PID":"688"/);
});

test('captures errors and promise rejections, retaining early errors after the recent buffer rolls over', () => {
    const app = harness();
    app.listeners.error({ message: 'DPI initialization failed', filename: 'https://synapse.razer.com/main.js?token=private', lineno: 7, colno: 8, error: new Error('macro storage unavailable') });
    app.run(`console.error(new Error('storage read failed')); console.assert(true, 'not a failure'); console.assert(false, 'failure');`);
    const loggedError = app.snapshot().entries.find(entry => entry.level === 'error');
    assert.equal(loggedError.args[0].message, 'storage read failed');
    assert.match(loggedError.args[0].stack, /storage read failed/);
    app.listeners.unhandledrejection({ reason: 'profile loading rejected' });
    for (let batch = 0; batch < 24; batch++) {
        app.tick();
        app.run(`for (let i = ${batch * 50}; i < ${(batch + 1) * 50}; i++) console.debug(i, 'x'.repeat(2400));`);
    }
    const report = app.snapshot();
    assert.ok(report.droppedFromRecent > 0);
    assert.ok(report.entries.length <= 1080);
    assert.ok(JSON.stringify(report).length < 2200000);
    assert.ok(report.entries.some(entry => entry.level === 'page-error' && entry.args[0] === 'DPI initialization failed'));
    assert.ok(report.entries.some(entry => entry.level === 'unhandledrejection'));
    assert.ok(!report.entries.some(entry => entry.args.includes('not a failure')));
    assert.equal(report.entries.at(-1).args[0], 1199);
});

test('log storms are rate limited before serialization, with suppression counts in the export', () => {
    const app = harness();
    app.run(`for (let i = 0; i < 10000; i++) { console.debug('poll', i); console.error('repeated error', i); }`);
    const report = app.snapshot();
    assert.equal(app.calls.length, 5);
    assert.ok(report.totalRecorded <= 80);
    assert.ok(report.rateLimited.routine > 9900);
    assert.ok(report.rateLimited.important > 9900);
    assert.ok(report.consoleSuppressed > 19000);
    app.tick();
    app.run(`console.warn('new second');`);
    assert.equal(app.calls.length, 6);
    assert.equal(app.snapshot().entries.at(-1).args[0], 'new second');
});

test('preserves mapping evidence and complete HID-sized packets during routine log floods', () => {
    const app = harness();
    app.run(`for (let i = 0; i < 1000; i++) console.debug('poll', i);
        console.log('response', { commandDesc: 'Get Multi Mod Tap Key Assignment', data: new Uint8Array(91).fill(27) });
        console.log('Set Single Analog Key Assignment', { status: 2 });
        let getterHits = 0;
        console.log({ get commandDesc() { getterHits++; throw new Error('not allowed'); } });`);
    for (let batch = 0; batch < 24; batch++) {
        app.tick();
        app.run(`for (let i = 0; i < 50; i++) console.debug('poll', i);`);
    }
    const report = app.snapshot();
    assert.equal(app.run('getterHits'), 0);
    assert.equal(report.retainedMappingEvents, 2);
    const packet = report.entries.find(entry => entry.args[1]?.commandDesc)?.args[1].data;
    assert.equal(packet.bytes.length, 91);
    assert.equal(packet.truncated, false);
    assert.equal(app.calls.length, 0);
});

test('collects dashboard and hidden product frames and identifies missing recordings', () => {
    const app = harness();
    app.run(`location = { origin: 'https://synapse.razer.com', pathname: '/dashboard', href: 'https://synapse.razer.com/dashboard' };
        frames = [
            { location: { origin: 'https://synapse.razer.com', pathname: '/products/688/' }, frames: [], __razerDiagnostics: { snapshot: () => ({ productId: '688', entries: [] }) } },
            { location: { origin: 'https://synapse.razer.com', pathname: '/products/229/' }, frames: [] },
            { location: { origin: 'https://other.example', pathname: '/' }, frames: [] }
        ];
        __razerExperiments = { state: 'hooked', options: { menu: true } };`);
    const frames = JSON.parse(JSON.stringify(app.run(`(${collectDiagnostics.toString()})()`)));
    assert.equal(frames.length, 3);
    assert.equal(frames[0].experiments.state, 'hooked');
    assert.equal(frames[1].productId, '688');
    assert.equal(frames[1].recording, true);
    assert.equal(frames[2].productId, '229');
    assert.equal(frames[2].recording, false);
    assert.match(frames[2].message, /reload Synapse/);
});
