import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKLIST_REUSE_MS, createBlocklistClient } from '../src/blocklist.js';
import { createHandler } from '../worker/index.js';

const hash = 'a'.repeat(64);
const origin = 'https://removal.rosint.dev';

test('production proxy uses the removal Worker binding only for public reads', async () => {
    let calls = 0;
    const env = { REMOVAL_SERVICE: { fetch: async (url, options) => {
        calls++;
        assert.equal(url.href, origin + '/api/config');
        assert.equal(options.redirect, 'manual');
        assert.deepEqual(options.headers, { Accept: 'application/json' });
        return Response.json({ featuresEnabled: true });
    } } };
    const handler = createHandler(async () => { throw new Error('Must use service binding'); });
    assert.equal((await handler(new Request('https://rosint.dev/api/config'), env)).status, 200);
    assert.equal((await handler(new Request('https://rosint.dev/api/admin/removals'), env)).status, 404);
    assert.equal(calls, 1);
});

test('www searches redirect to the canonical origin allowed by the removal service', async () => {
    const response = await createHandler()(new Request('https://www.rosint.dev/?u=example'), {});
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), 'https://rosint.dev/?u=example');
});

test('public search fetches hashes without sending usernames or credentials and observes approval undo', async () => {
    let blocked = true, clock = 0;
    const calls = [];
    const check = createBlocklistClient({ origin, now: () => clock, fetcher: async (url, options) => {
        calls.push(url);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.cache, 'no-store');
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(url.endsWith('/config') ? { featuresEnabled: true } : { hashes: blocked ? [hash] : [] });
    } });
    assert.equal(await check(hash), true);
    blocked = false;
    clock += BLOCKLIST_REUSE_MS;
    assert.equal(await check(hash), false);
    assert.deepEqual(calls, [origin + '/api/config', origin + '/api/blocklist', origin + '/api/blocklist']);
});

test('one blocklist response serves a search and its pagination within the reuse window', async () => {
    let clock = 0, blocklistReads = 0, hashes = [];
    const check = createBlocklistClient({ origin, now: () => clock, fetcher: async url => {
        if (url.endsWith('/config')) return Response.json({ featuresEnabled: true });
        blocklistReads++;
        return Response.json({ hashes });
    } });
    // A search checks once up front, then once per posts/comments fetch and per page.
    assert.deepEqual(await Promise.all([check(hash), check(hash), check(hash)]), [false, false, false]);
    hashes = [hash];
    clock += BLOCKLIST_REUSE_MS - 1;
    assert.equal(await check(hash), false);
    assert.equal(blocklistReads, 1);
    clock += 1;
    assert.equal(await check(hash), true);
    assert.equal(blocklistReads, 2);
});

test('a failed blocklist read fails closed and is retried on the next check', async () => {
    let failures = 1, blocklistReads = 0;
    const check = createBlocklistClient({ origin, now: () => 0, fetcher: async url => {
        if (url.endsWith('/config')) return Response.json({ featuresEnabled: true });
        blocklistReads++;
        if (failures-- > 0) return Response.json({ error: 'Unavailable' }, { status: 503 });
        return Response.json({ hashes: [] });
    } });
    assert.equal(await check(hash), true);
    assert.equal(await check(hash), false);
    assert.equal(blocklistReads, 2);
});

test('unavailable or malformed removal-service responses fail closed', async () => {
    for (const fetcher of [
        async () => { throw new Error('Offline'); },
        async () => Response.json({ error: 'Unavailable' }, { status: 503 }),
        async () => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }),
        async () => Response.json({}),
        async url => Response.json(url.endsWith('/config') ? { featuresEnabled: true } : { hashes: ['invalid'] }),
    ]) {
        assert.equal(await createBlocklistClient({ origin, fetcher })(hash), true);
    }
});

test('plain local search works without a service and a disabled service skips dynamic checks', async () => {
    const local = createBlocklistClient({ origin: '', fetcher: async () => { throw new Error('Must not fetch'); } });
    assert.equal(await local(hash), false);
    let calls = 0;
    const disabled = createBlocklistClient({ origin, fetcher: async () => { calls++; return Response.json({ featuresEnabled: false }); } });
    assert.equal(await disabled(hash), false);
    assert.equal(calls, 1);
});

test('concurrent search checks share in-flight requests and recover after an outage', async () => {
    let online = false, calls = 0;
    const check = createBlocklistClient({ origin, fetcher: async url => {
        calls++;
        if (!online) throw new Error('Offline');
        return Response.json(url.endsWith('/config') ? { featuresEnabled: true } : { hashes: [] });
    } });
    assert.equal(await check(hash), true);
    online = true;
    assert.deepEqual(await Promise.all([check(hash), check(hash)]), [false, false]);
    assert.equal(calls, 3);
});

test('legacy removal/admin URLs redirect to the separate service and private APIs are absent', async () => {
    let assets = 0;
    const handler = createHandler();
    const env = { ASSETS: { fetch: async () => { assets++; return new Response('search'); } } };
    for (const [path, target] of [['/removal', '/'], ['/removal/?ref=abc', '/?ref=abc'], ['/admin', '/admin'], ['/admin/review?status=approved', '/admin/review?status=approved']]) {
        const response = await handler(new Request('https://rosint.dev' + path), env);
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('Location'), origin + target);
    }
    for (const path of ['/api/admin/removals', '/api/removals']) {
        assert.equal((await handler(new Request('https://rosint.dev' + path), env)).status, 404);
    }
    assert.equal(assets, 0);
    assert.equal((await handler(new Request('https://rosint.dev/?u=example'), env)).status, 200);
    assert.equal(assets, 1);
});

test('public read proxy supports previously loaded clients without forwarding cookies', async () => {
    const handler = createHandler(async (url, options) => {
        assert.equal(url.href, origin + '/api/blocklist');
        assert.deepEqual(options.headers, { Accept: 'application/json' });
        return Response.json({ hashes: [hash] });
    });
    const response = await handler(new Request('https://rosint.dev/api/blocklist', { headers: { Cookie: 'private-cookie' } }), {});
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { hashes: [hash] });
    const down = createHandler(async () => { throw new Error('Offline'); });
    assert.equal((await down(new Request('https://rosint.dev/api/config'), {})).status, 503);
    const redirect = createHandler(async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/' } }));
    assert.equal((await redirect(new Request('https://rosint.dev/api/config'), {})).status, 503);
});
