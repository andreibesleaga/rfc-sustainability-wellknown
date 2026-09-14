/**
 * Per-client request rate limiting (draft Security Considerations §Denial of Service: servers
 * SHOULD rate-limit requests to the well-known URI). The limiter itself is
 * `rate-limiter-flexible`'s in-memory backend; this module only fixes the
 * gateway's policy — one fixed window per client, `Retry-After` on refusal —
 * and how a client is identified behind a platform proxy.
 */
import type { IncomingMessage } from "node:http";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

export interface RateLimitConfig {
  /** Requests allowed per client per minute; 0 disables the limiter. */
  perMinute: number;
  /** Number of trusted proxies in front of the process (0 = exposed directly). */
  trustProxy: number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface RateLimiter {
  check(clientKey: string): Promise<RateLimitDecision>;
}

/** A limiter for the given policy, or `undefined` when disabled. */
export function createRateLimiter(config: RateLimitConfig): RateLimiter | undefined {
  if (config.perMinute <= 0) return undefined;
  const limiter = new RateLimiterMemory({ points: config.perMinute, duration: 60 });
  return {
    async check(clientKey) {
      try {
        await limiter.consume(clientKey);
        return { allowed: true };
      } catch (res) {
        if (res instanceof RateLimiterRes) {
          return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(res.msBeforeNext / 1000)) };
        }
        throw res;
      }
    },
  };
}

/**
 * The client identity a request is limited on. Behind `trustProxy` proxies the
 * real client is the entry that the nearest trusted proxy appended to
 * `X-Forwarded-For` — counted from the END of the list, since anything a
 * client sends itself sits at the front. Directly exposed, the socket address.
 */
export function clientKey(req: IncomingMessage, trustProxy: number): string {
  if (trustProxy > 0) {
    const raw = req.headers["x-forwarded-for"];
    const list = (Array.isArray(raw) ? raw.join(",") : raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    // Fewer entries than trusted proxies is a misconfiguration; the first
    // entry then still keys per client rather than collapsing everyone onto
    // the proxy's own address.
    const fromProxy = list[Math.max(0, list.length - trustProxy)];
    if (fromProxy) return fromProxy;
  }
  return req.socket?.remoteAddress ?? "unknown";
}
