// Retain the original storage key so earlier local backups remain recoverable.
export const MODTAP_STORAGE_KEY = 'localBackslashModTapTest';

// Chrome storage can reorder object properties. Preserve array order, types,
// and the presence of every property when verifying durable backups.
export function sameJsonValue(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object'
        || Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left) && left.length !== right.length) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every(key => Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]));
}
