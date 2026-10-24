import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { EXTENSION_FILES } from '../tools/extension-files.mjs';
import { experimentalRegistrations } from '../src/preferences.mjs';
import { EXPERIMENTS } from '../src/experiments.mjs';

const read = name => readFile(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const included = new Set(EXTENSION_FILES);

test('release file list contains manifest resources, module imports and every feature registration', async () => {
    assert.equal(included.size, EXTENSION_FILES.length, 'No duplicate ZIP entries');
    const manifest = JSON.parse(await read('manifest.json'));
    for (const name of [manifest.background.service_worker, manifest.action.default_popup,
        ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
        assert.ok(included.has(name), `Missing manifest resource: ${name}`);
    }
    for (const name of EXTENSION_FILES) {
        assert.ok(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'), `Unsafe package path: ${name}`);
        const contents = await read(name);
        if (/\.m?js$/.test(name)) {
            for (const [, dependency] of contents.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
                const resolved = posix.normalize(posix.join(posix.dirname(name), dependency));
                assert.ok(included.has(resolved), `${name} imports an unpackaged module: ${dependency}`);
            }
        } else if (name === 'popup.html') {
            for (const [, resource] of contents.matchAll(/(?:src|href)="([^"#]+)"/g)) {
                assert.ok(included.has(resource), `Missing popup resource: ${resource}`);
            }
        }
    }
    for (const developer of [false, true]) for (const experimental of [false, true]) {
        for (const disabled of [[], EXPERIMENTS.map(item => item.id)]) {
            for (const registration of experimentalRegistrations([], disabled, developer, experimental)) {
                for (const file of registration.js) assert.ok(included.has(file), `Unpackaged registered script: ${file}`);
            }
        }
    }
});

test('release excludes the retired test coordinator while retaining backup recovery helpers', async () => {
    assert.equal(included.has('lib/modtap-session.mjs'), false);
    assert.equal(included.has('lib/modtap-storage.mjs'), true);
    assert.equal(EXTENSION_FILES.some(name => name.endsWith('.json') && name !== 'manifest.json'), false, 'No diagnostic JSON files belong in the ZIP');
    assert.doesNotMatch(await read('background.mjs'), /runModTapTest|type === 'modTapTest'/);
    assert.doesNotMatch(await read('lib/modtap-probe.mjs'), /runModTapProbeInPage/);
    assert.match(await read('lib/modtap-storage.mjs'), /localBackslashModTapTest/);
    assert.match(await read('lib/modtap-editor-session.mjs'), /importedFromBackslashTest/);
});
