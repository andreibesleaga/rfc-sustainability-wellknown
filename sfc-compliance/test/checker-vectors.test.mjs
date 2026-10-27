/**
 * The checker against the test vectors (Appendix B): every check scenario of every case is run through
 * runChecks and its rows must equal vectors/expected; the pure-function scenarios run through
 * vectors/functions.mjs, which uses the checker's own building blocks. No network, no clock: every scenario carries its own fixed T.
 */
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/check.mjs";
import { summaryOf } from "../lib/report.mjs";
import { prepareInput } from "../lib/input.mjs";
import { buildContext } from "../lib/ledger.mjs";
import { effectiveList } from "../lib/replay.mjs";
import { FUNCS } from "../vectors/functions.mjs";
import { vectorFiles, inputOf, selectRows } from "./helpers.mjs";

for (const file of vectorFiles()) {
  describe(`vector ${file.name}`, () => {
    for (const scenario of file.inputs.scenarios) {
      const expected = file.expected.scenarios[scenario.name];
      if (scenario.fn) {
        it(`${scenario.name}: ${scenario.fn} agrees`, () => {
          expect(FUNCS[scenario.fn](scenario)).toEqual(expected.result);
        });
        continue;
      }
      it(`${scenario.name}: the rows are those expected`, async () => {
        const report = await runChecks(inputOf(scenario, file));
        const rows = selectRows(report.rows, scenario.select);
        expect(rows).toEqual(expected.rows);
        expect(summaryOf(rows)).toEqual(expected.summary);
      });
      if (scenario.effectiveAt !== undefined) {
        it(`${scenario.name}: the effective attestations at ${scenario.effectiveAt} are those expected`, () => {
          const ctx = buildContext(prepareInput(inputOf(scenario, file)));
          expect(effectiveList(ctx, scenario.effectiveAt)).toEqual(expected.effective);
        });
      }
    }
  });
}
