import { runModTapEditorInPage } from './modtap-probe.mjs';
import { MODTAP_STORAGE_KEY, sameJsonValue } from './modtap-storage.mjs';

export const MODTAP_EDITOR_STORAGE_KEY = 'localModTapEditor';
const scope = backup => [backup.deviceHash, backup.profileHash, backup.profileId, backup.mappingName, backup.target].join(':');
const sameRecord = (a, b) => Boolean(a && b && ['keyId', 'enabled', 'keyCode', 'holdTime'].every(key => a[key] === b[key]));
const retainedDisabledCode = (actual, target, before) => Boolean(actual && target && before
    && target.enabled === 0 && actual.enabled === 0 && actual.keyId === target.keyId && before.keyId === target.keyId
    && actual.holdTime === target.holdTime && actual.keyCode === before.keyCode);

// Recover only the old false-negative restore: a valid SET acknowledgment,
// unchanged reference/layers, and the known previous tap code retained while
// disabled. A fresh prepare must independently confirm all those reads again.
function canReconcileDisabledRestore(entry, backup) {
    const pending = entry?.pending, report = entry?.lastResult?.report;
    if (!pending || entry.lastResult?.ok !== false || report?.action !== 'restore' || report.writeAttempted !== true
        || report.writeAcknowledged === false || report.writeResponse?.valid !== true
        || report.controlUnchanged !== true || report.layersUnchanged !== true || report.readBackMatches !== false
        || report.target !== backup.target || report.profileId !== backup.profileId || scope(entry.baseline) !== scope(backup)
        || !sameRecord(pending.desired, entry.baseline.original) || !sameRecord(report.requested, pending.desired)
        || !sameRecord(report.writeResponse.record, pending.desired)
        || (report.verificationFailures && !sameJsonValue(report.verificationFailures, ['dual-purpose record read-back']))) return false;
    const before = report.results?.find(item => item.role === 'candidate' && item.phase === 'before');
    const after = report.results?.find(item => item.role === 'candidate' && item.phase === 'after');
    const control = report.results?.find(item => item.role === 'control' && item.phase === 'after');
    const layers = report.layers?.find(item => item.phase === 'after');
    return before?.valid === true && after?.valid === true && control?.valid === true && layers?.valid === true
        && sameRecord(before.record, pending.before) && retainedDisabledCode(after.record, pending.desired, pending.before)
        && after.record.keyCode !== pending.desired.keyCode && sameRecord(backup.original, after.record)
        && sameRecord(backup.control, control.record) && sameJsonValue(backup.originalLayers, layers.data);
}

export function modTapEditorSender(sender, extensionId) {
    if (sender?.id !== extensionId || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId)) return null;
    try {
        const url = new URL(sender.url);
        if (url.origin !== 'https://synapse.razer.com' || !/^\/products\/688(?:\/|$)/.test(url.pathname)) return null;
        return { tabId: sender.tab.id, frameId: sender.frameId };
    } catch { return null; }
}

