/**
 * The SFC profile 2.0 ledger bridge: from a ledger read (excerpt format 2) to the
 * declarations of the draft, as the profile maps them.
 *
 * Output (7.1 to 7.5, 8): the PRIMARY object, market-based, with the figures of
 * 7.4 and the extensions `hardware-lifecycle` (8.2), `carbon-neutrality` (8.3),
 * `network-topology` (8.4) and `ledger-evidence-2` (8.5); and, on request and
 * when 7.3 allows it, the PAIRED location-based object. The cut-off is the
 * object's `updated`. A silent operator-month makes the object INCOMPLETE
 * (7.5): the members derived from the silent type are omitted, and it is still
 * published. Heads are null for an empty chain. Intensity is each object's own
 * Scope 2 per kWh (7.4).
 *
 * It refuses rather than guesses only where publishing would be wrong: a
 * malformed excerpt, a period the profile does not allow, an `updated` later
 * than the read, an operator that is not in the Registry, and a read on which
 * deep check FAILs on D2 to D6 or C-SFC-7 (a faulty ledger, 5.5). It never refuses for a
 * silent month, a late correction or an unpinned registrar key.
 *
 * `measurement-method` is the least direct method among counted events, or `third-party-modeled`
 * when no counted effective EnergyAttested exists (7.4).
 *
 * Reading choices where the spec leaves a form open:
 *  - `hardware-lifecycle` is written (true, false) when every counted operator's `nodeProfile` is
 *    complete, else omitted (8.2); the publisher's optional members of it are not written;
 *  - at operator level the counted operator is the one whose Registry `origin` is the target (D2);
 *  - `renewable-energy` (the publisher's market-based share, 7.4) is published only beside the energy
 *    figure it is a share of: an object incomplete for energy (7.5) omits it. 7.4 makes the member a
 *    SHOULD where `carbon-neutrality` is published, so the object conforms either way.
 *
 * Every name comes from the profile descriptor (`../sfc-ledger-profile.ts`). The
 * figures are the ones the deep check recomputes (`derive.ts`), so what is
 * written here agrees with C-SFC-7 by construction, and the self-check at the end
 * proves it for the object written.
 *
 * This directory is a port of the reference checker in `sfc-compliance/lib/`, written
 * against the same spec. `test/sfc-ledger-2-vectors.test.ts` runs the vectors in
 * `sfc-compliance/vectors` through it and keeps the two in step.
 *
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import type { RawMetrics } from "sustainability-wellknown-publisher";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { CheckLimit, type Clock } from "./deadline";
import { deepCheck } from "./deep";
import { CARBON_SHIFT, derive, ENERGY_SHIFT, evidenceValue, locationFigures, shiftOf, topLevel, type Derivation } from "./derive";
import { Bridge2Error, refuse2, type ReadExcerptV2 } from "./excerpt";
import { withLimits } from "./limits";
import { buildContext, type Ctx, type Pins } from "./ledger";
import { nodeProfileComplete, timeInfo } from "./window";
import { activeIn, type Entry } from "./registry";
import { before, isCalendarYear, isHttpsUri, isInstant, isMonthBound, isUtcMonthPeriod, monthsBetween, sameHost, FAIL, type Json, type Row } from "./primitives";

export type BridgeLevel = "operator" | "network";
export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "tCO2e";

export interface Bridge2Options {
  mode: BridgeLevel;
  provider: string;
  methodologyUri: string;
  /** Where a verifier obtains the read (`ledger-access-uri`, 8.5): an absolute https URI. */
  ledgerAccessUri: string;
  /** A machine-readable index of filed reports (7.2 rule 4): required at network level; at operator level it carries the object when every month is silent. */
  disclosureUri?: string;
  /** Both bounds month-bound: a calendar year (network), or a month or a year (operator) (7.1, 7.2 rule 6). */
  period: { start: string; end: string };
  /** The cut-off (7.1): the read's instant or earlier. */
  updated: string;
  /** Network: the network's host. Operator: the operator's Registry `origin`. */
  target: string;
  /** The published unit of `energy-consumption`; default `kWh`. A coarser unit is for figures of 10^15 or more (3.3 rule 3). */
  energyUnit?: EnergyUnit;
  carbonUnit?: CarbonUnit;
  /** Network level: `consensus-mechanism` of `network-topology` (8.4), required there. */
  consensusMechanism?: string;
  /** Operator level: where the network's declaration is published (`network-declaration`, 8.4). */
  networkDeclarationUri?: string;
  /** The publisher's market-based renewable share, 0 to 100 (7.4); written only beside the energy figure it is a share of (see the reading choices above). */
  renewableEnergy?: number;
  /** Also write the location-based object (7.3), when every counted carbon attestation carries `scope2LocationKgCO2e`. */
  pairedLocation?: boolean;
  /** The methodology parameters (7.6): retirement registries and reference forms (L8b), takeovers (L4), platform. */
  parameters?: Json;
  pins?: Pins;
  /** Milliseconds, in place of the monotonic clock that measures the time limit of the checks (tests pass a fake). */
  clock?: Clock;
}

