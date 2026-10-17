import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPostLookup, retryAfterMs, POST_IDS_PER_REQUEST } from '../src/postLookup.js';

const base = 'https://archive.example';
const idsOf = url => new URL(url).searchParams.get('ids').split(',');

// Collects scheduled flushes so each test decides when a batch is sent.
function setup(respond) {
    const calls = [], waits = [], queued = [];
    const lookup = createPostLookup({
        base,
        fetcher: async url => { calls.push(url); return respond(url, calls.length); },
        wait: async ms => { waits.push(ms); },
        schedule: fn => queued.push(fn),
        now: () => Date.parse('2026-10-05T00:00:00Z'),
        random: () => 0,
    });
    const flush = () => { while (queued.length) queued.shift()(); };
    return { lookup, calls, waits, flush };
}

const found = url => Response.json({ data: idsOf(url).map(id => ({ id, title: `post ${id}` })) });

test('lookups in the same tick share one request and duplicates are sent once', async () => {
    const { lookup, calls, flush } = setup(found);
    const results = Promise.all(['a1', 'b2', 'a1', 'c3', 'b2'].map(lookup));
    flush();
    const posts = await results;
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).pathname, '/api/posts/ids');
    assert.deepEqual(idsOf(calls[0]), ['a1', 'b2', 'c3']);
    assert.deepEqual(posts.map(post => post.id), ['a1', 'b2', 'a1', 'c3', 'b2']);
});

test('batches split at 500 IDs', async () => {
    const { lookup, calls, flush } = setup(found);
    const ids = Array.from({ length: 1201 }, (_, i) => `p${i.toString(36)}`);
    const results = Promise.all(ids.map(lookup));
    flush();
    const posts = await results;
    assert.deepEqual(calls.map(url => idsOf(url).length), [POST_IDS_PER_REQUEST, POST_IDS_PER_REQUEST, 201]);
    assert.deepEqual(calls.flatMap(idsOf), ids);
    assert.equal(posts.every((post, i) => post.id === ids[i]), true);
});

test('cached posts and missing posts are never requested again', async () => {
    const { lookup, calls, flush } = setup(url => Response.json({ data: idsOf(url).filter(id => id !== 'gone').map(id => ({ id })) }));
    const first = Promise.all([lookup('a1'), lookup('gone')]);
    flush();
    assert.deepEqual((await first).map(post => post?.id ?? null), ['a1', null]);
    // A later page repeats both IDs and adds one new one.
    const second = Promise.all([lookup('a1'), lookup('gone'), lookup('n3')]);
    flush();
    assert.deepEqual((await second).map(post => post?.id ?? null), ['a1', null, 'n3']);
    assert.equal(calls.length, 2);
    assert.deepEqual(idsOf(calls[1]), ['n3']);
});

test('a rate-limited batch retries after Retry-After', async () => {
    const { lookup, calls, waits, flush } = setup((url, n) => n === 1
        ? new Response('', { status: 429, headers: { 'Retry-After': '7' } })
        : found(url));
    const result = lookup('a1');
    flush();
    assert.equal((await result).id, 'a1');
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [7000]);
});

test('a batch that keeps failing resolves to no post and can be tried again later', async () => {
    let fail = true;
    const { lookup, calls, waits, flush } = setup(url => fail ? new Response('', { status: 503 }) : found(url));
    const result = Promise.all([lookup('a1'), lookup('a1')]);
    flush();
    assert.deepEqual(await result, [null, null]);
    assert.equal(calls.length, 4);
    assert.deepEqual(waits, [1500, 3000, 6000]);
    fail = false;
    const retry = lookup('a1');
    flush();
    assert.equal((await retry).id, 'a1');
    assert.equal(calls.length, 5);
});

test('network errors retry; rejections and long waits do not retry', async () => {
    const network = setup((url, n) => { if (n === 1) throw new TypeError('offline'); return found(url); });
    const a = network.lookup('a1');
    network.flush();
    assert.equal((await a).id, 'a1');
    assert.equal(network.calls.length, 2);

    const rejected = setup(() => new Response('', { status: 400 }));
    const b = rejected.lookup('b2');
    rejected.flush();
    assert.equal(await b, null);
    assert.equal(rejected.calls.length, 1);

    const longWait = setup(() => new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
    const c = longWait.lookup('c3');
    longWait.flush();
    assert.equal(await c, null);
    assert.equal(longWait.calls.length, 1);
    assert.deepEqual(longWait.waits, []);
});

test('invalid IDs never reach the archive', async () => {
    const { lookup, calls, flush } = setup(found);
    assert.deepEqual(await Promise.all([lookup(undefined), lookup(123), lookup(''), lookup('a,b')]), [null, null, null, null]);
    flush();
    assert.equal(calls.length, 0);
});

test('Retry-After accepts seconds and HTTP dates', () => {
    const now = () => Date.parse('2026-10-05T00:00:00Z');
    const withHeader = value => new Response('', { status: 429, headers: value ? { 'Retry-After': value } : {} });
    assert.equal(retryAfterMs(withHeader('3'), now), 3000);
    assert.equal(retryAfterMs(withHeader('Mon, 05 Oct 2026 00:00:10 GMT'), now), 10000);
    assert.equal(retryAfterMs(withHeader('soon'), now), null);
    assert.equal(retryAfterMs(withHeader(), now), null);
});
