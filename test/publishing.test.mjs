import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion, replaceVersion, compareVersions } from '../tools/version.mjs';
import { createStoreClient, inspectStoreStatus, submitToStore } from '../tools/publish-store.mjs';

test('release increments reset the smaller fields and respect Chrome version limits', () => {
    assert.equal(nextVersion('0.1.9', 'patch'), '0.1.10');
    assert.equal(nextVersion('1.9.8', 'minor'), '1.10.0');
    assert.equal(nextVersion('1.9.8', 'major'), '2.0.0');
    for (const version of ['0.0.0', '01.2.3', '1.2.3-beta', '1.2.3.4', '1.2.65536']) assert.throws(() => nextVersion(version, 'patch'));
    assert.throws(() => nextVersion('1.2.65535', 'patch'));
    assert.throws(() => nextVersion('1.2.3', 'unknown'));
    assert.equal(compareVersions('0.1.0.0', '0.1.0'), 0);
    assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
});

test('version edits preserve unrelated metadata and reject inconsistent versions', () => {
    const source = '{\n  "version": "0.1.0",\n  "description": "Keep 0.1.0 here"\n}\n';
    assert.equal(replaceVersion(source, '0.1.0', '0.1.1'), source.replace('"version": "0.1.0"', '"version": "0.1.1"'));
    assert.throws(() => replaceVersion(source, '0.2.0', '0.2.1'));
});

const revision = (version, state) => ({ state, distributionChannels: [{ crxVersion: version }] });
const initial = { publishedItemRevisionStatus: revision('0.1.0', 'PUBLISHED') };
const fakeClient = (statuses, upload = { uploadState: 'SUCCEEDED', crxVersion: '0.1.1' }) => {
    const calls = [];
    return {
        calls,
        status: async () => { calls.push('status'); return statuses.shift(); },
        upload: async zip => { calls.push(['upload', zip]); return upload; },
        publish: async () => { calls.push('publish'); return { state: 'PENDING_REVIEW' }; },
    };
};

test('a new release cannot overwrite an existing version or an unrelated pending submission', () => {
    assert.throws(() => inspectStoreStatus(initial, '0.1.0'));
    assert.throws(() => inspectStoreStatus(initial, '0.0.9', true));
    assert.throws(() => inspectStoreStatus({ submittedItemRevisionStatus: revision('0.1.2', 'PENDING_REVIEW') }, '0.1.1', true));
});

test('upload processing completes before submission, using the provided ZIP bytes', async () => {
    const zip = Buffer.from('release ZIP');
    const client = fakeClient([initial, { lastAsyncUploadState: 'IN_PROGRESS' }, { lastAsyncUploadState: 'SUCCEEDED' }], { uploadState: 'IN_PROGRESS' });
    const state = await submitToStore({ client, version: '0.1.1', zip, wait: async () => {} });
    assert.equal(state, 'PENDING_REVIEW');
    assert.deepEqual(client.calls, ['status', ['upload', zip], 'status', 'status', 'publish']);
});

test('failed, timed out, or mismatched uploads never submit a release', async () => {
    for (const upload of [
        { uploadState: 'FAILED' },
        { uploadState: 'IN_PROGRESS' },
        { uploadState: 'SUCCEEDED', crxVersion: '0.1.2' },
    ]) {
        const client = fakeClient([initial], upload);
        await assert.rejects(submitToStore({ client, version: '0.1.1', zip: Buffer.from('zip'), attempts: 0 }));
        assert.equal(client.calls.includes('publish'), false);
    }
});

test('reruns do not upload or submit a version already under review or published', async () => {
    for (const status of [
        { submittedItemRevisionStatus: revision('0.1.1', 'PENDING_REVIEW') },
        { publishedItemRevisionStatus: revision('0.1.1', 'PUBLISHED') },
    ]) {
        const client = fakeClient([status]);
        await submitToStore({ client, version: '0.1.1', resume: true });
        assert.deepEqual(client.calls, ['status']);
    }
});

test('a previously staged version is published without uploading it again', async () => {
    const client = fakeClient([{ submittedItemRevisionStatus: revision('0.1.1', 'STAGED') }]);
    await submitToStore({ client, version: '0.1.1', resume: true });
    assert.deepEqual(client.calls, ['status', 'publish']);
});

test('API calls use v2, ZIP content, the Chrome scope token, and normal review', async () => {
    const requests = [];
    const client = createStoreClient({
        publisherId: 'publisher', extensionId: 'a'.repeat(32), token: 'test-token',
        request: async (url, options) => {
            requests.push({ url, options });
            return new Response(JSON.stringify({ itemId: 'a'.repeat(32) }));
        },
    });
    const zip = Buffer.from('zip');
    await client.status(); await client.upload(zip); await client.publish();
    assert.match(requests[0].url, /\/v2\/publishers\/publisher\/items\/[a]{32}:fetchStatus$/);
    assert.match(requests[1].url, /\/upload\/v2\//);
    assert.equal(requests[1].options.body, zip);
    assert.equal(requests[1].options.headers['Content-Type'], 'application/zip');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(requests[2].options.body), { publishType: 'DEFAULT_PUBLISH', skipReview: false });
});

test('API failures do not print the access token', async () => {
    const client = createStoreClient({
        publisherId: 'publisher', extensionId: 'a'.repeat(32), token: 'private-token',
        request: async () => new Response(JSON.stringify({ error: { message: 'Invalid private-token' } }), { status: 401 }),
    });
    await assert.rejects(client.status(), error => error.message.includes('401') && !error.message.includes('private-token'));
});