export interface Bridge2Result {
  level: BridgeLevel;
  derivation: Derivation;
  /** The primary object, in the form the draft's wire uses, before the publisher signs it. */
  primary: Json;
  /** The paired location-based object, when requested and allowed. */
  location?: Json;
  /** The primary object as the publisher library takes it. */
  rawPrimary: RawMetrics;
  rawLocation?: RawMetrics;
  /** The deep-check rows the self-check ran (D2 to D5, C-SFC-7 and the window rows). */
  rows: Row[];
}

/** 7.1, 7.2 rule 6: month-bound bounds; network one calendar year; operator one month or one calendar year. */
function checkPeriod(opts: Bridge2Options): void {
  const { start, end } = opts.period;
  if (!isMonthBound(start) || !isMonthBound(end)) refuse2("E-PERIOD", `both period bounds must be month-bound (YYYY-MM-01T00:00:00Z), got ${start} to ${end}`);
  const oneMonth = isUtcMonthPeriod({ start, end });
  const oneYear = isCalendarYear({ start, end }, true);
  if (opts.mode === "network" && !oneYear) refuse2("E-PERIOD", `a network declaration covers one calendar year, got ${start} to ${end}`);
  if (opts.mode === "operator" && !oneMonth && !oneYear) refuse2("E-PERIOD", `an operator declaration covers one month or one calendar year, got ${start} to ${end}`);
}

/** A unit option, when given, is one of the table's own names (the tables are the ones the figures are computed with). */
function checkUnit(member: string, unit: unknown, table: Record<string, number>): void {
  if (unit !== undefined && shiftOf(table, unit) === undefined) refuse2("E-CONFIG", `${member} must be one of ${Object.keys(table).join(", ")} (got ${JSON.stringify(unit)})`);
}

/** The configuration checks that need no read: mode, provider, the methodology reference, `updated`, URIs, period shape, the units. Refuses `[E-CONFIG]`, `[E-DISCLOSURE]` or `[E-PERIOD]`. */
export function checkBridge2Config(opts: Bridge2Options): void {
  if (opts.mode !== "operator" && opts.mode !== "network") refuse2("E-CONFIG", `mode must be "operator" or "network"`);
  if (typeof opts.provider !== "string" || !opts.provider) refuse2("E-CONFIG", "provider must be a non-empty string (7.1)");
  // 7.1 says "a URI reference" and the publisher accepts a relative one, so the bridge is no stricter than the draft here
  if (typeof opts.methodologyUri !== "string" || !opts.methodologyUri) refuse2("E-CONFIG", "methodologyUri must be a URI reference to the methodology document (7.1)");
  if (!isInstant(opts.updated)) refuse2("E-CONFIG", `updated must be an RFC 3339 instant (got ${JSON.stringify(opts.updated)})`);
  if (!isHttpsUri(opts.ledgerAccessUri)) refuse2("E-CONFIG", `ledgerAccessUri must be an absolute https URI (got ${JSON.stringify(opts.ledgerAccessUri)})`);
  if (opts.disclosureUri !== undefined && !isHttpsUri(opts.disclosureUri)) refuse2("E-CONFIG", "disclosureUri must be an absolute https URI");
  if (opts.mode === "network" && !opts.disclosureUri) refuse2("E-DISCLOSURE", "a network declaration must carry disclosure-uri (7.2 rule 4); configure disclosureUri");
  if (opts.mode === "network" && typeof opts.consensusMechanism !== "string") refuse2("E-CONFIG", "a network declaration needs consensusMechanism for network-topology (8.4)");
  if (opts.renewableEnergy !== undefined && !(opts.renewableEnergy >= 0 && opts.renewableEnergy <= 100)) refuse2("E-CONFIG", "renewableEnergy must be between 0 and 100");
  checkUnit("energyUnit", opts.energyUnit, ENERGY_SHIFT);
  checkUnit("carbonUnit", opts.carbonUnit, CARBON_SHIFT);
  checkPeriod(opts);
}

