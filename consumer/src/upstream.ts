/**
 * The upstream chain (draft -10 §Upstream Declarations, §Evidence and Upstream
 * Consistency, §Security Considerations).
 *
 * A target's figures commonly derive in part from providers of hosting,
 * colocation, cloud, content delivery, network transit or electricity, and the
 * OPTIONAL `upstream` member names those providers' declarations by URI
 * reference. A consumer that follows them "MUST NOT go deeper than three
 * declarations below the one it started from, MUST refuse any URI it has
 * already retrieved during the walk, and MUST bound the total number of
 * retrievals in one walk". All three are enforced here: {@link MAX_UPSTREAM_DEPTH},
 * the `visited` set (a fragment does not make a URI new), and
 * {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}. The budget is not redundant with the
 * depth limit: `upstream` may carry many entries, so three levels of a wide
 * fan-out is an enormous number of requests built entirely out of conforming
 * documents. Every retrieval goes through `secureGet`: https on every hop, the
 * address checked at the connection, the body read under a byte cap.
 *
 * WHERE A REFERENCE POINTS. `declaration` is a URI reference. It is resolved
 * against the URI the declaration containing it was retrieved from (`base`), and
 * only then is the https rule applied; a relative reference with no base cannot
 * be resolved and is not followed. The reference may name any path.
 *
 * HOW A RETRIEVED DECLARATION IS READ: exactly as any other, with the same
 * compatibility reading (and none in strict mode). An upstream that is not a
 * declaration at all, or that is invalid as read, is reported as not retrieved.
 *
 * WHERE THE COMPARISON IS DEFINED: "where an upstream publishes a tenant
 * declaration about what it delivers to this target", for the same period and
 * after conversion to one unit. The period is the same when both bounds are
 * the same instants, whatever their spelling; an upstream that publishes other
 * periods only is asked for the period with `start` and `end` when it declares
 * `capabilities: extended`. A target whose declared scope covers what the
 * upstream delivers cannot have consumed less energy or caused fewer
 * emissions than the upstream states, rounding aside; a smaller figure is "an
 * inconsistency between two claims, to investigate, not a conformance
 * failure", and is worded here as a condition ("if the target's scope covers
 * what this upstream delivers"), because the format cannot say whether it does.
 *
 * WHAT IS COMPARED: `energy-consumption` and `carbon-footprint`, no other
 * member. The comparison is limited in the ways the draft names, and each
 * is visible in the output:
 *
 *  1. Whether a target's scope covers a given upstream is not expressible, so
 *     every `under-reported` detail says what it would mean if it does and
 *     that it is not a failure to conform.
 *  2. No member carries the share of a target's figures attributable to one
 *     upstream, so the converse (that the target has not claimed more than the
 *     upstream delivered) is not checked.
 *  3. Each `upstream` entry is compared on its own; nothing here sums, averages
 *     or otherwise combines entries.
 *  4. `carbon-footprint` is compared only where both objects declare the same
 *     `carbon-accounting` value or neither does; `carbonComparison` records
 *     when it was left out while the energy comparison proceeded.
 *
 * Retrieval is never automatic: `fetchSustainability` walks the chain only when
 * the caller passes `followUpstream` (CLI: `--upstream`).
 */
import { classifyMediaType, ACCEPT_HEADER } from "./media-type";
import { CARBON_ACCOUNTING } from "./tokens";
import { AddressLookup, BodyTooLargeError, discardBody, isAbortOrTimeout, readBodyCapped, secureGet } from "./transport";
import { CompatReport, readDocument } from "./sentinel";
import { DEFAULT_MAX_DEPTH, parseBody } from "./body";
import { canonicalKey, toUtcQueryValue } from "./period";
import { SustainabilityMetrics, UpstreamComparison, UpstreamEntry } from "./types";
import { convertCarbon, convertEnergy } from "./units";
import { validateDocument } from "./validate";

/** The draft's limit: never "deeper than three declarations below the one it started from". */
export const MAX_UPSTREAM_DEPTH = 3;

