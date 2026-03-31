import { useState, useCallback, useEffect } from "react";

// ─── API Config ───────────────────────────────────────────────────────────────

const ARCTIC   = "https://arctic-shift.photon-reddit.com";
const PULLPUSH = "https://api.pullpush.io";
const REDDIT_BASE = "https://www.reddit.com";
const LIMIT = 100;

function buildUrls(username, type, pagination = {}, dateFilters = {}) {
    const base = [
        `limit=${LIMIT}`,
        `sort=desc`,
        `author=${encodeURIComponent(username)}`,
    ];

    if (pagination.before) {
        base.push(`before=${pagination.before}`);
    } else if (dateFilters.dateTo) {
        base.push(`before=${dateFilters.dateTo}`);
    }

    if (pagination.after) {
        base.push(`after=${pagination.after}`);
    } else if (dateFilters.dateFrom) {
        base.push(`after=${dateFilters.dateFrom}`);
    }

    const qs = base.join("&");

    return {
        arctic: type === "posts"
            ? `${ARCTIC}/api/posts/search?${qs}`
            : `${ARCTIC}/api/comments/search?${qs}`,
        pullpush: type === "posts"
            ? `${PULLPUSH}/reddit/search/submission/?test&${qs}`
            : `${PULLPUSH}/reddit/search/comment/?test&${qs}`,
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(utc) {
    const s = Math.floor(Date.now() / 1000 - utc);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 365) return `${d}d ago`;
    return `${Math.floor(d / 365)}y ago`;
}

function fmtNum(n) {
    if (n == null) return "0";
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
}

function getPostThumbnail(post) {
    try {
        if (post.preview?.images?.length) {
            const src = post.preview.images[0].source?.url;
            if (src) return src.replace(/&amp;/g, "&");
        }
    } catch (_) {}
    try {
        if (post.media_metadata) {
            const first = Object.values(post.media_metadata)[0];
            if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
        }
    } catch (_) {}
    const imageExts = ["jpg", "jpeg", "png", "gif"];
    if (post.url && imageExts.includes(post.url.split(".").pop()?.toLowerCase()))
        return post.url;
    return null;
}

function getCommentImage(comment) {
    try {
        if (comment.media_metadata) {
            const first = Object.values(comment.media_metadata)[0];
            if (first?.s?.u) return first.s.u.replace(/&amp;/g, "&");
        }
    } catch (_) {}
    return null;
}

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

async function fetchBoth(username, type, pagination = {}, dateFilters = {}) {
    const { arctic, pullpush } = buildUrls(username, type, pagination, dateFilters);
    const [arcticRes, pullpushRes] = await Promise.all([
        safeFetch(arctic),
        safeFetch(pullpush),
    ]);

    const seen = new Set();
    const merged = [];
    const sources = [];

    if (arcticRes.ok && arcticRes.data.length > 0) sources.push("Arctic Shift");
    if (pullpushRes.ok && pullpushRes.data.length > 0) sources.push("PullPush");

    [...arcticRes.data, ...pullpushRes.data].forEach((item) => {
        if (item.id && !seen.has(item.id)) {
            seen.add(item.id);
            merged.push(item);
        }
    });

    merged.sort((a, b) => b.created_utc - a.created_utc);
    return { items: merged, sources };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSearch = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
    </svg>
);

const IconArrowUp = () => (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 3l7 7H3l7-7z" />
    </svg>
);

const IconComment = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </svg>
);

const IconExternal = () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
);

const IconSpinner = () => (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);

const IconChevronLeft = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
);

const IconChevronRight = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
);

// ─── Anime Face SVG ───────────────────────────────────────────────────────────

