/**
 * The upstream chain (draft -07 §Upstream Declarations).
 *
 * A subject's figures commonly derive in part from what other providers
 * deliver to it, and the OPTIONAL `upstream` member names those providers'
 * declarations. A consumer that retrieves them "MUST NOT follow a chain deeper
 * than three declarations below the one it started from, MUST refuse any URI
 * it has already retrieved during the walk, MUST bound the total number of
 * retrievals it performs for one starting declaration, and applies the fetch
 * limits of Consumer Considerations to each". All four bounds are enforced
 * here: {@link MAX_UPSTREAM_DEPTH}, the `visited` set,
 * {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}, and `secureGet`. The retrieval
 * budget is not redundant with the depth limit: `upstream` may carry many
 * entries, so three levels of a wide fan-out is an enormous number of requests
 * built entirely out of conforming documents.
 *
 * HOW A RETRIEVED DECLARATION IS READ: exactly as any other. The draft says
 * so — "It reads a retrieved declaration exactly as it reads any other,
 * applying the tolerance rules of Value Constraints and Omitted Metrics rather
 * than refusing one over a defective value" — so `retrieve` runs the same
 * tolerance pre-pass the ordinary fetch path runs (the shared
 * `applyToleranceRules`), and what it disregarded is reported in
 * {@link UpstreamComparison.upstreamDisregarded}. An upstream carrying an
 * unrecognized `carbon-accounting` value is therefore retrieved and compared
 * with that member disregarded, not reported unreachable — the same document
 * fetched directly would be read, and one reading is what the draft asks for.
 * Tolerance stops where readability does: an upstream that is not a
 * declaration at all, or that omits a mandatory member, is still reported as
 * not retrieved.
 *
 * WHERE THE COMPARISON IS DEFINED: only where the upstream publishes a
 * declaration about what it delivers to this subject — "one whose
 * `target-type` is `tenant`, cited by the URI in the `upstream` entry, which
 * is the only identifier this document defines for that relationship". For
 * that declaration, for the same `reporting-period` and after conversion to a
 * single unit, "a subject whose declared scope covers what that upstream
 * delivers cannot report less energy, or fewer emissions, than the upstream
 * states it delivered". A subject that reports less has been found
 * `under-reported` against its own provider's tenant figures. Where an
 * upstream publishes "only its own totals rather than a tenant-scoped
 * declaration, no relation is defined at all" — such a declaration is reported
 * as fetched and `not-comparable`.
 *
 * WHAT IS COMPARED: `energy-consumption` and `carbon-footprint`, those two and
 * no other member. Every other member is read for context (the units, the
 * period, `target-type`, `carbon-accounting`) or not read at all; nothing else
 * takes part in a verdict.
 *
 * WHAT THE COMPARISON IS: it is "the only relation defined here", it "is
 * deliberately loose", and "no such comparison is proof of either claim". Both
 * numbers are published by the party they flatter; nothing here measures
 * anything, and a `consistent` verdict says only that the two published
 * figures do not contradict each other for that period. The draft names four
 * limits, and each one is visible in the output rather than papered over:
 *
 *  1. "Whether a subject's declared scope covers a given upstream is not
 *     expressible in this format, so a subject that legitimately excludes one
 *     will read as inconsistent, and the finding is something to investigate
 *     rather than a failure to conform." Every `under-reported` detail says
 *     exactly that, so no reader of this output can take the verdict for a
 *     breach of the draft.
 *  2. "No member carries the share of a subject's figures attributable to one
 *     upstream, so the converse — that the subject has not claimed more than
 *     the upstream delivered — cannot be checked at all." It is not checked
 *     here, and a subject reporting far more than one upstream delivered is
 *     exactly what a subject with other upstreams looks like.
 *  3. "Each `upstream` entry is compared on its own, and no relation is
 *     defined over several of them together." One {@link UpstreamComparison}
 *     per entry, each standing alone: nothing here sums, averages or otherwise
 *     combines entries, and a list of `consistent` verdicts says nothing about
 *     the set of upstreams as a whole.
 *  4. "Figures computed on different bases are not comparable, so a consumer
 *     compares `carbon-footprint` only where both objects declare the same
 *     `carbon-accounting` value or neither declares one." When the two
 *     disagree, or one declares a basis and the other does not, the carbon
 *     comparison is skipped — `carbonComparison` records it and the detail
 *     string names both bases — while the energy comparison proceeds. If that
 *     leaves nothing comparable the verdict is `not-comparable`, and the
 *     detail says why.
 *
 * Retrieval is never automatic: `fetchSustainability` walks the chain only
 * when the caller passes `followUpstream` (CLI: `--upstream`). Every fetch
 * goes through `secureGet`, so HTTPS is required on every hop, the body is
 * read under a byte cap, and the object count is bounded — an upstream chain
 * cannot be used for amplification.
 */
