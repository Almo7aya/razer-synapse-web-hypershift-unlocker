import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createModTapProbe } from '../src/modtap-probe.mjs';
import { MODTAP_STORAGE_KEY } from '../src/modtap-session.mjs';
import { MODTAP_EDITOR_STORAGE_KEY, modTapEditorSender, runModTapEditor } from '../src/modtap-editor-session.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const reordered = value => Array.isArray(value) ? value.map(reordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, reordered(value[key])])) : value;
const frame = { tabId: 7, frameId: 42 };

function harness() {
    const notifications = [];
    const context = vm.createContext({ crypto: webcrypto, TextEncoder, setTimeout, clearTimeout,
        document: { documentElement: {dataset:{}}, dispatchEvent: event => notifications.push(event.type) }, Event });
    const run = source => vm.runInContext(source, context);
    run(`window = globalThis;
        const writes = [], reads = [];
        let serial = 'TEST-KEYBOARD-123', failAfterWrite = false, onRead = null;
        const definitions = [
            ['KEY_BACKSLASH',29,49], ['KEY_A',31,4], ['KEY_RIGHT_ALT',62,230], ['KEY_RIGHT_CTRL',64,228],
            ['KEY_CAPS_LOCK',30,57], ['KEY_FN',255,0], ['KEY_ESC',null,41], ['KEY_ARROW_LEFT',null,80]
        ];
        const mapping = Object.fromEntries(definitions.map(([inputID,fwID,HID]) => [inputID,{inputID,fwID,keyInput:{pageID:'7',HID:String(HID)}}]));
        const records = Object.fromEntries(definitions.filter(d=>d[1]).map(([,keyId]) => [keyId,{keyId,enabled:keyId===62?1:0,keyCode:keyId===62?80:0,holdTime:250}]));
        const layers = Object.fromEntries(definitions.filter(d=>d[1]).map(([,keyId,HID]) => [keyId,[3,keyId,0,2,2,0,HID,0,0,0,keyId,1,0,0,0,0,0,0,0]]));
        const reply = (p,record,command=155) => ({status:'SUCCESS',command:[80,2,command],
            dataHeader:[2,1,0,0,0,5,2,command],packetSizeReturned:5,data:[p,record.keyId,record.enabled,record.keyCode,record.holdTime]});
        const device = {productId:688,isDriverMode:false,isSending:false,
            async getSerialNumber() {return {status:'SUCCESS',jsonData:{serialNumberAscii:serial}};},
            async getMultiModTapKeyAssignment(p,keys) {
                reads.push(['modtap',...keys]); if (onRead) onRead();
                const response=reply(p,records[keys[0]]);
                response.packetSizeReturned=1+4*keys.length; response.dataHeader[5]=response.packetSizeReturned;
                response.data=[p,...keys.flatMap(key=>{const r=records[key];return [r.keyId,r.enabled,r.keyCode,r.holdTime];})];
                if(failAfterWrite&&writes.length)response.status='FAIL'; return response;
            },
            async getMultiKeyAssignment(p,keys) {
                reads.push(['layers',...keys]); const data=[...layers[keys[0].keyId]]; data[0]=p;
                return {status:'SUCCESS',command:[80,2,158],dataHeader:[2,1,0,0,0,19,2,158],packetSizeReturned:19,data};
            },
            async setMultiModTapKeyAssignment(p,items) {
                if(items.length!==1)throw Error('Only one key is allowed');
                const record={...items[0]}; writes.push({profile:p,record}); records[record.keyId]=record; return reply(p,record,27);
            },
            setMultiKeyAssignment() {throw Error('Ordinary layer writes are forbidden');},
            sendCommand() {throw Error('Raw command writes are forbidden');}
        };
        const engine = {name:'obmEngineKeyboardCalMaxMem',rzDevice:device,options:{modTap:true},modTapKeyIdList:[62,64],
            obmJson:{profiles:[{id:3}],buttonIdList:[29,31,62,64,30,255]},
            inputIDToMapping:{keyboardMappingName:'active-layout',keyboard:{NormalMode:mapping}},
            fwIDToMapping:{keyboard:{NormalMode:Object.fromEntries(Object.values(mapping).filter(m=>m.fwID).map(m=>[m.fwID,m]))}},
            setModTapKeyAssignment() {throw Error('Cached engine writer is forbidden');}
        };
        const profiles = {currentProfile:{id:3,guid:'test-guid',name:'My onboard profile'},profiles:[{obmSlotId:3,guid:'test-guid'}]};
        const ui = {customizeReducer:{activeButton:{inputID:'KEY_A'},isMappingChanged:false,selectedTab:'TAB_CUSTOMIZE'},profileReducer:{selectedProfileGuid:'test-guid',selectedObmSlotId:3}};
        const observer=(${createModTapProbe.toString()})();
        observer.observeModule({exports:{A:{_initialized:true,_rzDevice:device,_obm:{engine}}}},'initializeRzDevice [WebRzDevice] get obmEngine()');
        observer.observeModule({exports:{A:profiles}},'current profile changed currentProfile obmSlotId');
        let uiListener;
        observer.observeModule({exports:{A:{getState:()=>ui,subscribe(listener){uiListener=listener;}}}},'customizeReducer: modTapReducer:');
    `);
    const data = {}, calls = [];
    const api = {
        storage: { local: {
            async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))); },
            async set(value) { Object.assign(data, reordered(structuredClone(value))); },
        } },
        scripting: { async executeScript({ target, world, args: [action, request] }) {
            assert.deepEqual(target, { tabId: 7, frameIds: [42] }); assert.equal(world, 'MAIN');
            calls.push(action);
            if (['apply', 'restore'].includes(action)) {
                const entry = Object.values(data[MODTAP_EDITOR_STORAGE_KEY].entries).find(entry => entry.baseline.target === request.inputID);
                assert.ok(entry?.pending, 'A verified, durable pending backup must precede any write');
            }
            return [{ result: plain(await context.__razerModTapProbe.editor(action, reordered(request))) }];
        } },
    };
    const request = value => runModTapEditor(api, value, frame);
    const read = async (inputID = 'KEY_BACKSLASH') => {
        const response = await request({ action: 'read', inputID }); assert.equal(response.ok, true, response.message); return response.view;
    };
    const save = (view, keyCode, enabled = true) => request({ action: 'save', inputID: view.inputID, expected: view.expected, settings: { keyCode, enabled } });
    const restore = view => request({ action: 'restore', inputID: view.inputID, expected: view.expected });
    return { context, run, data, calls, api, request, read, save, restore, notifications, entries: () => Object.values(data[MODTAP_EDITOR_STORAGE_KEY]?.entries || {}) };
}

