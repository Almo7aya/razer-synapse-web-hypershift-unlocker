import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createModTapProbe, runModTapProbeInPage, collectModTapProbeInPage } from '../src/modtap-probe.mjs';
import { MODTAP_STORAGE_KEY, runModTapTest } from '../src/modtap-session.mjs';

function harness() {
    const timers = new Map();
    const context = vm.createContext({ crypto: webcrypto, TextEncoder, setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); } });
    const run = source => vm.runInContext(source, context);
    run(`window = globalThis;
        location = { origin: 'https://synapse.razer.com', pathname: '/products/688/' }; frames = [];
        const reads = []; let writes = 0, respond;
        const reply = (profile, key, enabled = 0) => ({status:'SUCCESS', command:[80,2,155], dataHeader:new Uint8Array([2,1,0,0,0,5,2,155]), packetSizeReturned:5, data:[profile,key,enabled,49,250]});
        const device = {
            productId:688, isSending:false, isDriverMode:false,
            async getMultiModTapKeyAssignment(profile, keys) { reads.push({profile,keys}); return respond ? await respond(profile,keys[0]) : reply(profile,keys[0]); },
            setMultiModTapKeyAssignment() { writes++; throw Error('WRITE FORBIDDEN'); },
            sendCommand() { writes++; throw Error('RAW COMMAND FORBIDDEN'); },
        };
        const mapping = { KEY_RIGHT_ALT:{inputID:'KEY_RIGHT_ALT',fwID:62}, KEY_BACKSLASH:{inputID:'KEY_BACKSLASH',fwID:29}, KEY_CAPS_LOCK:{inputID:'KEY_CAPS_LOCK',fwID:30} };
        const engine = { name:'obmEngineKeyboardCalMaxMem', rzDevice:device, options:{modTap:true}, modTapKeyIdList:[62,64,129,57],
            inputIDToMapping:{keyboard:{NormalMode:mapping},keyboardMappingName:'active-layout'},
            fwIDToMapping:{keyboard:{NormalMode:Object.fromEntries(Object.values(mapping).map(m=>[m.fwID,m]))}},
            obmJson:{profiles:[{id:3}]},
            setModTapKeyAssignment() { writes++; throw Error('WRITE FORBIDDEN'); },
        };
        const web = {_initialized:true,_rzDevice:device,_obm:{engine}};
        const profiles = {currentProfile:{id:3,guid:'test-guid'},profiles:[{obmSlotId:3,guid:'test-guid'}]};
        const observer = (${createModTapProbe.toString()})();
        observer.observeModule({exports:{A:web}}, 'initializeRzDevice [WebRzDevice] get obmEngine()');
        observer.observeModule({exports:{A:profiles}}, 'current profile changed currentProfile obmSlotId');
    `);
    return { run, context, timers, probe: () => context.__razerModTapProbe.run(), snapshot: () => JSON.parse(JSON.stringify(context.__razerModTapProbe.snapshot())) };
}

test('reads the control and Backslash on demand, never Caps Lock or any assignment writer', async () => {
    const app = harness();
    assert.equal(app.run('reads.length'), 0, 'Loading the observer must not communicate with the device');
    const result = await app.probe();
    assert.equal(result.ok, true);
    assert.equal(app.run('JSON.stringify(reads)'), '[{"profile":3,"keys":[62]},{"profile":3,"keys":[29]}]');
    assert.equal(app.run('writes'), 0);
    const snapshot = app.snapshot();
    assert.equal(snapshot.last.target, 'KEY_BACKSLASH');
    assert.equal(snapshot.last.readOnly, true);
    assert.equal(snapshot.last.state, 'read-complete');
    assert.equal(snapshot.last.results[1].record.keyId, 29);
    assert.equal(app.timers.size, 0);
    snapshot.last.results[1].record.enabled = 1;
    assert.equal(app.snapshot().last.results[1].record.enabled, 0, 'Report must be detached from live state');
});

test('resolves key IDs from current mappings instead of assuming US IDs', async () => {
    const app = harness();
    app.run(`mapping.KEY_RIGHT_ALT.fwID=70; mapping.KEY_BACKSLASH.fwID=71;
        engine.modTapKeyIdList=[70];
        engine.fwIDToMapping.keyboard.NormalMode={70:mapping.KEY_RIGHT_ALT,71:mapping.KEY_BACKSLASH};`);
    assert.equal((await app.probe()).ok, true);
    assert.equal(app.run('reads.map(r=>r.keys[0]).join(",")'), '70,71');
});

