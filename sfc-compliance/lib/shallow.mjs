/**
 * The shallow check (9.3) on a document in hand: S2 conformance, S3 signature, S4 selection with
 * C-SFC-2 disclosure form, C-SFC-5, S6 coherence and the object verdict. Fetching (S1) is in input.mjs.
 */
import { validateDocument } from "sustainability-wellknown-consumer";
import { s3 } from "./signed.mjs";
import { s6 } from "./coherence.mjs";
import { selectAnnual, csfc2Disclosure, csfc5 } from "./disclosure.mjs";
import { declarationUriRows } from "./uris.mjs";
import { deriveFor } from "./derive.mjs";
import { hasOnlyOldEvidence, legacyRows } from "./profile1x.mjs";
import { row, PASS, FAIL, NE, INFO, COMPLETE, INCOMPLETE, NOT_APPLICABLE } from "./rows.mjs";
import { extOf, levelOf, claimsSfc, labelOf, samePeriodTarget, hasEvidence, usablePeriod, mistypedMembers } from "./declaration.mjs";
import { isInstant, sameHost } from "./forms.mjs";

const CARBON_GROUP = ["scope-2", "scope-3", "carbon-footprint"];
const carbonOmitted = (o) => hasEvidence(o) && CARBON_GROUP.every((k) => o[k] === undefined);
const energyOmitted = (o) => hasEvidence(o) && o["energy-consumption"] === undefined;
/** An object seen alone is INCOMPLETE when a 7.5 member group is omitted. */
const looksIncomplete = (o) => energyOmitted(o) || carbonOmitted(o);

/** S2 for each object, from the published consumer library in strict mode (the -10 wire; `legacyCompat` off, as 9.3 prescribes). */
export function s2Rows(objs, limits) {
  if (objs.length > limits.declarationObjects) return { rows: [row("S2", NE, "limit: objects in a declaration array")], valid: [] };
  const valid = objs.map((o) => validateDocument(o, { legacyCompat: false }).valid);
  return { rows: objs.map((o, i) => row("S2", valid[i] ? PASS : FAIL, undefined, labelOf(o))), valid };
}

/** Pair location-based objects with their primary (7.3); an unpaired one, or one whose primary is incomplete, gets S2 only. */
function pairingRows(objs) {
  const rows = new Map();
  for (const o of objs.filter((x) => x["carbon-accounting"] === "location-based")) {
    // the primary may have omitted `carbon-accounting` with the rest of its carbon members (7.5)
    const primary = objs.find((p) => p !== o && samePeriodTarget(p, o) && p["carbon-accounting"] !== "location-based" && claimsSfc(p)
      && (p["carbon-accounting"] === "market-based" || carbonOmitted(p)));
    if (!primary) rows.set(o, row("PAIR", INFO, "unpaired object", labelOf(o)));
    else if (carbonOmitted(primary)) rows.set(o, row("PAIR", INFO, "location object not applicable (incomplete)", labelOf(o)));
  }
  return rows;
}

/** COMPLETE or INCOMPLETE (7.5): from the ledger when a read is held, else from the omitted member groups. */
function verdictRow(ctx, o, level) {
  const label = labelOf(o);
  const period = usablePeriod(o);
  if (!(ctx && hasEvidence(o) && isInstant(o.updated) && period)) {
    return row("VERDICT", looksIncomplete(o) ? INCOMPLETE : COMPLETE, undefined, label);
  }
  const d = deriveFor(ctx, o.updated, period, o, level);
  const parts = [
    ...d.silentEnergy.map((x) => `silent: ${x.operator}, ${x.month.slice(0, 7)}, EnergyAttested`),
    ...d.silentCarbon.map((x) => `silent: ${x.operator}, ${x.month.slice(0, 7)}, CarbonAttested`),
    ...d.noOperator.map((m) => `no operator: ${m.slice(0, 7)}`),
  ];
  return row("VERDICT", parts.length ? INCOMPLETE : COMPLETE, parts.sort().join("; ") || undefined, label);
}

/**
 * Run the shallow check. `run` holds: served (the objects as served: S2, S3 and the URI rows read these),
 * objs (the same objects with a wrongly typed member read as absent: every figure check reads these),
 * objectIssues (the duplicate-member and lone-surrogate findings of each served object), rawClaims,
 * input (T, pins, network, retrievalUri), T (the check instant or null), skew, limits and ctx (the ledger
 * context or null). Returns { rows } in report order.
 */
export function shallowCheck(run) {
  const { served, objs, input, limits } = run;
  const s2 = s2Rows(served, limits);
  const rows = [...s2.rows, ...declarationUriRows(served, input.retrievalUri ?? null)];
  const paired = pairingRows(objs);
  const claimed = (o) => claimsSfc(o) || (run.rawClaims && objs.length === 1);
  const s3rows = new Map();
  objs.forEach((o, i) => {
    if (paired.has(o)) return;
    const r = s3(served[i], levelOf(o), claimed(o), input.pins ?? {}, run.objectIssues?.[i] ?? null);
    s3rows.set(o, r);
    rows.push(...r);
  });
  rows.push(...selectionRows(run));
  objs.forEach((o, i) => rows.push(...objectRows(run, o, { s2valid: s2.valid[i], mistyped: mistypedMembers(served[i]) }, paired, s3rows, claimed)));
  return { rows };
}

const isNetworkObject = (o) => o["target-type"] === "service" && typeof extOf(o, "network-topology")?.["member-of-network"] !== "string";
const hostOfUri = (uri) => { try { return typeof uri === "string" ? new URL(uri).hostname : null; } catch { return null; } };

/** When the document was fetched, each network object whose `target` is not the retrieval host is noted (9.3 S4). */
function retrievalHostRows(network, retrievalUri) {
  const host = hostOfUri(retrievalUri);
  if (host === null) return [];
  return network.filter((o) => !sameHost(o.target, host)).map((o) => row("S4.info", INFO, "target differs from retrieval host", labelOf(o)));
}

/** S4 and C-SFC-2 disclosure form; they run only when T is known. */
function selectionRows(run) {
  const { objs, input, T } = run;
  if (!objs.length || !T) return [];
  const network = objs.filter(isNetworkObject);
  const target = input.network ?? network[0]?.target;
  if (target === undefined) return [];
  const selection = selectAnnual(objs, target, T);
  const rows = [...retrievalHostRows(network, input.retrievalUri), ...selection.rows];
  if (selection.selected) rows.push(csfc2Disclosure(selection.selected, selection.primary, selection.primary ? looksIncomplete(selection.primary) : false));
  return rows;
}

/** The rows of one object: pairing note, legacy reading, or C-SFC-5, S6 and the verdict. `facts` holds its S2 verdict and its mistyped optional members. */
function objectRows(run, o, facts, paired, s3rows, claimed) {
  const { objs, T, skew, ctx } = run;
  const level = levelOf(o);
  if (paired.has(o)) return [paired.get(o)];
  if (hasOnlyOldEvidence(o)) return legacyRows(o, facts.s2valid === false);
  if (!claimed(o)) return [row("VERDICT", NOT_APPLICABLE, undefined, labelOf(o))];
  const rows = [];
  if (T) rows.push(csfc5(o, level, objs, T, skew, facts.s2valid !== false, s3rows.get(o)));
  rows.push(...s6(o, level, objs, labelOf(o), facts.mistyped));
  rows.push(verdictRow(ctx, o, level));
  return rows;
}