const AnimeFace = () => (
    <svg className="anime-face-svg" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Face circle */}
        <circle cx="22" cy="22" r="19" fill="white" opacity="0.97"/>
        {/* Left eye */}
        <g className="face-eye-l">
            <ellipse cx="15" cy="20" rx="4" ry="4.5" fill="#1a1a2e"/>
            <ellipse cx="15" cy="20" rx="3" ry="3.5" fill="#3a3a6e"/>
            <circle cx="16.5" cy="18.2" r="1.2" fill="white"/>
            <circle cx="14"   cy="21.5" r="0.5" fill="white" opacity="0.6"/>
        </g>
        {/* Right eye */}
        <g className="face-eye-r">
            <ellipse cx="29" cy="20" rx="4" ry="4.5" fill="#1a1a2e"/>
            <ellipse cx="29" cy="20" rx="3" ry="3.5" fill="#3a3a6e"/>
            <circle cx="30.5" cy="18.2" r="1.2" fill="white"/>
            <circle cx="28"   cy="21.5" r="0.5" fill="white" opacity="0.6"/>
        </g>
        {/* Blush marks */}
        <ellipse className="face-blush" cx="10" cy="26" rx="4.5" ry="2.2" fill="#fe5301" opacity="0.45"/>
        <ellipse className="face-blush" cx="34" cy="26" rx="4.5" ry="2.2" fill="#fe5301" opacity="0.45"/>
        {/* Happy mouth */}
        <path d="M17 28 Q22 33 27 28" stroke="#1a1a2e" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
        {/* Highlight */}
        <ellipse cx="28" cy="12" rx="3" ry="1.5" fill="white" opacity="0.35" transform="rotate(-30 28 12)"/>
    </svg>
);

// ─── Post Card ────────────────────────────────────────────────────────────────

