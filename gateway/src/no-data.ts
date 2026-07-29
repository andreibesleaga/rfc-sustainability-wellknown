/**
 * Subjects the operator looked for and could NOT honestly publish.
 *
 * A registry of published sustainability data that quietly leaves out the
 * organizations publishing nothing would overstate how much of the web is
 * actually measurable. These entries are therefore listed in the index, with
 * the finding and the evidence, and a request for one of their documents gets a
 * 404 — the draft's no-data rule — carrying that finding in the body.
 *
 * They are NOT Sustainability Metadata Documents and are never served as one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMAIN_RE } from "./registry";

export const NO_DATA_FILE = "_no-data.json";

export type NoDataStatus = "publishes-no-quantitative-data" | "consolidated-into-parent";

export interface NoDataEntry {
  domain: string;
  entity: string;
  status: NoDataStatus;
  /** What the operator found, and why no document is possible. */
  finding: string;
  /** Primary sources consulted. */
  evidence: string[];
  /** Another subject in this registry that does cover it, if any. */
  see?: string;
  /** ISO date the finding was last checked. */
  checked: string;
}

const STATUSES: NoDataStatus[] = ["publishes-no-quantitative-data", "consolidated-into-parent"];

/** Load and validate `data/_no-data.json`. Absent file means an empty list. */
export function loadNoData(dataDir: string): Map<string, NoDataEntry> {
  const file = join(dataDir, NO_DATA_FILE);
  const out = new Map<string, NoDataEntry>();
  if (!existsSync(file)) return out;

  const parsed = JSON.parse(readFileSync(file, "utf8")) as { subjects?: unknown };
  const subjects = parsed.subjects;
  if (!Array.isArray(subjects)) {
    throw new Error(`no-data: ${NO_DATA_FILE} must carry a "subjects" array`);
  }

  for (const raw of subjects) {
    const e = raw as Partial<NoDataEntry>;
    if (typeof e.domain !== "string" || !DOMAIN_RE.test(e.domain)) {
      throw new Error(`no-data: entry has no valid domain (${JSON.stringify(e.domain)})`);
    }
    if (typeof e.entity !== "string" || !e.entity) {
      throw new Error(`no-data: ${e.domain} has no entity name`);
    }
    if (!STATUSES.includes(e.status as NoDataStatus)) {
      throw new Error(
        `no-data: ${e.domain} has status ${JSON.stringify(e.status)}; expected one of ${STATUSES.join(", ")}`,
      );
    }
    // The whole point of an entry is the evidence behind it.
    if (typeof e.finding !== "string" || e.finding.length < 40) {
      throw new Error(`no-data: ${e.domain} needs a substantive "finding"`);
    }
    if (!Array.isArray(e.evidence) || e.evidence.length === 0) {
      throw new Error(`no-data: ${e.domain} needs at least one evidence URL`);
    }
    for (const u of e.evidence) {
      if (typeof u !== "string" || !/^https?:\/\/\S+$/.test(u)) {
        throw new Error(`no-data: ${e.domain} has a non-absolute evidence URL (${String(u)})`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.checked))) {
      throw new Error(`no-data: ${e.domain} needs a "checked" date as YYYY-MM-DD`);
    }
    if (out.has(e.domain)) throw new Error(`no-data: duplicate entry for ${e.domain}`);
    out.set(e.domain, e as NoDataEntry);
  }
  return out;
}
