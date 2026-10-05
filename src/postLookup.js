// Comment cards show their parent post. Instead of one /api/posts/ids request
// per card, lookups requested in the same tick are merged into one request per
// 500 unique IDs, and every result is cached by ID for the session.
export const POST_IDS_PER_REQUEST = 500;
export const DEFAULT_RETRY_DELAY_MS = 1500;
export const MAX_RETRY_AFTER_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry-After is either seconds or an HTTP date.
export function retryAfterMs(response, now = Date.now) {
    const value = response?.headers?.get?.("retry-after");
    if (!value) return null;
    if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - now());
}

export function createPostLookup({
    base,
    fetcher = (...args) => fetch(...args),
    wait = sleep,
    schedule = (fn) => setTimeout(fn, 0),
    now = Date.now,
} = {}) {
    const cache = new Map(); // id -> Promise<post | null>
    let pending = new Map(); // id -> resolve, for the batch being collected

    async function request(ids) {
        const url = `${base}/api/posts/ids?ids=${ids.join(",")}`;
        for (let attempt = 0; attempt < 2; attempt++) {
            let delay = DEFAULT_RETRY_DELAY_MS;
            try {
                const res = await fetcher(url, { headers: { Accept: "application/json" } });
                if (res.ok) {
                    const json = await res.json();
                    if (Array.isArray(json?.data)) return json.data;
                    return null;
                }
                // Other 4xx responses will not clear on their own.
                if (res.status !== 429 && res.status < 500) return null;
                delay = retryAfterMs(res, now) ?? delay;
            } catch { /* network error - retryable */ }
            if (attempt === 1 || delay > MAX_RETRY_AFTER_MS) return null;
            await wait(delay);
        }
        return null;
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