test('editor catalog uses the active layout and real UI selection without device traffic', async () => {
    const app = harness();
    const catalog = await app.request({ action: 'catalog' });
    assert.equal(catalog.ok, true);
    assert.deepEqual(catalog.keys.map(key => key.inputID), ['KEY_BACKSLASH', 'KEY_A', 'KEY_RIGHT_ALT', 'KEY_RIGHT_CTRL']);
    assert.deepEqual(catalog.keys.map(key => key.support), ['Tested', 'Experimental', 'Stock key', 'Stock key']);
    assert.equal(catalog.selectedInputID, 'KEY_A');
    assert.equal(catalog.keys.find(key => key.inputID === 'KEY_A').defaultTapCode, 4);
    assert.equal(catalog.isHypershift, false);
    app.run('ui.customizeReducer.isHyperShiftOn=true');
    assert.equal((await app.request({action:'catalog'})).isHypershift, true);
    assert.ok(catalog.taps.some(tap => tap.code === 41 && tap.name === 'Escape'), 'Nonphysical outputs can be chosen for tap');
    assert.ok(!catalog.taps.some(tap => tap.code === 57), 'Caps Lock must not be a tap output either');
    assert.equal(app.run('reads.length + writes.length'), 0);
});

test('purple-key snapshots read physical keys in bounded batches, exclude protected keys and cache per profile', async () => {
    const app = harness();
    app.run(`for(let i=0;i<40;i++) {
        const inputID='KEY_TEST_'+i, fwID=80+i, item={inputID,fwID,keyInput:{pageID:'7',HID:String(4+i)}};
        mapping[inputID]=item; engine.fwIDToMapping.keyboard.NormalMode[fwID]=item; engine.obmJson.buttonIdList.push(fwID);
        records[fwID]={keyId:fwID,enabled:i===0||i===39?1:0,keyCode:4,holdTime:250};
    }
    records[30].enabled=1; records[255].enabled=1;`);
    const result = await app.request({action:'highlights'});
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.enabledKeys, ['KEY_RIGHT_ALT','KEY_TEST_0','KEY_TEST_39']);
    assert.equal(app.run('reads.length'), 3);
    assert.equal(app.run('reads.every(r=>r[0]==="modtap"&&r.length<=20&&!r.slice(1).includes(30)&&!r.slice(1).includes(255))'), true);
    await app.request({action:'highlights'}); assert.equal(app.run('reads.length'), 3, 'Cached reads do not poll the device');
    assert.deepEqual(app.data, {}, 'Highlights do not use extension undo storage');
    app.run('records[62].enabled=0; ui.modTapReducer={enabled:false};');
    assert.deepEqual((await app.request({action:'highlights'})).enabledKeys, ['KEY_TEST_0','KEY_TEST_39']);
    assert.equal(app.run('reads.length'), 6);
    app.run('profiles.currentProfile={id:4,guid:"other-profile"};profiles.profiles=[{obmSlotId:4,guid:"other-profile"}];engine.obmJson.profiles=[{id:4}];ui.profileReducer={selectedProfileGuid:"other-profile",selectedObmSlotId:4};records[80].enabled=0;');
    assert.deepEqual((await app.request({action:'highlights'})).enabledKeys, ['KEY_TEST_39']);
    assert.equal(app.run('writes.length'), 0);
});