// The worker serializes every editor and legacy test request. Backups are scoped
// to the physical device, onboard profile and input key; raw serials stay in-page.
export async function runModTapEditor(api, request, { tabId, frameId }) {
    const { action, inputID, settings, expected } = request;
    const requireSelected = request.requireSelected === true;
    if (!['catalog', 'highlights', 'read', 'save', 'restore'].includes(action) || !Number.isInteger(tabId) || !Number.isInteger(frameId)) throw Error('Invalid editor request.');
    if (!['catalog', 'highlights'].includes(action) && (typeof inputID !== 'string' || !/^KEY_[A-Z0-9_]+$/.test(inputID) || /CAPS|^KEY_FN$|^KEY_FUNCTION$/i.test(inputID))) {
        throw Error('Select an eligible key. Caps Lock and Fn are excluded.');
    }
    if (action === 'save' && (typeof settings?.enabled !== 'boolean' || !Number.isInteger(settings.keyCode))) throw Error('Choose a tap action.');
    const execute = async (command, value) => {
        const [response] = await api.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN',
            func: runModTapEditorInPage, args: [command, value ?? null] });
        if (!response?.result) throw Error('The keyboard page did not respond. Reopen the editor; saved backups are kept.');
        return response.result;
    };
    if (action === 'catalog') return execute('catalog');
    if (action === 'highlights') return execute('highlights', { force: request.force === true });
    const prepared = await execute('prepare', { inputID, requireSelected, ...(action === 'save' ? { settings } : {}) });
    if (!prepared.ok) return prepared;
    const backup = prepared.backup;
    if (!backup || backup.target !== inputID) throw Error('The keyboard returned an unexpected selection.');
    const key = scope(backup);
    if (action !== 'read' && (expected?.scope !== key || !sameRecord(expected?.current, backup.original))) {
        throw Error('The keyboard, profile or key setting changed. Click Refresh in the editor before saving.');
    }
    const stored = await api.storage.local.get([MODTAP_EDITOR_STORAGE_KEY, MODTAP_STORAGE_KEY]);
    const store = stored[MODTAP_EDITOR_STORAGE_KEY] || { schemaVersion: 1, entries: {} };
    if (store.schemaVersion !== 1 || !store.entries || typeof store.entries !== 'object' || Array.isArray(store.entries)) throw Error('The saved editor backups have an unknown format. Export diagnostics.');
    let entry = store.entries[key];
    const persist = async () => {
        store.entries[key] = entry;
        await api.storage.local.set({ [MODTAP_EDITOR_STORAGE_KEY]: store });
        const verified = (await api.storage.local.get(MODTAP_EDITOR_STORAGE_KEY))[MODTAP_EDITOR_STORAGE_KEY];
        if (!sameJsonValue(verified, store)) throw Error('The saved backup could not be verified. No further device commands were sent.');
    };
    // Carry the original disabled Backslash record across from the proven test,
    // instead of treating its currently enabled test mapping as the original.
    const legacy = stored[MODTAP_STORAGE_KEY];
    if (!entry && legacy?.backup && scope(legacy.backup) === key) {
        if (!sameRecord(backup.original, legacy.backup.original) && !sameRecord(backup.original, legacy.backup.test)) {
            throw Error('Backslash differs from its saved test. Export diagnostics before changing it.');
        }
        entry = { baseline: legacy.backup, lastVerified: backup.original, state: 'imported',
            importedFromBackslashTest: true, pending: !['applied', 'restored', 'prepared'].includes(legacy.state)
                ? { before: legacy.backup.original, desired: legacy.backup.test } : null };
        await persist();
    }
    let reconciled = false;
    if (canReconcileDisabledRestore(entry, backup)) {
        entry = { ...entry, pending: null, state: 'restored', lastVerified: backup.original,
            reconciliation: { reason: 'disabled-tap-code-retained', checkedAt: new Date().toISOString(), readOnly: true, record: backup.original } };
        await persist();
        reconciled = true;
    }
    const isRestored = record => Boolean(entry && (sameRecord(record, entry.baseline.original)
        || (entry.state === 'restored' && sameRecord(record, entry.lastVerified))));
    const view = () => ({ ...prepared.view, inputID, expected: { scope: key, current: backup.original },
        hasBackup: Boolean(entry), pending: Boolean(entry?.pending), restored: isRestored(backup.original) });
    if (action === 'read') return { ok: true, view: view(), ...(reconciled
        ? { message: 'Previous restore verified with fresh keyboard reads. Dual-purpose is disabled; its previous tap choice is retained. You can edit this key again.' } : {}) };
    if (action === 'restore' && !entry) throw Error('No saved original for this key in this profile.');
    if (!entry) {
        if (Object.keys(store.entries).length >= 500) throw Error('The local backup limit has been reached. Export diagnostics.');
        entry = { baseline: backup, lastVerified: backup.original, state: 'prepared', pending: null };
    }
    if (action === 'save' && entry.pending) throw Error('A previous write is unverified. Restore this key before saving another change.');
    if (entry.baseline.original.keyId !== backup.original.keyId || entry.baseline.mappingName !== backup.mappingName) throw Error('The keyboard layout no longer matches the saved original.');
    let commandBackup = backup;
    if (action === 'restore') {
        const known = [entry.baseline.original, entry.lastVerified, entry.pending?.before, entry.pending?.desired];
        if (!known.some(record => sameRecord(record, backup.original))
            && !retainedDisabledCode(backup.original, entry.pending?.desired, entry.pending?.before)) {
            throw Error('This key has an unexpected setting. Export diagnostics before restoring.');
        }
        // Preserve the current ordinary layers even if the user intentionally
        // changed them in Synapse since the first backup. Never write those layers.
        commandBackup = { ...backup, original: entry.baseline.original, test: backup.original };
    }
    const desired = action === 'restore' ? entry.baseline.original : backup.test;
    entry = { ...entry, pending: { before: backup.original, desired, startedAt: new Date().toISOString() }, state: action === 'save' ? 'saving' : 'restoring' };
    await persist();
    const result = await execute(action === 'save' ? 'apply' : 'restore', { inputID, requireSelected, backup: commandBackup });
    const current = result.ok ? (result.current
        || result.report?.results?.find(item => item.role === 'candidate' && item.phase === 'after' && item.valid === true)?.record) : backup.original;
    if (result.ok && !sameRecord(current, desired) && !retainedDisabledCode(current, desired, backup.original)) {
        throw Error('The page did not return a verified current record. The backup is kept; reload the extension and Synapse Web.');
    }
    entry = { ...entry, lastResult: result, updatedAt: new Date().toISOString(),
        ...(result.ok ? { pending: null, lastVerified: current, state: action === 'save' ? 'saved' : 'restored' } : { state: 'unverified' }) };
    await persist();
    return { ...result, view: { ...view(), current,
        expected: { scope: key, current }, restored: result.ok && isRestored(current) } };
}
