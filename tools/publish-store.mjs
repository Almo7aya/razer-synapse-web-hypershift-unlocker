import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, packageName, parseVersion } from './version.mjs';

export function inspectStoreStatus(status, version, resume = false) {
    parseVersion(version);
    if (status.takenDown) throw new Error('This store item is taken down. Resolve it in the Developer Dashboard.');
    const channels = revision => revision?.distributionChannels || [];
    const published = status.publishedItemRevisionStatus;
    const publishedVersions = channels(published).map(channel => compareVersions(channel.crxVersion, version));
    if (publishedVersions.some(order => order > 0)) throw new Error('A newer version is already published. Refusing to upload an older release.');
    if (publishedVersions.includes(0)) {
        if (!resume) throw new Error('This version already exists in the store. Update the repository version before releasing.');
        if (!['PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(published.state)) throw new Error('Unexpected published revision state.');
        return published.state;
    }
    const submitted = status.submittedItemRevisionStatus;
    const sameVersion = channels(submitted).some(channel => compareVersions(channel.crxVersion, version) === 0);
    if (['PENDING_REVIEW', 'STAGED'].includes(submitted?.state)) {
        if (sameVersion && resume) return submitted.state;
        throw new Error('Another submission is pending or staged. Resolve it in the Developer Dashboard first.');
    }
    if (sameVersion && submitted?.state === 'REJECTED') throw new Error('This version was rejected. Review the feedback before creating another release.');
    if (['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(status.lastAsyncUploadState)) throw new Error('An upload is still processing. Wait for it to finish before retrying.');
    return 'READY';
}

export function createStoreClient({ publisherId, extensionId, token, request = fetch }) {
    if (!/^[a-zA-Z0-9_-]+$/.test(publisherId || '') || !/^[a-p]{32}$/.test(extensionId || '') || !token) {
        throw new Error('Set valid CWS_PUBLISHER_ID, CWS_EXTENSION_ID, and Google authentication.');
    }
    const item = `publishers/${publisherId}/items/${extensionId}`;
    async function call(path, options = {}) {
        const response = await request(`https://chromewebstore.googleapis.com/${path}`, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, ...options.headers },
            signal: AbortSignal.timeout(60000),
            redirect: 'error',
        });
        const text = await response.text();
        let result;
        try { result = JSON.parse(text); } catch { throw new Error(`Chrome Web Store returned invalid JSON (HTTP ${response.status}).`); }
        if (!response.ok) {
            const message = String(result.error?.message || 'Request failed').replaceAll(token, '[redacted]').slice(0, 1500);
            throw new Error(`Chrome Web Store HTTP ${response.status}: ${message}`);
        }
        if (result.itemId && result.itemId !== extensionId) throw new Error('Chrome Web Store returned an unexpected item ID.');
        return result;
    }
    return {
        status: () => call(`v2/${item}:fetchStatus`),
        upload: zip => call(`upload/v2/${item}:upload`, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip }),
        publish: () => call(`v2/${item}:publish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false }),
        }),
    };
}

export async function submitToStore({ client, version, zip, resume = false, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 24 }) {
    const state = inspectStoreStatus(await client.status(), version, resume);
    if (['PENDING_REVIEW', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(state)) return state;
    if (state !== 'STAGED') {
        const upload = await client.upload(zip);
        if (upload.crxVersion && compareVersions(upload.crxVersion, version) !== 0) throw new Error('Uploaded manifest version does not match the release.');
        let uploadState = upload.uploadState;
        for (let i = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploadState) && i < attempts; i++) {
            await wait(5000);
            uploadState = (await client.status()).lastAsyncUploadState;
        }
        if (uploadState !== 'SUCCEEDED') throw new Error(`Store upload did not succeed (${uploadState || 'unknown state'}). Re-run this workflow after checking the dashboard.`);
    }
    const published = await client.publish();
    if (!['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS'].includes(published.state)) {
        throw new Error(`Unexpected submission state: ${published.state || 'unknown'}.`);
    }
    return published.state;
}

async function main() {
    const version = process.env.RELEASE_VERSION;
    const state = JSON.parse(await readFile('artifacts/release.json', 'utf8'));
    if (state.version !== version || state.runId !== process.env.GITHUB_RUN_ID) throw new Error('Release state does not match this workflow run.');
    const client = createStoreClient({
        publisherId: process.env.CWS_PUBLISHER_ID,
        extensionId: process.env.CWS_EXTENSION_ID,
        token: process.env.CWS_ACCESS_TOKEN,
    });
    if (process.argv[2] === 'preflight') {
        const status = inspectStoreStatus(await client.status(), version, state.existing);
        console.log(`Chrome Web Store access confirmed; release status: ${status}.`);
    } else if (process.argv[2] === 'publish') {
        const result = await submitToStore({
            client, version, resume: state.existing,
            zip: await readFile(`artifacts/${packageName(version)}`),
        });
        console.log(`Chrome Web Store ${version}: ${result}`);
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `Chrome Web Store version **${version}**: **${result}**.\n\nSubmission success does not mean review has finished.\n`);
    } else throw new Error('Expected preflight or publish.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