test('profile and Mod Tap changes notify the highlighter, while selecting a key does not invalidate the snapshot', async () => {
    const app = harness();
    assert.deepEqual(app.notifications, ['hypershift-unlocker:modtap-state'], 'Initial native tab state is published when the store is captured');
    app.notifications.length = 0;
    await app.request({action:'highlights'});
    app.run('ui.customizeReducer.activeButton.inputID="KEY_BACKSLASH";uiListener();');
    assert.equal(app.notifications.length, 0);
    await app.request({action:'highlights'});
    assert.equal(app.run('reads.length'), 1);
    app.run('records[29].enabled=1;ui.modTapReducer={enabled:true};uiListener();');
    assert.deepEqual(app.notifications, ['hypershift-unlocker:modtap-state']);
    assert.ok((await app.request({action:'highlights'})).enabledKeys.includes('KEY_BACKSLASH'));
    assert.equal(app.run('reads.length'), 2);
    app.run('ui.profileReducer.selectedProfileGuid="another-guid";uiListener();');
    app.run('ui.profileReducer.selectedObmSlotId=4;uiListener();');
    app.run('uiListener();');
    assert.equal(app.notifications.length, 3, 'Only a changed profile identity or Mod Tap state emits a notification');
    assert.equal(app.run('writes.length'), 0);
});

test('highlight reads and the published page marker follow the native Customize tab, including navigation during a read', async () => {
    const app = harness();
    assert.equal(app.run('document.documentElement.dataset.localModtapPage'), 'customize');
    await app.request({action:'highlights'});
    for (const tab of ['ACTUATION','RAPID_TRIGGER','SNAP_TAP','TAB_LIGHTING',null]) {
        app.run(`ui.customizeReducer.selectedTab=${JSON.stringify(tab)};uiListener();`);
        assert.equal(app.run('document.documentElement.dataset.localModtapPage'), 'other');
        const reads = app.run('reads.length');
        assert.deepEqual((await app.request({action:'highlights',force:true})).enabledKeys, []);
        assert.equal(app.run('reads.length'), reads);
    }
    app.run('ui.customizeReducer.selectedTab="TAB_CUSTOMIZE";uiListener();');
    assert.equal(app.run('document.documentElement.dataset.localModtapPage'), 'customize');
    assert.ok((await app.request({action:'highlights'})).enabledKeys.includes('KEY_RIGHT_ALT'));
    app.run('onRead=()=>{ui.customizeReducer.selectedTab="ACTUATION";uiListener();};');
    assert.equal((await app.request({action:'highlights',force:true})).ok, false);
    assert.equal(app.run('writes.length'), 0);
});

