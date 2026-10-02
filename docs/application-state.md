# Public search and separate removal service

The public repository serves `rosint.dev`. Removal intake, administration, authentication, database state, CAPTCHA validation, and migration tooling now live in the private [Rosint-removal repository](https://github.com/zuxu4n/Rosint-removal).

The sibling checkout is `../rosint-removal`. Its `docs/application-state.md` contains database, Access, CAPTCHA, and workflow setup. It preserves all four migrations and the reversible workflow implementation.

## Integration

`src/blocklist.js` reads the service config and active hash list from `https://removal.rosint.dev`. Only hashes are exchanged; archive queries still run directly in the browser. Reads omit credentials and use no-store caching. Restrictions are checked before each search and pagination request; one successful blocklist response is reused for up to 30 seconds, so a search and its pagination normally cost one service request. Outages and invalid responses fail closed and are never reused. Static/CLI blocks stay independent of request approval undo.

The service allows CORS for GET `/api/config` and `/api/blocklist` from its exact `SEARCH_ORIGIN`, normally `https://rosint.dev`. Admin endpoints and public POST intake are not enabled for cross-origin access. Intake must originate from the removal service itself.

Legacy `/removal` and `/admin` URLs redirect to the service. The public Worker retains only public config/blocklist proxies for older frontend clients. Its other `/api/*` paths return 404.

## Local verification

Run the removal demo from the private checkout, normally on `127.0.0.1:5174`. Set `VITE_REMOVAL_SERVICE_ORIGIN` in the public app's ignored `.env` to that origin and restart Vite. Match the service's `DEMO_SEARCH_ORIGIN` to the exact search browser origin. Plain local search intentionally skips dynamic checks when no service override is set.

Run `npm test`, `npm run lint`, `npm run build`, and `npm run deploy:check` separately in each repository. Tests and dry-runs do not validate live PostgreSQL, Access policies, provider keys, or hosting permissions.

## Logs and monitoring

wrangler.jsonc enables Workers Logs with invocation logs off and query strings redacted, so only the Worker's `public_proxy_failure` event (an error name) is stored. An hourly workflow in the private repository checks that rosint.dev/admin redirects to the service and that the live bundle still contains the restriction check. Workers Builds deploys master on every push, so a failed run right after a push usually means the wrong commit went live. See the private repository's docs/application-state.md.

## Release order

1. Configure the private service's PostgreSQL/Hyperdrive, apply all four migrations, and establish runtime grants.
2. Protect `removal.rosint.dev/admin`, `/admin/*`, and `/api/admin/*` with Cloudflare Access; configure its audience and administrator allowlist. The service also checks authentication before serving admin HTML.
3. Configure both CAPTCHA providers for `removal.rosint.dev`, then deploy the private service with its features enabled.
4. Check the service's public config/blocklist from `rosint.dev` and test approved restriction enforcement and undo.
5. Deploy the public search app. Publishing it before the service is available causes fail-closed searches.

Both Workers were deployed on October 1, 2026 after Neon, Hyperdrive, Access, and CAPTCHA setup. Public search reads live restrictions from the removal service; the compatibility API proxy uses the REMOVAL_SERVICE Worker binding. www.rosint.dev redirects to rosint.dev to use the allowed CORS origin. Anonymous administration redirects to Access, and private APIs remain absent from the public Worker. Real human CAPTCHA submission and authenticated approval/undo remain operator checks. Public working-tree changes remain uncommitted for Jason to review and push.

Secrets remain in ignored private-service configuration or Worker secret storage. The public app needs only the non-secret removal service origin and Worker binding.

On October 1, the account exhausted its Workers Free daily request quota (Error 1027). Public run_worker_first is now limited to API and legacy admin/removal paths; HTML and assets are served directly without Worker invocation. Browser navigation from www redirects to the canonical hostname in src/main.jsx. Static pages were verified to return 200 after deployment; APIs still returned 429 pending the account quota reset. Searches intentionally remain closed while current restrictions cannot be checked. Do not enable global run_worker_first for canonical redirects on the Free plan. The quota resets at midnight UTC and is shared across the account.
