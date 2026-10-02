# Rosint public search handoff

The working tree still contains uncommitted public-site changes; preserve them. See README.md and docs/application-state.md.

The removal/admin service has been extracted into the sibling `../rosint-removal` checkout. Its original source files and documents are preserved in that checkout's ignored `.split-backup/`, and the service has its own Git repository. The public repo no longer includes admin/removal screens, private APIs, database migrations, workflow tests, or CAPTCHA secrets.

Public production search is configured to use `https://removal.rosint.dev` for active restrictions. The info button points to that service. Legacy feature URLs redirect; only public read endpoints have compatibility proxies. Plain development search skips dynamic checks without `VITE_REMOVAL_SERVICE_ORIGIN`. Unavailable production restrictions fail closed.

The service must be live and validated before the public integration is deployed. Production needs PostgreSQL/Hyperdrive, all four migrations, runtime grants, Access for admin paths/API, and both CAPTCHA providers. Existing Cloudflare API credentials lacked access to the Worker at the last check. No deployment should be inferred from dry-runs or local tests.

Public CLI static blocks remain independent. Database imports are owned by the private service. Existing AI credentials in the public `.env` were preserved. Tests/builds run separately in each checkout.

Preserve shared username normalization, direct archive searches, post-only NSFW filters, parent-ID guards, timestamp pagination, the dark-only result design, and decoy behavior for restricted subjects. Keep watchlist features removed. Jason prefers short responses, plain hyphens, and four-space App.jsx/script indentation. He normally pushes the public repo himself.