test('blocks unready, wrong-device, busy, driver-controlled and ambiguous mapping states before any reads', async () => {
    for (const change of [
        'web._initialized=false', 'device.productId=229', 'device.isSending=true', 'device.isDriverMode=true',
        'engine.rzDevice={}', 'engine.options.modTap=false', 'profiles.currentProfile.guid="unknown"',
        'engine.obmJson.profiles=[]', 'delete mapping.KEY_BACKSLASH', 'mapping.KEY_BACKSLASH.fwID=255',
        'engine.fwIDToMapping.keyboard.NormalMode[29]={inputID:"KEY_CAPS_LOCK"}', 'engine.modTapKeyIdList.push(29)',
        'device.getMultiModTapKeyAssignment=undefined',
    ]) {
        const app = harness(); app.run(change);
        assert.equal((await app.probe()).ok, false, change);
        assert.equal(app.run('reads.length + writes'), 0, change);
    }
});

test('a failed or malformed control reply prevents the candidate read', async () => {
    for (const change of [
        'r.status="FAIL"', 'r.packetSizeReturned=80', 'r.command[2]=27', 'r.dataHeader[7]=27',
        'r.dataHeader[0]=5', 'r.data[0]=4', 'r.data[1]=29', 'r.data[2]=7', 'r.data[3]="bad"', 'r.data=[]',
    ]) {
        const app = harness(); app.run(`respond=(p,k)=>{const r=reply(p,k); ${change}; return r;};`);
        assert.equal((await app.probe()).ok, false, change);
        assert.equal(app.run('reads.length'), 1, change);
        assert.equal(app.snapshot().last.state, 'control-failed');
    }
});

test('a firmware rejection or different returned key remains an unverified candidate, not support', async () => {
    for (const mode of ['failure', 'wrong-key']) {
        const app = harness();
        app.run(`respond=(p,k)=> k===62 ? reply(p,k) : ${mode === 'failure' ? '({...reply(p,k),status:"FAIL"})' : 'reply(p,62)'};`);
        assert.equal((await app.probe()).ok, false);
        assert.equal(app.snapshot().last.state, 'candidate-unverified');
        assert.equal(app.snapshot().last.results[1].valid, false);
        assert.equal(app.run('writes'), 0);
    }
});

test('concurrent clicks and timeout cannot launch extra reads while the transport is pending', async () => {
    const app = harness();
    app.run('let finish; respond=(p,k)=>new Promise(resolve=>{finish=()=>resolve(reply(p,k));});');
    const pending = app.probe();
    assert.equal((await app.probe()).ok, false);
    assert.equal(app.run('reads.length'), 1);
    app.timers.get(1)();
    assert.equal(app.snapshot().last.state, 'waiting');
    assert.equal((await app.probe()).ok, false);
    app.run('finish();');
    assert.equal((await pending).ok, false);
    assert.equal(app.run('reads.length'), 1, 'A late control response must not trigger the candidate');
    assert.equal(app.snapshot().running, false);
});

test('profile changes during the first read stop the probe', async () => {
    const app = harness();
    app.run('respond=(p,k)=>{profiles.currentProfile.guid="changed";return reply(p,k);};');
    assert.equal((await app.probe()).ok, false);
    assert.equal(app.run('reads.length'), 1);
    assert.equal(app.snapshot().last.state, 'read-failed');
});

test('page entry points find hidden product frames, export results and refuse ambiguous frames', async () => {
    const app = harness();
    app.run(`const child={location:{...location},frames:[],__razerModTapProbe};
        location.pathname='/dashboard'; frames=[child]; delete window.__razerModTapProbe;`);
    const result = await app.run(`(${runModTapProbeInPage.toString()})()`);
    assert.equal(result.ok, true);
    const reports = app.run(`(${collectModTapProbeInPage.toString()})()`);
    assert.equal(reports[0].last.target, 'KEY_BACKSLASH');
    assert.equal(reports[0].frame, 'top/0');
    app.run('frames.push({...child});');
    assert.equal((await app.run(`(${runModTapProbeInPage.toString()})()`)).ok, false);
    assert.equal(app.run('reads.length'), 2, 'Ambiguous frames must not send a second probe');
});

