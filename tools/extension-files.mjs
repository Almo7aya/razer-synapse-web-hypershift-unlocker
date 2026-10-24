import { EXPERIMENTS } from '../src/experiments.mjs';

// Older unpacked installs may still reference these content scripts at startup.
export const COMPATIBILITY_STUBS = ['mouseLogs', 'keyboardLogs', 'controller', 'dynamic', 'polling', 'fn'];

// Review additions here: files elsewhere in extension/ never enter release ZIPs.
export const EXTENSION_FILES = [
    'manifest.json', 'background.mjs', 'popup.html', 'popup.css', 'popup.mjs', 'LICENSE.txt',
    'content.js', 'experimental.js', 'diagnostics.js', 'modtap-editor.js',
    ...['preferences', 'experiments', 'products', 'diagnostics', 'modtap-probe', 'modtap-storage', 'modtap-editor-session']
        .map(name => `lib/${name}.mjs`),
    ...[16, 32, 48, 128].map(size => `icons/${size}.png`),
    'experimental/reset.js',
    ...EXPERIMENTS.filter(item => !item.diagnostic).map(item => `experimental/${item.id}.js`),
    ...COMPATIBILITY_STUBS.map(id => `experimental/${id}.js`),
].sort();
