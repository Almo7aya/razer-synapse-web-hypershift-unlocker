import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const releaseScript = fileURLToPath(new URL('../tools/release.mjs', import.meta.url));
const run = (cwd, program, args, env) => execFileSync(program, args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const git = (cwd, ...args) => run(cwd, 'git', args);

// Local bare repositories and a fake gh executable; no GitHub or Google calls.
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'synapse-release-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const origin = join(root, 'origin.git'), work = join(root, 'work'), bin = join(root, 'bin');
    git(root, 'init', '--bare', '--initial-branch=main', origin);
    git(root, 'clone', origin, work);
    git(work, 'config', 'user.name', 'Release test');
    git(work, 'config', 'user.email', 'test@example.invalid');
    await mkdir(join(work, 'extension'));
    await writeFile(join(work, 'package.json'), '{"name":"test","version":"0.1.0"}\n');
    await writeFile(join(work, 'extension/manifest.json'), '{"version":"0.1.0"}\n');
    await writeFile(join(work, '.gitignore'), 'artifacts/\n');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'Initial'); git(work, 'push', 'origin', 'main');
    await mkdir(bin);
    await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const stateFile = process.env.TEST_GH_STATE;
let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile)) : null;
if (args[0] === 'api') console.log(JSON.stringify([state ? [state] : []]));
else if (args[1] === 'create') {
    state = {tag_name: args[2], draft: true, assets: [{name: path.basename(args[3])}]};
    fs.copyFileSync(args[3], stateFile + '.zip');
    fs.writeFileSync(stateFile, JSON.stringify(state));
} else if (args[1] === 'download') {
    fs.copyFileSync(stateFile + '.zip', path.join(args[args.indexOf('--dir') + 1], state.assets[0].name));
} else if (args[1] === 'edit') {
    state.draft = false;
    fs.writeFileSync(stateFile, JSON.stringify(state));
} else throw new Error('Unexpected gh operation: ' + args.join(' '));
`, { mode: 0o755 });
    const env = {
        ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'example/project', GITHUB_RUN_ID: '123',
        GITHUB_OUTPUT: join(root, 'outputs'), GITHUB_STEP_SUMMARY: join(root, 'summary'),
        RELEASE_BUMP: 'patch', TEST_GH_STATE: join(root, 'github-release.json'),
    };
    return { root, origin, work, env, release: phase => run(work, process.execPath, [releaseScript, phase], env) };
}

test('a retry reuses the pushed version, tag, and GitHub ZIP without another bump', { skip: process.platform === 'win32' }, async t => {
    const fixtureData = await fixture(t);
    const { origin, work, env, release } = fixtureData;
    release('prepare');
    const zip = join(work, 'artifacts/razer-synapse-web-hypershift-unlocker-0.1.1.zip');
    await writeFile(zip, 'validated package bytes');
    release('publish');
    const firstCommit = git(origin, 'rev-parse', 'main');
    assert.equal(git(origin, 'rev-list', '-n', '1', 'v0.1.1'), firstCommit);
    assert.equal(JSON.parse(await readFile(env.TEST_GH_STATE, 'utf8')).draft, false);
    release('prepare');
    const state = JSON.parse(await readFile(join(work, 'artifacts/release.json'), 'utf8'));
    assert.equal(state.version, '0.1.1');
    assert.equal(state.existing, true);
    release('publish');
    assert.equal(git(origin, 'rev-parse', 'main'), firstCommit);
    assert.equal(git(origin, 'rev-list', '--count', 'main'), '2');
    assert.equal(await readFile(zip, 'utf8'), 'validated package bytes');
});

test('a concurrent main push prevents both the version push and release tag', { skip: process.platform === 'win32' }, async t => {
    const { root, origin, work, env, release } = await fixture(t);
    release('prepare');
    await writeFile(join(work, 'artifacts/razer-synapse-web-hypershift-unlocker-0.1.1.zip'), 'package');
    const other = join(root, 'other');
    git(root, 'clone', origin, other);
    git(other, 'config', 'user.name', 'Other contributor');
    git(other, 'config', 'user.email', 'other@example.invalid');
    await writeFile(join(other, 'README.md'), 'Concurrent change');
    git(other, 'add', 'README.md'); git(other, 'commit', '-m', 'Concurrent change'); git(other, 'push', 'origin', 'main');
    const concurrentCommit = git(origin, 'rev-parse', 'main');
    assert.throws(() => release('publish'));
    assert.equal(git(origin, 'rev-parse', 'main'), concurrentCommit);
    assert.equal(git(origin, 'tag', '--list', 'v0.1.1'), '');
    await assert.rejects(access(env.TEST_GH_STATE));
});
