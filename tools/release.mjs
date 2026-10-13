import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { nextVersion, packageName, replaceVersion } from './version.mjs';

const command = (program, args) => execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const git = (...args) => command('git', args);
const gh = (...args) => command('gh', args);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const runId = process.env.GITHUB_RUN_ID;
const repository = process.env.GITHUB_REPOSITORY;
if (!/^\d+$/.test(runId || '') || !/^[\w.-]+\/[\w.-]+$/.test(repository || '') || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Release commands must run in the manual GitHub workflow on main.');
}
const marker = `Release-Run: ${repository}/${runId}`;
const stateFile = 'artifacts/release.json';

async function prepare() {
    git('fetch', 'origin', 'main', '--tags');
    const candidates = git('log', 'origin/main', '--format=%H', '--fixed-strings', `--grep=${marker}`).split('\n').filter(Boolean);
    const existing = candidates.find(sha => git('show', '-s', '--format=%B', sha).split('\n').includes(marker));
    if (existing) git('checkout', '--detach', existing);
    else if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
        throw new Error('main changed before release preparation. Re-run the workflow to use the latest main.');
    }
    const projectSource = await readFile('package.json', 'utf8');
    const manifestSource = await readFile('extension/manifest.json', 'utf8');
    const current = JSON.parse(projectSource).version;
    if (JSON.parse(manifestSource).version !== current) throw new Error('Package and manifest versions must match.');
    const version = existing ? current : nextVersion(current, process.env.RELEASE_BUMP);
    const tag = `v${version}`;
    const tags = git('tag', '--list', tag);
    if (existing) {
        if (!tags || git('rev-list', '-n', '1', tag) !== existing) throw new Error(`The release tag ${tag} is missing or changed.`);
    } else {
        if (tags) throw new Error(`Tag ${tag} already exists. No release files were changed.`);
        await writeFile('package.json', replaceVersion(projectSource, current, version));
        await writeFile('extension/manifest.json', replaceVersion(manifestSource, current, version));
    }
    await mkdir('artifacts', { recursive: true });
    await writeFile(stateFile, JSON.stringify({ version, tag, existing: Boolean(existing), base: git('rev-parse', 'HEAD'), runId }) + '\n');
    await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    console.log(`${existing ? 'Resuming' : 'Preparing'} ${tag}.`);
}

async function publish() {
    const state = await json(stateFile);
    const { version, tag, existing, base } = state;
    if (state.runId !== runId || tag !== `v${version}`) throw new Error('Release state belongs to another run.');
    if ((await json('package.json')).version !== version || (await json('extension/manifest.json')).version !== version) {
        throw new Error('Release version changed after preparation.');
    }
    const assetName = packageName(version);
    const zip = `artifacts/${assetName}`;
    const bytes = await readFile(zip);
    if (git('rev-parse', 'HEAD') !== base) throw new Error('The source commit changed after validation.');
    if (!existing) {
        const changed = git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean).sort();
        if (JSON.stringify(changed) !== JSON.stringify(['extension/manifest.json', 'package.json'])) {
            throw new Error('Only the two version fields should change during release.');
        }
        git('config', 'user.name', 'github-actions[bot]');
        git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
        git('add', 'package.json', 'extension/manifest.json');
        git('commit', '-m', `Release ${tag}`, '-m', marker);
        git('tag', '-a', tag, '-m', `Release ${tag}\n\n${marker}`);
        // Neither the branch nor tag is pushed if main advanced concurrently.
        git('push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`);
    }

    // An API error must not be mistaken for a missing release.
    const pages = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`));
    const release = pages.flat().find(item => item.tag_name === tag);
    const notes = `Chrome extension package for ${tag}.\n\nExtract the attached ZIP and load its folder through chrome://extensions, or install from Chrome Web Store when approved.\n\nChrome Web Store submission runs after this GitHub release; see the [publish workflow](https://github.com/${repository}/actions/runs/${runId}) for its status.\n`;
    await writeFile('artifacts/release-notes.md', notes);
    if (!release) {
        gh('release', 'create', tag, zip, '--repo', repository, '--verify-tag', '--draft', '--title', tag, '--notes-file', 'artifacts/release-notes.md');
    } else if (!release.assets.some(asset => asset.name === assetName)) {
        gh('release', 'upload', tag, zip, '--repo', repository);
    }
    // Reuse the actual GitHub release asset, and never overwrite a different ZIP.
    const downloadDir = 'artifacts/release-download';
    await mkdir(downloadDir, { recursive: true });
    gh('release', 'download', tag, '--repo', repository, '--pattern', assetName, '--dir', downloadDir, '--clobber');
    const uploaded = await readFile(`${downloadDir}/${assetName}`);
    const digest = buffer => createHash('sha256').update(buffer).digest('hex');
    if (digest(uploaded) !== digest(bytes)) throw new Error('The GitHub release ZIP does not match the validated package.');
    await writeFile(zip, uploaded);
    if (!release || release.draft) gh('release', 'edit', tag, '--repo', repository, '--draft=false');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `GitHub release: [${tag}](https://github.com/${repository}/releases/tag/${tag})\n\nZIP SHA-256: \`${digest(uploaded)}\`\n\n`);
}

if (process.argv[2] === 'prepare') await prepare();
else if (process.argv[2] === 'publish') await publish();
else throw new Error('Expected prepare or publish.');
