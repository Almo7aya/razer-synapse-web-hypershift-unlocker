import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHypershiftPatch } from '../src/runtime.mjs';
import { installExperimentalPatch } from '../src/experimental-runtime.mjs';
import { EXPERIMENTS } from '../src/experiments.mjs';
import { installDiagnostics } from '../src/diagnostics.mjs';
import { createModTapProbe, runModTapEditorInPage, collectModTapProbeInPage } from '../src/modtap-probe.mjs';
import { installModTapEditorUI } from '../src/modtap-editor-ui.mjs';
import { installModTapHighlights } from '../src/modtap-highlights.mjs';
import { createIcon } from './icons.mjs';
import { COMPATIBILITY_STUBS } from './extension-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const read = file => readFile(resolve(root, file), 'utf8');
const project = JSON.parse(await read('package.json'));
const manifest = JSON.parse(await read('extension/manifest.json'));
if (manifest.version !== project.version) throw new Error('package.json and manifest.json versions must match.');
const outputs = new Map([
    ['extension/lib/preferences.mjs', await read('src/preferences.mjs')],
    ['extension/lib/experiments.mjs', await read('src/experiments.mjs')],
    ['extension/lib/diagnostics.mjs', await read('src/diagnostics.mjs')],
    ['extension/lib/modtap-probe.mjs', `// Generated editor bridge and diagnostic export. Legacy test entry points are not shipped.\nexport ${runModTapEditorInPage.toString()}\nexport ${collectModTapProbeInPage.toString()}\n`],
    ['extension/lib/modtap-storage.mjs', await read('src/modtap-storage.mjs')],
    ['extension/lib/modtap-editor-session.mjs', await read('src/modtap-editor-session.mjs')],
    ['extension/lib/products.mjs', await read('src/products.mjs')],
    ['extension/LICENSE.txt', await read('LICENSE')],
    ['extension/content.js', `// Generated from src/runtime.mjs. MIT licensed.\n(${installHypershiftPatch.toString()})();\n`],
    ['extension/experimental.js', `// Generated from src/experimental-runtime.mjs and src/modtap-probe.mjs. MIT licensed.\n(${installExperimentalPatch.toString()})(${createModTapProbe.toString()});\n`],
    ['extension/diagnostics.js', `// Generated from src/diagnostics.mjs. MIT licensed.\n(${installDiagnostics.toString()})();\n`],
    ['extension/modtap-editor.js', `// Generated from src/modtap-editor-ui.mjs and src/modtap-highlights.mjs. MIT licensed.\n(${installModTapEditorUI.toString()})(${installModTapHighlights.toString()});\n`],
    ['extension/experimental/reset.js', 'globalThis.__razerExperimentalOptions = {};\n'],
]);
for (const { id } of EXPERIMENTS.filter(item => !item.diagnostic)) outputs.set(`extension/experimental/${id}.js`, `globalThis.__razerExperimentalOptions.${id} = true;\n`);
// Persisted registrations from earlier local builds can reference these files
// before the updated worker reconciles them. Keep harmless compatibility stubs.
for (const id of COMPATIBILITY_STUBS) {
    outputs.set(`extension/experimental/${id}.js`, '// Compatibility stub for an earlier local registration. Intentionally empty.\n');
}
for (const size of [16, 32, 48, 128]) outputs.set(`extension/icons/${size}.png`, createIcon(size));
for (const [file, value] of outputs) {
    const expected = Buffer.isBuffer(value) ? value : Buffer.from(value.replaceAll('\r\n', '\n'));
    if (check) {
        const actual = await readFile(resolve(root, file)).catch(() => Buffer.alloc(0));
        if (!actual.equals(expected)) throw new Error(`${file} is out of date. Run npm run build.`);
    } else {
        await mkdir(dirname(resolve(root, file)), { recursive: true });
        await writeFile(resolve(root, file), expected);
    }
}
console.log(`${check ? 'Checked' : 'Built'} extension ${project.version}; automatic product-frame matching.`);