test('highlight snapshots invalidate after writes and explicit refresh and never return partially verified colours', async () => {
    const app = harness();
    await app.request({action:'highlights'});
    assert.equal((await app.save(await app.read('KEY_A'), 41)).ok, true);
    assert.ok((await app.request({action:'highlights'})).enabledKeys.includes('KEY_A'));
    assert.equal((await app.restore(await app.read('KEY_A'))).ok, true);
    assert.ok(!(await app.request({action:'highlights'})).enabledKeys.includes('KEY_A'));
    app.run('records[29].enabled=1');
    assert.ok((await app.request({action:'highlights',force:true})).enabledKeys.includes('KEY_BACKSLASH'));
    for (const damage of ['r.data[1]=30','r.data[2]=7','r.data[0]=9','r.dataHeader[5]=5','r.packetSizeReturned=5','r.command[2]=27','r.status="FAIL"']) {
        const broken = harness();
        broken.run(`const get=device.getMultiModTapKeyAssignment;device.getMultiModTapKeyAssignment=async(...args)=>{const r=await get(...args);${damage};return r;};`);
        const result = await broken.request({action:'highlights'});
        assert.equal(result.ok, false, damage); assert.equal(result.enabledKeys, undefined);
        assert.equal(broken.run('writes.length'), 0);
    }
});

test('profile changes during a highlight read discard the snapshot without any write', async () => {
    const app = harness(); app.run('onRead=()=>{ui.profileReducer.selectedProfileGuid="different";};');
    const result = await app.request({action:'highlights'});
    assert.equal(result.ok, false); assert.equal(result.enabledKeys, undefined);
    assert.equal(app.run('writes.length'), 0);
});

test('each edited key retains its first original across repeated saves and restores', async () => {
    const app = harness(), beforeLayers = app.run('JSON.stringify(layers)');
    const a = await app.read('KEY_A');
    assert.equal(a.hold, 'A');
    assert.equal(a.profileName, 'My onboard profile');
    let saved = await app.save(a, 41);
    assert.equal(saved.ok, true, saved.message);
    assert.deepEqual(plain(app.run('writes')), [{profile:3,record:{keyId:31,enabled:1,keyCode:41,holdTime:250}}]);
    assert.equal((await app.save(saved.view, 80)).ok, true);
    assert.equal((await app.save(await app.read(), 80)).ok, true);
    assert.equal(app.entries().length, 2);
    assert.deepEqual(app.entries().find(entry => entry.baseline.target === 'KEY_A').baseline.original, {keyId:31,enabled:0,keyCode:0,holdTime:250});
    assert.equal((await app.restore(await app.read('KEY_A'))).ok, true);
    assert.equal(app.run('records[31].enabled'), 0);
    assert.equal(app.run('records[29].enabled'), 1, 'Restoring one key must leave other edits intact');
    assert.equal(app.run('JSON.stringify(layers)'), beforeLayers);
    assert.equal(app.run('writes.some(w=>w.record.keyId===30||w.record.keyId===255)'), false);
});

test('imports the successful Backslash test original and retains it after another tap action', async () => {
    const app = harness();
    const prepared = plain(await app.context.__razerModTapProbe.test('prepare'));
    assert.equal(prepared.ok, true, prepared.message);
    app.data[MODTAP_STORAGE_KEY] = { state: 'applied', backup: prepared.backup };
    app.run('records[29]={keyId:29,enabled:1,keyCode:80,holdTime:250};');
    const view = await app.read();
    assert.equal(view.current.keyCode, 80); assert.equal(view.hasBackup, true);
    assert.equal(app.entries()[0].importedFromBackslashTest, true);
    assert.equal(app.entries()[0].baseline.original.enabled, 0);
    assert.equal((await app.save(view, 41)).ok, true);
    assert.equal((await app.restore(await app.read())).ok, true);
    assert.equal(app.run('records[29].enabled'), 0);
    assert.equal(app.data[MODTAP_STORAGE_KEY].backup.id, prepared.backup.id, 'Never discard the original test backup');
});

test('editing a stock modifier uses another independent control key', async () => {
    const app = harness();
    const result = await app.save(await app.read('KEY_RIGHT_ALT'), 41);
    assert.equal(result.ok, true, result.message);
    assert.equal(app.run('records[62].keyCode'), 41);
    assert.ok(app.run('reads.some(r=>r[0]==="modtap"&&r[1]===64)'));
    assert.equal(app.run('writes.every(w=>w.record.keyId===62)'), true);
});