import { classifyMediaType, ACCEPT_HEADER } from "./media-type";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { AddressLookup, BodyTooLargeError, discardBody, isAbortOrTimeout, readBodyCapped, secureGet } from "./transport";
import { applyToleranceRules } from "./sentinel";
import { SustainabilityMetrics, UpstreamComparison, UpstreamEntry } from "./types";
import { convertCarbon, convertEnergy } from "./units";
import { carriesAtLeastOne, validateDocument } from "./validate";

/** The draft's limit: never "deeper than three declarations below the one it started from". */
export const MAX_UPSTREAM_DEPTH = 3;

/**
 * Default bound on the TOTAL number of upstream declarations retrieved for one
 * starting declaration (draft -07 §Upstream Declarations and §Consumer
 * Considerations: a consumer walking the chain "applies the depth, revisit, and
 * total-retrieval limits of Upstream Declarations, so that a chain of
 * declarations cannot be turned into an amplifier"; -07 moved the bounds into
 * Upstream Declarations and dropped the separate "breadth" limit, which this
 * package bounds through the total-retrieval budget below).
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
 * Draft -07 §Upstream Declarations sanctions it: a consumer "disregards a
 * shortfall no larger than the rounding and unit conversion behind the two
 * figures could account for". This takes only the unit-conversion part of that
 * allowance — 1e-9 is some six orders of magnitude above the double-precision
 * error a kWh/MWh or gCO2e/mtCO2e conversion can introduce (~1e-16 relative
 * per operation), so two figures that are equal before conversion never read
 * as a shortfall after it.
 *
 * It deliberately does NOT try to take the rounding part as well. A consumer
 * sees two parsed numbers, not the precision each publisher rounded at, so any
 * wider band would be a guess — and every widening forgives a real shortfall
 * of that size. A band narrower than the draft allows can only report a
 * shortfall the draft would have let pass, which is a finding "to investigate
 * rather than a failure to conform"; a wider one would hide a real one.
 */
const EPSILON = 1e-9;

export interface UpstreamWalkOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  maxBytes: number;
  maxObjects: number;
  allowInsecure?: boolean;
  /**
   * Opt out of refusing an upstream URI that resolves to a loopback, private,
   * link-local, unique-local or unspecified address (default: the value of
   * `allowInsecure`). An `upstream[].declaration` is the most exposed URI the
   * draft defines — it is written by another origin and followed automatically
   * once the walk is asked for — so the address check matters most here.
   */
  allowPrivateAddresses?: boolean;
  /** Resolver for the address check; see {@link AddressLookup}. */
  lookup?: AddressLookup;
  /**
   * The tolerance pre-pass, as on the ordinary fetch path (default true;
   * `fetchSustainability` passes its own `legacyCompat` through, so one
   * strictness setting governs the whole walk). With it on, a retrieved
   * declaration is read "exactly as [the consumer] reads any other, applying
   * the tolerance rules of Value Constraints and Omitted Metrics rather than
   * refusing one over a defective value" (draft -07 §Upstream Declarations).
   * False validates every retrieved declaration exactly as served, so a
   * defective value makes that upstream `unreachable`.
   */
  legacyCompat?: boolean;
  /** Default {@link MAX_UPSTREAM_DEPTH}; never raised above it. */
  maxDepth?: number;
  /**
   * Total retrievals allowed for one starting declaration, across every level
   * of the walk (default {@link DEFAULT_MAX_UPSTREAM_RETRIEVALS}). Once it is
   * exhausted the remaining entries are reported `unreachable` rather than
   * fetched.
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
  if (typeof energy === "number" && energy >= 0) out.energyKWh = convertEnergy(energy, m["energy-unit"] ?? "kWh", "kWh");
  const carbon = m["carbon-footprint"];
  if (typeof carbon === "number" && carbon >= 0) out.carbonGCO2e = convertCarbon(carbon, m["carbon-unit"] ?? "gCO2e", "gCO2e");
  return out;
}

/** The values of `carbon-accounting` this revision defines (a closed set). */
const CARBON_ACCOUNTING_VALUES: readonly string[] = RESPONSE_JTD_SCHEMA.optionalProperties["carbon-accounting"].enum;