/**
 * Default bound on the TOTAL number of upstream declarations retrieved for one
 * starting declaration (draft -10 §Security Considerations: a consumer that
 * follows upstream declarations "MUST bound the total number of retrievals in
 * one walk", so that a chain of declarations cannot be turned into an
 * amplifier).
 *
 * Depth alone does not bound the work: `upstream` is an array, so a document
 * naming ten providers, each naming ten, reaches a thousand retrievals at
 * depth three without a single non-conformant document. Twenty covers any
 * plausible real supply chain (a handful of providers, each with a handful)
 * and is configurable through `maxRetrievals` (`upstreamMaxRetrievals` on
 * `fetchSustainability`).
 */
export const DEFAULT_MAX_UPSTREAM_RETRIEVALS = 20;

/**
 * The rounding allowance, as a relative tolerance on the upstream figure.
 *
 * Draft -10 §Evidence and Upstream Consistency: a smaller figure counts
 * "rounding aside". This takes only the unit-conversion part of that
 * allowance: 1e-9 is some six orders of magnitude above the double-precision
 * error a kWh/MWh or gCO2e/tCO2e conversion can introduce (~1e-16 relative per
 * operation), so two figures that are equal before conversion never read as a
 * shortfall after it.
 *
 * It deliberately does NOT try to take the rounding of the publishers as well.
 * A consumer sees two parsed numbers, not the precision each publisher rounded
 * at, so any wider band would be a guess, and every widening forgives a real
 * shortfall of that size. A band narrower than the draft allows can only
 * report a shortfall the draft would have let pass, which is a finding "to
 * investigate" and not a failure to conform.
 */
const EPSILON = 1e-9;

export interface UpstreamWalkOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  maxBytes: number;
  maxObjects: number;
  /** Bound on how deeply a retrieved body may nest (default {@link DEFAULT_MAX_DEPTH}). */
  maxDepth?: number;
  allowInsecure?: boolean;
  /**
   * Opt out of refusing an upstream URI that resolves to an address that is not
   * public unicast (default false; `allowInsecure` lifts the check for loopback only). An
   * `upstream[].declaration` is the most exposed URI the draft defines: it is
   * written by another origin and followed automatically once the walk is asked
   * for, so the address check matters most here.
   */
  allowPrivateAddresses?: boolean;
  /** Resolver of the connection; see {@link AddressLookup}. */
  lookup?: AddressLookup;
  /** Certificate authorities (PEM) to trust in addition to the system's. */
  ca?: string | readonly string[];
  /**
   * The URI the declaration being walked was retrieved from, against which each
   * `declaration` reference is resolved. Without it only an absolute reference
   * is followed, and a relative one is reported as not resolvable.
   */
  base?: URL;
  /**
   * The compatibility reading, as on the ordinary fetch path (default true;
   * `fetchSustainability` passes its own `legacyCompat` through, so one
   * strictness setting governs the whole walk). False validates every retrieved
   * declaration exactly as served, so a document of an earlier revision is
   * reported as not retrieved.
   */
  legacyCompat?: boolean;
  /** How many declarations below the starting one may be retrieved (default and maximum {@link MAX_UPSTREAM_DEPTH}). */
  walkDepth?: number;
  /**
   * Total retrievals allowed for one starting declaration, across every level
   * of the walk (default {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}). Once it is
   * exhausted the remaining entries are reported rather than fetched.
   */
  maxRetrievals?: number;
}

/** The retrieval budget shared by every level of one walk. */
interface RetrievalBudget {
  remaining: number;
  /** The bound the walk started with, for the detail string. */
  limit: number;
}

interface Figures {
  energyKWh?: number;
  carbonGCO2e?: number;
}

/** A declaration object's energy and carbon in one common unit each. */
function figuresOf(m: SustainabilityMetrics): Figures {
  const out: Figures = {};
  const energy = m["energy-consumption"];
  if (typeof energy === "number") out.energyKWh = convertEnergy(energy, m["energy-unit"] ?? "kWh", "kWh");
  const carbon = m["carbon-footprint"];
  if (typeof carbon === "number") out.carbonGCO2e = convertCarbon(carbon, m["carbon-unit"] ?? "gCO2e", "gCO2e");
  return out;
}

/** The accounting method an object declares for its `carbon-footprint`, or `undefined` when it declares none. */
function accountingOf(m: SustainabilityMetrics): string | undefined {
  const value = m["carbon-accounting"];
  return typeof value === "string" && (CARBON_ACCOUNTING as readonly string[]).includes(value) ? value : undefined;
}