test('excluded targets, unready UI profiles and unsaved normal mappings cannot reach a write', async () => {
    for (const inputID of ['KEY_CAPS_LOCK', 'KEY_FN', 'KEY_FUNCTION', 'KEY_ESC', 'KEY_UNKNOWN']) {
        const app = harness();
        try { assert.equal((await app.request({action:'read',inputID})).ok, false); }
        catch (error) { assert.match(error.message, /eligible key|excluded/); }
        assert.equal(app.run('writes.length + reads.length'), 0, inputID);
    }
    for (const change of ['ui.customizeReducer.isMappingChanged=true', 'ui.profileReducer.selectedProfileGuid="other"', 'ui.profileReducer.selectedObmSlotId=4']) {
        const app = harness(); app.run(change);
        assert.equal((await app.request({ action: 'read', inputID: 'KEY_A' })).ok, false);
        assert.equal(app.run('writes.length + reads.length'), 0);
    }
});

test('stale views and unlisted tap outputs cannot write', async () => {
    for (const change of ['serial="OTHER-KEYBOARD-123"', 'records[31].keyCode=41', 'engine.inputIDToMapping.keyboardMappingName="new-layout"',
        'profiles.currentProfile.guid="new-guid"; profiles.profiles[0].guid="new-guid"; ui.profileReducer.selectedProfileGuid="new-guid"']) {
        const app = harness(), view = await app.read('KEY_A'); app.run(change);
        await assert.rejects(app.save(view, 80), /changed/);
        assert.equal(app.run('writes.length'), 0);
    }
    for (const code of [57, 0, 300]) {
        const app = harness();
        const result = await app.save(await app.read('KEY_A'), code);
        assert.equal(result.ok, false); assert.equal(app.run('writes.length'), 0);
    }
});

test('profile or pending UI changes during preparation block further reads and all writes', async () => {
    for (const change of ['ui.customizeReducer.isMappingChanged=true', 'profiles.currentProfile.guid="changed"', 'engine.inputIDToMapping.keyboardMappingName="changed"']) {
        const app = harness(); app.run(`onRead=()=>{${change};};`);
        assert.equal((await app.request({ action:'read', inputID:'KEY_A' })).ok, false);
        assert.equal(app.run('reads.length'), 1);
        assert.equal(app.run('writes.length'), 0);
    }
});

test('inline editor follows the selected Synapse key and blocks selection changes before or during a save', async () => {
    for (const duringRead of [false, true]) {
        const app = harness(), view = await app.read('KEY_A');
        app.run(duringRead ? 'onRead=()=>{ui.customizeReducer.activeButton.inputID="KEY_BACKSLASH";};'
            : 'ui.customizeReducer.activeButton.inputID="KEY_BACKSLASH";');
        const result = await app.request({ action:'save', inputID:'KEY_A', expected:view.expected,
            requireSelected:true, settings:{enabled:true,keyCode:41} });
        assert.equal(result.ok, false); assert.match(result.message, /selected key changed/);
        assert.equal(app.run('writes.length'), 0);
    }
    const app = harness(), view = await app.read('KEY_A');
    assert.equal((await app.request({action:'save',inputID:'KEY_A',expected:view.expected,requireSelected:true,settings:{enabled:true,keyCode:41}})).ok, true);
});

test('failed backup persistence prevents any device write', async () => {
    for (const mode of ['throws', 'discarded', 'corrupt']) {
        const app = harness(), view = await app.read('KEY_A');
        const save = app.api.storage.local.set;
        app.api.storage.local.set = async value => {
            if (mode === 'throws') throw Error('storage unavailable');
            if (mode === 'corrupt') { value = structuredClone(value); Object.values(value[MODTAP_EDITOR_STORAGE_KEY].entries)[0].baseline.original.keyCode = 80; await save(value); }
        };
        await assert.rejects(app.save(view, 41), /storage unavailable|backup could not be verified/);
        assert.equal(app.run('writes.length'), 0);
        assert.ok(!app.calls.includes('apply'));
    }
});

