/** Result words (9.1) and the report row. */
export const PASS = "PASS", FAIL = "FAIL", NE = "NOT-EVALUABLE", DECLARED = "DECLARED", NOT_DECLARED = "NOT-DECLARED", INFO = "INFO";
export const COMPLETE = "COMPLETE", INCOMPLETE = "INCOMPLETE", NOT_APPLICABLE = "NOT-APPLICABLE";
const RANK = { [FAIL]: 3, [NE]: 2, [PASS]: 1 };

/** A row is { id, result, scope?, detail? }; empty detail is left out. */
export function row(id, result, detail, scope) {
  const r = { id, result };
  if (scope !== undefined) r.scope = scope;
  if (detail !== undefined && detail !== "") r.detail = detail;
  return r;
}
/** Worst of results: FAIL, then NOT-EVALUABLE, then PASS. */
export const worst = (...results) => results.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a));
/** Sorted, de-duplicated tokens joined by "; ", the detail form of the vectors. */
export const list = (xs) => [...new Set(xs)].sort().join("; ");