/** How a declaration's accounting method reads in a detail string. */
function describeAccounting(basis: string | undefined): string {
  return basis === undefined ? "declares no carbon-accounting" : `declares carbon-accounting ${basis}`;
}

const objectsOf = (doc: unknown): SustainabilityMetrics[] => (Array.isArray(doc) ? doc : [doc]) as SustainabilityMetrics[];

type Retrieved =
  | { ok: true; objects: SustainabilityMetrics[]; converted: string[]; disregarded: string[] }
  | { ok: false; reason: string };

/** GET one declaration by absolute URI, under the same bounds as the main fetch. */
async function retrieve(url: URL, options: UpstreamWalkOptions): Promise<Retrieved> {
  const got = await secureGet(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    allowInsecure: options.allowInsecure,
    allowPrivateAddresses: options.allowPrivateAddresses,
    lookup: options.lookup,
    ca: options.ca,
    headers: { Accept: ACCEPT_HEADER },
  });
  // A safety refusal says WHY in its detail (which address the name resolved
  // to), and that belongs in the verdict, since "unreachable" alone would read
  // as the upstream being down rather than deliberately not followed.
  if (!got.ok) {
    const { reason, detail } = got.refusal;
    return { ok: false, reason: reason === "blocked-address" || reason === "userinfo-in-uri" ? `${reason} (${detail ?? ""})` : reason };
  }
  const { res } = got;
  if (res.status !== 200) {
    await discardBody(res);
    return { ok: false, reason: `http-${res.status}` };
  }
  const mediaType = classifyMediaType(res.headers.get("content-type"));
  if (mediaType === "other") {
    await discardBody(res);
    return { ok: false, reason: `wrong-media-type (${res.headers.get("content-type") ?? "none"})` };
  }
  let text: string;
  try {
    ({ text } = await readBodyCapped(res, options.maxBytes));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { ok: false, reason: "too-large" };
    if (isAbortOrTimeout(err)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network-error" };
  }
  const body = parseBody(text, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  if ("error" in body) return { ok: false, reason: "not-json" };
  const parsed = body.value;
  if (objectsOf(parsed).length > options.maxObjects) return { ok: false, reason: "too-many-objects" };

  // A retrieved declaration is read exactly as any other: the compatibility
  // reading runs here as it does in fetch.ts, and strict mode turns it off for
  // both alike.
  const report: CompatReport = { converted: [], disregarded: [] };
  if (options.legacyCompat !== false) readDocument(parsed, report);

  const check = validateDocument(parsed);
  if (!check.valid) return { ok: false, reason: `invalid (${check.errors[0] ?? "validation failed"})` };
  return { ok: true, objects: objectsOf(parsed), converted: report.converted, disregarded: report.disregarded };
}

/**
 * Compare one metric pair, in the direction the draft defines: a target whose
 * declared scope covers what the upstream delivers cannot have consumed less
 * energy, or caused fewer emissions, than the upstream states it delivered.
 * The target's own figure at least the upstream's is `consistent`, and less is
 * `under-reported`. The converse is not checked, and cannot be: no member
 * carries the share of the target's figures attributable to one upstream.
 *
 * `undefined` when the two do not share that metric.
 */
function metricVerdict(subject: number | undefined, upstream: number | undefined): "consistent" | "under-reported" | undefined {
  if (typeof subject !== "number" || typeof upstream !== "number") return undefined;
  return subject < upstream * (1 - EPSILON) ? "under-reported" : "consistent";
}

/** The URI as the walk counts it: a fragment does not make a URI new. */
const withoutFragment = (url: URL): string => {
  const copy = new URL(url);
  copy.hash = "";
  return copy.toString();
};

/**
 * Walk the `upstream` entries of one declaration object and compare each with
 * it.
 *
 * `visited` carries every URI already retrieved in this walk, so a cycle is
 * refused rather than followed, and `budget` carries the total retrievals left
 * for this starting declaration, shared by every level. Both are the draft's
 * MUSTs, not options.
 */
export async function compareUpstream(
  subject: SustainabilityMetrics,
  options: UpstreamWalkOptions,
  visited: Set<string> = new Set(),
  depth = 1,
  budget: RetrievalBudget = {
    remaining: options.maxRetrievals ?? DEFAULT_MAX_UPSTREAM_RETRIEVALS,
    limit: options.maxRetrievals ?? DEFAULT_MAX_UPSTREAM_RETRIEVALS,
  },
): Promise<UpstreamComparison[]> {
  const entries = Array.isArray(subject.upstream) ? (subject.upstream as UpstreamEntry[]) : [];
  const maxDepth = Math.min(options.walkDepth ?? MAX_UPSTREAM_DEPTH, MAX_UPSTREAM_DEPTH);
  const period = subject.period;
  const periodText = `${period.start}/${period.end}`;
  const out: UpstreamComparison[] = [];

  for (const entry of entries) {
    const declaration = typeof entry?.declaration === "string" ? entry.declaration : "";
    const base: UpstreamComparison = {
      declaration,
      ...(typeof entry?.role === "string" ? { role: entry.role } : {}),
      depth,
      verdict: "unreachable",
      detail: "",
      period,
    };

    if (depth > maxDepth) {
      out.push({ ...base, detail: `not retrieved: the chain is limited to a depth of ${maxDepth}` });
      continue;
    }

    let url: URL;
    try {
      url = new URL(declaration, options.base);
    } catch {
      out.push({
        ...base,
        detail: options.base
          ? `refused: "${declaration}" is not a URI reference that resolves against ${options.base}`
          : `refused: "${declaration}" is not an absolute URI, and no retrieval URI was given to resolve it against`,
      });
      continue;
    }
    if (!options.allowInsecure && url.protocol !== "https:") {
      out.push({ ...base, detail: `refused: this consumer dereferences only https URIs (allowInsecure overrides, for local development)` });
      continue;
    }
    const key = withoutFragment(url);
    if (visited.has(key)) {
      out.push({ ...base, detail: "refused: already retrieved in this walk (a loop, or a declaration reached twice)" });
      continue;
    }
    // The retrieval bound: `upstream` may name many providers, so depth alone
    // would let a chain of conforming documents fan out without limit.
    if (budget.remaining <= 0) {
      out.push({ ...base, detail: `not retrieved: this walk has used its budget of ${budget.limit} retrievals for one starting declaration` });
      continue;
    }
    visited.add(key);
    budget.remaining--;

    const got = await retrieve(url, options);
    if (!got.ok) {
      out.push({ ...base, detail: `not retrieved: ${got.reason}` });
      continue;
    }
    // What the compatibility reading did to the retrieved declaration, so that
    // reading it exactly as any other is visible in the output.
    const converted = [...got.converted];
    const disregarded = [...got.disregarded];

    // The object for the same period: the same two instants, whatever their
    // spelling. A publisher that declares `extended` is asked for the period
    // directly; one that does not is taken at its answer, and only when that
    // answer is for the same period. Either way the object used is one whose
    // period IS the period asked about: a server ignores a parameter it does not
    // support, so what came back is compared with what was requested and never
    // recorded as covering a period it does not name.
    const samePeriod = (objects: SustainabilityMetrics[]) => {
      const matching = objects.filter((o) => canonicalKey(o.period) === canonicalKey(period));
      return matching.find((o) => o["target-type"] === "tenant") ?? matching[0];
    };
    let match = samePeriod(got.objects);
    let ignoredPeriodParameter = false;
    if (!match && got.objects.some((o) => o.capabilities === "extended")) {
      const scoped = new URL(url);
      scoped.searchParams.set("start", toUtcQueryValue(period.start));
      scoped.searchParams.set("end", toUtcQueryValue(period.end));
      const scopedKey = withoutFragment(scoped);
      if (!visited.has(scopedKey) && budget.remaining > 0) {
        visited.add(scopedKey);
        budget.remaining--;
        const extended = await retrieve(scoped, options);
        if (extended.ok) {
          converted.push(...extended.converted);
          disregarded.push(...extended.disregarded);
          match = samePeriod(extended.objects);
          ignoredPeriodParameter = match === undefined;
        }
      }
    }
    if (!match) {
      out.push({
        ...base,
        verdict: "not-comparable",
        detail:
          `the upstream publishes no declaration for ${periodText}` +
          (ignoredPeriodParameter ? ": it answered the period request with other periods, so nothing it served covers the period compared" : ""),
        subject: figuresOf(subject),
        ...(converted.length > 0 ? { upstreamConverted: converted } : {}),
        ...(disregarded.length > 0 ? { upstreamDisregarded: disregarded } : {}),
      });
      continue;
    }

    const subjectFigures = figuresOf(subject);
    const upstreamFigures = figuresOf(match);
    const targetType = typeof match["target-type"] === "string" ? (match["target-type"] as string) : undefined;
    const comparison: UpstreamComparison = {
      ...base,
      subject: subjectFigures,
      upstreamFigures,
      ...(targetType !== undefined ? { upstreamTargetType: targetType } : {}),
      ...(typeof match.target === "string" ? { upstreamTarget: match.target } : {}),
      ...(converted.length > 0 ? { upstreamConverted: converted } : {}),
      ...(disregarded.length > 0 ? { upstreamDisregarded: disregarded } : {}),
      verdict: "not-comparable",
      detail: "",
    };

    if (targetType !== "tenant") {
      // The comparison is defined only where the upstream publishes a tenant
      // declaration about what it delivers to this target. An upstream's own
      // totals are not that, so the declaration is reported as fetched and left
      // uncompared rather than measured against a rule that does not apply.
      comparison.detail =
        `retrieved, but not comparable: the upstream declaration for ${periodText} is not tenant-scoped ` +
        `(target-type ${targetType ?? "absent"}), so it states the upstream's own totals rather than what it ` +
        `delivers to this target, and no relation between the two is defined`;
    } else {
      // The two compared members, and only these two.
      const energy = metricVerdict(subjectFigures.energyKWh, upstreamFigures.energyKWh);

      // Carbon is comparable only where both objects declare the same
      // carbon-accounting value or neither does. Where they differ, the carbon
      // figures are left out of the verdict and the reason is reported; the
      // energy comparison, which no accounting method parameterizes, proceeds.
      const subjectBasis = accountingOf(subject);
      const upstreamBasis = accountingOf(match);
      const sameBasis = subjectBasis === upstreamBasis;
      const carbon = sameBasis ? metricVerdict(subjectFigures.carbonGCO2e, upstreamFigures.carbonGCO2e) : undefined;
      const carbonSkipped = !sameBasis && typeof subjectFigures.carbonGCO2e === "number" && typeof upstreamFigures.carbonGCO2e === "number";
      if (carbon !== undefined) comparison.carbonComparison = "compared";
      else if (carbonSkipped) comparison.carbonComparison = "skipped-different-accounting-basis";
      const basisNote = carbonSkipped
        ? `; carbon-footprint was not compared, because the target ${describeAccounting(subjectBasis)} and this ` +
          `upstream ${describeAccounting(upstreamBasis)}, and figures computed on different bases are not comparable`
        : "";

      const verdicts = [energy, carbon].filter((v): v is "consistent" | "under-reported" => v !== undefined);
      comparison.verdict = verdicts.length === 0 ? "not-comparable" : verdicts.includes("under-reported") ? "under-reported" : "consistent";
      comparison.detail =
        verdicts.length === 0
          ? `the two declarations share no comparable figure for ${periodText}${basisNote}`
          : comparison.verdict === "under-reported"
            ? `if the target's declared scope covers what this upstream delivers, its figures for ${periodText} cannot be less than ` +
              `the upstream states it delivered, and they are less: an inconsistency between two claims, to investigate and not a ` +
              `conformance failure. The format cannot say whether the scope covers this upstream, so a target that legitimately ` +
              `leaves it out reads the same way${basisNote}`
            : `the target's figures for ${periodText} are at least what this upstream states it delivered, so the two claims do ` +
              `not contradict each other if the target's scope covers it; that is all this shows, and neither claim is verified${basisNote}`;
    }

    if (depth < maxDepth) {
      const nested = await compareUpstream(match, { ...options, base: new URL(url) }, visited, depth + 1, budget);
      if (nested.length > 0) comparison.upstream = nested;
    } else if (Array.isArray(match.upstream) && match.upstream.length > 0) {
      comparison.upstream = match.upstream.map((e) => ({
        declaration: typeof (e as UpstreamEntry)?.declaration === "string" ? (e as UpstreamEntry).declaration : "",
        ...(typeof (e as UpstreamEntry)?.role === "string" ? { role: (e as UpstreamEntry).role as string } : {}),
        depth: depth + 1,
        verdict: "unreachable" as const,
        detail: `not retrieved: the chain is limited to a depth of ${maxDepth}`,
      }));
    }
    out.push(comparison);
  }

  return out;
}