function writerHarness() {
    const app = harness();
    app.run(`
        let serial = 'TEST-KEYBOARD-123', layerChanged = false;
        let candidateRecord = {keyId:29,enabled:0,keyCode:0,holdTime:250};
        const writeCalls = [], layerReads = [];
        device.getSerialNumber = async () => ({status:'SUCCESS',jsonData:{serialNumberAscii:serial}});
        respond = (p,k) => {
            const record = k===62 ? {keyId:62,enabled:1,keyCode:80,holdTime:250} : candidateRecord;
            return {...reply(p,k),data:[p,record.keyId,record.enabled,record.keyCode,record.holdTime]};
        };
        device.getMultiKeyAssignment = async (p,keys) => {
            layerReads.push(keys);
            return {status:'SUCCESS',command:[80,2,158],dataHeader:[2,1,0,0,0,19,2,158],packetSizeReturned:19,
                data:[p,29,0,2,2,0,layerChanged?4:49,0,0,0,29,1,0,0,0,0,0,0,0]};
        };
        device.setMultiModTapKeyAssignment = async (p,records) => {
            writes++;
            writeCalls.push({profile:p,records:JSON.parse(JSON.stringify(records))});
            candidateRecord = {...records[0]};
            return {...reply(p,29),command:[80,2,27],dataHeader:[2,1,0,0,0,5,2,27],
                data:[p,candidateRecord.keyId,candidateRecord.enabled,candidateRecord.keyCode,candidateRecord.holdTime]};
        };
    `);
    return { ...app, test: (action, backup) => app.context.__razerModTapProbe.test(action, backup) };
}

test('explicit Left Arrow test backs up, writes only Backslash, verifies both layers and restores exact original', async () => {
    const app = writerHarness();
    const prepared = await app.test('prepare');
    assert.equal(prepared.ok, true, prepared.message);
    assert.equal(app.run('writes'), 0);
    assert.equal(prepared.backup.original.enabled, 0);
    assert.equal(prepared.backup.test.keyCode, 80);
    assert.match(prepared.backup.deviceHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(prepared).includes('TEST-KEYBOARD'), false, 'No raw serial in backup');
    assert.ok(prepared.report.finishedAt);
    const applied = await app.test('apply', prepared.backup);
    assert.equal(applied.ok, true, applied.message);
    assert.equal(applied.report.state, 'applied');
    assert.equal(applied.report.readBackMatches, true);
    assert.equal(applied.report.layersUnchanged, true);
    assert.equal(applied.report.controlUnchanged, true);
    assert.equal(app.run('writes'), 1);
    assert.equal(app.run('JSON.stringify(writeCalls)'), '[{"profile":3,"records":[{"keyId":29,"enabled":1,"keyCode":80,"holdTime":250}]}]');
    assert.equal((await app.test('apply', prepared.backup)).ok, false, 'Cannot replay the prepared write');
    const restored = await app.test('restore', prepared.backup);
    assert.equal(restored.ok, true, restored.message);
    assert.equal(restored.report.state, 'restored');
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(candidateRecord)')), JSON.parse(JSON.stringify(prepared.backup.original)));
    assert.equal(app.run('writes'), 2);
    assert.equal(app.run('writeCalls.every(c=>c.records.length===1 && c.records[0].keyId===29)'), true);
    assert.equal(app.run('layerReads.every(keys=>keys.length===2 && keys.every(k=>k.keyId===29))'), true);
    restored.report.results[0].record.enabled = 99;
    assert.notEqual(app.snapshot().last.results[0].record.enabled, 99);
});

test('the saved original can be restored after the page runtime has reloaded', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    assert.equal((await app.test('apply', backup)).ok, true);
    app.run(`const reloaded = (${createModTapProbe.toString()})();
        reloaded.observeModule({exports:{A:web}},'initializeRzDevice [WebRzDevice] get obmEngine()');
        reloaded.observeModule({exports:{A:profiles}},'current profile changed currentProfile obmSlotId');`);
    assert.equal((await app.test('restore', backup)).ok, true);
    assert.equal(app.run('candidateRecord.enabled'), 0);
});

test('reordered backup properties across the extension boundary still allow the exact prepared test', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    const sortedProperties = value => Array.isArray(value) ? value.map(sortedProperties)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedProperties(value[key])])) : value;
    const reordered = sortedProperties(backup);
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(backup), 'Reproduce changed property order');
    const applied = await app.test('apply', reordered);
    assert.equal(applied.ok, true, applied.message);
    assert.equal(app.run('writes'), 1);
    assert.equal((await app.test('restore', reordered)).ok, true);
    assert.equal(app.run('candidateRecord.enabled'), 0);
});

