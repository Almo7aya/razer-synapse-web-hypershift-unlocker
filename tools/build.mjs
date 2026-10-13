import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installHypershiftPatch } from '../src/runtime.mjs';
import { createIcon } from './icons.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const read = file => readFile(resolve(root, file), 'utf8');
const project = JSON.parse(await read('package.json'));
const manifest = JSON.parse(await read('extension/manifest.json'));
if (manifest.version !== project.version) throw new Error('package.json and manifest.json versions must match.');
const outputs = new Map([
    ['extension/lib/preferences.mjs', await read('src/preferences.mjs')],
    ['extension/lib/products.mjs', await read('src/products.mjs')],
    ['extension/LICENSE.txt', await read('LICENSE')],
    ['extension/content.js', `// Generated from src/runtime.mjs. MIT licensed.\n(${installHypershiftPatch.toString()})();\n`],
]);
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