function checkOptions(opts: Bridge2Options, read: ReadExcerptV2): void {
  checkBridge2Config(opts);
  if (before(read.excerpt["read-at"], opts.updated)) refuse2("E-UPDATED", `updated ${opts.updated} is later than the read (${read.excerpt["read-at"]}); the cut-off is the read's instant or earlier (7.1)`);
}

/** The counted operators for the object (7.1): every operator active in a month of the period, or the one operator whose Registry origin is the target. */
function countedEntries(ctx: Ctx, opts: Bridge2Options): Entry[] {
  const months = monthsBetween(opts.period.start, opts.period.end);
  if (opts.mode === "network") {
    if (!sameHost(ctx.network, opts.target)) refuse2("E-OPERATOR", `the network of the read is ${ctx.network}, the target is ${opts.target} (D2)`);
    return ctx.registry.filter((en) => months.some((m) => activeIn(en, m)));
  }
  const entry = ctx.registry.find((en) => sameHost(en.origin, opts.target));
  if (!entry) refuse2("E-OPERATOR", `no Registry entry has origin ${opts.target}`);
  if (!months.some((m) => activeIn(entry, m))) refuse2("E-OPERATOR", `${entry.operator} is not active in ${opts.period.start} to ${opts.period.end}`);
  return [entry];
}

/** 8.2: from the ledger, `hardware-lifecycle` is written when every counted operator's hardware declaration is complete; else omitted (never `false` on this basis). */
function hardwareExtension(entries: Entry[]): Json | undefined {
  if (!entries.length || !entries.every((en) => nodeProfileComplete(en.nodeProfile))) return undefined;
  return { "general-purpose-hardware": true, "single-use-asic-required": false };
}

/** The wire members every object of this bridge carries (7.1). */
function baseMembers(opts: Bridge2Options, d: Derivation): Json {
  return {
    updated: opts.updated,
    capabilities: "basic",
    provider: opts.provider,
    // 7.4: the least direct method among counted events, or `third-party-modeled` when no counted effective EnergyAttested exists
    "measurement-method": d.leastDirect ?? "third-party-modeled",
    "methodology-uri": opts.methodologyUri,
    period: opts.period,
    target: opts.target,
    "target-type": opts.mode === "network" ? "service" : "origin",
  };
}

/** The primary object, market-based, in wire form (7.4, 7.5, 8). */
function primaryObject(opts: Bridge2Options, d: Derivation, entries: Entry[], networkOfRead: string): Json {
  const t = topLevel(d, { energyUnit: opts.energyUnit ?? "kWh", carbonUnit: opts.carbonUnit ?? "kgCO2e", consensus: opts.consensusMechanism, level: opts.mode });
  const { "measurement-method": _m, ...figures } = t.top;
  const topology = { ...t.networkTopology };
  if (opts.mode === "operator") {
    topology["member-of-network"] = networkOfRead;
    if (opts.networkDeclarationUri !== undefined) topology["network-declaration"] = opts.networkDeclarationUri;
  }
  const extensions: Record<string, Json> = {};
  const hardware = hardwareExtension(entries);
  if (hardware) extensions[PROFILE.extensions.hardwareLifecycle] = hardware;
  extensions[PROFILE.extensions.carbonNeutrality] = t.carbonNeutrality;
  extensions[PROFILE.extensions.networkTopology] = topology;
  extensions[PROFILE.extensions.ledgerEvidence2] = evidenceValue(d, { level: opts.mode, access: opts.ledgerAccessUri });
  return {
    ...baseMembers(opts, d),
    ...figures,
    ...(opts.renewableEnergy !== undefined && !d.incompleteEnergy ? { "renewable-energy": opts.renewableEnergy } : {}),
    ...(opts.disclosureUri !== undefined ? { "disclosure-uri": opts.disclosureUri } : {}),
    extensions,
  };
}

/** The paired location-based object (7.3, 7.5 rule 4), or undefined when 7.3 forbids it. */
function locationObject(opts: Bridge2Options, d: Derivation, primary: Json): Json | undefined {
  const figures = locationFigures(d, { carbonUnit: opts.carbonUnit ?? "kgCO2e" });
  if (!figures) return undefined;
  const keep = ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target", "target-type", "energy-consumption", "energy-unit", "carbon-unit", "disclosure-uri"];
  const out: Json = {};
  for (const k of keep) if (primary[k] !== undefined) out[k] = primary[k];
  return { ...out, "carbon-accounting": "location-based", ...figures };
}

