// Device verification for the audited Huntsman V3 Pro Mini Web bundle.
// Passed into the document-start runtime; all dependencies stay inside this function.
export function createModTapProbe() {
    let webDevice, profiles, uiStore, unsubscribeUI, running = false, last = null, prepared = null, highlightCache = null, lastHighlights = null;
    const own = (object, key) => object && Object.getOwnPropertyDescriptor(object, key)?.value;
    const byte = value => Number.isInteger(value) && value >= 0 && value <= 255;
    const clone = value => JSON.parse(JSON.stringify(value));
    const now = () => new Date().toISOString();

    const protectedKey = inputID => /CAPS|^KEY_FN$|^KEY_FUNCTION$/i.test(inputID);
    const label = inputID => ({ KEY_BACKSLASH: 'Backslash (\\)', KEY_LEFT_GUI: 'Left Windows', KEY_RIGHT_GUI: 'Right Windows',
        KEY_APPLICATION: 'Menu', KEY_ESC: 'Escape', KEY_SPACEBAR: 'Space', KEY_HYPEN: '-', KEY_EQUAL: '=',
        KEY_OPEN_SQUARE_BRACKET: '[', KEY_CLOSE_SQUARE_BRACKET: ']', KEY_APOSTROPHE: "'", KEY_TILDE: '`',
        KEY_COMMA: ',', KEY_PERIOD: '.', KEY_SLASH: '/', KEY_SEMICOLON: ';' })[inputID]
        || inputID.replace(/^KEY_/, '').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

    function context(target = 'KEY_BACKSLASH', editor = false, requireSelected = false) {
        if (own(webDevice, '_initialized') !== true || !profiles) throw Error('Open the keyboard page and wait for its profile to finish loading.');
        const engine = own(own(webDevice, '_obm'), 'engine');
        const device = own(webDevice, '_rzDevice');
        if (own(device, 'productId') !== 688 || !/^obmEngineKeyboard/.test(own(engine, 'name') || '')
            || own(engine, 'rzDevice') !== device || own(own(engine, 'options'), 'modTap') !== true) {
            throw Error('This keyboard engine does not match the audited Mod Tap interface.');
        }
        if (device.isDriverMode === true) throw Error('Exit desktop Synapse before running the probe.');
        if (device.isSending) throw Error('The keyboard is busy. Wait a moment and try again.');
        if (typeof device.getMultiModTapKeyAssignment !== 'function') throw Error('The read-only Mod Tap command is unavailable.');
        const current = own(profiles, 'currentProfile');
        const profileId = own(current, 'id'), guid = own(current, 'guid');
        if (editor) {
            if (!uiStore) throw Error('The Synapse key editor is not ready. Reload the keyboard page.');
            const ui = uiStore.getState();
            if (ui.customizeReducer?.isMappingChanged) throw Error('Save or cancel your normal Synapse mapping edits first.');
            if (ui.profileReducer?.selectedProfileGuid !== guid || ui.profileReducer?.selectedObmSlotId !== profileId) {
                throw Error('Wait for the selected Synapse profile to finish loading.');
            }
            if (requireSelected && selectedInputID() !== target) throw Error('The selected key changed. Open Dual-purpose for the new key.');
        }
        const list = own(profiles, 'profiles'), onboard = own(own(engine, 'obmJson'), 'profiles');
        if (!byte(profileId) || !guid || !Array.isArray(list) || !Array.isArray(onboard)
            || list.filter(p => p.obmSlotId === profileId && p.guid === guid).length !== 1
            || onboard.filter(p => p.id === profileId).length !== 1) {
            throw Error('The selected profile is not ready in onboard memory.');
        }
        const mapping = engine.inputIDToMapping?.keyboard?.NormalMode;
        const inverse = engine.fwIDToMapping?.keyboard?.NormalMode;
        const stock = own(engine, 'modTapKeyIdList');
        if (editor && (typeof target !== 'string' || !/^KEY_[A-Z0-9_]+$/.test(target) || protectedKey(target))) {
            throw Error('Caps Lock and Fn are excluded from this editor.');
        }
        const targetId = own(own(mapping, target), 'fwID');
        if (editor && !own(own(engine, 'obmJson'), 'buttonIdList')?.includes(targetId)) throw Error('This key is not present in the active keyboard layout.');
        const controlId = editor && Array.isArray(stock) ? stock.find(id => id !== targetId && inverse?.[id]?.inputID && !protectedKey(inverse[id].inputID)) : null;
        const controlInput = editor ? inverse?.[controlId]?.inputID : 'KEY_RIGHT_ALT';
        if (!controlInput) throw Error('No independent stock Mod Tap key is available for verification.');
        const keys = [['control', controlInput, label(controlInput)], ['candidate', target, label(target)]].map(([role, inputID, name]) => {
            const record = own(mapping, inputID), keyId = own(record, 'fwID');
            if (!byte(keyId) || keyId === 0 || keyId === 255 || record.inputID !== inputID || inverse?.[keyId]?.inputID !== inputID) {
                throw Error(`Cannot resolve ${name} from the active keyboard mapping.`);
            }
            return { role, inputID, name, keyId };
        });
        if (!Array.isArray(stock) || !stock.includes(keys[0].keyId) || (!editor && stock.includes(keys[1].keyId))
            || keys[0].keyId === keys[1].keyId) throw Error('The stock Mod Tap key list does not match this probe.');
        return { engine, device, profileId, guid, keys, editor, requireSelected, profileName: own(current, 'name') || 'Current onboard profile',
            mappingName: engine.inputIDToMapping.keyboardMappingName || '' };
    }

    function assertUnchanged(before) {
        const after = context(before.keys[1].inputID, before.editor, before.requireSelected);
        if (after.device !== before.device || after.engine !== before.engine || after.profileId !== before.profileId
            || after.guid !== before.guid || after.mappingName !== before.mappingName || JSON.stringify(after.keys) !== JSON.stringify(before.keys)) {
            throw Error('The keyboard or selected profile changed during the probe. Run it again after loading finishes.');
        }
    }

    function decode(response, profileId, key, commandId = 155) {
        const bytes = value => {
            if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return [];
            const result = Array.from(value).slice(0, 128);
            return result.every(byte) ? result : [];
        };
        const data = bytes(response?.data), command = bytes(response?.command), header = bytes(response?.dataHeader);
        const result = { ...key, status: typeof response?.status === 'string' ? response.status.slice(0, 40) : 'MISSING',
            command, packetSizeReturned: byte(response?.packetSizeReturned) ? response.packetSizeReturned : null, header, data, valid: false };
        if (result.status !== 'SUCCESS') result.reason = 'The device did not return SUCCESS.';
        else if (command.length !== 3 || command[0] !== 80 || command[1] !== 2 || command[2] !== commandId
            || header.length !== 8 || header[0] !== 2 || header[5] !== 5 || header[6] !== 2 || header[7] !== commandId) result.reason = 'Unexpected command or header in the reply.';
        else if (result.packetSizeReturned !== 5 || data.length < 5 || data[0] !== profileId || data[1] !== key.keyId) {
            result.reason = 'The reply does not contain the requested profile and single key record.';
        } else if (![0, 1].includes(data[2])) result.reason = 'Unexpected enabled value in the record.';
        else {
            result.valid = true;
            result.record = { keyId: data[1], enabled: data[2], keyCode: data[3], holdTime: data[4] };
        }
        return result;
    }

    async function run() {
        if (running) return { ok: false, message: 'A Mod Tap read is already running.' };
        let state;
        try { state = context(); }
        catch (error) {
            last = { schemaVersion: 1, startedAt: now(), finishedAt: now(), state: 'not-ready', readOnly: true,
                productId: '688', target: 'KEY_BACKSLASH', results: [], message: error.message,
                captured: { deviceModule: Boolean(webDevice), profileModule: Boolean(profiles) } };
            return { ok: false, message: error.message };
        }
        running = true;
        const report = last = { schemaVersion: 1, startedAt: now(), finishedAt: null, state: 'reading', readOnly: true,
            productId: '688', target: 'KEY_BACKSLASH', profileId: state.profileId, mappingName: state.mappingName,
            command: '02/9B Get Multi Mod Tap Key Assignment', results: [],
            limitation: 'A readable record does not establish writable support, tap/hold behavior or persistence.' };
        let timedOut = false;
        // A timeout does not cancel a vendor transport promise. Keep the lock
        // until it settles so reopening the popup cannot launch overlapping reads.
        const timer = setTimeout(() => {
            timedOut = true;
            report.state = 'waiting';
            report.message = 'The device read is taking longer than expected. Do not start another probe.';
        }, 15000);
        try {
            for (const key of state.keys) {
                assertUnchanged(state);
                // This read-only action never enters the explicit write path below.
                const response = await state.device.getMultiModTapKeyAssignment(state.profileId, [key.keyId]);
                const result = decode(response, state.profileId, key);
                report.results.push(result);
                if (timedOut) throw Error('Read timed out.');
                assertUnchanged(state);
                if (!result.valid) {
                    report.state = key.role === 'control' ? 'control-failed' : 'candidate-unverified';
                    report.message = `${key.name}: ${result.reason} Export diagnostics for inspection.`;
                    return { ok: false, message: report.message };
                }
            }
            report.state = 'read-complete';
            report.message = 'Backslash Mod Tap record read successfully. No assignments changed. Export diagnostics.';
            return { ok: true, message: report.message };
        } catch {
            report.state = 'read-failed';
            report.message = 'The read failed or the keyboard/profile changed. No assignments were written. Export diagnostics.';
            return { ok: false, message: report.message };
        } finally {
            clearTimeout(timer);
            report.finishedAt = now();
            running = false;
        }
    }

    // MAIN-world arguments can return with reordered object properties. Keep
    // this comparison self-contained because the factory is injected as text.
    function equal(left, right) {
        if (left === right) return true;
        if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
            || Array.isArray(left) !== Array.isArray(right)) return false;
        if (Array.isArray(left) && left.length !== right.length) return false;
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length
            && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
    }
    const sameRecord = (left, right) => Boolean(left && right && ['keyId', 'enabled', 'keyCode', 'holdTime'].every(key => left[key] === right[key]));
    // The audited keyboard retains the previous tap code when disabling a key.
    // Allow only that observed value; enabled records and timing stay exact.
    const matchesTarget = (actual, target, before) => sameRecord(actual, target) || Boolean(actual && target && before
        && target.enabled === 0 && actual.enabled === 0 && actual.keyId === target.keyId && before.keyId === target.keyId
        && actual.holdTime === target.holdTime && actual.keyCode === before.keyCode);
    function selectedInputID() {
        const selected = uiStore?.getState()?.customizeReducer?.activeButton;
        const inputID = selected?.inputID || selected?.buttonKey || null;
        return inputID === 'KEY_WINDOWS' ? 'KEY_LEFT_GUI' : inputID;
    }
    function catalog(state) {
        const mapping = state.engine.inputIDToMapping.keyboard.NormalMode;
        const inverse = state.engine.fwIDToMapping.keyboard.NormalMode;
        const physical = state.engine.obmJson.buttonIdList || [];
        const keys = Object.entries(mapping).filter(([inputID, item]) => inputID === item.inputID && !protectedKey(inputID)
            && byte(item.fwID) && item.fwID > 0 && item.fwID < 255 && physical.includes(item.fwID) && inverse[item.fwID]?.inputID === inputID)
            .map(([inputID, item]) => ({ inputID, name: label(inputID), defaultTapCode: Number(item.keyInput?.HID), support: inputID === 'KEY_BACKSLASH' ? 'Tested'
                : state.engine.modTapKeyIdList.includes(item.fwID) ? 'Stock key' : 'Experimental' }));
        const taps = new Map();
        for (const item of Object.values(mapping)) {
            const code = Number(item.keyInput?.HID);
            if (String(item.keyInput?.pageID) === '7' && code >= 4 && code <= 231 && byte(code)
                && typeof item.inputID === 'string' && !protectedKey(item.inputID)) taps.set(code, { code, name: label(item.inputID) });
        }
        return { keys, taps: [...taps.values()].sort((a, b) => a.code - b.code), profileName: state.profileName, selectedInputID: selectedInputID(),
            isHypershift: uiStore?.getState()?.customizeReducer?.isHyperShiftOn === true };
    }
    // Read-only colour snapshot, independent of saved undo records. The vendor
    // GET accepts at most 19 keys, with one profile byte and four bytes per key.
    async function highlights(force = false) {
        if (running) return { ok: false, retry: true };
        if (uiStore && uiStore.getState()?.customizeReducer?.selectedTab !== 'TAB_CUSTOMIZE') {
            return { ok: true, enabledKeys: [] };
        }
        let state;
        try { state = context('KEY_BACKSLASH', true); }
        catch { highlightCache = null; return { ok: false, retry: true }; }
        const revision = uiStore.getState().modTapReducer;
        const matches = highlightCache && highlightCache.device === state.device && highlightCache.engine === state.engine
            && highlightCache.guid === state.guid && highlightCache.profileId === state.profileId
            && highlightCache.mappingName === state.mappingName && highlightCache.revision === revision;
        if (!force && matches) return clone(highlightCache.result);
        running = true;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; }, 15000);
        const report = lastHighlights = { startedAt: now(), readOnly: true, profileId: state.profileId, batches: [] };
        try {
            const keys = catalog(state).keys, enabledKeys = [];
            const check = () => {
                if (timedOut) throw Error('Highlight read timed out.');
                if (uiStore.getState()?.customizeReducer?.selectedTab !== 'TAB_CUSTOMIZE') throw Error('Left the Customize page during the highlight read.');
                assertUnchanged(state);
                if (uiStore.getState().modTapReducer !== revision) throw Error('Dual-purpose settings changed during the read.');
            };
            for (let offset = 0; offset < keys.length; offset += 19) {
                const batch = keys.slice(offset, offset + 19);
                const ids = batch.map(key => state.engine.inputIDToMapping.keyboard.NormalMode[key.inputID].fwID);
                check();
                const response = await state.device.getMultiModTapKeyAssignment(state.profileId, ids);
                check();
                const size = 1 + ids.length * 4;
                const data = Array.from(response?.data || []).slice(0, size), header = Array.from(response?.dataHeader || []);
                let valid = response?.status === 'SUCCESS' && equal(Array.from(response?.command || []), [80, 2, 155])
                    && header.length === 8 && header[0] === 2 && header[5] === size && header[6] === 2 && header[7] === 155
                    && response.packetSizeReturned === size && data.length === size && data.every(byte) && data[0] === state.profileId;
                for (let index = 0; index < ids.length && valid; index++) {
                    const at = 1 + index * 4;
                    valid = data[at] === ids[index] && [0, 1].includes(data[at + 1]);
                    if (valid && data[at + 1] === 1) enabledKeys.push(batch[index].inputID);
                }
                report.batches.push({ ids, valid, status: response?.status || 'MISSING', data });
                if (!valid) throw Error('Could not verify the keyboard highlight snapshot.');
            }
            const result = { ok: true, enabledKeys };
            highlightCache = { ...state, revision, result };
            report.enabledKeys = enabledKeys; report.ok = true;
            return clone(result);
        } catch (error) {
            report.ok = false; report.message = error.message;
            highlightCache = null;
            return { ok: false, message: error.message };
        } finally { report.finishedAt = now(); clearTimeout(timer); running = false; }
    }
    function holdLabel(state, layers) {
        if (layers[3] === 2) {
            const modifiers = ['Left Ctrl', 'Left Shift', 'Left Alt', 'Left Windows', 'Right Ctrl', 'Right Shift', 'Right Alt', 'Right Windows']
                .filter((_, bit) => layers[5] & (1 << bit));
            const key = catalog(state).taps.find(tap => tap.code === layers[6])?.name;
            return [...modifiers, key].filter(Boolean).join(' + ') || 'Existing keyboard assignment';
        }
        return ({ 0: 'Disabled', 1: 'Existing mouse assignment', 10: 'Existing media assignment', 17: 'Existing Razer assignment' })[layers[3]] || 'Existing normal assignment';
    }
    async function hash(value) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }

    // A backup must identify the physical keyboard, not just its model or slot.
    // Raw serial numbers never leave this helper; diagnostics redact vendor logs.
    async function identity(state, check) {
        check();
        if (typeof state.device.getSerialNumber !== 'function') throw Error('Cannot identify this keyboard for a restorable test.');
        const response = await state.device.getSerialNumber();
        check();
        const serial = response?.jsonData?.serialNumberAscii;
        if (response?.status !== 'SUCCESS' || typeof serial !== 'string' || !/^[\x21-\x7e]{4,64}$/.test(serial)
            || /^(?:NOSERIALNUMBER|0+)$/i.test(serial)) throw Error('The keyboard did not return a usable identity. Nothing was written.');
        const result = { deviceHash: await hash(`688:${serial}`), profileHash: await hash(state.guid) };
        check();
        return result;
    }

    async function readRecord(state, key, report, phase, check) {
        check();
        const response = await state.device.getMultiModTapKeyAssignment(state.profileId, [key.keyId]);
        const result = decode(response, state.profileId, key);
        report.results.push({ phase, ...result });
        check();
        if (!result.valid) throw Error(`${key.name}: ${result.reason}`);
        return result.record;
    }

    async function readLayers(state, report, phase, check) {
        check();
        if (typeof state.device.getMultiKeyAssignment !== 'function') throw Error('Cannot read the original normal and Hypershift assignments.');
        const keyId = state.keys[1].keyId;
        const response = await state.device.getMultiKeyAssignment(state.profileId, [{ keyId, mode: 0 }, { keyId, mode: 1 }]);
        const data = Array.from(response?.data || []).slice(0, 19);
        const header = Array.from(response?.dataHeader || []);
        const valid = response?.status === 'SUCCESS' && equal(Array.from(response?.command || []), [80, 2, 158])
            && header.length === 8 && header[0] === 2 && header[5] === 19 && header[6] === 2 && header[7] === 158
            && response.packetSizeReturned === 19 && data.length === 19 && data.every(byte)
            && data[0] === state.profileId && data[1] === keyId && data[2] === 0 && data[10] === keyId && data[11] === 1
            && data[4] <= 5 && data[13] <= 5;
        report.layers.push({ phase, valid, data, header, command: Array.from(response?.command || []).slice(0, 3),
            status: typeof response?.status === 'string' ? response.status.slice(0, 40) : 'MISSING',
            packetSizeReturned: byte(response?.packetSizeReturned) ? response.packetSizeReturned : null });
        check();
        if (!valid) throw Error(`Could not verify both assignment layers for ${state.keys[1].name}.`);
        return data;
    }

    // Every operation is limited to one key. The background coordinator must
    // persist prepare's backup before calling apply. No automatic writes/retries.
    async function performTest(action, supplied, selection = null) {
        if (!['prepare', 'apply', 'restore'].includes(action)) return { ok: false, message: 'Unknown Mod Tap action.' };
        if (running) return { ok: false, message: 'A Mod Tap operation is already running.' };
        running = true;
        const report = last = { schemaVersion: 2, startedAt: now(), finishedAt: null, state: action, readOnly: true,
            action, productId: '688', target: selection?.inputID || 'KEY_BACKSLASH', tap: selection ? 'Selected keyboard action' : 'Left Arrow', results: [], layers: [], writeAttempted: false,
            limitation: 'Read-back verifies configuration only. Physical tap/hold behavior and persistence need manual testing.' };
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            report.state = 'waiting';
            report.message = 'The device is still busy. The backup is kept; do not start another operation.';
        }, 15000);
        try {
            const state = context(report.target, Boolean(selection), selection?.requireSelected === true);
            const check = () => { if (timedOut) throw Error('The device operation timed out.'); assertUnchanged(state); };
            const [control, candidate] = state.keys;
            report.profileId = state.profileId;
            const deviceIdentity = await identity(state, check);
            let backup;
            if (action !== 'prepare') {
                backup = clone(supplied);
                const validRecord = record => record && record.keyId === candidate.keyId
                    && [0, 1].includes(record.enabled) && byte(record.keyCode) && byte(record.holdTime);
                if (backup?.schemaVersion !== 1 || backup.productId !== '688' || backup.target !== report.target
                    || backup.profileId !== state.profileId || backup.mappingName !== state.mappingName
                    || backup.deviceHash !== deviceIdentity.deviceHash || backup.profileHash !== deviceIdentity.profileHash
                    || !validRecord(backup.original) || !validRecord(backup.test)
                    || (!selection && (backup.test.enabled !== 1 || backup.test.keyCode !== 80))
                    || !Array.isArray(backup.originalLayers) || backup.originalLayers.length !== 19 || !backup.originalLayers.every(byte)) {
                    throw Error('The saved backup does not match this keyboard, profile or layout. Select the original profile.');
                }
                if (action === 'apply') {
                    if (!prepared || prepared.state.device !== state.device || prepared.state.engine !== state.engine
                        || Date.now() - prepared.at > 60000 || !equal(prepared.backup, backup)) {
                        throw Error('The prepared test expired or the page changed. Use Restore to clear the pending test.');
                    }
                    prepared = null; // A prepared write can be attempted only once.
                }
            }
            const controlRecord = await readRecord(state, control, report, 'before', check);
            const original = await readRecord(state, candidate, report, 'before', check);
            const originalLayers = await readLayers(state, report, 'before', check);
            if (action === 'prepare') {
                if (!selection && (controlRecord.enabled !== 1 || controlRecord.keyCode !== 80)) throw Error('Enable the existing Right Alt to Left Arrow behavior first.');
                if (!selection && original.enabled !== 0) throw Error('Backslash already has an enabled Mod Tap record. This test will not replace it.');
                let desired = { keyId: candidate.keyId, enabled: 1, keyCode: 80, holdTime: controlRecord.holdTime };
                if (selection) {
                    desired = { ...original };
                    if (selection.settings) {
                        if (typeof selection.settings.enabled !== 'boolean' || !catalog(state).taps.some(tap => tap.code === selection.settings.keyCode)) {
                            throw Error('Choose a supported single keyboard tap action.');
                        }
                        desired = { keyId: candidate.keyId, enabled: Number(selection.settings.enabled), keyCode: selection.settings.keyCode, holdTime: original.holdTime || 250 };
                    }
                }
                backup = { schemaVersion: 1, id: crypto.randomUUID(), createdAt: now(), productId: '688', target: report.target,
                    profileId: state.profileId, mappingName: state.mappingName, ...deviceIdentity,
                    original, originalLayers, control: controlRecord,
                    test: desired };
                prepared = { state, backup: clone(backup), at: Date.now() };
                report.state = 'prepared';
                report.message = 'Original records read. Waiting for the extension to save the backup before writing.';
                return { ok: true, message: report.message, backup: clone(backup), report,
                    ...(selection ? { view: { ...catalog(state), hold: holdLabel(state, originalLayers), current: original } } : {}) };
            }
            if (!equal(originalLayers, backup.originalLayers)) throw Error('The normal or Hypershift mapping changed since preparation. Nothing was written.');
            const target = action === 'apply' ? backup.test : backup.original;
            if (action === 'apply' && (!sameRecord(original, backup.original) || !sameRecord(controlRecord, backup.control))) {
                throw Error('A Mod Tap record changed after preparation. No write was attempted.');
            }
            if (action === 'restore' && !sameRecord(original, backup.test) && !matchesTarget(original, backup.original, backup.test)) {
                throw Error('This key has an unexpected Mod Tap record. Export diagnostics before changing it.');
            }
            let acknowledged = true;
            const alreadyMatches = action === 'restore' ? matchesTarget(original, target, backup.test) : sameRecord(original, target);
            if (!alreadyMatches) {
                check();
                if (typeof state.device.setMultiModTapKeyAssignment !== 'function') throw Error('The audited Mod Tap writer is unavailable.');
                report.writeAttempted = true;
                report.readOnly = false;
                report.requested = clone(target);
                try {
                    const response = await state.device.setMultiModTapKeyAssignment(state.profileId, [clone(target)]);
                    report.writeResponse = decode(response, state.profileId, candidate, 27);
                    acknowledged = report.writeResponse.valid && sameRecord(report.writeResponse.record, target);
                } catch {
                    acknowledged = false;
                    report.writeError = 'The SET command failed. Reading back before deciding the outcome.';
                }
                check();
            }
            // Check the independent GET even when SET was rejected: never infer
            // the device was unchanged merely from a failed write response.
            report.writeAcknowledged = acknowledged;
            const after = await readRecord(state, candidate, report, 'after', check);
            const controlAfter = await readRecord(state, control, report, 'after', check);
            const layersAfter = await readLayers(state, report, 'after', check);
            report.readBackMatches = matchesTarget(after, target, original);
            report.disabledTapCodeRetained = report.readBackMatches && !sameRecord(after, target);
            report.controlUnchanged = sameRecord(controlRecord, controlAfter);
            report.layersUnchanged = equal(originalLayers, layersAfter);
            report.verificationFailures = [
                ...(!acknowledged ? ['write acknowledgment'] : []),
                ...(!report.readBackMatches ? ['dual-purpose record read-back'] : []),
                ...(!report.controlUnchanged ? ['stock reference key changed'] : []),
                ...(!report.layersUnchanged ? ['normal or Hypershift assignment changed'] : []),
            ];
            if (report.verificationFailures.length) {
                const prefix = report.readBackMatches
                    ? `${action === 'restore' ? 'The original' : 'The requested'} dual-purpose record reads back correctly.`
                    : 'The dual-purpose record read-back differs from the requested setting.';
                throw Error(`${prefix} Verification incomplete: ${report.verificationFailures.join('; ')}. The original backup is kept. Export diagnostics before retrying.`);
            }
            report.state = action === 'apply' ? 'applied' : 'restored';
            report.message = selection ? (action === 'apply' ? 'Saved to the keyboard and verified. Test the tap and hold behavior.' : 'Original dual-purpose setting restored and verified.') : action === 'apply'
                ? 'Left Arrow test written and read back. Test a quick tap and a hold of Backslash, then export diagnostics. Restore returns its original Mod Tap record.'
                : 'Original Backslash Mod Tap record restored and verified. Normal and Hypershift assignments are unchanged.';
            if (report.disabledTapCodeRetained) report.message += ' The previous tap choice remains stored while dual-purpose is disabled.';
            return { ok: true, message: report.message, current: clone(after), report };
        } catch (error) {
            report.state = report.writeAttempted ? 'write-unverified' : 'test-blocked';
            report.message = error.message || 'The test could not complete. Export diagnostics.';
            return { ok: false, message: report.message, report };
        } finally {
            clearTimeout(timer);
            report.finishedAt = now();
            if (report.writeAttempted) highlightCache = null;
            running = false;
        }
    }

    const test = async (...args) => clone(await performTest(...args));
    const editor = async (action, request = {}) => {
        if (action === 'highlights') return highlights(request?.force === true);
        if (action === 'catalog') {
            try { return { ok: true, ...catalog(context()) }; }
            catch (error) { return { ok: false, message: error.message }; }
        }
        if (!request || typeof request.inputID !== 'string') return { ok: false, message: 'Select a keyboard key.' };
        return test(action, request.backup, request);
    };
    const api = Object.freeze({ run, test, editor, snapshot: () => ({ running, last: last ? clone(last) : null,
        highlights: lastHighlights ? clone(lastHighlights) : null }) });
    Object.defineProperty(window, '__razerModTapProbe', { value: api, configurable: true });
    return {
        observeModule(module, source) {
            // Capture already-loaded singleton exports. Never require or execute
            // an application module on demand just to find the device.
            if (source.includes('initializeRzDevice') && source.includes('[WebRzDevice]') && /get\s+obmEngine\s*\(/.test(source)) {
                const value = module.exports?.A;
                if (own(value, '_obm')) webDevice = value;
            } else if (source.includes('current profile changed') && source.includes('currentProfile') && source.includes('obmSlotId')) {
                const value = module.exports?.A;
                if (own(value, 'currentProfile') && Array.isArray(own(value, 'profiles'))) profiles = value;
            } else if (source.includes('customizeReducer:') && source.includes('modTapReducer:')) {
                const value = module.exports?.A;
                if (typeof value?.getState === 'function' && typeof value?.subscribe === 'function' && value !== uiStore) {
                    if (typeof unsubscribeUI === 'function') unsubscribeUI();
                    uiStore = value;
                    const signature = () => {
                        const ui = value.getState();
                        return [ui?.profileReducer?.selectedProfileGuid, ui?.profileReducer?.selectedObmSlotId,
                            ui?.modTapReducer, ui?.customizeReducer?.selectedTab];
                    };
                    const notifyUI = () => {
                        if (typeof document === 'undefined') return;
                        if (document.documentElement) {
                            // Use the native tab identifier, not translated labels
                            // or the shared .customize keyboard component.
                            document.documentElement.dataset.localModtapPage = signature()[3] === 'TAB_CUSTOMIZE' ? 'customize' : 'other';
                        }
                        if (typeof document.dispatchEvent === 'function') document.dispatchEvent(new Event('hypershift-unlocker:modtap-state'));
                    };
                    let previous = signature();
                    notifyUI();
                    unsubscribeUI = value.subscribe(() => {
                        const next = signature();
                        if (next.some((part, index) => part !== previous[index])) {
                            previous = next; highlightCache = null;
                            // Notification only: no IDs or settings cross this
                            // event, and its receiver can request GETs only.
                            notifyUI();
                        }
                    });
                }
            }
        },
    };
}