/**
 * The accounting basis a declaration object declares for its
 * `carbon-footprint`, or `undefined` when it declares none.
 *
 * An unrecognized value is `undefined` too, not a basis of its own: the draft
 * (§Value Constraints and Omitted Metrics) says an unrecognized
 * `carbon-accounting` "causes that member to be disregarded", so such an
 * object is processed as though the member were absent — here as one that
 * "declares no basis", which compares equal to another object that declares
 * none.
 */
function accountingOf(m: SustainabilityMetrics): string | undefined {
  const value = m["carbon-accounting"];
  return typeof value === "string" && CARBON_ACCOUNTING_VALUES.includes(value) ? value : undefined;
}

/** How a declaration's accounting basis reads in a detail string. */
function describeAccounting(basis: string | undefined): string {
  return basis === undefined ? "declares no carbon-accounting" : `declares carbon-accounting ${basis}`;
}

function objectsOf(doc: unknown): SustainabilityMetrics[] {
  return (Array.isArray(doc) ? doc : [doc]) as SustainabilityMetrics[];
}

type Retrieved =
  | { ok: true; objects: SustainabilityMetrics[]; disregarded: string[] }
  | { ok: false; reason: string };

/** GET one declaration by absolute URI, under the same bounds as the main fetch. */
async function retrieve(url: URL, options: UpstreamWalkOptions): Promise<Retrieved> {
  const got = await secureGet(url, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    allowInsecure: options.allowInsecure,
    allowPrivateAddresses: options.allowPrivateAddresses,
    lookup: options.lookup,
    headers: { Accept: ACCEPT_HEADER },
  });
  // A safety refusal says WHY in its detail — which address the name resolved
  // to — and that belongs in the verdict, since "unreachable" alone would read
  // as the upstream being down rather than deliberately not followed.
  if (!got.ok) {
    const { reason, detail } = got.refusal;
    return {
      ok: false,
      reason: reason === "blocked-address" || reason === "userinfo-in-uri" ? `${reason} (${detail ?? ""})` : reason,
    };
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  const objects = objectsOf(parsed);
  if (objects.length > options.maxObjects) return { ok: false, reason: "too-many-objects" };

  // Draft -07 §Upstream Declarations: "It reads a retrieved declaration
  // exactly as it reads any other, applying the tolerance rules of Value
  // Constraints and Omitted Metrics rather than refusing one over a defective
  // value." So the same pre-pass the ordinary fetch path runs (fetch.ts, via
  // the shared `applyToleranceRules`) runs here, before the schema gate: an
  // upstream carrying an unrecognized `carbon-accounting` value, a wrong-typed
  // optional member or a `sci-score` without `functional-unit` is read with
  // that member disregarded and still compared, exactly as the same document
  // fetched directly would be. Tolerance never manufactures a readable
  // declaration: a body that is not a declaration at all, or one missing a
  // mandatory member, still fails validation below and is reported as not
  // retrieved.
  //
  // As on the fetch path, the at-least-one rule is "judged on the members the
  // object carries as served", so the verdict is taken before the pre-pass and
  // carried into validateDocument().
  const disregarded: string[] = [];
  let atLeastOneAsServed: boolean[] | undefined;
  if (options.legacyCompat !== false) {
    atLeastOneAsServed = objects.map((o) => carriesAtLeastOne(o));
    objects.forEach((o, i) => applyToleranceRules(o, Array.isArray(parsed) ? `[${i}].` : "", disregarded));
  }

  const check = validateDocument(parsed, atLeastOneAsServed ? { atLeastOneAsServed } : {});
  if (!check.valid) return { ok: false, reason: `invalid (${check.errors[0] ?? "validation failed"})` };
  return { ok: true, objects, disregarded };
}

