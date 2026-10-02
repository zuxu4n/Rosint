// Public search Worker: redirects legacy feature URLs and proxies only public reads.
export function createHandler(fetcher = fetch) {
    return async (request, env) => {
        const url = new URL(request.url);
        if (url.hostname === 'www.rosint.dev') {
            url.hostname = 'rosint.dev';
            return Response.redirect(url.href, 301);
        }
        const origin = env.REMOVAL_SERVICE_ORIGIN || 'https://removal.rosint.dev';
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            return Response.redirect(new URL(url.pathname + url.search, origin).href, 302);
        }
        if (url.pathname === '/removal' || url.pathname.startsWith('/removal/')) {
            return Response.redirect(new URL('/' + url.search, origin).href, 302);
        }
        if (url.pathname.startsWith('/api/')) {
            if (request.method === 'GET' && ['/api/config', '/api/blocklist'].includes(url.pathname)) {
                try {
                    const readService = env.REMOVAL_SERVICE ? env.REMOVAL_SERVICE.fetch.bind(env.REMOVAL_SERVICE) : fetcher;
                    const response = await readService(new URL(url.pathname, origin), {
                        headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000)
                    });
                    if (response.status >= 300 && response.status < 400) throw new Error('Unexpected service redirect');
                    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid service response');
                    return new Response(response.body, { status: response.status, headers: {
                        'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
                    } });
                } catch (error) { console.error('public_proxy_failure', error.name); return Response.json({ error: 'Removal service unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
            }
            return Response.json({ error: 'Endpoint not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
        }
        return env.ASSETS.fetch(request);
    };
}
export default { fetch: createHandler() };
