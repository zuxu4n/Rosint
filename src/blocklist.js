// Public search reads only config and subject hashes from the removal service.
// One successful blocklist response serves every check for a short window, so a
// search and its pagination cost one service request instead of one per fetch.
export const BLOCKLIST_REUSE_MS = 30000;

export function createBlocklistClient({ origin, fetcher = fetch, reuseMs = BLOCKLIST_REUSE_MS, now = Date.now }) {
    let configPromise, blocklistPromise, blocklistExpires = 0;
    const read = async path => {
        const response = await fetcher(`${origin.replace(/\/$/, '')}${path}`, {
            cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000)
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Removal service unavailable');
        return response.json();
    };
    return async hash => {
        if (!origin) return false; // Local search may run without a removal service.
        try {
            configPromise ||= read('/api/config').then(config => {
                if (typeof config.featuresEnabled !== 'boolean') throw new Error('Invalid configuration');
                return config;
            }).catch(error => { configPromise = undefined; throw error; });
            if (!(await configPromise).featuresEnabled) return false;
            if (!blocklistPromise || now() >= blocklistExpires) {
                // Concurrent checks share the request in flight; failures are never reused.
                const pending = read('/api/blocklist').then(result => {
                    if (!Array.isArray(result.hashes) || result.hashes.some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new Error('Invalid blocklist');
                    blocklistExpires = now() + reuseMs;
                    return new Set(result.hashes);
                });
                blocklistPromise = pending;
                blocklistExpires = Infinity;
                pending.catch(() => { if (blocklistPromise === pending) blocklistPromise = undefined; });
            }
            return (await blocklistPromise).has(hash);
        } catch { return true; } // Refuse archive requests while restrictions cannot be checked.
    };
}

export const dynamicallyBlocked = createBlocklistClient({
    origin: import.meta.env?.VITE_REMOVAL_SERVICE_ORIGIN || (import.meta.env?.DEV ? '' : 'https://removal.rosint.dev')
});