/**
 * Compare one metric pair, in the direction the draft defines: for the same
 * `reporting-period`, and after conversion to a single unit, "a subject whose
 * declared scope covers what that upstream delivers cannot report less energy,
 * or fewer emissions, than the upstream states it delivered".
 *
 * So the subject's own figure is compared with what the upstream says it
 * delivered to this tenant: at least as much is `consistent`, and less is
 * `under-reported` — the subject reports less than its own provider says it
 * supplied, which is "an inconsistency between two self-asserted claims, and
 * nothing more".
 *
 * The converse is not checked, and cannot be: no member carries the share of
 * the subject's figures attributable to one upstream, so a subject reporting
 * far more than this upstream delivered is exactly what a subject with other
 * upstreams, or with figures of its own, looks like.
 *
 * `undefined` when the two do not share that metric.
 */
function metricVerdict(subject: number | undefined, upstream: number | undefined): "consistent" | "under-reported" | undefined {
  if (typeof subject !== "number" || typeof upstream !== "number") return undefined;
  // The draft's rounding allowance: a consumer "disregards a shortfall no
  // larger than the rounding and unit conversion behind the two figures could
  // account for" — see {@link EPSILON}.
  return subject < upstream * (1 - EPSILON) ? "under-reported" : "consistent";
}

