/**
 * D2.signed: an operator declaration's `signed` verified under the operator's Registry keys (7.2 rule 2).
 *
 * Registry keys count only after D2 authenticated the entry under a pinned registrar key. The key is the one
 * whose validity window holds the check instant T, not `updated`, which the publisher wrote. The shallow
 * check never gets here: it has only the keys the caller pinned (S3).
 */
import { s3 } from "./signed.mjs";
import { keysValidAt } from "./registry.mjs";
import { extOf } from "./declaration.mjs";
import { row, PASS } from "./rows.mjs";

/** The check instant: the explicit T, the checker's clock, else the instant of the read. */
export const checkInstant = (ctx) => ctx.input.T ?? ctx.input.now ?? ctx.readAt;

const operatorOf = (decl) => {
  const operators = extOf(decl, "ledger-evidence-2")?.operators;
  return Array.isArray(operators) ? operators[0]?.operator : undefined;
};

/** Is the operator's 2.0-form Registry entry authenticated, per the D2.entry rows already made? */
const entryAuthenticated = (rows, operator) => rows.some((r) => r.id === "D2.entry" && r.result === PASS && r.scope === operator);

/** The operator's Registry keys valid at T, as Ed25519 keys for the S3 key step. */
function registryKeys(ctx, entry) {
  return keysValidAt(entry, checkInstant(ctx)).filter((k) => typeof k.x === "string").map((k) => ({ kty: "OKP", crv: "Ed25519", x: k.x }));
}

/** One PASS row when the served `signed` verifies under a Registry key valid at T; no row otherwise (S3 says the rest). */
export function registrySignedRows(ctx, decl, level, siblings, d2Rows, label) {
  if (level !== "operator") return [];
  const operator = operatorOf(decl);
  const entry = typeof operator === "string" ? ctx.byOperator.get(operator) : undefined;
  const served = ctx.input.objs?.[siblings.indexOf(decl)];
  if (!entry || entry.form !== "2x" || !served || typeof served.signed !== "string" || !entryAuthenticated(d2Rows, operator)) return [];
  const [result] = s3(served, "operator", true, { operatorKeys: registryKeys(ctx, entry) }, ctx.input.objectIssues?.[siblings.indexOf(decl)] ?? null);
  return result.result === PASS ? [row("D2.signed", PASS, "verified under a Registry key valid at T", label)] : [];
}