function PostCard({ post }) {
    const [bodyOpen, setBodyOpen] = useState(false);
    const thumb = getPostThumbnail(post);
    const postUrl = `${REDDIT_BASE}${post.permalink}`;
    const hasBody = post.selftext && post.selftext !== "[deleted]" && post.selftext !== "[removed]";

    return (
        <div className="bg-[#1a1a1b] border border-[#343536] rounded overflow-hidden hover:border-[#818384] transition-all duration-150 hover:shadow-lg group">
            <a href={postUrl} target="_blank" rel="noopener noreferrer" className="block">
                <div className="flex">
                    <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-3 bg-[#161617] min-w-[44px]">
                        <IconArrowUp />
                        <span className="text-[11px] font-bold text-[#d7dadc] leading-none">{fmtNum(post.score)}</span>
                    </div>
                    <div className="flex-1 p-3 min-w-0">
                        {/* Top row: text + thumbnail side by side */}
                        <div className="flex gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 text-[11px] text-[#818384] mb-1.5 flex-wrap">
                                    <span className="font-medium text-[#d7dadc]">{post.subreddit_name_prefixed}</span>
                                    <span>·</span>
                                    <span>{timeAgo(post.created_utc)}</span>
                                    {post.link_flair_text && (
                                        <>
                                            <span>·</span>
                                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#272729] text-[#d7dadc] border border-[#343536]">
                                                {post.link_flair_text}
                                            </span>
                                        </>
                                    )}
                                </div>
                                <p className="text-sm font-medium text-[#d7dadc] leading-snug mb-1.5 group-hover:text-white transition-colors line-clamp-2">
                                    {post.title}
                                </p>
                                {/* Comments + domain — only show show-body inline when no thumb */}
                                <div className={`flex items-center gap-3 text-[11px] text-[#818384] ${thumb ? "" : ""}`}>
                                    <span className="flex items-center gap-1">
                                        <IconComment />{fmtNum(post.num_comments)} comments
                                    </span>
                                    {post.domain && !post.is_self && (
                                        <span className="flex items-center gap-1 text-[#4fbdba] truncate max-w-[200px]">
                                            <IconExternal /><span className="truncate">{post.domain}</span>
                                        </span>
                                    )}
                                    {/* Show body inline only when there's no thumbnail */}
                                    {hasBody && !thumb && (
                                        <button
                                            onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                            className="flex items-center gap-1 ml-auto text-[#818384] hover:text-[#fe5301] transition-colors"
                                        >
                                            <svg className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                            {bodyOpen ? "hide body" : "show body"}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {thumb && (
                                <div className="flex-shrink-0 w-[70px] h-[52px] rounded overflow-hidden bg-[#272729]">
                                    <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy"
                                         onError={(e) => { e.target.style.display = "none"; }} />
                                </div>
                            )}
                        </div>
                        {/* Show body button below thumbnail row when thumb exists */}
                        {hasBody && thumb && (
                            <div className="flex items-center mt-2 text-[11px] text-[#818384]">
                                <button
                                    onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                    className="flex items-center gap-1 ml-auto hover:text-[#fe5301] transition-colors"
                                >
                                    <svg className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    {bodyOpen ? "hide body" : "show body"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </a>

            {/* Expanded body */}
            {hasBody && bodyOpen && (
                <div className="border-t border-[#272729] px-4 pt-3 pb-3 ml-[44px]">
                    <p className="text-[12px] text-[#d7dadc] leading-relaxed whitespace-pre-wrap">
                        {post.selftext}
                    </p>
                </div>
            )}
        </div>
    );
}

// ─── Comment Card ─────────────────────────────────────────────────────────────

function CommentCard({ comment }) {
    const threadId = comment.link_id?.split("_").pop();
    const url = `${REDDIT_BASE}${comment.permalink}`;
    const threadUrl = threadId ? `${REDDIT_BASE}/comments/${threadId}` : url;
    const img = getCommentImage(comment);
    return (
        <a href={url} target="_blank" rel="noopener noreferrer"
           className="group block bg-[#1a1a1b] border border-[#343536] rounded overflow-hidden hover:border-[#818384] transition-all duration-150 hover:shadow-lg">
            <div className="flex">
                <div className="flex flex-col items-center justify-start gap-1 px-2.5 py-3 bg-[#161617] min-w-[44px]">
                    <IconArrowUp />
                    <span className="text-[11px] font-bold text-[#d7dadc] leading-none">{fmtNum(comment.score)}</span>
                </div>
                <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-[#818384] mb-1.5 flex-wrap">
                        <span className="font-medium text-[#d7dadc]">{comment.subreddit_name_prefixed}</span>
                        <span>·</span>
                        <span>{timeAgo(comment.created_utc)}</span>
                        <span>·</span>
                        <a href={threadUrl} target="_blank" rel="noopener noreferrer"
                           onClick={(e) => e.stopPropagation()}
                           className="text-[#4fbdba] hover:underline flex items-center gap-0.5">
                            view thread <IconExternal />
                        </a>
                    </div>
                    <p className="text-sm text-[#d7dadc] leading-relaxed line-clamp-4 group-hover:text-white transition-colors">
                        {comment.body || "(no content)"}
                    </p>
                    {img && (
                        <div className="mt-2 w-24 h-16 rounded overflow-hidden bg-[#272729]">
                            <img src={img} alt="" className="w-full h-full object-cover" loading="lazy"
                                 onError={(e) => { e.target.style.display = "none"; }} />
                        </div>
                    )}
                </div>
            </div>
        </a>
    );
}

// ─── Empty / Error ────────────────────────────────────────────────────────────

function EmptyState({ tab }) {
    return (
        <div className="text-center py-16 text-[#818384]">
            <p className="text-sm">No {tab} found for this user.</p>
        </div>
    );
}

function ErrorState({ message }) {
    return (
        <div className="text-center py-16">
            <p className="text-sm text-red-400">{message}</p>
        </div>
    );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabBtn({ label, count, countIsPlus, active, onClick }) {
    return (
        <button onClick={onClick}
                className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${active ? "text-white" : "text-[#818384] hover:text-[#d7dadc]"}`}>
            {label}
            {count > 0 && (
                <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full ${active ? "bg-[#ff4500] text-white" : "bg-[#272729] text-[#818384]"}`}>
          {countIsPlus ? `${count}+` : count}
        </span>
            )}
            {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff4500] rounded-t" />}
        </button>
    );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, hasPrev, hasNext, onPrev, onNext, loading }) {
    if (!hasPrev && !hasNext) return null;
    return (
        <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={onPrev} disabled={!hasPrev || loading}
                    className="flex items-center justify-center w-10 h-10 rounded border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronLeft />
            </button>
            <span className="text-[12px] text-[#818384] min-w-[60px] text-center">
        {loading ? <span className="flex justify-center"><IconSpinner /></span> : `Page ${page}`}
      </span>
            <button onClick={onNext} disabled={!hasNext || loading}
                    className="flex items-center justify-center w-10 h-10 rounded border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronRight />
            </button>
        </div>
    );
}

// ─── usePaginatedFetch ────────────────────────────────────────────────────────

function usePaginatedFetch(type) {
    const [items, setItems]         = useState([]);
    const [sources, setSources]     = useState([]);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState(null);
    const [page, setPage]           = useState(1);
    const [pageStack, setPageStack] = useState([]);
    const [storedFilters, setStoredFilters] = useState({});

    const _fetch = useCallback(async (username, pagination, filters) => {
        setLoading(true);
        setError(null);
        try {
            const { items: data, sources: srcs } = await fetchBoth(username, type, pagination, filters);
            setItems(data);
            setSources(srcs);
            return data;
        } catch (err) {
            setError(err.message);
            setItems([]);
            return [];
        } finally {
            setLoading(false);
        }
    }, [type]);

    const reset = useCallback(async (username, filters = {}) => {
        setPage(1);
        setPageStack([]);
        setStoredFilters(filters);
        const data = await _fetch(username, {}, filters);
        if (data.length > 0) {
            setPageStack([{ firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc }]);
        }
        return data;
    }, [_fetch]);

    const goNext = useCallback(async (username) => {
        const current = pageStack[pageStack.length - 1];
        if (!current) return;
        const data = await _fetch(username, { before: current.lastUtc }, storedFilters);
        if (data.length > 0) {
            setPageStack((prev) => [...prev, { firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc }]);
            setPage((p) => p + 1);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [_fetch, pageStack, storedFilters]);

    const goPrev = useCallback(async (username) => {
        if (pageStack.length <= 1) return;
        const newStack = pageStack.slice(0, -1);
        const prevEntry = newStack[newStack.length - 2];
        const data = await _fetch(username, prevEntry ? { after: prevEntry.firstUtc } : {}, storedFilters);
        if (data.length > 0) {
            newStack[newStack.length - 1] = { firstUtc: data[0].created_utc, lastUtc: data[data.length - 1].created_utc };
        }
        setPageStack(newStack);
        setPage((p) => p - 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [_fetch, pageStack, storedFilters]);

    return { items, sources, loading, error, page, reset, goNext, goPrev };
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const TABS = ["posts", "comments"];

export default function App() {
    const [username, setUsername]           = useState("");
    const [query, setQuery]                 = useState("");
    const [activeTab, setActiveTab]         = useState("posts");
    const [searched, setSearched]           = useState(false);
    const [initialLoading, setInitialLoading] = useState(false);
    const [dateFrom, setDateFrom]           = useState("");
    const [dateTo, setDateTo]               = useState("");

    const posts    = usePaginatedFetch("posts");
    const comments = usePaginatedFetch("comments");

    const buildFilters = useCallback(() => {
        const f = {};
        if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
        if (dateTo)   f.dateTo   = Math.floor(new Date(dateTo).getTime()   / 1000);
        return f;
    }, [dateFrom, dateTo]);

    // On mount, check if a ?u= param is in the URL and auto-search it
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const u = params.get("u")?.trim();
        if (!u) return;
        setUsername(u);
        setQuery(u);
        setSearched(true);
        setInitialLoading(true);
        Promise.all([posts.reset(u, {}), comments.reset(u, {})]).then(() => {
            setInitialLoading(false);
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        const user = username.trim();
        if (!user) return;
        // Write username to URL so the link is shareable
        const url = new URL(window.location.href);
        url.searchParams.set("u", user);
        window.history.pushState({}, "", url);
        setQuery(user);
        setSearched(true);
        setInitialLoading(true);
        const filters = buildFilters();
        await Promise.all([posts.reset(user, filters), comments.reset(user, filters)]);
        setInitialLoading(false);
    }, [username, buildFilters, posts, comments]);

    const applyFilters = useCallback(async () => {
        if (!query) return;
        setInitialLoading(true);
        const filters = buildFilters();
        await Promise.all([posts.reset(query, filters), comments.reset(query, filters)]);
        setInitialLoading(false);
    }, [query, buildFilters, posts, comments]);

    const clearFilters = useCallback(async () => {
        setDateFrom("");
        setDateTo("");
        if (!query) return;
        setInitialLoading(true);
        await Promise.all([posts.reset(query, {}), comments.reset(query, {})]);
        setInitialLoading(false);
    }, [query, posts, comments]);

    const active = activeTab === "posts" ? posts : comments;
    const allSources = [...new Set([...posts.sources, ...comments.sources])];

    return (
        <div className="min-h-screen bg-[#0d0d0d] text-[#d7dadc]" style={{ fontFamily: "'Sora', sans-serif" }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');

                @keyframes face-in {
                    0%   { transform: translate(-50%, -50%) scale(0.1); opacity: 0; }
                    20%  { opacity: 1; }
                    65%  { transform: translate(-50%, -50%) scale(1.15); }
                    80%  { transform: translate(-50%, -50%) scale(0.94); }
                    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                }

                @keyframes face-bob {
                    0%,100% { transform: translate(-50%, -52%); }
                    50%     { transform: translate(-50%, -48%); }
                }

                @keyframes blush-pulse {
                    0%,100% { opacity: 0.55; }
                    50%     { opacity: 0.85; }
                }

                @keyframes eye-blink {
                    0%,90%,100% { transform: scaleY(1); }
                    95%         { transform: scaleY(0.08); }
                }

                .anime-face-svg {
                    width: 36px;
                    height: 36px;
                    display: block;
                    opacity: 0;
                    transform: translate(-50%, -50%) scale(0.1);
                    pointer-events: none;
                    position: absolute;
                    left: 20px;
                    top: 50%;
                    z-index: 10;
                    overflow: visible;
                }

                .logo-btn:hover .anime-face-svg {
                    animation:
                        face-in 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                        face-bob 2.2s ease-in-out 0.55s infinite;
                }

                .logo-btn:hover .face-blush {
                    animation: blush-pulse 2s ease-in-out 0.55s infinite;
                }

                .logo-btn:hover .face-eye-l,
                .logo-btn:hover .face-eye-r {
                    transform-origin: center;
                    animation: eye-blink 3.5s ease-in-out 1s infinite;
                }
            `}</style>

            {/* Header */}
            <header className="border-b border-[#1c1c1d] bg-[#0d0d0d] sticky top-0 z-20">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
                    <button
                        onClick={() => { setSearched(false); setUsername(""); setQuery(""); setDateFrom(""); setDateTo(""); window.history.pushState({}, "", "/"); }}
                        className="logo-btn group flex items-center gap-2 relative"
                    >
                        <img src="/bot.png" alt="logo" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        <span className="text-[22px] font-semibold tracking-tight text-white whitespace-nowrap max-w-0 overflow-hidden opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-700 ease-out">
                            reddit<span className="text-[#fe5301]">OSINT</span>
                        </span>
                        <span className="text-[11px] text-[#818384] border border-[#343536] rounded px-1.5 py-0.5 flex-shrink-0">beta</span>
                        <AnimeFace />
                    </button>
                    <div className="flex-1 flex justify-end items-center gap-4">
                        <a href="/changelog.html" target="_blank" rel="noopener noreferrer"
                           title="Docs"
                           className="text-[11px] text-[#818384] hover:text-[#d7dadc] border border-[#343536] hover:border-[#818384] rounded px-2.5 py-1 transition-colors">
                            Docs
                        </a>
                        <a href="https://github.com/zuxu4n/RedditOsint" target="_blank" rel="noopener noreferrer"
                           title="GitHub" className="text-[#818384] hover:text-white transition-colors">
                            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                            </svg>
                        </a>
                    </div>
                </div>
            </header>

            {/* Hero / Search */}
            <div className={`max-w-3xl mx-auto px-4 transition-all duration-300 ${searched ? "pt-6" : "pt-20"}`}>
                {!searched && (
                    <div className="text-center mb-2">
                        <img src="/rosintTitle.png" alt="redditOSINT" className="mx-auto mb-4" style={{ width: "578px", maxWidth: "90vw" }} />
                        <p className="text-sm text-[#cccccc]">View private accounts and deleted posts/comments from any user via distributed open-source archives.</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#cccccc] text-base font-medium select-none">u/</span>
                        <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                               placeholder="username"
                               className="w-full bg-[#1a1a1b] border border-[#343536] rounded pl-10 pr-4 py-2.5 text-sm text-white placeholder-[#818384] focus:outline-none focus:border-[#ff4500] transition-colors"
                               autoFocus />
                    </div>
                    <button type="submit" disabled={!username.trim() || initialLoading}
                            className="flex items-center gap-2 bg-[#ff4500] hover:bg-[#e03d00] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-5 py-2.5 rounded transition-colors">
                        {initialLoading ? <IconSpinner /> : <IconSearch />}
                        {initialLoading && "Searching…"}
                    </button>
                </form>

                {!searched && (
                    <div className="flex items-center gap-2 flex-wrap mt-3">
                        <span className="text-[11px] text-[#818384]">From</span>
                        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                               className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                        <span className="text-[11px] text-[#818384]">To</span>
                        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                               className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                        {(dateFrom || dateTo) && (
                            <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); }}
                                    className="px-3 py-1 text-[12px] text-[#818384] hover:text-[#d7dadc] transition-colors">
                                Clear
                            </button>
                        )}
                    </div>
                )}

                {/* SEO content — visible but subtle, fully crawlable */}
                {!searched && (
                    <div className="mt-16 pb-16 border-t border-[#1c1c1d] pt-10">
                        <div className="grid grid-cols-1 gap-8 text-[#5a5a5b] text-[12px] leading-relaxed sm:grid-cols-3">
                            <div>
                                <h2 className="text-[#818384] font-medium mb-2 text-[13px]">View deleted Reddit posts</h2>
                                <p>redditOSINT lets you recover deleted Reddit posts and removed comments from any user. Content is sourced from distributed open-source archives that capture Reddit data before it disappears.</p>
                            </div>
                            <div>
                                <h2 className="text-[#818384] font-medium mb-2 text-[13px]">Search private accounts</h2>
                                <p>Browse the post and comment history of private or suspended Reddit accounts. As long as the content was archived, it remains searchable even after the account is made private or banned.</p>
                            </div>
                            <div>
                                <h2 className="text-[#818384] font-medium mb-2 text-[13px]">Powered by open archives</h2>
                                <p>Results are fetched in parallel from Arctic Shift and PullPush, two independent Reddit archives. Combining both sources gives the most complete picture of a user's Reddit history.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Results */}
            {searched && (
                <div className="max-w-3xl mx-auto px-4 mt-6 pb-16">

                    {/* Summary + date filters */}
                    {!initialLoading && (
                        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                            <p className="text-[12px] text-[#818384]">
                                Results for <span className="text-[#ff4500] font-medium">u/{query}</span>
                                {allSources.length > 0 && (
                                    <> · {allSources.map((src, i) => {
                                        const url = src === "Arctic Shift"
                                            ? "https://github.com/ArthurHeitmann/arctic_shift"
                                            : "https://pullpush.io/";
                                        return (
                                            <span key={src}>
                                                {i > 0 && <span className="text-[#818384]"> + </span>}
                                                <a href={url} target="_blank" rel="noopener noreferrer"
                                                   className="text-[#d7dadc] hover:text-white hover:underline transition-colors">
                                                    {src}
                                                </a>
                                            </span>
                                        );
                                    })}</>
                                )}
                            </p>
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-[#818384]">From</span>
                                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                       className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                                <span className="text-[11px] text-[#818384]">To</span>
                                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                       className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                                <button onClick={applyFilters} disabled={initialLoading}
                                        className="px-3 py-1 text-[12px] font-medium bg-[#ff4500] hover:bg-[#e03d00] disabled:opacity-50 text-white rounded-sm transition-colors">
                                    Apply
                                </button>
                                {(dateFrom || dateTo) && (
                                    <button onClick={clearFilters} disabled={initialLoading}
                                            className="px-3 py-1 text-[12px] text-[#818384] hover:text-[#d7dadc] transition-colors">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Tabs + inline pagination */}
                    <div className="flex items-center border-b border-[#1c1c1d] mb-4">
                        <div className="flex flex-1">
                            {TABS.map((tab) => (
                                <TabBtn key={tab}
                                        label={tab.charAt(0).toUpperCase() + tab.slice(1)}
                                        count={tab === "posts" ? posts.items.length : comments.items.length}
                                        countIsPlus={tab === "posts" ? posts.items.length >= LIMIT : comments.items.length >= LIMIT}
                                        active={activeTab === tab}
                                        onClick={() => setActiveTab(tab)} />
                            ))}
                        </div>
                        {!initialLoading && !active.loading && active.items.length > 0 && (active.page > 1 || active.items.length >= LIMIT) && (
                            <div className="flex items-center gap-2 pb-2">
                                <button onClick={() => active.goPrev(query)} disabled={active.page <= 1 || active.loading}
                                        className="flex items-center justify-center w-7 h-7 rounded-sm border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                    <IconChevronLeft />
                                </button>
                                <span className="text-[11px] text-[#818384]">
                                    {active.loading ? <IconSpinner /> : `Page ${active.page}`}
                                </span>
                                <button onClick={() => active.goNext(query)} disabled={active.items.length < LIMIT || active.loading}
                                        className="flex items-center justify-center w-7 h-7 rounded-sm border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                    <IconChevronRight />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Archive notice */}
                    {!initialLoading && (
                        <div className="text-[11px] text-[#818384] mb-3 leading-relaxed">
                            Archive coverage may vary.{" "}
                            <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22&type=${activeTab}`}
                               target="_blank" rel="noopener noreferrer" className="text-[#ff4500] hover:underline">
                                Click here
                            </a>{" "}
                            to search Reddit directly for the most recent activity.
                            <br />
                            <span className="text-[#5a5a5b]">Note: Doing so will not show deleted posts or comments.</span>
                        </div>
                    )}

                    {/* Tab content */}
                    {initialLoading || active.loading ? (
                        <div className="flex items-center justify-center py-20 gap-3 text-[#818384]">
                            <IconSpinner />
                            <span className="text-sm">Fetching from Arctic Shift + PullPush…</span>
                        </div>
                    ) : active.error ? (
                        <ErrorState message={active.error} />
                    ) : active.items.length === 0 ? (
                        <EmptyState tab={activeTab} />
                    ) : (
                        <>
                            <div className="flex flex-col gap-2">
                                {activeTab === "posts" && posts.items.map((post) => (
                                    <PostCard key={post.id} post={post} />
                                ))}
                                {activeTab === "comments" && comments.items.map((comment) => (
                                    <CommentCard key={comment.id} comment={comment} />
                                ))}
                            </div>
                            <Pagination
                                page={active.page}
                                hasPrev={active.page > 1}
                                hasNext={active.items.length >= LIMIT}
                                onPrev={() => active.goPrev(query)}
                                onNext={() => active.goNext(query)}
                                loading={active.loading}
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}