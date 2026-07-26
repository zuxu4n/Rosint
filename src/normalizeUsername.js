// Strip anything users paste around a username: @, leading slashes, full
// reddit URLs, and u/ /u/ user/ prefixes. Returns the bare username.
//
// Shared by the app (isBlockedUser) and scripts/block.mjs (hash generation) so
// the two can never drift apart. If they did, a name added to the blocklist
// would hash differently than the one the app checks, and the block would
// silently fail while looking like it succeeded.
export function normalizeUsername(input) {
    let s = String(input || "").trim();
    // Full URL → keep only the path after the domain
    s = s.replace(/^https?:\/\/(www\.|old\.|new\.)?reddit\.com/i, "");
    // Leading slashes, then optional u/ /user/ prefix, then a leading @
    s = s.replace(/^\/+/, "").replace(/^(u|user)\//i, "").replace(/^@/, "");
    // Drop any trailing slash / query / whitespace
    s = s.replace(/[\/?#].*$/, "").trim();
    return s;
}
