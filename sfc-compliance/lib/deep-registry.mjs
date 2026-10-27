/** D2: the operator set and the Registry (9.4 step 2). */
import { canonicalize, textHash } from "./canonical.mjs";
import { keyFault } from "./ed25519.mjs";
import { isObject, sameHost, asciiLower } from "./forms.mjs";
import { entryShape } from "./shapes.mjs";
import { activeIn, intervalsOrdered, pubOf } from "./registry.mjs";
import { replay, voidInfos } from "./replay.mjs";
import { monthOfEvent } from "./ledger.mjs";
import { registrarKeys, verifyUnder, methodologyPinned } from "./parameters.mjs";
import { atOrBefore, before, monthsBetween } from "./time.mjs";
import { row, PASS, FAIL, NE, INFO, list } from "./rows.mjs";
import { extOf } from "./declaration.mjs";

const typeShort = (t) => (t === "EnergyAttested" ? "Energy" : "Carbon");

/** Is a 1.x entry authenticated by a listed digest or a caller-pinned entry? */
export function entry1xAuthenticated(ctx, en) {
  const digest = textHash(canonicalize(en.raw));
  const listed = methodologyPinned(ctx) && (ctx.params["registry-1x-digests"] ?? []).some((x) => x.operator === en.operator && x.sha256 === digest);
  return listed || (ctx.pins.entries1x ?? []).includes(digest);
}

function entry1xRow(ctx, en, scope) {
  const ok = entry1xAuthenticated(ctx, en);
  return [row("D2.entry", ok ? PASS : NE, ok ? "1.x entry authenticated by digest" : "unsigned Registry entry not authenticated", scope)];
}

/** The fault of a key (a weak or invalid point), worked out once per key text for the whole read: the same key may sit in many entries and declarations. */
function keyFaultOf(ctx, k) {
  const id = `keyFault|${k.x}`;
  if (!ctx.cache.has(id)) ctx.cache.set(id, keyFault(pubOf(k)));
  return ctx.cache.get(id);
}

/** Faults of a 2.0 entry that do not depend on the registrar's signature. */
function entryFaults(ctx, en, twoX) {
  const tokens = [];
  if (entryShape(en.raw).length) tokens.push("shape");
  if (!sameHost(en.network, ctx.network)) tokens.push("network");
  for (const k of en.keys) {
    ctx.checkDeadline();
    const fault = keyFaultOf(ctx, k);
    if (fault) tokens.push(fault);
  }
  if (en.profile2From && (twoX.get(en.operator) ?? []).some((m) => before(m, en.profile2From))) tokens.push("profile2From");
  if (!isObject(en.raw.sig)) tokens.push("sig absent");
  return tokens;
}

function entry2xRow(ctx, en, keys, twoX, scope) {
  const tokens = entryFaults(ctx, en, twoX);
  if (!keys.length) return [row("D2.entry", NE, "registrar key not pinned", scope)];
  const verified = isObject(en.raw.sig) ? verifyUnder(keys, en.raw, ctx.checkDeadline) : { ok: false, reason: "absent" };
  if (isObject(en.raw.sig) && !verified.ok) tokens.push(verified.reason === "encoding" ? "sig encoding" : "sig");
  const out = [row("D2.entry", tokens.length ? FAIL : PASS, list(tokens), scope)];
  if (verified.ok && verified.status === "former") out.push(row("D2.entry.info", INFO, "signed under a former key", scope));
  return out;
}

/** The operator set, the network and the member-of-network binding of a declaration (rows `D2.operator-set`, `D2.network`). */
function operatorSetRows(ctx, decl, level, ev2, pinned, label) {
  const months = monthsBetween(decl.period.start, decl.period.end);
  const entries = Array.isArray(ev2.operators) ? ev2.operators : [];
  return level === "network" ? networkSetRows(ctx, decl, months, entries, label) : memberSetRows(ctx, decl, months, entries, pinned, label);
}

function networkSetRows(ctx, decl, months, entries, label) {
  const active = ctx.registry.filter((en) => months.some((m) => activeIn(en, m)));
  const same = list(active.map((en) => en.operator)) === list(entries.map((x) => x?.operator));
  const originOf = (x) => asciiLower(ctx.byOperator.get(x?.operator)?.origin);
  const origins = entries.every((x) => originOf(x) === asciiLower(x?.origin));
  const detail = same ? (origins ? undefined : "origin differs") : "operator set differs";
  return [row("D2.operator-set", same && origins ? PASS : FAIL, detail, label), row("D2.network", sameHost(ctx.network, decl.target) ? PASS : FAIL, undefined, label)];
}

/** An operator declaration: one entry, its Registry origin is the target, and it names the network it belongs to. */
function memberSetRows(ctx, decl, months, entries, pinned, label) {
  const member = extOf(decl, "network-topology")?.["member-of-network"];
  const entry = ctx.byOperator.get(entries[0]?.operator);
  const okSet = entries.length === 1 && entry && sameHost(entry.origin, decl.target) && months.some((m) => activeIn(entry, m));
  const rows = [row("D2.operator-set", okSet ? PASS : FAIL, undefined, label)];
  if (typeof member !== "string") rows.push(row("D2.network", NE, "member-of-network missing", label));
  else if (!sameHost(ctx.network, member)) rows.push(row("D2.network", FAIL, undefined, label));
  else rows.push(row("D2.network", pinned ? PASS : NE, pinned ? undefined : "claimed, not authenticated", label));
  return rows;
}

