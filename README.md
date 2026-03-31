# Rosint.dev | redditOSINT

**Reddit user intelligence tool** — search any Reddit user's full post and comment history, including private accounts and deleted content.

[rosint.dev](https://rosint.dev)

## Features

- **Dual-source search** — Arctic Shift and PullPush queried in parallel, results merged and deduplicated by post/comment ID
- **Posts tab** — title, subreddit, score, comment count, timestamp, thumbnail, body snippet
- **Comments tab** — full comment body, subreddit, score, link to original thread
- **Date range filter** — filter results by before/after date using a calendar picker
- **Pagination** — timestamp-based cursor pagination (100 results per page)
- **No login required** — fully frontend, no backend, no auth


## Tech stack

| | |
|---|---|
| Framework | React + Vite |
| Styling | Tailwind CSS v3 |
| APIs | [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift), [PullPush](https://pullpush.io) |
| Hosting | Vercel |


## Running locally
```bash
git clone https://github.com/zuxu4n/RedditOsint.git
cd RedditOsint
npm install --legacy-peer-deps
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).


## "Backend"

Both APIs are queried with the same parameters:
```
Arctic Shift:  https://arctic-shift.photon-reddit.com/api/posts/search?author={username}&limit=100&sort=desc
PullPush:      https://api.pullpush.io/reddit/search/submission/?test&author={username}&limit=100&sort=desc
```


## Limitations

- Archive data updates **monthly** — recent posts may not appear
- Arctic Shift and PullPush have no guaranteed uptime
- If both APIs are down, no results will be returned


## Credits

- [Arctic Shift](https://github.com/ArthurHeitmann/arctic_shift) by ArthurHeitmann
- [PullPush](https://pullpush.io)
- Logo inspired by [searchcord.io](https://searchcord.io)

---

*For questions or feedback: zuxu4n@proton.me*
