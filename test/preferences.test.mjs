import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences, withProductEnabled, contentRegistration, syncRegistration } from '../src/preferences.mjs';

test('all products start enabled and only off choices are stored', () => {
    assert.deepEqual(normalizePreferences(), []);
    assert.deepEqual(withProductEnabled([], '688', false), ['688']);
    assert.deepEqual(withProductEnabled(['688'], '229', false), ['229', '688']);
    assert.deepEqual(withProductEnabled(['229', '688'], '688', true), ['229']);
    assert.deepEqual(normalizePreferences(['688', '688']), ['688']);
});

test('preference inputs cannot expand site access or inject URL patterns', () => {
    for (const id of ['*', '688*', '688/../229', '0', '', 688, null]) {
        assert.throws(() => withProductEnabled([], id, false));
    }
    assert.throws(() => withProductEnabled([], '688', 'false'));
    assert.throws(() => normalizePreferences({ 688: false }));
});

test('disabled products are excluded before startup, without excluding other products', () => {
    const registration = contentRegistration(['688']);
    assert.deepEqual(registration.matches, ['https://synapse.razer.com/products/*']);
    assert.deepEqual(registration.excludeMatches, [
        'https://synapse.razer.com/products/688',
        'https://synapse.razer.com/products/688?*',
        'https://synapse.razer.com/products/688/*',
    ]);
    const excluded = url => registration.excludeMatches.some(pattern => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url));
    assert.equal(excluded('https://synapse.razer.com/products/688/'), true);
    assert.equal(excluded('https://synapse.razer.com/products/688?view=1'), true);
    assert.equal(excluded('https://synapse.razer.com/products/229/'), false);
    assert.equal(excluded('https://synapse.razer.com/products/6880/'), false);
    assert.equal(registration.runAt, 'document_start');
    assert.equal(registration.world, 'MAIN');
    assert.equal(registration.allFrames, true);
    assert.equal(registration.persistAcrossSessions, true);
});

test('registers once and updates persisted exclusions only when needed', async () => {
    let current = [], calls = [];
    const scripting = {
        async getRegisteredContentScripts() { return current; },
        async registerContentScripts(scripts) { calls.push('register'); current = scripts; },
        async updateContentScripts(scripts) { calls.push('update'); current = scripts; },
    };
    await syncRegistration(scripting, []);
    await syncRegistration(scripting, []);
    await syncRegistration(scripting, ['688']);
    await syncRegistration(scripting, ['688']);
    await syncRegistration(scripting, []);
    assert.deepEqual(calls, ['register', 'update', 'update']);
    assert.deepEqual(current[0].excludeMatches, []);
});
