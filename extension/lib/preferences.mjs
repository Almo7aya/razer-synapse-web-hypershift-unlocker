import { EXPERIMENTS, effectiveDisabledExperiments, normalizeDeveloperMode } from './experiments.mjs';

export const REGISTRATION_ID = 'synapse-web-hypershift';

export function normalizeProductId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw new Error('Invalid product reference.');
    return value;
}

export function normalizePreferences(value = []) {
    if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid product preferences.');
    return [...new Set(value.map(normalizeProductId))].sort();
}

export function withProductEnabled(disabledProducts, productId, enabled) {
    const disabled = new Set(normalizePreferences(disabledProducts));
    normalizeProductId(productId);
    if (typeof enabled !== 'boolean') throw new Error('Invalid product toggle.');
    if (enabled) disabled.delete(productId);
    else disabled.add(productId);
    return normalizePreferences([...disabled]);
}

export function contentRegistration(disabledProducts) {
    return {
        id: REGISTRATION_ID,
        matches: ['https://synapse.razer.com/products/*'],
        excludeMatches: normalizePreferences(disabledProducts).flatMap(id => {
            const base = `https://synapse.razer.com/products/${id}`;
            return [base, `${base}?*`, `${base}/*`];
        }),
        js: ['content.js'],
        allFrames: true,
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: true,
    };
}

export async function syncRegistration(scripting, disabledProducts) {
    const desired = contentRegistration(disabledProducts);
    const existing = await scripting.getRegisteredContentScripts({ ids: [REGISTRATION_ID] });
    if (!existing.length) await scripting.registerContentScripts([desired]);
    else {
        const same = Object.entries(desired).every(([key, value]) => JSON.stringify(existing[0][key]) === JSON.stringify(value));
        if (!same) await scripting.updateContentScripts([desired]);
    }
}

export function experimentalRegistrations(disabledProducts, disabledExperiments, developerMode = false, experimentalMode = false) {
    const products = ['229', '688'];
    const disabled = normalizePreferences(disabledProducts);
    const off = effectiveDisabledExperiments(disabledExperiments, developerMode, experimentalMode);
    const diagnosticsOff = EXPERIMENTS.filter(item => item.diagnostic && off.includes(item.id)).map(item => item.product);
    const registrations = [contentRegistration([...disabled, ...products])];
    if (normalizeDeveloperMode(developerMode)) registrations.push({
        ...contentRegistration(diagnosticsOff),
        id: `${REGISTRATION_ID}-diagnostics`,
        matches: ['https://synapse.razer.com/*'],
        js: ['diagnostics.js'],
    });
    if (!disabled.includes('688') && !off.includes('dualPurpose')) registrations.push({
        ...contentRegistration([]), id: `${REGISTRATION_ID}-modtap-editor`,
        matches: ['https://synapse.razer.com/products/688', 'https://synapse.razer.com/products/688?*', 'https://synapse.razer.com/products/688/*'],
        js: ['modtap-editor.js'], world: 'ISOLATED', runAt: 'document_idle',
    });
    for (const product of products) {
        if (disabled.includes(product)) continue;
        registrations.push({
            ...contentRegistration([]),
            id: `${REGISTRATION_ID}-experiment-${product}`,
            matches: [`https://synapse.razer.com/products/${product}`, `https://synapse.razer.com/products/${product}?*`, `https://synapse.razer.com/products/${product}/*`],
            // Chrome runs files in this order, so preferences exist before hooks.
            js: ['experimental/reset.js', ...EXPERIMENTS
                .filter(item => !item.diagnostic && item.product === product && !off.includes(item.id))
                .map(item => `experimental/${item.id}.js`), 'content.js', 'experimental.js'],
        });
    }
    return registrations;
}

export async function syncExperimentalRegistrations(scripting, disabledProducts, disabledExperiments, developerMode = false, experimentalMode = false) {
    const ids = [REGISTRATION_ID, `${REGISTRATION_ID}-diagnostics`, `${REGISTRATION_ID}-modtap-editor`, ...['229', '688'].map(id => `${REGISTRATION_ID}-experiment-${id}`)];
    const desired = experimentalRegistrations(disabledProducts, disabledExperiments, developerMode, experimentalMode);
    const current = await scripting.getRegisteredContentScripts({ ids });
    // Replace registrations whose file list changed. This also clears stale
    // persisted paths from earlier unpacked builds before registering new files.
    const removed = current.filter(item => {
        const next = desired.find(next => next.id === item.id);
        return !next || JSON.stringify(next.js) !== JSON.stringify(item.js);
    }).map(item => item.id);
    if (removed.length) await scripting.unregisterContentScripts({ ids: removed });
    const retained = current.filter(item => !removed.includes(item.id));
    const updates = desired.filter(item => retained.some(old => old.id === item.id
        && Object.entries(item).some(([key, value]) => JSON.stringify(old[key]) !== JSON.stringify(value))));
    if (updates.length) await scripting.updateContentScripts(updates);
    const added = desired.filter(item => !retained.some(old => old.id === item.id));
    if (added.length) await scripting.registerContentScripts(added);
}
