import { useState, useCallback, useEffect, useMemo } from "react";

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

    if (dateFilters.subreddit) {
        base.push(`subreddit=${encodeURIComponent(dateFilters.subreddit)}`);
    }

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

async function fetchTimeSeries(key, { precision = "hour", hours = 24 } = {}) {
    const before = Date.now();
    const after = before - hours * 60 * 60 * 1000;

    const url =
        `${ARCTIC}/api/time_series` +
        `?key=${encodeURIComponent(key)}` +
        `&precision=${encodeURIComponent(precision)}` +
        `&after=${after}` +
        `&before=${before}`;

    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return [];
        const json = await res.json();
        return (json?.data ?? []).map((p) => ({
            date: new Date(p.date * 1000),
            value: p.value,
        }));
    } catch {
        return [];
    }
}

function formatChartTick(date, precision, spanHours = 24) {
    if (spanHours >= 24 * 3) {
        return date.toLocaleDateString([], { weekday: "short" });
    }
    if (precision === "minute" || precision === "hour") {
        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function buildLinePath(points, width, height, padding) {
    if (!points.length) return "";

    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const minX = points[0].date.getTime();
    const maxX = points[points.length - 1].date.getTime();
    const maxY = Math.max(...points.map((p) => p.value), 1);

    return points.map((p, i) => {
        const x =
            padding.left +
            ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) * innerWidth;
        const y =
            height -
            padding.bottom -
            (p.value / maxY) * innerHeight;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    }).join(" ");
}

function mergeSeries(leftSeries, rightSeries, leftKey = "left", rightKey = "right") {
    const byTs = new Map();

    for (const point of leftSeries) {
        const ts = point.date.getTime();
        byTs.set(ts, { date: point.date, [leftKey]: point.value, [rightKey]: 0 });
    }

    for (const point of rightSeries) {
        const ts = point.date.getTime();
        const existing = byTs.get(ts);
        if (existing) {
            existing[rightKey] = point.value;
        } else {
            byTs.set(ts, { date: point.date, [leftKey]: 0, [rightKey]: point.value });
        }
    }

    return Array.from(byTs.values()).sort((a, b) => a.date - b.date);
}

function ratioSeries(numeratorSeries, denominatorSeries) {
    const denominatorMap = new Map(
        denominatorSeries.map((point) => [point.date.getTime(), point.value])
    );

    return numeratorSeries
        .map((point) => {
            const denominator = denominatorMap.get(point.date.getTime());
            if (!denominator) return null;
            return { date: point.date, value: point.value / denominator };
        })
        .filter(Boolean);
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
        <circle cx="22" cy="22" r="19" fill="white" opacity="0.97"/>
        <g className="face-eye-l">
            <ellipse cx="15" cy="20" rx="4" ry="4.5" fill="#1a1a2e"/>
            <ellipse cx="15" cy="20" rx="3" ry="3.5" fill="#3a3a6e"/>
            <circle cx="16.5" cy="18.2" r="1.2" fill="white"/>
            <circle cx="14" cy="21.5" r="0.5" fill="white" opacity="0.6"/>
        </g>
        <g className="face-eye-r">
            <ellipse cx="29" cy="20" rx="4" ry="4.5" fill="#1a1a2e"/>
            <ellipse cx="29" cy="20" rx="3" ry="3.5" fill="#3a3a6e"/>
            <circle cx="30.5" cy="18.2" r="1.2" fill="white"/>
            <circle cx="28" cy="21.5" r="0.5" fill="white" opacity="0.6"/>
        </g>
        <ellipse className="face-blush" cx="10" cy="26" rx="4.5" ry="2.2" fill="#fe5301" opacity="0.45"/>
        <ellipse className="face-blush" cx="34" cy="26" rx="4.5" ry="2.2" fill="#fe5301" opacity="0.45"/>
        <path d="M17 28 Q22 33 27 28" stroke="#1a1a2e" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
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
                                <div className="flex items-center gap-3 text-[11px] text-[#818384]">
                                    <span className="flex items-center gap-1">
                                        <IconComment />{fmtNum(post.num_comments)} comments
                                    </span>
                                    {post.domain && !post.is_self && (
                                        <span className="flex items-center gap-1 text-[#4fbdba] truncate max-w-[200px]">
                                            <IconExternal /><span className="truncate">{post.domain}</span>
                                        </span>
                                    )}
                                    {hasBody && !thumb && (
                                        <button
                                            aria-label={bodyOpen ? "Hide post body" : "Show post body"}
                                            onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                            className="flex items-center gap-1 ml-auto text-[#818384] hover:text-[#fe5301] transition-colors"
                                        >
                                            <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                            {bodyOpen ? "hide body" : "show body"}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {thumb && (
                                <div className="flex-shrink-0 w-[70px] h-[52px] rounded overflow-hidden bg-[#272729]">
                                    <img src={thumb} alt="" width="70" height="52" className="w-full h-full object-cover" loading="lazy"
                                         onError={(e) => { e.target.style.display = "none"; }} />
                                </div>
                            )}
                        </div>
                        {hasBody && thumb && (
                            <div className="flex items-center mt-2 text-[11px] text-[#818384]">
                                <button
                                    aria-label={bodyOpen ? "Hide post body" : "Show post body"}
                                    onClick={(e) => { e.preventDefault(); setBodyOpen(o => !o); }}
                                    className="flex items-center gap-1 ml-auto hover:text-[#fe5301] transition-colors"
                                >
                                    <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${bodyOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    {bodyOpen ? "hide body" : "show body"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </a>

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
                            <img src={img} alt="" width="96" height="64" className="w-full h-full object-cover" loading="lazy"
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
    return (
        <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={onPrev} disabled={!hasPrev || loading} aria-label="Previous page"
                    className="flex items-center justify-center w-10 h-10 rounded border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronLeft />
            </button>
            <span className="text-[12px] text-[#818384] min-w-[60px] text-center">
                {loading ? <span className="flex justify-center"><IconSpinner /></span> : `Page ${page}`}
            </span>
            <button onClick={onNext} disabled={!hasNext || loading} aria-label="Next page"
                    className="flex items-center justify-center w-10 h-10 rounded border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <IconChevronRight />
            </button>
        </div>
    );
}

// ─── Global Chart ─────────────────────────────────────────────────────────────

function TotalActivityChart() {
    const [postsSeries, setPostsSeries] = useState([]);
    const [commentsSeries, setCommentsSeries] = useState([]);
    const [loading, setLoading] = useState(true);

    const precision = "hour";
    const hours = 24 * 7;

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            const [posts, comments] = await Promise.all([
                fetchTimeSeries("global/posts/count", { precision, hours }),
                fetchTimeSeries("global/comments/count", { precision, hours }),
            ]);

            if (!cancelled) {
                setPostsSeries(posts);
                setCommentsSeries(comments);
                setLoading(false);
            }
        }

        load();
        const id = setInterval(load, 60 * 1000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, []);

    const width = 900;
    const height = 391;
    const padding = { top: 12, right: 42, bottom: 42, left: 72 };

    const merged = useMemo(() => {
        const byTs = new Map();

        for (const p of postsSeries) {
            const ts = p.date.getTime();
            byTs.set(ts, { date: p.date, posts: p.value, comments: 0 });
        }

        for (const c of commentsSeries) {
            const ts = c.date.getTime();
            const existing = byTs.get(ts);
            if (existing) {
                existing.comments = c.value;
            } else {
                byTs.set(ts, { date: c.date, posts: 0, comments: c.value });
            }
        }

        return Array.from(byTs.values()).sort((a, b) => a.date - b.date);
    }, [postsSeries, commentsSeries]);

    const maxY = Math.max(
        1,
        ...merged.map((p) => Math.max(p.posts ?? 0, p.comments ?? 0))
    );

    const yTicks = 3;
    const xTicks = merged.filter((_, i) => {
        if (merged.length <= 4) return true;
        const step = Math.max(1, Math.floor(merged.length / 4));
        return i % step === 0 || i === merged.length - 1;
    });

    const postsPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.posts })),
        width,
        height,
        padding
    );

    const commentsPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.comments })),
        width,
        height,
        padding
    );

    return (
        <div className="bg-[#1a1a1b] border border-[#343536] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-[#272729]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-semibold text-white">Total Reddit posts and comments</h2>
                        <p className="text-[11px] text-[#818384] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            Global Reddit activity over the past week.
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-[12px]">
                        <div className="flex items-center gap-2 text-[#d7dadc]">
                            <span className="w-3 h-3 rounded-full bg-[#fe5301] inline-block"></span>
                            Posts
                        </div>
                        <div className="flex items-center gap-2 text-[#d7dadc]">
                            <span className="w-3 h-3 rounded-full bg-[#4fbdba] inline-block"></span>
                            Comments
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3">
                {loading ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-[#818384]">
                        <IconSpinner />
                        <span className="text-sm">Loading chart…</span>
                    </div>
                ) : merged.length === 0 ? (
                    <div className="text-center py-16 text-[#818384] text-sm">
                        No chart data available right now.
                    </div>
                ) : (
                    <div className="w-full overflow-hidden">
                        <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="w-full h-auto"
                            role="img"
                            aria-label="Line chart of total Reddit posts and comments"
                        >
                            {Array.from({ length: yTicks + 1 }).map((_, i) => {
                                const value = (maxY / yTicks) * i;
                                const y =
                                    height -
                                    padding.bottom -
                                    (value / maxY) * (height - padding.top - padding.bottom);

                                return (
                                    <g key={i}>
                                        <line
                                            x1={padding.left}
                                            x2={width - padding.right}
                                            y1={y}
                                            y2={y}
                                            stroke="#2a2a2b"
                                            strokeWidth="1"
                                        />
                                        <text
                                            x={padding.left - 12}
                                            y={y + 4}
                                            textAnchor="end"
                                            fontSize="23"
                                            fill="#818384"
                                        >
                                            {fmtNum(Math.round(value))}
                                        </text>
                                    </g>
                                );
                            })}

                            {xTicks.map((p, i) => {
                                const minX = merged[0].date.getTime();
                                const maxX = merged[merged.length - 1].date.getTime();
                                const x =
                                    padding.left +
                                    ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) *
                                    (width - padding.left - padding.right);

                                return (
                                    <g key={i}>
                                        <line
                                            x1={x}
                                            x2={x}
                                            y1={padding.top}
                                            y2={height - padding.bottom}
                                            stroke="#202021"
                                            strokeWidth="1"
                                        />
                                        <text
                                            x={x}
                                            y={height - 12}
                                            textAnchor="middle"
                                            fontSize="23"
                                            fill="#818384"
                                        >
                                            {formatChartTick(p.date, precision, hours)}
                                        </text>
                                    </g>
                                );
                            })}

                            <path
                                d={postsPath}
                                fill="none"
                                stroke="#fe5301"
                                strokeWidth="3"
                                strokeLinecap="square"
                                strokeLinejoin="bevel"
                            />
                            <path
                                d={commentsPath}
                                fill="none"
                                stroke="#4fbdba"
                                strokeWidth="3"
                                strokeLinecap="square"
                                strokeLinejoin="bevel"
                            />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── usePaginatedFetch ────────────────────────────────────────────────────────

function SecondaryGlobalChart({
                                  title,
                                  subtitle,
                                  ariaLabel,
                                  leftLabel,
                                  rightLabel,
                                  leftKey,
                                  rightKey,
                                  numberFormatter,
                              }) {
    const [leftSeries, setLeftSeries] = useState([]);
    const [rightSeries, setRightSeries] = useState([]);
    const [loading, setLoading] = useState(true);
    const precision = "hour";
    const hours = 24 * 7;
    const width = 900;
    const height = 391;
    const padding = { top: 12, right: 42, bottom: 42, left: 72 };

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            const [leftBase, rightBase, leftCount, rightCount] = await Promise.all([
                fetchTimeSeries(leftKey, { precision, hours }),
                fetchTimeSeries(rightKey, { precision, hours }),
                fetchTimeSeries("global/posts/count", { precision, hours }),
                fetchTimeSeries("global/comments/count", { precision, hours }),
            ]);

            if (cancelled) return;

            setLeftSeries(ratioSeries(leftBase, leftCount));
            setRightSeries(ratioSeries(rightBase, rightCount));
            setLoading(false);
        }

        load();
        const id = setInterval(load, 60 * 1000);

        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [hours, leftKey, precision, rightKey]);

    const merged = useMemo(
        () => mergeSeries(leftSeries, rightSeries, "left", "right"),
        [leftSeries, rightSeries]
    );

    const maxY = Math.max(1, ...merged.map((p) => Math.max(p.left ?? 0, p.right ?? 0)));
    const yTicks = 3;
    const xTicks = merged.filter((_, i) => {
        if (merged.length <= 4) return true;
        const step = Math.max(1, Math.floor(merged.length / 4));
        return i % step === 0 || i === merged.length - 1;
    });

    const leftPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.left })),
        width,
        height,
        padding
    );
    const rightPath = buildLinePath(
        merged.map((p) => ({ date: p.date, value: p.right })),
        width,
        height,
        padding
    );

    return (
        <div className="bg-[#1a1a1b] border border-[#343536] rounded-lg overflow-hidden">
            <div className="px-4 py-2 border-b border-[#272729]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-semibold text-white">{title}</h2>
                        <p className="text-[11px] text-[#818384] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-4 text-[12px]">
                        <div className="flex items-center gap-2 text-[#d7dadc]">
                            <span className="w-3 h-3 rounded-full bg-[#fe5301] inline-block"></span>
                            {leftLabel}
                        </div>
                        <div className="flex items-center gap-2 text-[#d7dadc]">
                            <span className="w-3 h-3 rounded-full bg-[#4fbdba] inline-block"></span>
                            {rightLabel}
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-3">
                {loading ? (
                    <div className="flex items-center justify-center py-16 gap-3 text-[#818384]">
                        <IconSpinner />
                        <span className="text-sm">Loading chart...</span>
                    </div>
                ) : merged.length === 0 ? (
                    <div className="text-center py-16 text-[#818384] text-sm">
                        No chart data available right now.
                    </div>
                ) : (
                    <div className="w-full overflow-hidden">
                        <svg
                            viewBox={`0 0 ${width} ${height}`}
                            className="w-full h-auto"
                            role="img"
                            aria-label={ariaLabel}
                        >
                            {Array.from({ length: yTicks + 1 }).map((_, i) => {
                                const value = (maxY / yTicks) * i;
                                const y =
                                    height -
                                    padding.bottom -
                                    (value / maxY) * (height - padding.top - padding.bottom);

                                return (
                                    <g key={i}>
                                        <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#2a2a2b" strokeWidth="1" />
                                        <text x={padding.left - 12} y={y + 4} textAnchor="end" fontSize="23" fill="#818384">
                                            {numberFormatter(value)}
                                        </text>
                                    </g>
                                );
                            })}

                            {xTicks.map((p, i) => {
                                const minX = merged[0].date.getTime();
                                const maxX = merged[merged.length - 1].date.getTime();
                                const x =
                                    padding.left +
                                    ((p.date.getTime() - minX) / Math.max(maxX - minX, 1)) *
                                    (width - padding.left - padding.right);

                                return (
                                    <g key={i}>
                                        <line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} stroke="#202021" strokeWidth="1" />
                                        <text x={x} y={height - 12} textAnchor="middle" fontSize="23" fill="#818384">
                                            {formatChartTick(p.date, precision, hours)}
                                        </text>
                                    </g>
                                );
                            })}

                            <path d={leftPath} fill="none" stroke="#fe5301" strokeWidth="3" strokeLinecap="square" strokeLinejoin="bevel" />
                            <path d={rightPath} fill="none" stroke="#4fbdba" strokeWidth="3" strokeLinecap="square" strokeLinejoin="bevel" />
                        </svg>
                    </div>
                )}
            </div>
        </div>
    );
}

