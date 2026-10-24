// In-memory sliding-window rate limiter for POST /api/assistant (Requirement 8.2).
//
// The route allows at most 10 requests per 60 seconds per client, keyed by the
// client IP (the first address of `x-forwarded-for`) combined with the optional
// `sessionId`. The window "slides": each check prunes timestamps older than the
// window, so the limit is the count of hits in the most recent 60 seconds — not a
// fixed calendar minute.
//
// Scope and honesty (design.md "Rate limit"): the store is a module-level `Map`,
// so it lives only inside one server process. On Vercel a request may hit any of
// several instances, each with its own Map, so the effective ceiling can be a
// multiple of `LIMIT`. This is acceptable for a demo; the panel's ⓘ says so. For a
// hard, cross-instance limit we would need a shared store (e.g. Redis), which is
// out of scope here.
//
// Determinism: `rateLimit` takes an injectable `now` so tests can advance time
// without real timers, and `resetRateLimit` clears the store between tests.

/** Maximum number of requests permitted within the window. */
export const LIMIT = 10;

/** The sliding-window length in milliseconds (60 seconds). */
export const WINDOW_MS = 60_000;

/**
 * Module-level store: rate-limit key → the timestamps (ms) of recent allowed
 * requests, kept in ascending order (we only ever push `now`, which never moves
 * backwards in practice). Entries are pruned on access and a key is deleted once
 * its array is empty, so the Map does not grow without bound for idle clients.
 */
const hits = new Map<string, number[]>();

/**
 * Build the rate-limit key from the first `x-forwarded-for` address and an optional
 * session id.
 *
 * `x-forwarded-for` may be a comma-separated list (`client, proxy1, proxy2`); the
 * first entry is the originating client, so we take it and trim surrounding
 * whitespace. A missing or empty header falls back to `"unknown"` so that clients
 * we cannot identify still share a single bucket rather than bypassing the limit.
 *
 * The session id is appended after a `::` separator (empty when absent), so two
 * tabs from the same IP with distinct session ids get independent buckets.
 */
export function rateLimitKey(forwardedFor: string | null, sessionId?: string): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  const ip = first && first.length > 0 ? first : "unknown";
  return `${ip}::${sessionId ?? ""}`;
}

/** Result of a rate-limit check. */
export interface RateLimitResult {
  /** True when the request is within the limit and has been recorded. */
  allowed: boolean;
  /**
   * When `allowed` is false, the number of milliseconds until the oldest in-window
   * request ages out and a slot frees up. Useful for a `Retry-After`-style hint.
   */
  retryAfterMs?: number;
}

/**
 * Check (and, when allowed, record) one request against the sliding window.
 *
 * On every call we prune timestamps older than `now - WINDOW_MS`, then:
 *   - if `LIMIT` or more remain, the request is NOT allowed. We compute how long
 *     until the oldest in-window hit expires (`oldest + WINDOW_MS - now`) and
 *     return it as `retryAfterMs`. Crucially we do NOT record the blocked attempt,
 *     so a client being throttled cannot keep pushing its own window forward and
 *     starve itself indefinitely.
 *   - otherwise the request is allowed: we push `now` and store the window back.
 *
 * `now` defaults to `Date.now()` but is injectable for deterministic tests.
 */
export function rateLimit(key: string, now: number = Date.now()): RateLimitResult {
  const cutoff = now - WINDOW_MS;

  // Prune entries that have aged out of the window.
  const previous = hits.get(key) ?? [];
  const recent = previous.filter((timestamp) => timestamp > cutoff);

  if (recent.length >= LIMIT) {
    // At capacity: reject without recording. The oldest surviving timestamp is the
    // first element because the array is kept in ascending order.
    const oldest = recent[0];
    const retryAfterMs = oldest + WINDOW_MS - now;

    // Store the pruned window back so stale timestamps do not accumulate even while
    // a client is being throttled.
    hits.set(key, recent);

    return { allowed: false, retryAfterMs };
  }

  // Under the limit: record this request.
  recent.push(now);
  hits.set(key, recent);

  return { allowed: true };
}

/**
 * Clear the entire store. Intended for tests only, so each test starts from a
 * clean window without relying on `vi.resetModules()`.
 */
export function resetRateLimit(): void {
  hits.clear();
}