test('an old prepared backup can be checked without a write, then retried across reordered storage and page messages', async () => {
    const app = writerHarness();
    const preparation = await app.test('prepare');
    const sortedProperties = value => Array.isArray(value) ? value.map(sortedProperties)
        : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedProperties(value[key])])) : value;
    let stored = sortedProperties({ schemaVersion:1, backup:preparation.backup, state:'prepared', preparation:preparation.report });
    app.run(`const reloaded = (${createModTapProbe.toString()})();
        reloaded.observeModule({exports:{A:web}},'initializeRzDevice [WebRzDevice] get obmEngine()');
        reloaded.observeModule({exports:{A:profiles}},'current profile changed currentProfile obmSlotId');`);
    const api = {
        storage: { local: {
            async get() { return { [MODTAP_STORAGE_KEY]: sortedProperties(stored) }; },
            async set(value) { stored = sortedProperties(value[MODTAP_STORAGE_KEY]); },
        } },
        scripting: { async executeScript({ args: [action, backup] }) {
            return [{ result: sortedProperties(await app.test(action, sortedProperties(backup))) }];
        } },
    };
    const restored = await runModTapTest(api, {tabId:7,action:'restore'});
    assert.equal(restored.ok, true, restored.message);
    assert.equal(app.run('writes'), 0, 'Checking the unwritten original must not issue SET');
    assert.equal(stored.state, 'restored');
    const applied = await runModTapTest(api, {tabId:7,action:'apply'});
    assert.equal(applied.ok, true, applied.message);
    assert.equal(app.run('writes'), 1);
    assert.equal(stored.state, 'applied');
    assert.equal(stored.backup.original.enabled, 0);
    assert.equal(stored.application.report.layersUnchanged, true);
});

test('preparation requires a disabled candidate, known control, identity and readable assignment layers', async () => {
    for (const change of [
        'candidateRecord.enabled=1', 'serial="NOSERIALNUMBER"', 'serial=""',
        'device.getMultiKeyAssignment=async()=>({status:"FAIL"})',
        'respond=(p,k)=>reply(p,k,0)',
    ]) {
        const app = writerHarness(); app.run(change);
        assert.equal((await app.test('prepare')).ok, false, change);
        assert.equal(app.run('writes'), 0);
    }
});

test('device, profile, layout, mapping or records changing between backup and apply prevents any write', async () => {
    for (const change of [
        'serial="DIFFERENT-KEYBOARD"', 'profiles.currentProfile.guid="different-profile"',
        'engine.inputIDToMapping.keyboardMappingName="different-layout"', 'layerChanged=true',
        'candidateRecord.keyCode=42', 'device.isDriverMode=true',
    ]) {
        const app = writerHarness();
        const { backup } = await app.test('prepare');
        app.run(change);
        assert.equal((await app.test('apply', backup)).ok, false, change);
        assert.equal(app.run('writes'), 0, change);
    }
});

test('tampered backups and unprepared actions never write', async () => {
    for (const change of [backup => backup.test.keyId = 30, backup => backup.test.keyCode = 41,
        backup => backup.original.enabled = 1, backup => backup.profileId = 4,
        backup => backup.originalLayers.reverse(), backup => backup.original.extra = true,
        backup => backup.id = 'different-preparation', backup => backup.test.holdTime = 249]) {
        const app = writerHarness();
        const { backup } = await app.test('prepare');
        change(backup);
        assert.equal((await app.test('apply', backup)).ok, false);
        assert.equal(app.run('writes'), 0);
    }
    const app = writerHarness();
    assert.equal((await app.test('apply')).ok, false);
    assert.equal((await app.test('restore', {})).ok, false);
    assert.equal(app.run('writes'), 0);
});

test('a failed SET is read back without retrying, and an unchanged original restores without a write', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    app.run('device.setMultiModTapKeyAssignment=async()=>{writes++;return {status:"FAIL"};};');
    const result = await app.test('apply', backup);
    assert.equal(result.ok, false);
    assert.equal(result.report.state, 'write-unverified');
    assert.equal(result.report.readBackMatches, false);
    assert.equal(app.run('writes'), 1);
    assert.equal((await app.test('restore', backup)).ok, true);
    assert.equal(app.run('writes'), 1, 'Restoring an already original record must not write');
});

