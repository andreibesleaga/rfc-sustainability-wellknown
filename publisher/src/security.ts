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

/** Apply safeguards to a list of metrics objects; returns a new array. */
export function secureReports(
  reports: SustainabilityMetrics[],
  opts: SecurityOptions = {},
): SustainabilityMetrics[] {
  const maxObjects = opts.maxObjects ?? 366;
  const enforceDailyFloor = opts.enforceDailyFloor ?? true;
  const applyNoise = opts.applyNoise ?? false;

  let out = reports.slice(0, maxObjects);

  if (enforceDailyFloor) {
    out = out.filter((r) => isDailyOrCoarser(String(r["reporting-period"] ?? "")));
  }

  if (applyNoise) {
    out = out.map((r) => {
      const fuzz = 0.99 + Math.random() * 0.02; // 0.99 – 1.01
      const secured: SustainabilityMetrics = { ...r };
      for (const key of NUMERIC_KEYS) {
        const v = secured[key];
        if (typeof v === "number") {
          secured[key] = Math.round(v * fuzz * 100) / 100;
        }
      }
      return secured;
    });
  }

  return out;
}
