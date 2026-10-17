// Comment cards show their parent post. Instead of one /api/posts/ids request
// per card, lookups requested in the same tick are merged into one request per
// 500 unique IDs, and every result is cached by ID for the session.
export const POST_IDS_PER_REQUEST = 500;
export const DEFAULT_RETRY_DELAY_MS = 1500;
export const MAX_RETRY_AFTER_MS = 60000;
export const MAX_RETRIES = 3;
export const RETRY_JITTER = 0.25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry-After is either seconds or an HTTP date.
export function retryAfterMs(response, now = Date.now) {
    const value = response?.headers?.get?.("retry-after");
    if (!value) return null;
    if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - now());
}

// Exponential backoff for the nth retry (0-based): 1.5s, 3s, 6s, each
// stretched by up to 25% random jitter so clients do not retry in lockstep.
export function backoffDelayMs(retry, random = Math.random) {
    return Math.round(DEFAULT_RETRY_DELAY_MS * 2 ** retry * (1 + RETRY_JITTER * random()));
}

// Fetches url and resolves to the ok Response, or null once it gives up.
// Only failures that can clear on their own are retried: 429, 5xx and network
// errors. Other 4xx responses and Retry-After waits over MAX_RETRY_AFTER_MS
// fail at once. onRetry(n) fires as the nth retry request goes out.
export async function fetchWithBackoff(url, {
    init,
    retries = MAX_RETRIES,
    fetcher = (...args) => fetch(...args),
    wait = sleep,
    now = Date.now,
    random = Math.random,
    onRetry,
} = {}) {
    for (let attempt = 0; ; attempt++) {
        let res = null;
        try {
            res = await fetcher(url, init);
        } catch { /* network error - retryable */ }
        if (res?.ok) return res;
        if (res && res.status !== 429 && res.status < 500) return null;
        if (attempt >= retries) return null;
        const delay = retryAfterMs(res, now) ?? backoffDelayMs(attempt, random);
        if (delay > MAX_RETRY_AFTER_MS) return null;
        await wait(delay);
        onRetry?.(attempt + 1);
    }
}

export function createPostLookup({
    base,
    fetcher = (...args) => fetch(...args),
    wait = sleep,
    schedule = (fn) => setTimeout(fn, 0),
    now = Date.now,
    random = Math.random,
} = {}) {
    const cache = new Map(); // id -> Promise<post | null>
    let pending = new Map(); // id -> resolve, for the batch being collected

    async function request(ids) {
        const url = `${base}/api/posts/ids?ids=${ids.join(",")}`;
        const res = await fetchWithBackoff(url, {
            init: { headers: { Accept: "application/json" } },
            fetcher, wait, now, random,
        });
        if (!res) return null;
        try {
            const json = await res.json();
            return Array.isArray(json?.data) ? json.data : null;
        } catch {
            return null;
        }
    }

    async function flush() {
        const batch = pending;
        pending = new Map();
        const ids = [...batch.keys()];
        for (let i = 0; i < ids.length; i += POST_IDS_PER_REQUEST) {
            const chunk = ids.slice(i, i + POST_IDS_PER_REQUEST);
            request(chunk).then((posts) => {
                const byId = new Map();
                for (const post of posts ?? []) {
                    if (post && typeof post.id === "string") byId.set(post.id, post);
                }
                for (const id of chunk) {
                    // Failed batches are forgotten so a later view can try again;
                    // IDs missing from a good response stay cached as not found.
                    if (!posts) cache.delete(id);
                    batch.get(id)(byId.get(id) ?? null);
                }
            });
        }
    }

    return function lookupPost(id) {
        if (typeof id !== "string" || !/^[a-z0-9]+$/i.test(id)) return Promise.resolve(null);
        if (cache.has(id)) return cache.get(id);
        const promise = new Promise((resolve) => {
            if (pending.size === 0) schedule(flush);
            pending.set(id, resolve);
        });
        cache.set(id, promise);
        return promise;
    };
}