test('SET exceptions are treated as potentially applied, preserving the restore path', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    app.run('const setter=device.setMultiModTapKeyAssignment; device.setMultiModTapKeyAssignment=async(...args)=>{await setter(...args);throw Error("transport failed after write");};');
    const result = await app.test('apply', backup);
    assert.equal(result.ok, false);
    assert.equal(result.report.readBackMatches, true);
    assert.equal(result.report.writeAcknowledged, false);
    assert.deepEqual(Array.from(result.report.verificationFailures), ['write acknowledgment']);
    assert.match(result.message, /requested dual-purpose record reads back correctly/);
    app.run('device.setMultiModTapKeyAssignment=setter;');
    assert.equal((await app.test('restore', backup)).ok, true);
    assert.equal(app.run('candidateRecord.enabled'), 0);
});

test('restore distinguishes a matching original read-back from an invalid SET acknowledgment', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    assert.equal((await app.test('apply', backup)).ok, true);
    app.run('const setter=device.setMultiModTapKeyAssignment; device.setMultiModTapKeyAssignment=async(...args)=>{await setter(...args);return {status:"FAIL"};};');
    const result = await app.test('restore', backup);
    assert.equal(result.ok, false, 'An invalid acknowledgment remains an incomplete verification');
    assert.equal(app.run('candidateRecord.enabled'), 0, 'The simulated keyboard did restore despite the invalid acknowledgment');
    assert.equal(result.report.readBackMatches, true);
    assert.deepEqual(Array.from(result.report.verificationFailures), ['write acknowledgment']);
    assert.match(result.message, /original dual-purpose record reads back correctly/);
    assert.match(result.message, /Verification incomplete: write acknowledgment/);
    assert.equal(app.run('writes'), 2, 'No automatic retry');
});

test('restore accepts a retained disabled tap code and a repeated restore sends no SET', async () => {
    const app = writerHarness(), {backup} = await app.test('prepare');
    assert.equal((await app.test('apply', backup)).ok, true);
    app.run(`const setter=device.setMultiModTapKeyAssignment;
        device.setMultiModTapKeyAssignment=async(...args)=>{const code=candidateRecord.keyCode;
            const response=await setter(...args);candidateRecord.keyCode=code;return response;};`);
    const restored = await app.test('restore', backup);
    assert.equal(restored.ok, true, restored.message);
    assert.equal(restored.report.disabledTapCodeRetained, true);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.current)), {keyId:29,enabled:0,keyCode:80,holdTime:250});
    assert.equal((await app.test('restore', backup)).ok, true);
    assert.equal(app.run('writes'), 2);
});

test('disabled read-back still rejects unexpected codes, timing, enable state, acknowledgment and layer changes', async () => {
    for (const damage of ['candidateRecord.keyCode=81', 'candidateRecord.holdTime=249', 'candidateRecord.enabled=1',
        'response.status="FAIL"', 'layerChanged=true']) {
        const app = writerHarness(), {backup} = await app.test('prepare');
        assert.equal((await app.test('apply', backup)).ok, true);
        app.run(`const setter=device.setMultiModTapKeyAssignment;
            device.setMultiModTapKeyAssignment=async(...args)=>{const response=await setter(...args);
                candidateRecord.keyCode=80;${damage};return response;};`);
        const result = await app.test('restore', backup);
        assert.equal(result.ok, false, damage);
        assert.equal(app.run('writes'), 2, 'Never retry a write automatically');
    }
});

test('changes in mapping layers after SET are reported, not overwritten by Restore', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    app.run('const setter=device.setMultiModTapKeyAssignment; device.setMultiModTapKeyAssignment=async(...args)=>{const r=await setter(...args);layerChanged=true;return r;};');
    const result = await app.test('apply', backup);
    assert.equal(result.ok, false);
    assert.equal(result.report.layersUnchanged, false);
    assert.equal((await app.test('restore', backup)).ok, false);
    assert.equal(app.run('writes'), 1);
});

test('a timeout keeps the lock until the outstanding write settles and cannot cause another write', async () => {
    const app = writerHarness();
    const { backup } = await app.test('prepare');
    app.run('let finishWrite; device.setMultiModTapKeyAssignment=async()=>{writes++;return new Promise(resolve=>{finishWrite=()=>resolve({status:"FAIL"});});};');
    const pending = app.test('apply', backup);
    while (!app.run('writes')) await new Promise(resolve => setImmediate(resolve));
    app.timers.get(1)();
    assert.equal((await app.test('restore', backup)).ok, false);
    assert.equal((await app.probe()).ok, false);
    app.run('finishWrite();');
    assert.equal((await pending).ok, false);
    assert.equal(app.run('writes'), 1);
    assert.equal(app.snapshot().running, false);
});