function GlobalChartsPanel() {
    return (
        <section className="max-w-3xl mx-auto px-4 mt-8 mb-32">
            <div className="grid gap-4 md:grid-cols-2">
                <TotalActivityChart />
                <SecondaryGlobalChart
                    title="Average upvotes"
                    subtitle="Average post/comment score over the past week."
                    ariaLabel="Line chart of average post and comment upvotes"
                    leftLabel="Posts"
                    rightLabel="Comments"
                    leftKey="global/posts/sum_score"
                    rightKey="global/comments/sum_score"
                    numberFormatter={(value) => fmtNum(Math.round(value))}
                />
            </div>
        </section>
    );
}

function usePaginatedFetch(type) {
    const [items, setItems] = useState([]);
    const [sources, setSources] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(1);
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
    const [username, setUsername] = useState("");
    const [query, setQuery] = useState("");
    const [activeTab, setActiveTab] = useState("posts");
    const [searched, setSearched] = useState(false);
    const [initialLoading, setInitialLoading] = useState(false);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [subreddit, setSubreddit] = useState("");
    const [appliedSubreddit, setAppliedSubreddit] = useState("");
    const [sortOrder, setSortOrder] = useState("desc");
    const [showGraphs, setShowGraphs] = useState(false);

    const posts = usePaginatedFetch("posts");
    const comments = usePaginatedFetch("comments");

    useEffect(() => { document.title = "Rosint"; }, []);

    const buildFilters = useCallback(() => {
        const f = {};
        if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom).getTime() / 1000);
        if (dateTo) f.dateTo = Math.floor(new Date(dateTo).getTime() / 1000);
        if (subreddit.trim()) f.subreddit = subreddit.trim();
        return f;
    }, [dateFrom, dateTo, subreddit]);

    const hasFilters = dateFrom || dateTo || subreddit.trim();

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
    }, []);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        const user = username.trim();
        if (!user) return;
        const url = new URL(window.location.href);
        url.searchParams.set("u", user);
        window.history.pushState({}, "", url);
        setQuery(user);
        setSearched(true);
        setInitialLoading(true);
        const filters = buildFilters();
        await Promise.all([posts.reset(user, filters), comments.reset(user, filters)]);
        setAppliedSubreddit(subreddit.trim());
        setInitialLoading(false);
    }, [username, buildFilters, posts, comments, subreddit]);

    const clearFilters = useCallback(async () => {
        setDateFrom("");
        setDateTo("");
        setSubreddit("");
        setAppliedSubreddit("");
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

            <header className="border-b border-[#1c1c1d] bg-[#0d0d0d] sticky top-0 z-20">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
                    <button
                        aria-label="Go to homepage"
                        onClick={() => { setSearched(false); setUsername(""); setQuery(""); setDateFrom(""); setDateTo(""); setSubreddit(""); window.history.pushState({}, "", "/"); }}
                        className="logo-btn group flex items-center gap-2 relative"
                    >
                        <picture>
                            <source srcSet="/bot.webp" type="image/webp" />
                            <img src="/bot.png" alt="logo" width="40" height="40" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        </picture>
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

            <main>
                <div className={`max-w-3xl mx-auto px-4 transition-all duration-300 ${searched ? "pt-6" : "pt-20"}`}>
                    {!searched && (
                        <div className="text-center mb-2">
                            <picture>
                                <source srcSet="/rosintTitle.png" type="image/png" />
                                <img src="/rosintTitle.png" alt="redditOSINT" width="578" height="284" className="mx-auto mb-4" style={{ width: "578px", maxWidth: "90vw" }} />
                            </picture>
                            <p className="text-sm text-[#cccccc]">View private accounts and deleted posts/comments from any user via distributed open-source archives.</p>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <div className="relative" style={{ flex: "2 1 0" }}>
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#cccccc] text-sm font-medium select-none">u/</span>
                            <input aria-label="Reddit username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                                   placeholder="username"
                                   className="w-full bg-[#1a1a1b] border border-[#343536] rounded pl-8 pr-3 py-2.5 text-sm text-white placeholder-[#818384] focus:outline-none focus:border-[#ff4500] transition-colors"
                                   autoFocus />
                        </div>
                        <div className="relative" style={{ flex: "1 1 0" }}>
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#818384] text-sm font-medium select-none">r/</span>
                            <input
                                aria-label="Filter by subreddit"
                                type="text"
                                value={subreddit}
                                onChange={(e) => setSubreddit(e.target.value.replace(/^r\//, ""))}
                                placeholder="subreddit"
                                className="w-full bg-[#1a1a1b] border border-[#343536] rounded pl-8 pr-3 py-2.5 text-sm text-white placeholder-[#818384] focus:outline-none focus:border-[#ff4500] transition-colors"
                            />
                        </div>
                        <button type="submit" disabled={!username.trim() || initialLoading}
                                className="flex items-center gap-2 bg-[#ff4500] hover:bg-[#e03d00] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-5 py-2.5 rounded transition-colors flex-shrink-0">
                            {initialLoading ? <IconSpinner /> : <IconSearch />}
                            {initialLoading && "Searching…"}
                        </button>
                    </form>

                    {!searched && (
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                            <span className="text-[11px] text-[#818384]">From</span>
                            <input
                                aria-label="Date from"
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]"
                            />
                            <span className="text-[11px] text-[#818384]">To</span>
                            <input
                                aria-label="Date to"
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]"
                            />
                            {hasFilters && (
                                <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); setSubreddit(""); }}
                                        className="px-3 py-1 text-[12px] text-[#818384] hover:text-[#d7dadc] transition-colors">
                                    Clear
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setShowGraphs(g => !g)}
                                className="flex items-center gap-1.5 ml-auto text-[12px] text-[#818384] hover:text-[#d7dadc] transition-colors"
                            >
                                {showGraphs ? "Hide graphs" : "Show graphs"}
                                <svg aria-hidden="true" className={`w-3 h-3 transition-transform duration-200 ${showGraphs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>

                {!searched && showGraphs && <GlobalChartsPanel />}

                {searched && (
                    <div className="max-w-3xl mx-auto px-4 mt-6 pb-16">
                        {!initialLoading && (
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                                <div className="text-[12px] text-[#818384] pt-1">
                                    <p>
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
                                    {appliedSubreddit && (
                                        <p className="text-[#818384] mt-0.5">in <span className="text-[#ff4500] font-medium">r/{appliedSubreddit}</span></p>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 ml-auto">
                                    <span className="text-[11px] text-[#818384]">From</span>
                                    <input aria-label="Date from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                                           className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                                    <span className="text-[11px] text-[#818384]">To</span>
                                    <input aria-label="Date to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                                           className="bg-[#1a1a1b] border border-[#343536] rounded-sm px-2 py-1 text-[12px] text-[#d7dadc] focus:outline-none focus:border-[#ff4500] transition-colors [color-scheme:dark]" />
                                    <button onClick={clearFilters} disabled={initialLoading}
                                            className="px-3 py-1 text-[12px] font-medium text-[#818384] hover:text-[#d7dadc] border border-[#343536] hover:border-[#818384] disabled:opacity-50 rounded-sm transition-colors">
                                        Clear
                                    </button>
                                </div>
                            </div>
                        )}

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
                            <div className="flex items-center gap-2 pb-2">
                                {!initialLoading && !active.loading && active.items.length > 0 && (
                                    <>
                                        <button onClick={() => active.goPrev(query)} disabled={active.page <= 1 || active.loading} aria-label="Previous page"
                                                className="flex items-center justify-center w-7 h-7 rounded-sm border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                            <IconChevronLeft />
                                        </button>
                                        <span className="text-[11px] text-[#818384]">
                                            {active.loading ? <IconSpinner /> : `Page ${active.page}`}
                                        </span>
                                        <button onClick={() => active.goNext(query)} disabled={active.items.length < LIMIT || active.loading} aria-label="Next page"
                                                className="flex items-center justify-center w-7 h-7 rounded-sm border border-[#343536] hover:border-[#818384] text-[#d7dadc] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                                            <IconChevronRight />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {!initialLoading && (
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="text-[11px] text-[#818384] leading-relaxed">
                                    Archive coverage may vary.{" "}
                                    <a href={`https://www.reddit.com/search/?q=author%3A%22${query}%22&type=${activeTab}`}
                                       target="_blank" rel="noopener noreferrer" className="text-[#ff4500] hover:underline">
                                        Click here
                                    </a>{" "}
                                    to search Reddit directly for the most recent activity.
                                    <br />
                                    <span className="text-[#5a5a5b]">Note: Doing so will not show deleted posts or comments.</span>
                                </div>
                                <select
                                    aria-label="Sort order"
                                    value={sortOrder}
                                    onChange={(e) => setSortOrder(e.target.value)}
                                    className="flex-shrink-0 text-[11px] text-[#818384] bg-[#1a1a1b] border border-[#343536] hover:border-[#818384] rounded px-2 py-1 transition-colors focus:outline-none focus:border-[#fe5301] cursor-pointer"
                                >
                                    <option value="desc">Newest</option>
                                    <option value="asc">Oldest</option>
                                    <option value="top">Top</option>
                                </select>
                            </div>
                        )}

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
                                    {activeTab === "posts" && [...posts.items]
                                        .sort((a, b) =>
                                            sortOrder === "desc" ? b.created_utc - a.created_utc :
                                                sortOrder === "asc" ? a.created_utc - b.created_utc :
                                                    (b.score ?? 0) - (a.score ?? 0)
                                        )
                                        .map((post) => (
                                            <PostCard key={post.id} post={post} />
                                        ))}
                                    {activeTab === "comments" && [...comments.items]
                                        .sort((a, b) =>
                                            sortOrder === "desc" ? b.created_utc - a.created_utc :
                                                sortOrder === "asc" ? a.created_utc - b.created_utc :
                                                    (b.score ?? 0) - (a.score ?? 0)
                                        )
                                        .map((comment) => (
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
            </main>

            {!searched && (
                <footer className="fixed bottom-0 left-0 right-0 z-10 py-2 bg-[#0d0d0d] border-t border-[#1c1c1d]">
                    <p className="text-[11px] text-[#3a3a3b] leading-relaxed text-center">
                        redditOSINT is a free tool to search deleted Reddit posts, removed comments, and private Reddit accounts using open-source archives including Arctic Shift and PullPush.
                    </p>
                </footer>
            )}
        </div>
    );
}