/** Wire form to the publisher library's input (the library signs and serialises it). */
export function toRawMetrics(wire: Json): RawMetrics {
  const raw: RawMetrics = {
    provider: wire.provider,
    measurementMethod: wire["measurement-method"],
    methodologyUri: wire["methodology-uri"],
    period: wire.period,
    capabilities: wire.capabilities,
    updated: wire.updated,
    target: wire.target,
    targetType: wire["target-type"],
  };
  if (wire["energy-consumption"] !== undefined) raw.energy = { value: wire["energy-consumption"], unit: wire["energy-unit"] };
  if (wire["carbon-footprint"] !== undefined) raw.carbon = { value: wire["carbon-footprint"], unit: wire["carbon-unit"] };
  if (wire["scope-1"] !== undefined) raw.scope1 = wire["scope-1"];
  if (wire["scope-2"] !== undefined) raw.scope2 = wire["scope-2"];
  if (wire["scope-3"] !== undefined) raw.scope3 = wire["scope-3"];
  if (wire["carbon-accounting"] !== undefined) raw.carbonAccounting = wire["carbon-accounting"];
  if (wire["carbon-intensity-gCO2e-per-kWh"] !== undefined) raw.carbonIntensity = wire["carbon-intensity-gCO2e-per-kWh"];
  if (wire["renewable-energy"] !== undefined) raw.renewableEnergy = wire["renewable-energy"];
  if (wire["disclosure-uri"] !== undefined) raw.disclosureUri = wire["disclosure-uri"];
  if (wire.extensions !== undefined) raw.extensions = wire.extensions;
  return raw;
}

/** The rows whose FAIL makes a read faulty or the object inconsistent with it: D2 to D6 and C-SFC-7. The window rows (C-SFC-1, 2, 4, 6) judge the network against the criteria, not the read, so they never stop publication. */
const BLOCKING = /^(D[2-6]|C-SFC-7)(\.|$)/;

/** The self-check: the deep check over the object just written; a FAIL of a blocking row means the read is faulty (5.5) and nothing is published. */
function selfCheck(ctx: Ctx, primary: Json, location: Json | undefined): Row[] {
  const rows = deepCheck(ctx, timeInfo(ctx), primary, location ? [primary, location] : [primary]);
  const failed = rows.filter((r) => r.result === FAIL && BLOCKING.test(r.id));
  if (failed.length) refuse2("E-LEDGER", `the deep check fails on this read: ${failed.slice(0, 6).map((r) => `${r.id}${r.scope ? ` (${r.scope})` : ""}${r.detail ? `: ${r.detail}` : ""}`).join("; ")}`);
  return rows;
}

/**
 * One declaration (and, on request, its location-based pair) from a read. Throws a
 * `Bridge2Error` on any refusal named in the module comment, and nothing else: a read
 * that stops the checks in any other way is refused as E-LEDGER in fixed words.
 */
export function bridge2(read: ReadExcerptV2, opts: Bridge2Options): Bridge2Result {
  checkOptions(opts, read);
  try {
    return bridgeChecked(read, opts);
  } catch (e) {
    if (e instanceof Bridge2Error) throw e;
    // a read that takes longer than the limit of one check is refused, in fixed words
    if (e instanceof CheckLimit) refuse2("E-LEDGER", `the checks of this read stopped: ${e.message}`);
    // defence in depth: the exception text is never echoed, it may carry the read's content
    return refuse2("E-LEDGER", "the checks of this read stopped on a value they could not read");
  }
}

function bridgeChecked(read: ReadExcerptV2, opts: Bridge2Options): Bridge2Result {
  const ctx = buildContext({ excerpt: read.excerpt, parameters: opts.parameters, pins: opts.pins, clock: opts.clock }, withLimits());
  const entries = countedEntries(ctx, opts);
  const d = derive({ ...ctx, registry: entries }, opts.updated, opts.period);
  if (d.incompleteEnergy && d.incompleteCarbon && opts.disclosureUri === undefined) {
    refuse2("E-DISCLOSURE", "the object is incomplete for energy and for carbon, so it carries no numeric member; it must then carry disclosure-uri (7.4, 7.5 rule 3); configure disclosureUri");
  }
  const primary = primaryObject(opts, d, entries, read.excerpt.network);
  const location = opts.pairedLocation ? locationObject(opts, d, primary) : undefined;
  const rows = selfCheck(ctx, primary, location);
  return {
    level: opts.mode,
    derivation: d,
    primary,
    ...(location ? { location } : {}),
    rawPrimary: toRawMetrics(primary),
    ...(location ? { rawLocation: toRawMetrics(location) } : {}),
    rows,
  };
}

