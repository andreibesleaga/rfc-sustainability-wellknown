/**
 * The environment of the gateway: what it accepts, and what stops it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const NAMES = ["SELF_PERIOD_START", "SELF_PERIOD_END", "SELF_LIVE_SINCE"];
afterEach(() => {
  for (const n of NAMES) delete process.env[n];
});

describe("the pinned period of the self report", () => {
  it("is unset by default, and read as a period from SELF_PERIOD_START and SELF_PERIOD_END together", () => {
    expect(loadConfig().self.period).toBeUndefined();
    process.env.SELF_PERIOD_START = "2025-01-01T00:00:00Z";
    process.env.SELF_PERIOD_END = "2026-01-01T00:00:00Z";
    expect(loadConfig().self.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  });

  it("refuses one bound alone, a start that is not before the end, a date only, and a bound inside a day", () => {
    process.env.SELF_PERIOD_START = "2025-01-01T00:00:00Z";
    expect(() => loadConfig()).toThrow(/together/);
    delete process.env.SELF_PERIOD_START;
    process.env.SELF_PERIOD_END = "2025-01-01T00:00:00Z";
    expect(() => loadConfig()).toThrow(/together/);
    for (const [start, end] of [
      ["2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
      ["2025-01-01", "2026-01-01"],
      ["2025-01-01T06:00:00Z", "2026-01-01T00:00:00Z"],
    ]) {
      process.env.SELF_PERIOD_START = start;
      process.env.SELF_PERIOD_END = end;
      expect(() => loadConfig(), `${start} ${end}`).toThrow(/SELF_PERIOD_START/);
    }
  });
});

describe("the go-live instant", () => {
  it("is an RFC 3339 date-time with T and Z in upper case, written in UTC", () => {
    expect(loadConfig().self.liveSince).toBe("2026-07-30T00:00:00Z");
    process.env.SELF_LIVE_SINCE = "2026-07-30T02:00:00+02:00";
    expect(loadConfig().self.liveSince).toBe("2026-07-30T00:00:00Z");
    for (const bad of ["2026-07-30", "2026-07-30t00:00:00z", "yesterday", "2026-02-30T00:00:00Z"]) {
      process.env.SELF_LIVE_SINCE = bad;
      expect(() => loadConfig(), bad).toThrow(/SELF_LIVE_SINCE must be an RFC 3339 date-time/);
    }
  });
});
