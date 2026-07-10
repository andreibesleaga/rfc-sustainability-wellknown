/**
 * The three mandated safeguards from the draft's Security and Privacy sections,
 * ported from `example-scripts/security.js` into the gateway:
 *
 *  1. DoS protection      — cap arrays at 366 objects (draft §"Array Size Limits").
 *  2. Traffic analysis    — drop entries finer than 24h (draft §"Traffic Analysis").
 *  3. Anti-fingerprinting — apply ~1% noise to numeric fields (draft §"Hardware Fingerprinting").
 */
import { SustainabilityMetrics } from "./types";

export interface SecurityOptions {
  /** Max array length. Default 366 (draft RECOMMENDED). */
  maxObjects?: number;
  /** Drop entries whose reporting-period is finer than a day. Default true. */
  enforceDailyFloor?: boolean;
  /** Apply ~1% fuzz to numeric fields (draft MAY). Default false (deterministic). */
  applyNoise?: boolean;
}

const NUMERIC_KEYS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
] as const;

/** A `reporting-period` longer than "YYYY-MM-DD" (10 chars) implies sub-daily data. */
function isDailyOrCoarser(period: string): boolean {
  return (period ?? "").length <= 10;
}

/**
 * Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).
 * The draft requires noise to be applied "once, at document-generation time,
 * deterministically per reporting period" — regenerating the same period
 * (e.g. after cache expiry) must yield the same published values. A single
 * factor per report keeps arithmetically related fields consistent (scopes
 * still sum to the fuzzed carbon-footprint, modulo rounding).
 */
function fuzzFactorFor(period: string): number {
  let h = 5381;
  for (let i = 0; i < period.length; i++) h = ((h << 5) + h + period.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

/** Apply safeguards to a list of metrics objects; returns a new array. */
export function secureReports(
  reports: SustainabilityMetrics[],
  opts: SecurityOptions = {},
): SustainabilityMetrics[] {
  const maxObjects = opts.maxObjects ?? 366;
  const enforceDailyFloor = opts.enforceDailyFloor ?? true;
  const applyNoise = opts.applyNoise ?? false;

  // Filter before capping so floor-dropped entries do not consume cap slots.
  let out = reports;
  if (enforceDailyFloor) {
    out = out.filter((r) => isDailyOrCoarser(String(r["reporting-period"] ?? "")));
  }

  // Trend arrays MUST be sorted ascending by reporting-period (draft §Payload
  // Format); when the cap is exceeded, keep the MOST RECENT periods (draft
  // §Array Size Limits).
  out = [...out].sort((a, b) =>
    String(a["reporting-period"] ?? "").localeCompare(String(b["reporting-period"] ?? "")),
  );
  if (out.length > maxObjects) out = out.slice(out.length - maxObjects);

  if (applyNoise) {
    out = out.map((r) => {
      const fuzz = fuzzFactorFor(String(r["reporting-period"] ?? ""));
      const secured: SustainabilityMetrics = { ...r };
      for (const key of NUMERIC_KEYS) {
        const v = secured[key];
        // Multiplicative noise applies to every reported value regardless of
        // sign (scopes MAY be negative under net accounting): multiplication
        // preserves sign and keeps arithmetically related fields consistent.
        // An unreported metric is simply absent (-03 removed the sentinel).
        if (typeof v === "number") {
          secured[key] = Math.round(v * fuzz * 100) / 100;
        }
      }
      return secured;
    });
  }

  return out;
}
