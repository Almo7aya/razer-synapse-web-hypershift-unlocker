import { runModTapProbeInPage } from './modtap-probe.mjs';
import { MODTAP_STORAGE_KEY, sameJsonValue } from './modtap-storage.mjs';
export { MODTAP_STORAGE_KEY, sameJsonValue } from './modtap-storage.mjs';

// Legacy coordinator retained for regression tests; not included in the extension.

// Called through the worker's serialized queue, so two popups/tabs cannot
// replace a pending backup. The worker also survives closing the popup.
export async function runModTapTest(api, { tabId, action }) {
    if (!Number.isInteger(tabId) || !['apply', 'restore'].includes(action)) throw Error('Invalid local test request.');
    const execute = async (command, backup) => {
        const [response] = await api.scripting.executeScript({ target: { tabId }, world: 'MAIN',
            func: runModTapProbeInPage, args: [command, backup ?? null] });
        if (!response?.result) throw Error('The keyboard page did not respond. The backup is kept; reopen the popup.');
        return response.result;
    };
    const saved = (await api.storage.local.get(MODTAP_STORAGE_KEY))[MODTAP_STORAGE_KEY];
    let session = saved;
    if (action === 'apply') {
        if (saved && saved.state !== 'restored') throw Error('A Backslash test is already saved. Restore it before starting another.');
        const prepared = await execute('prepare');
        if (!prepared.ok) return prepared;
        if (!prepared.backup) throw Error('No original record was returned. Nothing was written.');
        session = { schemaVersion: 1, backup: prepared.backup, state: 'prepared', preparation: prepared.report };
        await api.storage.local.set({ [MODTAP_STORAGE_KEY]: session });
        const verified = (await api.storage.local.get(MODTAP_STORAGE_KEY))[MODTAP_STORAGE_KEY];
        if (!sameJsonValue(verified, session)) throw Error('The backup could not be verified in extension storage. Nothing was written.');
    } else if (!saved?.backup) {
        throw Error('No saved Backslash test to restore.');
    }
    session = { ...session, state: action === 'apply' ? 'applying' : 'restoring', updatedAt: new Date().toISOString() };
    await api.storage.local.set({ [MODTAP_STORAGE_KEY]: session });
    const result = await execute(action, session.backup);
    session = { ...session, state: result.ok ? (action === 'apply' ? 'applied' : 'restored') : 'unverified',
        updatedAt: new Date().toISOString(), [action === 'apply' ? 'application' : 'restoration']: result };
    await api.storage.local.set({ [MODTAP_STORAGE_KEY]: session });
    return result;
}
