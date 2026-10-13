export function parseVersion(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
        throw new Error(`Expected a three-part release version, received ${value}.`);
    }
    const parts = value.split('.').map(Number);
    if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
        throw new Error(`Version ${value} is outside Chrome's supported version range.`);
    }
    return parts;
}

export function nextVersion(version, bump) {
    const parts = parseVersion(version);
    const index = ['major', 'minor', 'patch'].indexOf(bump);
    if (index === -1) throw new Error('Choose patch, minor, or major.');
    parts[index]++;
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
    const next = parts.join('.');
    parseVersion(next);
    return next;
}

export function replaceVersion(source, expected, next) {
    parseVersion(next);
    if (JSON.parse(source).version !== expected) throw new Error('Package and manifest versions must match.');
    const updated = source.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, (_, prefix, suffix) => `${prefix}${next}${suffix}`);
    if (JSON.parse(updated).version !== next) throw new Error('Could not update the version field.');
    return updated;
}

export function packageName(version) {
    parseVersion(version);
    return `razer-synapse-web-hypershift-unlocker-${version}.zip`;
}

export function compareVersions(left, right) {
    const parts = value => {
        if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(value)) throw new Error('Invalid store version.');
        const result = value.split('.').map(Number);
        if (result.some(part => part > 65535)) throw new Error('Invalid store version.');
        return [...result, ...Array(4 - result.length).fill(0)];
    };
    const a = parts(left), b = parts(right);
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
    return 0;
}
