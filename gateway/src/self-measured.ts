/**
 * The operator's monthly figures for the gateway's own report, entered from the
 * hosting platform's metrics: `data/_self-measured.json` (the leading
 * underscore keeps it out of the subject registry).
 *
 *   {
 *     "months": {
 *       "2026-09": { "watts": 2.4, "source": "Railway metrics, read 2026-10-01: ...", "entered": "2026-10-02T00:00:00Z" }
 *     }
 *   }
 *
 * `entered` (an RFC 3339 date-time, optional) is when the figure was entered:
 * the objects that cover the month state it as `updated` when it is later than
 * their own close.
 *
 * `scripts/self-watts.mjs` writes it. A malformed file stops the gateway at
 * boot, like a malformed data file, rather than publishing a wrong figure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDateTime, toUtcQueryValue } from "sustainability-wellknown-publisher";

export const SELF_MEASURED_FILE = "_self-measured.json";

/** One entered month: the average power, and when it was entered. */
export interface SelfMeasuredEntry {
  watts: number;
  entered?: string;
}

/** The average power per month ("YYYY-MM" -> watts), as the model uses it. */
export function loadSelfMeasured(dataDir: string): Record<string, number> {
  return Object.fromEntries(Object.entries(loadSelfMeasuredEntries(dataDir)).map(([month, e]) => [month, e.watts]));
}

/** When each month's figure was entered ("YYYY-MM" -> date-time); months without an `entered` are left out. */
export function loadSelfEnteredAt(dataDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [month, e] of Object.entries(loadSelfMeasuredEntries(dataDir))) if (e.entered) out[month] = e.entered;
  return out;
}

function loadSelfMeasuredEntries(dataDir: string): Record<string, SelfMeasuredEntry> {
  const file = join(dataDir, SELF_MEASURED_FILE);
  if (!existsSync(file)) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${SELF_MEASURED_FILE}: not valid JSON`);
  }
  const months = (doc as { months?: unknown })?.months;
  if (typeof months !== "object" || months === null || Array.isArray(months)) {
    throw new Error(`${SELF_MEASURED_FILE}: expected an object "months"`);
  }
  const out: Record<string, SelfMeasuredEntry> = {};
  for (const [month, entry] of Object.entries(months as Record<string, unknown>)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`${SELF_MEASURED_FILE}: "${month}" is not a YYYY-MM month`);
    const watts = (entry as { watts?: unknown })?.watts;
    const source = (entry as { source?: unknown })?.source;
    if (typeof watts !== "number" || !Number.isFinite(watts) || watts <= 0 || watts > 10_000) {
      throw new Error(`${SELF_MEASURED_FILE}: ${month}.watts must be a number above 0 and at most 10000`);
    }
    if (typeof source !== "string" || source.trim().length < 5) {
      throw new Error(`${SELF_MEASURED_FILE}: ${month}.source must say where the figure came from`);
    }
    const entered = (entry as { entered?: unknown }).entered;
    if (entered !== undefined && !isDateTime(entered)) {
      throw new Error(`${SELF_MEASURED_FILE}: ${month}.entered must be an RFC 3339 date-time with the letters T and Z in upper case`);
    }
    out[month] = { watts, ...(entered === undefined ? {} : { entered: toUtcQueryValue(entered) }) };
  }
  return out;
}