/** Shared operator or origin, and intervals that are unsorted or overlap (INFO for a 1.x entry). */
function uniquenessRow(ctx, label) {
  const dup = [], seenOperator = new Set(), seenOrigin = new Set();
  for (const en of ctx.registry) {
    if (typeof en.operator !== "string" || typeof en.origin !== "string") continue; // not an entry: the shape check reports it
    if (seenOperator.has(en.operator)) dup.push(`operator ${en.operator}`);
    if (seenOrigin.has(asciiLower(en.origin))) dup.push(`origin ${en.origin}`);
    seenOperator.add(en.operator);
    seenOrigin.add(asciiLower(en.origin));
  }
  const unordered = ctx.registry.filter((en) => typeof en.operator === "string" && !intervalsOrdered(en));
  if (!dup.length && !unordered.length) return row("D2.unique", PASS, undefined, label);
  const fails = dup.length || unordered.some((en) => en.form === "2x");
  return row("D2.unique", fails ? FAIL : INFO, list([...dup, ...unordered.map((en) => `active ${en.operator}`)]), label);
}

/** Months of 2.0-form events per operator, for the `profile2From` rule. */
function twoXMonths(ctx) {
  const months = new Map();
  for (const ev of ctx.events) {
    const m = ev.kind === "2x" ? monthOfEvent(ev) : null;
    if (m) months.set(ev.event.subject, [...(months.get(ev.event.subject) ?? []), m]);
  }
  return months;
}

function registrarCopyRow(ctx, keys, label) {
  const copy = ctx.ex.registrar?.jwk?.x;
  if (copy === undefined) return [];
  if (!keys.length) return [row("D2.registrar-copy", NE, "only source of the registrar key", label)];
  return [row("D2.registrar-copy", keys.some((k) => k.x === copy) ? PASS : FAIL, undefined, label)];
}

/** The attested months of each subject, built once per read (d2 runs once per declaration object); the clock is tested once per event, as in the replay. */
function attestedMonths(ctx) {
  if (!ctx.cache.has("attestedMonths")) {
    const table = new Map();
    for (const e of ctx.events) {
      ctx.checkDeadline();
      const subject = e.event?.subject, month = monthOfEvent(e);
      if (typeof subject !== "string" || month === null) continue;
      if (!table.has(subject)) table.set(subject, new Set());
      table.get(subject).add(month);
    }
    ctx.cache.set("attestedMonths", table);
  }
  return ctx.cache.get("attestedMonths");
}

/** An entry whose `to` lies before a month with an attested event. */
function closedIntervalRows(ctx) {
  const rows = [];
  const months = attestedMonths(ctx);
  for (const en of ctx.registry) {
    ctx.checkDeadline();
    const attested = months.get(en.operator) ?? new Set();
    const over = [...attested].filter((m) => !activeIn(en, m) && en.intervals.some((iv) => iv.to !== null && atOrBefore(iv.to, m))).sort();
    if (over.length) rows.push(row("D2.interval", FAIL, `interval closed over attested months: ${over.map((m) => m.slice(0, 7)).join(", ")}`, en.operator));
  }
  return rows;
}

/** Events skipped under L1 only because their month is inactive: INFO. */
function inactiveMonthRows(ctx) {
  const st = replay(ctx, ctx.readAt);
  const rows = [];
  for (const ev of ctx.events) {
    const v = st.verdicts.get(ev.i);
    if (!v || !v.reasons.includes("L1") || !v.month || !ctx.byOperator.has(ev.event?.subject)) continue;
    const e = ev.event;
    if (activeIn(ctx.byOperator.get(e.subject), v.month) || e.subject !== e.actor || !(ev.kind === "1x" || sameHost(e.network, ctx.network))) continue;
    rows.push(row("D2.inactive-month", INFO, `${e.subject} ${v.month.slice(0, 7)}`, `${typeShort(e.type)} @${ev.commit}`));
  }
  return rows;
}

function voidRows(ctx) {
  const infos = voidInfos(ctx);
  return ctx.voids.flatMap((v, k) => {
    const info = infos[k];
    const scope = `void @${v?.commit ?? "-"}`;
    if (info.ok) return [row("D2.void", PASS, undefined, scope), ...(info.status === "former" ? [row("D2.void.info", INFO, "void signed under a former key", scope)] : [])];
    if (info.unpinned) return [row("D2.void", NE, info.reason, scope)];
    return [row("D2.void", info.fail ? FAIL : INFO, info.fail ? info.reason : `void ignored: ${info.reason}`, scope)];
  });
}

/** A lower `version` than an earlier verified entry is a rollback. */
function rollbackRows(ctx) {
  const rows = [];
  for (const en of ctx.registry) {
    const prior = ctx.input.prior?.versions?.[en.operator];
    if (prior !== undefined && en.version !== null) rows.push(row("D2.rollback", en.version < prior ? FAIL : PASS, en.version < prior ? "rollback" : undefined, en.operator));
  }
  return rows;
}

/** D2 for a declaration (or none): `decl` is given only when its period is in UTC months. */
export function d2(ctx, decl, level, ev2, label) {
  const keys = registrarKeys(ctx);
  const rows = [];
  if (decl && ev2) rows.push(...operatorSetRows(ctx, decl, level, ev2, keys.length > 0, label));
  rows.push(uniquenessRow(ctx, label));
  const twoX = twoXMonths(ctx);
  ctx.registry.forEach((en, i) => {
    ctx.checkDeadline();
    const scope = typeof en.operator === "string" ? en.operator : `registry[${i}]`;
    rows.push(...(en.form === "1x" ? entry1xRow(ctx, en, scope) : entry2xRow(ctx, en, keys, twoX, scope)));
  });
  rows.push(...registrarCopyRow(ctx, keys, label), ...closedIntervalRows(ctx), ...inactiveMonthRows(ctx), ...voidRows(ctx), ...rollbackRows(ctx));
  return rows;
}
