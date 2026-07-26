#!/usr/bin/env node
// Tier 1 review: prints a factual summary of a requester's archived history so
// you can eyeball a removal request in a few seconds. No API key, no cost.
//
// Usage:
//   node scripts/lookup.mjs <username>
//
// Examples:
//   node scripts/lookup.mjs nullpounce
//   node scripts/lookup.mjs u/nullpounce

import { fetchHistory, summarize, fmtDate } from "./lib/archive.mjs";

const raw = process.argv[2];
if (!raw) {
    console.error("Usage: node scripts/lookup.mjs <username>");
    process.exit(1);
}

const bar = (n, max, width = 20) =>
    "█".repeat(Math.max(1, Math.round((n / max) * width)));

const pct = (x) => `${Math.round(x * 100)}%`;

const h = await fetchHistory(raw);
const s = summarize(h);

console.log(`\nu/${h.user}`);
console.log(`  sources:  ${h.sources.join(" + ") || "none responded"}`);

if (s.postCount === 0 && s.commentCount === 0) {
    console.log("\n  No archived posts or comments found.");
    console.log("  Nothing to review — the archives have no history for this name.\n");
    process.exit(0);
}

console.log(`  activity: ${s.postCount} posts, ${s.commentCount} comments` +
            `${s.postCount >= 100 || s.commentCount >= 100 ? " (capped at 100 each)" : ""}`);
console.log(`  span:     ${fmtDate(s.earliest)} to ${fmtDate(s.latest)}`);
console.log(`  karma:    ${s.karma.toLocaleString()} across sampled items`);

console.log(`\n  top subreddits`);
const max = s.subreddits[0]?.[1] || 1;
for (const [name, count] of s.subreddits.slice(0, 15)) {
    console.log(`    r/${name.padEnd(24)} ${String(count).padStart(4)}  ${bar(count, max)}`);
}
if (s.subreddits.length > 15) {
    console.log(`    …and ${s.subreddits.length - 15} more`);
}

console.log(`\n  flags`);
console.log(`    NSFW posts:        ${s.nsfwPosts}/${s.postCount} (${pct(s.nsfwRatio)})`);
console.log(`    removed by mods:   ${s.removed}`);
console.log(`    deleted by author: ${s.deleted}`);

if (h.arcticDown) {
    console.log(`\n  note: Arctic Shift did not respond — this is PullPush data only.`);
}

console.log(`\n  If the subreddit mix isn't decisive, run:`);
console.log(`    node scripts/triage.mjs ${h.user}\n`);