/**
 * Walk the `upstream` entries of one declaration object and compare each with
 * it.
 *
 * `visited` carries every URI already retrieved in this walk, so a cycle is
 * refused rather than followed, and `budget` carries the total retrievals left
 * for this starting declaration, shared by every level — both are the draft's
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
  const maxDepth = Math.min(options.maxDepth ?? MAX_UPSTREAM_DEPTH, MAX_UPSTREAM_DEPTH);
  const period = subject["reporting-period"];
  const out: UpstreamComparison[] = [];

  for (const entry of entries) {
    const declaration = typeof entry?.declaration === "string" ? entry.declaration : "";
    const base: UpstreamComparison = {
      declaration,
      ...(typeof entry?.role === "string" ? { role: entry.role } : {}),
      depth,
      verdict: "unreachable",
      detail: "",
      reportingPeriod: period,
    };

    if (depth > maxDepth) {
      out.push({ ...base, detail: `not retrieved: the chain is limited to a depth of ${maxDepth}` });
      continue;
    }

    let url: URL;
    try {
      url = new URL(declaration);
    } catch {
      out.push({ ...base, detail: `refused: "${declaration}" is not an absolute URI` });
      continue;
    }
    if (!options.allowInsecure && url.protocol !== "https:") {
      out.push({ ...base, detail: `refused: the draft restricts upstream declarations to the "https" scheme` });
      continue;
    }
    const key = url.toString();
    if (visited.has(key)) {
      out.push({ ...base, detail: "refused: already retrieved in this chain (a loop)" });
      continue;
    }
    // The breadth bound: `upstream` may name many providers, so depth alone
    // would let a chain of conforming documents fan out without limit.
    if (budget.remaining <= 0) {
      out.push({
        ...base,
        detail:
          `not retrieved: this walk has used its budget of ${budget.limit} retrievals for one starting declaration`,
      });
      continue;
    }
    visited.add(key);
    budget.remaining--;

    const got = await retrieve(url, options);
    if (!got.ok) {
      out.push({ ...base, detail: `not retrieved: ${got.reason}` });
      continue;
    }
    // What the tolerance pre-pass disregarded in the retrieved declaration, so
    // that reading it "exactly as [a consumer] reads any other" is visible in
    // the output rather than silent.
    const disregarded = [...got.disregarded];

    // Select the upstream entry covering the same reporting period. A
    // publisher that supports the Extended parameters is asked for the period
    // directly; one that does not is taken at its Basic response, and only
    // when that response is for the same period. Either way the object used is
    // one whose `reporting-period` IS the period asked about: a server ignores
    // a parameter it does not support, so what came back is compared with what
    // was requested and never recorded as covering a period it does not name
    // (§Extended Query Parameters).
    let match = got.objects.find((o) => o["reporting-period"] === period);
    let ignoredPeriodParameter = false;
    if (!match && got.objects.some((o) => o.capabilities === "extended") && period) {
      const scoped = new URL(url.toString());
      scoped.searchParams.set("period", period);
      const scopedKey = scoped.toString();
      if (!visited.has(scopedKey) && budget.remaining > 0) {
        visited.add(scopedKey);
        budget.remaining--;
        const extended = await retrieve(scoped, options);
        if (extended.ok) {
          disregarded.push(...extended.disregarded);
          match = extended.objects.find((o) => o["reporting-period"] === period);
          ignoredPeriodParameter = match === undefined;
        }
      }
    }
    if (!match) {
      out.push({
        ...base,
        verdict: "not-comparable",
        detail:
          `the upstream publishes no declaration for ${period}` +
          (ignoredPeriodParameter
            ? ": it answered the period request with another period, so nothing it served covers the period compared"
            : ""),
        subject: figuresOf(subject),
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
      ...(disregarded.length > 0 ? { upstreamDisregarded: disregarded } : {}),
      verdict: "not-comparable",
      detail: "",
    };

    if (targetType !== "tenant") {
      // Draft -07 §Upstream Declarations: the comparison is defined only where
      // the upstream publishes a declaration about what it delivers to this
      // subject — `target-type: tenant`. "Where an upstream publishes only its
      // own totals rather than a tenant-scoped declaration, no relation is
      // defined at all", so the declaration is reported as fetched and left
      // uncompared rather than measured against a rule that does not exist.
      comparison.detail =
        `retrieved, but not comparable: the upstream declaration for ${period} is not tenant-scoped ` +
        `(target-type ${targetType ?? "absent"}), so it states the upstream's own totals rather than what it ` +
        `delivers to this subject, and the draft defines no arithmetic relation between the two`;
    } else {
      // The two compared members, and only these two.
      const energy = metricVerdict(subjectFigures.energyKWh, upstreamFigures.energyKWh);

      // Draft -07 §Upstream Declarations: "figures computed on different bases
      // are not comparable, so a consumer compares `carbon-footprint` only
      // where both objects declare the same `carbon-accounting` value or
      // neither declares one". Where they differ, the carbon figures are left
      // out of the verdict and the reason is reported; the energy comparison,
      // which no accounting basis parameterizes, proceeds either way.
      const subjectBasis = accountingOf(subject);
      const upstreamBasis = accountingOf(match);
      const sameBasis = subjectBasis === upstreamBasis;
      const carbon = sameBasis ? metricVerdict(subjectFigures.carbonGCO2e, upstreamFigures.carbonGCO2e) : undefined;
      const carbonSkipped =
        !sameBasis &&
        typeof subjectFigures.carbonGCO2e === "number" &&
        typeof upstreamFigures.carbonGCO2e === "number";
      if (carbon !== undefined) comparison.carbonComparison = "compared";
      else if (carbonSkipped) comparison.carbonComparison = "skipped-different-accounting-basis";
      const basisNote = carbonSkipped
        ? `; \`carbon-footprint\` was not compared, because the subject ${describeAccounting(subjectBasis)} and ` +
          `this upstream ${describeAccounting(upstreamBasis)}, and figures computed on different bases are not comparable`
        : "";

      const verdicts = [energy, carbon].filter((v): v is "consistent" | "under-reported" => v !== undefined);
      comparison.verdict =
        verdicts.length === 0 ? "not-comparable" : verdicts.includes("under-reported") ? "under-reported" : "consistent";
      comparison.detail =
        verdicts.length === 0
          ? `the two declarations share no comparable figure for ${period}${basisNote}`
          : comparison.verdict === "under-reported"
            ? `the subject's own total for ${period} is less than the figures this upstream states it delivered to ` +
              `the tenant, so the subject reports less than its own provider says it supplied ` +
              `(evidence about consistency between two self-asserted claims, never proof). Whether the subject's ` +
              `declared scope covers what this upstream delivers cannot be expressed in this format, so a subject ` +
              `that legitimately leaves this upstream out of its own figures reads the same way: this is something ` +
              `to investigate, not a failure to conform${basisNote}`
            : `the subject's own total for ${period} is at least the figures this upstream states it delivered to ` +
              `the tenant, so the subject reports no less than its own provider says it supplied ` +
              `(evidence about consistency between two self-asserted claims, never proof)${basisNote}`;
    }

    if (depth < maxDepth) {
      const nested = await compareUpstream(match, options, visited, depth + 1, budget);
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
