/**
 * The expected output of one check scenario: the checker's own rows (../lib), the effective attestations
 * and the figures a publisher would write. The independent check of these files is crosscheck.py.
 */
import { runChecks } from "../lib/check.mjs";
import { summaryOf } from "../lib/report.mjs";
import { prepareInput } from "../lib/input.mjs";
import { buildContext } from "../lib/ledger.mjs";
import { effectiveList } from "../lib/replay.mjs";
import { derivedFor } from "./build/publish.mjs";

/** The checker input a scenario stands for: its members less those that only steer the vector. */
export function inputOf(scenario) {
  const { name, select, derive, effectiveAt, consumer, excerptRef, ...input } = scenario;
  return input;
}

const selectRows = (rows, select) => (select ? rows.filter((r) => select.some((s) => r.id === s || r.id.startsWith(`${s}.`))) : rows);

export async function reportOf(scenario) {
  const input = inputOf(scenario);
  const rows = selectRows((await runChecks(input)).rows, scenario.select);
  const report = { rows, summary: summaryOf(rows) };
  if (scenario.effectiveAt === undefined && !scenario.derive) return report;
  const ctx = buildContext(prepareInput(input));
  if (scenario.effectiveAt !== undefined) report.effective = effectiveList(ctx, scenario.effectiveAt);
  if (scenario.derive) report.derived = scenario.derive.map((spec) => derivedFor(ctx, spec));
  return report;
}
