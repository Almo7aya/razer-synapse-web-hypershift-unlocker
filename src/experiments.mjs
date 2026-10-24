// Additional features are limited to products whose bundles were audited.
export const EXPERIMENTS = [
    { id: 'menu', product: '688', label: 'Menu key in Hypershift' },
    { id: 'drag', product: '688', label: 'Hypershift drag and drop', experimental: true },
    { id: 'windows', product: '688', label: 'Windows key mapping' },
    { id: 'dualPurpose', product: '688', label: 'Dual-purpose keys', experimental: true },
    { id: 'keyboardLogs', product: '688', label: 'Console diagnostics', diagnostic: true, devOnly: true },
    { id: 'macros', product: '229', label: 'Mouse macros', experimental: true },
    { id: 'mouseLogs', product: '229', label: 'Console diagnostics', diagnostic: true, devOnly: true },
];

const RETIRED = ['controller', 'dynamic', 'polling', 'fn'];
export const EXPERIMENT_REVISION = 3;

export function migrateExperiments(value, revision = 0) {
    const off = new Set(normalizeExperiments(value));
    // Preserve deliberate macro opt-ins from revision 2. Require a fresh
    // Dual-purpose opt-in when upgrading the earlier always-on local editor.
    if (revision < 2) off.add('macros');
    if (revision < 3) off.add('dualPurpose');
    return normalizeExperiments([...off]);
}

export function normalizeDeveloperMode(value = false) {
    if (typeof value !== 'boolean') throw new Error('Invalid developer mode preference.');
    return value;
}

export function normalizeExperimentalMode(value = false) {
    if (typeof value !== 'boolean') throw new Error('Invalid experimental features preference.');
    return value;
}

// Keep individual choices saved while either mode temporarily disables them.
export function effectiveDisabledExperiments(disabled, developerMode = false, experimentalMode = false) {
    const dev = normalizeDeveloperMode(developerMode);
    const experimental = normalizeExperimentalMode(experimentalMode);
    return normalizeExperiments([...normalizeExperiments(disabled),
        ...EXPERIMENTS.filter(item => (item.devOnly && !dev) || (item.experimental && !experimental)).map(item => item.id)]);
}

export function normalizeExperiments(value = ['dualPurpose', 'macros']) {
    if (!Array.isArray(value) || value.some(id => !RETIRED.includes(id) && !EXPERIMENTS.some(item => item.id === id))) {
        throw new Error('Invalid feature preferences.');
    }
    return [...new Set(value.filter(id => !RETIRED.includes(id)))].sort();
}

export function withExperimentEnabled(disabled, id, enabled) {
    if (!EXPERIMENTS.some(item => item.id === id) || typeof enabled !== 'boolean') {
        throw new Error('Invalid feature setting.');
    }
    const result = new Set(normalizeExperiments(disabled));
    if (enabled) result.delete(id);
    else result.add(id);
    return normalizeExperiments([...result]);
}