test('failed verification retains pending backup, blocks new saves and allows explicit restore', async () => {
    const app = harness(), view = await app.read('KEY_A'); app.run('failAfterWrite=true');
    const result = await app.save(view, 41);
    assert.equal(result.ok, false); assert.equal(app.entries()[0].state, 'unverified');
    assert.ok(app.entries()[0].pending); assert.equal(app.run('writes.length'), 1);
    app.run('failAfterWrite=false');
    const refreshed = await app.read('KEY_A'); assert.equal(refreshed.pending, true);
    await assert.rejects(app.save(refreshed, 80), /previous write is unverified/);
    assert.equal((await app.restore(refreshed)).ok, true);
    assert.equal(app.entries()[0].pending, null); assert.equal(app.run('records[31].enabled'), 0);
});

function retainDisabledTapCode(app) {
    app.run(`const setter=device.setMultiModTapKeyAssignment;
        device.setMultiModTapKeyAssignment=async(p,items)=>{
            const previous={...records[items[0].keyId]}, response=await setter(p,items);
            if(items[0].enabled===0)records[items[0].keyId].keyCode=previous.keyCode;
            return response;
        };`);
}

async function staleDisabledRestore(olderReport = false) {
    const app = harness(); retainDisabledTapCode(app);
    const saved = await app.save(await app.read('KEY_A'), 41);
    const restored = await app.restore(saved.view);
    assert.equal(restored.ok, true, restored.message);
    // Reproduce the previous verifier's false-negative and persisted lock.
    const entry = app.entries()[0];
    entry.state = 'unverified'; entry.lastVerified = saved.current;
    entry.pending = {before:saved.current,desired:entry.baseline.original,startedAt:restored.report.startedAt};
    entry.lastResult.ok = false; entry.lastResult.report.readBackMatches = false;
    entry.lastResult.report.state = 'write-unverified';
    entry.lastResult.report.verificationFailures = ['dual-purpose record read-back'];
    delete entry.lastResult.report.disabledTapCodeRetained;
    if (olderReport) {
        delete entry.lastResult.report.writeAcknowledged;
        delete entry.lastResult.report.verificationFailures;
    }
    return app;
}

test('disabling and restoring accepts only the previous unused tap code and keeps the actual record in the editor', async () => {
    const app = harness(); retainDisabledTapCode(app);
    const saved = await app.save(await app.read('KEY_A'), 41);
    const disabled = await app.save(saved.view, 80, false);
    assert.equal(disabled.ok, true, disabled.message);
    assert.equal(disabled.report.disabledTapCodeRetained, true);
    assert.equal(disabled.view.current.keyCode, 41, 'Show the device value, not the requested but ignored disabled tap code');
    assert.deepEqual(disabled.view.expected.current, disabled.current);
    assert.deepEqual(app.entries()[0].lastVerified, disabled.current);
    assert.equal(app.entries()[0].pending, null);
    const writes = app.run('writes.length');
    const restored = await app.restore(disabled.view);
    assert.equal(restored.ok, true, restored.message);
    assert.equal(restored.view.restored, true);
    assert.equal(app.run('writes.length'), writes, 'An already-disabled key does not need another write');
    assert.equal(app.entries()[0].baseline.original.keyCode, 0, 'Keep the original backup unchanged');
    assert.equal((await app.save(restored.view, 80)).ok, true, 'The returned view can be used immediately without a stale-snapshot error');
});

test('fresh reads reconcile old disabled restores, preserve evidence and unlock editing without a device write', async () => {
    for (const olderReport of [false, true]) {
        const app = await staleDisabledRestore(olderReport);
        const original = structuredClone(app.entries()[0].baseline), report = structuredClone(app.entries()[0].lastResult);
        const writes = app.run('writes.length');
        const result = await app.request({action:'read',inputID:'KEY_A'});
        assert.equal(result.ok, true); assert.equal(result.view.pending, false); assert.equal(result.view.restored, true);
        assert.match(result.message, /Previous restore verified with fresh keyboard reads/);
        assert.equal(app.run('writes.length'), writes);
        assert.deepEqual(app.entries()[0].baseline, original); assert.deepEqual(app.entries()[0].lastResult, report);
        assert.equal(app.entries()[0].reconciliation.readOnly, true);
        assert.equal((await app.save(result.view, 80)).ok, true);
    }
});

