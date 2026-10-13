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
