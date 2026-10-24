import test from 'node:test';
import assert from 'node:assert/strict';
import { MODTAP_STORAGE_KEY, runModTapTest } from '../src/modtap-session.mjs';

function harness() {
    const data = {}, calls = [];
    const api = {
        storage: { local: {
            async get(key) { return structuredClone({ [key]: data[key] }); },
            async set(value) { calls.push('save:' + value[MODTAP_STORAGE_KEY].state); Object.assign(data, structuredClone(value)); },
        } },
        scripting: { async executeScript({ args: [action, backup] }) {
            calls.push(action);
            if (action === 'prepare') return [{result:{ok:true,
                backup:{id:'backup-1', original:{keyId:29,enabled:0,keyCode:0,holdTime:250}, originalLayers:[3,29,0,2],
                    test:{keyId:29,enabled:1,keyCode:80,holdTime:250}},
                report:{state:'prepared',writeAttempted:false}}}];
            assert.equal(data[MODTAP_STORAGE_KEY].backup.id, backup.id, 'Backup must exist before any device write');
            return [{result:{ok:true,message:'Verified',report:{state:action==='apply'?'applied':'restored'}}}];
        } },
    };
    return { api, data, calls };
}

test('worker persists and verifies backup before apply, preserves it through restore', async () => {
    const { api, data, calls } = harness();
    assert.equal((await runModTapTest(api, { tabId: 7, action: 'apply' })).ok, true);
    assert.deepEqual(calls, ['prepare','save:prepared','save:applying','apply','save:applied']);
    await assert.rejects(runModTapTest(api, {tabId:7,action:'apply'}), /already saved/);
    assert.equal((await runModTapTest(api, {tabId:7,action:'restore'})).ok, true);
    assert.equal(data[MODTAP_STORAGE_KEY].state, 'restored');
    assert.equal(data[MODTAP_STORAGE_KEY].backup.id, 'backup-1');
});

test('storage failures or failed backup read-back prevent apply', async () => {
    for (const mode of ['throws', 'discarded']) {
        const { api, calls } = harness();
        api.storage.local.set = async () => { if (mode === 'throws') throw Error('storage failed'); };
        await assert.rejects(runModTapTest(api, { tabId: 7, action: 'apply' }));
        assert.deepEqual(calls, ['prepare']);
    }
});

function sortedProperties(value) {
    if (Array.isArray(value)) return value.map(sortedProperties);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedProperties(value[key])]));
    return value;
}

test('storage round-trip accepts reordered object properties without losing the original backup', async () => {
    const { api, data, calls } = harness();
    const save = api.storage.local.set;
    api.storage.local.set = async value => save(sortedProperties(value));
    const result = await runModTapTest(api, {tabId:7,action:'apply'});
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['prepare','save:prepared','save:applying','apply','save:applied']);
    assert.deepEqual(data[MODTAP_STORAGE_KEY].backup.original, {keyId:29,enabled:0,keyCode:0,holdTime:250});
    assert.equal((await runModTapTest(api, {tabId:7,action:'restore'})).ok, true);
});

test('reordered storage still rejects changed, missing, extra or mistyped values and reordered array entries', async () => {
    for (const corrupt of [
        saved => saved.backup.original.keyCode = 80,
        saved => delete saved.backup.original.holdTime,
        saved => saved.backup.original.extra = true,
        saved => saved.backup.original.enabled = '0',
        saved => saved.backup.originalLayers.reverse(),
        saved => saved.backup.originalLayers = {...saved.backup.originalLayers},
        saved => saved.backup.original = null,
    ]) {
        const { api, calls } = harness();
        const save = api.storage.local.set;
        api.storage.local.set = async value => {
            const modified = sortedProperties(value);
            corrupt(modified[MODTAP_STORAGE_KEY]);
            await save(modified);
        };
        await assert.rejects(runModTapTest(api, {tabId:7,action:'apply'}), /backup could not be verified/);
        assert.deepEqual(calls, ['prepare', 'save:prepared'], 'Corrupted backups must never reach apply');
    }
});

test('losing the page after backup keeps the pending original and prevents replacing it', async () => {
    const { api, data } = harness();
    const execute = api.scripting.executeScript;
    api.scripting.executeScript = async options => {
        if (options.args[0] === 'apply') throw Error('page closed');
        return execute(options);
    };
    await assert.rejects(runModTapTest(api, { tabId: 7, action: 'apply' }), /page closed/);
    assert.equal(data[MODTAP_STORAGE_KEY].state, 'applying');
    assert.equal(data[MODTAP_STORAGE_KEY].backup.id, 'backup-1');
    await assert.rejects(runModTapTest(api, {tabId:7,action:'apply'}), /already saved/);
});

test('rejected writes and failed restores retain the backup and diagnostics', async () => {
    const { api, data } = harness();
    const execute = api.scripting.executeScript;
    api.scripting.executeScript = async options => options.args[0] === 'prepare' ? execute(options)
        : [{ result: { ok: false, message: 'Unverified', report: {state:'write-unverified'} } }];
    assert.equal((await runModTapTest(api, { tabId: 7, action: 'apply' })).ok, false);
    assert.equal(data[MODTAP_STORAGE_KEY].state, 'unverified');
    assert.equal((await runModTapTest(api, { tabId: 7, action: 'restore' })).ok, false);
    assert.equal(data[MODTAP_STORAGE_KEY].backup.id, 'backup-1');
    assert.equal(data[MODTAP_STORAGE_KEY].application.report.state, 'write-unverified');
    assert.equal(data[MODTAP_STORAGE_KEY].restoration.report.state, 'write-unverified');
});
