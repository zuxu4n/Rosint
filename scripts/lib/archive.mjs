// Shared archive-fetch helpers for the removal-request review scripts.
//
// Hits the same two archives the site does (Arctic Shift + PullPush), merges
// and dedupes the results, and derives the summary stats used by lookup.mjs
// and triage.mjs.

import { normalizeUsername } from "../../src/normalizeUsername.js";

const ARCTIC = "https://arctic-shift.photon-reddit.com";
const PULLPUSH = "https://api.pullpush.io";
const LIMIT = 100;

async function safeFetch(url) {
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return { data: [], ok: false };
        const json = await res.json();
        return { data: json?.data ?? [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

// Merge both archives and drop duplicates, newest first.
function merge(a, b) {
    const seen = new Set();
    const out = [];
    for (const item of [...a, ...b]) {
        if (item?.id && !seen.has(item.id)) {
            seen.add(item.id);
            out.push(item);
        }
    }
    return out.sort((x, y) => (y.created_utc || 0) - (x.created_utc || 0));
}

// Same classification the site uses so the report matches what a visitor sees.
export function getStatus(item, type) {
    const text = type === "posts" ? item.selftext : item.body;
    return {
        removed: text === "[removed]" || (type === "posts" && !!item.removed_by_category),
        deleted: text === "[deleted]" || item.author === "[deleted]",
    };
}

export async function fetchHistory(rawUser) {
    const user = normalizeUsername(rawUser);
    if (!user) throw new Error("Empty username after normalization");

    const qs = `limit=${LIMIT}&sort=desc&author=${encodeURIComponent(user)}`;
    const [ap, pp, ac, pc] = await Promise.all([
        safeFetch(`${ARCTIC}/api/posts/search?${qs}`),
        safeFetch(`${PULLPUSH}/reddit/search/submission/?test&${qs}`),
        safeFetch(`${ARCTIC}/api/comments/search?${qs}`),
        safeFetch(`${PULLPUSH}/reddit/search/comment/?test&${qs}`),
    ]);

    const sources = [];
    if (ap.ok || ac.ok) sources.push("Arctic Shift");
    if (pp.ok || pc.ok) sources.push("PullPush");

    return {
        user,
        sources,
        posts: merge(ap.data, pp.data),
        comments: merge(ac.data, pc.data),
        arcticDown: !ap.ok && !ac.ok,
    };
}

export function summarize({ posts, comments }) {
    const subs = new Map();
    const bump = (name) => {
        if (!name) return;
        subs.set(name, (subs.get(name) || 0) + 1);
    };

    let removed = 0;
    let deleted = 0;
    let nsfwPosts = 0;
    let karma = 0;
    let earliest = Infinity;
    let latest = 0;

    const walk = (items, type) => {
        for (const it of items) {
            bump(it.subreddit);
            const st = getStatus(it, type);
            if (st.removed) removed++;
            if (st.deleted) deleted++;
            if (type === "posts" && it.over_18) nsfwPosts++;
            karma += Number(it.score) || 0;
            const t = Number(it.created_utc) || 0;
            if (t && t < earliest) earliest = t;
            if (t > latest) latest = t;
        }
    };
    walk(posts, "posts");
    walk(comments, "comments");

    return {
        postCount: posts.length,
        commentCount: comments.length,
        subreddits: [...subs.entries()].sort((a, b) => b[1] - a[1]),
        removed,
        deleted,
        nsfwPosts,
        // NSFW is a post-only flag on Reddit; comments carry no equivalent.
        nsfwRatio: posts.length ? nsfwPosts / posts.length : 0,
        karma,
        earliest: earliest === Infinity ? null : earliest,
        latest: latest || null,
    };
}

// Build the capped content sample sent to the model. Signal-dense items first
// (mod-removed, NSFW) so a truncated sample still surfaces the worst content,
// then most-recent to fill. Keeps token cost flat regardless of history size.
export function buildSample({ posts, comments }, { maxItems = 40, maxChars = 400 } = {}) {
    const items = [
        ...posts.map((p) => ({
            kind: "post",
            subreddit: p.subreddit,
            nsfw: !!p.over_18,
            status: getStatus(p, "posts"),
            created_utc: p.created_utc,
            permalink: p.permalink,
            text: [p.title, p.selftext].filter(Boolean).join(" — "),
        })),
        ...comments.map((c) => ({
            kind: "comment",
            subreddit: c.subreddit,
            nsfw: false,
            status: getStatus(c, "comments"),
            created_utc: c.created_utc,
            permalink: c.permalink,
            text: c.body || "",
        })),
    ].filter((i) => i.text && i.text !== "[removed]" && i.text !== "[deleted]");

    const weight = (i) => (i.status.removed ? 2 : 0) + (i.nsfw ? 1 : 0);
    items.sort((a, b) => weight(b) - weight(a) || (b.created_utc || 0) - (a.created_utc || 0));

    return items.slice(0, maxItems).map((i) => ({
        ...i,
        text: i.text.length > maxChars ? `${i.text.slice(0, maxChars)}…` : i.text,
    }));
}

export function fmtDate(utc) {
    return utc ? new Date(utc * 1000).toISOString().slice(0, 10) : "?";
}