// Called by the worker in the exact product frame that sent the trusted UI request.
export async function runModTapEditorInPage(action, request) {
    if (location.origin !== 'https://synapse.razer.com' || !/^\/products\/688(?:\/|$)/.test(location.pathname)) return { ok: false, message: 'Open the Huntsman V3 Pro Mini in Synapse Web.' };
    if (!window.__razerModTapProbe?.editor) return { ok: false, message: 'Reload the extension and Synapse Web to load the editor.' };
    return await window.__razerModTapProbe.editor(action, request);
}

// Runs in the dashboard MAIN world only after an explicit popup button click.
export async function runModTapProbeInPage(action = 'read', backup = null) {
    const found = [], visited = new Set();
    function visit(frame) {
        if (visited.has(frame) || visited.size >= 64) return;
        visited.add(frame);
        try {
            if (frame.location.origin !== 'https://synapse.razer.com') return;
            if (/^\/products\/688(?:\/|$)/.test(frame.location.pathname)) found.push(frame);
            for (let index = 0; index < frame.frames.length; index++) visit(frame.frames[index]);
        } catch { /* Ignore unavailable frames. */ }
    }
    visit(window);
    if (found.length !== 1) return { ok: false, message: 'Open one Huntsman V3 Pro Mini product page before running the probe.' };
    const probe = found[0].__razerModTapProbe;
    if (!probe?.run) return { ok: false, message: 'Reload the local extension and Synapse with the keyboard product enabled.' };
    if (action === 'read') return await probe.run();
    if (!probe.test) return { ok: false, message: 'Reload the local extension and Synapse to load the new test buttons.' };
    return await probe.test(action, backup);
}

export function collectModTapProbeInPage() {
    const reports = [], visited = new Set();
    function visit(frame, path) {
        if (visited.has(frame) || visited.size >= 64) return;
        visited.add(frame);
        try {
            if (frame.location.origin !== 'https://synapse.razer.com') return;
            if (/^\/products\/688(?:\/|$)/.test(frame.location.pathname) && frame.__razerModTapProbe) {
                reports.push({ frame: path, ...frame.__razerModTapProbe.snapshot() });
            }
            for (let index = 0; index < frame.frames.length; index++) visit(frame.frames[index], `${path}/${index}`);
        } catch { /* Frame navigated. */ }
    }
    visit(window, 'top');
    return reports;
}
