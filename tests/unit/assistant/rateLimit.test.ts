import { afterEach, describe, expect, it } from "vitest";
import {
  LIMIT,
  WINDOW_MS,
  rateLimit,
  rateLimitKey,
  resetRateLimit,
} from "@/app/api/assistant/rateLimit";

// The limiter uses a module-level Map, so clear it between tests to keep each
// case independent. Tests pass an explicit `now` so no real timers are needed.
afterEach(() => {
  resetRateLimit();
});

describe("rateLimitKey", () => {
  it("takes the first comma-separated address and trims it", () => {
    expect(rateLimitKey("1.2.3.4, 5.6.7.8, 9.9.9.9", "sess")).toBe("1.2.3.4::sess");
    expect(rateLimitKey("  10.0.0.1  ", "s")).toBe("10.0.0.1::s");
  });

  it("falls back to 'unknown' for a null or empty header", () => {
    expect(rateLimitKey(null, "sess")).toBe("unknown::sess");
    expect(rateLimitKey("", "sess")).toBe("unknown::sess");
    expect(rateLimitKey("   ", "sess")).toBe("unknown::sess");
  });

  it("uses an empty session segment when none is given", () => {
    expect(rateLimitKey("1.2.3.4")).toBe("1.2.3.4::");
  });

  it("separates distinct sessions from the same IP", () => {
    expect(rateLimitKey("1.2.3.4", "a")).not.toBe(rateLimitKey("1.2.3.4", "b"));
  });
});

describe("rateLimit — sliding window", () => {
  it("allows up to LIMIT requests within the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < LIMIT; i += 1) {
      expect(rateLimit("k", now + i).allowed).toBe(true);
    }
  });

  it("blocks the request after LIMIT without recording it", () => {
    const now = 1_000_000;
    for (let i = 0; i < LIMIT; i += 1) {
      rateLimit("k", now);
    }

    const blocked = rateLimit("k", now);
    expect(blocked.allowed).toBe(false);
    // The oldest in-window hit is at `now`, so it ages out a full window later.
    expect(blocked.retryAfterMs).toBe(WINDOW_MS);

    // A blocked attempt is not recorded, so retryAfterMs does not keep growing.
    const stillBlocked = rateLimit("k", now + 5);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.retryAfterMs).toBe(WINDOW_MS - 5);
  });

  it("frees a slot once the oldest hit ages out of the window", () => {
    const start = 1_000_000;
    // Fill the window: one hit at `start`, the rest just after.
    rateLimit("k", start);
    for (let i = 1; i < LIMIT; i += 1) {
      rateLimit("k", start + 1);
    }

    // Still full while the first hit is strictly inside the window. Pruning keeps
    // timestamps with `timestamp > now - WINDOW_MS`, so the hit at `start` survives
    // until `now` reaches `start + WINDOW_MS`.
    expect(rateLimit("k", start + WINDOW_MS - 1).allowed).toBe(false);

    // At `start + WINDOW_MS` the cutoff equals `start`, so the first hit (at
    // `start`) is pruned and a slot opens.
    expect(rateLimit("k", start + WINDOW_MS).allowed).toBe(true);
  });

  it("keeps separate windows per key", () => {
    const now = 1_000_000;
    for (let i = 0; i < LIMIT; i += 1) {
      rateLimit("a", now);
    }
    expect(rateLimit("a", now).allowed).toBe(false);
    // A different key is unaffected.
    expect(rateLimit("b", now).allowed).toBe(true);
  });

  it("resetRateLimit clears all windows", () => {
    const now = 1_000_000;
    for (let i = 0; i < LIMIT; i += 1) {
      rateLimit("k", now);
    }
    expect(rateLimit("k", now).allowed).toBe(false);

    resetRateLimit();
    expect(rateLimit("k", now).allowed).toBe(true);
  });
});
