# Rosint public search project

Read README.md, HANDOFF.md, and docs/application-state.md. Preserve all existing uncommitted work and user credentials.

This checkout contains public search only. The removal form, admin UI, Worker API, database migrations, and workflow tests have moved to the private sibling checkout `../rosint-removal` and GitHub repository `zuxu4n/Rosint-removal`. Do not copy service implementation or credentials back into this public repo.

Search queries Arctic Shift and PullPush directly. `src/blocklist.js` reads public config and active hashes from `removal.rosint.dev`. Fail closed when enabled restrictions cannot be fetched; preserve static blocking, deep-link checks, timestamp pagination, archive deduplication, card boundaries, and existing dark styling. NSFW controls apply to posts; type-check archive parent IDs before string operations. The watchlist remains removed.

The public Worker only redirects legacy feature URLs and proxies public config/blocklist reads. Admin and request APIs belong to the service. Deploy the service and validate its public endpoints before publishing the public integration.

Node.js 24+. Checks: npm test, npm run lint, npm run build, npm run deploy:check. Existing App.jsx lint warning for hours remains. Use four-space indentation in App.jsx/scripts and plain hyphens in copy. Jason prefers short responses and routine changes without repeated confirmation; he normally pushes public changes himself. Do not add Co-Authored-By: Claude trailers.

Keep `.env` credentials, requester worklists, local Claude state, and private data out of commits. Gemini/Cloudflare AI triage remains optional and advisory. Do not assume historical SEO/monetization ideas are pending work.
