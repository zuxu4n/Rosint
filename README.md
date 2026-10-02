# Rosint.dev

Reddit user intelligence tool: search the post and comment history available in independent archives, including deleted content and archived material from private or suspended accounts. Archive coverage varies; Rosint does not bypass Reddit access controls.

[rosint.dev](https://rosint.dev)

https://github.com/user-attachments/assets/6967e195-7de8-42cf-8429-34ae6281db51

## Features

- Arctic Shift and PullPush searches run directly in the browser, merged and deduplicated by ID.
- Posts and comments, date/subreddit/keyword filters, deleted-content filters, and post NSFW controls.
- Timestamp pagination and anonymous search.
- Static hashed restrictions plus current approved restrictions fetched from the separate removal service.

## Repositories and hosting

This public repository contains the search website served at `rosint.dev`. The removal form, admin UI, Worker API, database migrations, workflow tests, and service configuration belong to the private `Rosint-removal` repository at [github.com/zuxu4n/Rosint-removal](https://github.com/zuxu4n/Rosint-removal).

The service is configured for `removal.rosint.dev`. The info page opens that address in a new tab. Legacy `/removal` and `/admin` URLs redirect there. There is no private request API or admin UI in the public app.

Production builds fetch `/api/config` and `/api/blocklist` from `https://removal.rosint.dev`, using no cookies or plaintext usernames. The service permits cross-origin reads only from the configured search origin. The public Worker proxies these two read endpoints for previously loaded clients; it does not expose the admin API. Unavailable or malformed restrictions fail closed before any archive request. Static hashes remain active even when the service features are disabled.

Deploy the removal service, configure its database and Access, and validate its public endpoints before deploying this search integration. Local code and dry-runs do not establish live deployment readiness.

## Local development

Use Node.js 24 or newer and the checked-in `.npmrc` compatibility setting.

```bash
npm ci
npm run dev
```

Plain local search works without a removal backend. To test dynamic restrictions, add the public, non-secret setting `VITE_REMOVAL_SERVICE_ORIGIN=http://127.0.0.1:5174` to the existing ignored `.env` without overwriting other values, then restart Vite. Run the demo from the private repository. Its `DEMO_SEARCH_ORIGIN` must exactly match your browser origin, for example `http://localhost:5173`.

`VITE_REMOVAL_SERVICE_ORIGIN` can override the production service URL for staging. Never put secrets in `VITE_` variables. Public search does not require database, Access, Turnstile, or hCaptcha credentials.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Search preview |
| `npm test` | Restriction client, outage handling, redirects, and public proxy checks |
| `npm run lint` | JavaScript/JSX checks |
| `npm run build` | Build public frontend |
| `npm run deploy:check` | Bundle public Worker without publishing |
| `npm run preview` | Preview built assets |

## Local CLI tools

- `node scripts/lookup.mjs <username>` reads an archive summary.
- `node scripts/triage.mjs <username> [more usernames...]` provides advisory AI recommendations; also accepts `--file` or piped input.
- `node scripts/block.mjs [--dry-run] <username> [more usernames...]` adds independent hashes to the public static list. Build and deploy for those changes to take effect. Database imports are managed in the private service.
- `node scripts/removal-reply.mjs <username> [name]` prints a legacy reply template for manual editing and sending.

AI triage does not approve requests or execute blocks. Existing Gemini/Cloudflare AI settings remain in the ignored `.env`. The app and CLI do not send confirmation email.

## Limitations

Archives may omit recent content or be unavailable. Rosint restrictions affect Rosint searches; source deletion belongs to archive operators. Public SHA-256 hashes can be dictionary-tested and do not guarantee anonymous blocklist membership.

## Credits

- [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift)
- [PullPush](https://pullpush.io)
- Logo inspired by [searchcord.io](https://searchcord.io)

Submit removal requests at [removal.rosint.dev](https://removal.rosint.dev/). For source removal, contact [PullPush](https://removals.pullpush.io/) or [Arctic Shift](https://docs.google.com/forms/d/e/1FAIpQLSfzkmE8Bg6K_xii7aRm66ljzvo2tR59lTsdJ99acW4WX786Vw/viewform?usp=sf_link).