test('pending recovery refuses missing evidence, other verification failures or changed current records and layers', async () => {
    const mutations = [
        app=>{app.entries()[0].lastResult.report.writeAcknowledged=false;},
        app=>{app.entries()[0].lastResult.report.writeResponse.valid=false;},
        app=>{app.entries()[0].lastResult.report.controlUnchanged=false;},
        app=>{app.entries()[0].lastResult.report.layersUnchanged=false;},
        app=>{app.entries()[0].lastResult.report.verificationFailures.push('write acknowledgment');},
        app=>{app.entries()[0].lastResult.report.requested.keyCode=80;},
        app=>{delete app.entries()[0].lastResult;},
        app=>app.run('records[31].keyCode=80'),
        app=>app.run('records[31].enabled=1'),
        app=>app.run('records[31].holdTime=249'),
        app=>app.run('records[62].keyCode=79'),
        app=>app.run('layers[31][6]=80'),
        app=>app.run('layers[31][14]=80'),
    ];
    for (const mutate of mutations) {
        const app = await staleDisabledRestore(); mutate(app);
        const writes = app.run('writes.length'), view = await app.read('KEY_A');
        assert.equal(view.pending, true); assert.equal(app.run('writes.length'), writes);
        await assert.rejects(app.save(view, 80), /previous write is unverified/);
    }
});

test('recovery storage failure preserves the pending backup and never writes to the keyboard', async () => {
    const app = await staleDisabledRestore(), writes = app.run('writes.length');
    app.api.storage.local.set = async()=>{throw Error('storage unavailable');};
    await assert.rejects(app.read('KEY_A'), /storage unavailable/);
    assert.ok(app.entries()[0].pending); assert.equal(app.run('writes.length'), writes);
});

test('explicit Restore can verify a known disabled pending record after later normal mapping changes without sending another SET', async () => {
    const app = await staleDisabledRestore(), writes = app.run('writes.length');
    app.run('layers[31][6]=80');
    const refreshed = await app.read('KEY_A'); assert.equal(refreshed.pending, true);
    const restored = await app.restore(refreshed);
    assert.equal(restored.ok, true, restored.message); assert.equal(restored.view.pending, false);
    assert.equal(app.run('writes.length'), writes); assert.equal(app.run('layers[31][6]'), 80);
});

test('page loss after saving the backup retains recovery state', async () => {
    const app = harness(), view = await app.read('KEY_A'), execute = app.api.scripting.executeScript;
    app.api.scripting.executeScript = async options => {
        if (options.args[0] === 'apply') throw Error('frame closed');
        return execute(options);
    };
    await assert.rejects(app.save(view, 41), /frame closed/);
    assert.ok(app.entries()[0].pending); assert.equal(app.entries()[0].baseline.original.enabled, 0);
    assert.equal(app.run('writes.length'), 0);
    assert.equal((await app.restore(await app.read('KEY_A'))).ok, true);
});

test('restore preserves later ordinary-layer edits and refuses unknown Mod Tap changes', async () => {
    const app = harness();
    assert.equal((await app.save(await app.read('KEY_A'), 41)).ok, true);
    app.run('layers[31][6]=49; layers[31][14]=222');
    const layers = app.run('JSON.stringify(layers)');
    assert.equal((await app.restore(await app.read('KEY_A'))).ok, true);
    assert.equal(app.run('JSON.stringify(layers)'), layers);
    app.run('records[31].enabled=1; records[31].keyCode=231');
    const writes = app.run('writes.length');
    await assert.rejects(app.restore(await app.read('KEY_A')), /unexpected setting/);
    assert.equal(app.run('writes.length'), writes);
});

test('editor sender accepts only this extension content script in the correct product frame', () => {
    const sender = {id:'local-extension',url:'https://synapse.razer.com/products/688/?view=customize',tab:{id:7},frameId:42};
    assert.deepEqual(modTapEditorSender(sender, 'local-extension'), frame);
    for (const bad of [ {id:'other'}, {frameId:undefined}, {tab:null}, {url:'https://synapse.razer.com/dashboard'},
        {url:'https://synapse.razer.com/products/229/'}, {url:'https://synapse.razer.com.evil.test/products/688/'},
        {url:'http://synapse.razer.com/products/688/'}, {url:'https://synapse.razer.com/products/6880/'} ]) {
        assert.equal(modTapEditorSender({...sender,...bad},'local-extension'), null);
    }
});
