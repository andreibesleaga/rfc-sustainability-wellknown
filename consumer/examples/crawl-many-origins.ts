/**
 * Illustrative multi-origin script — NOT a shipped feature (a built-in crawler
 * is a non-goal). Shows how an aggregator would be built ON TOP of this
 * library: fetch each origin's declaration, report failures individually (one
 * bad origin must not abort the batch), keep every figure with the origin that
 * claims it, and add figures only under the rule `total()` implements:
 * objects of one target, with periods that do not overlap and one
 * `carbon-accounting` value or none. A claim is the claim of the origin that
 * served it, so the objects are grouped by origin and target, and one origin's
 * claims are never added to another's.
 *
 * A production crawler would add: concurrency limiting, politeness/rate
 * limiting per origin, persistence of ETags across runs, and retry/backoff,
 * all deliberately out of scope here to keep the illustration readable.
 *
 * Run: npx tsx examples/crawl-many-origins.ts origin1.example origin2.example ...
 */
import { fetchSustainability, SustainabilityMetrics, total, TotalPreconditionError } from "../src/index";
import { targetsEqual } from "../src/target";

export interface Claim {
  origin: string;
  object: SustainabilityMetrics;
}

/** The claims of one origin about one target, in the order they were fetched. */
export interface ClaimGroup {
  origin: string;
  target: string;
  objects: SustainabilityMetrics[];
}

/** Group claims by the origin that made them and the target they are about (host names compare case-insensitively). */
export function groupClaims(claims: Claim[]): ClaimGroup[] {
  const groups: ClaimGroup[] = [];
  for (const { origin, object } of claims) {
    const group = groups.find((g) => g.origin === origin && targetsEqual(g.target, object.target, object["target-type"]));
    if (group) group.objects.push(object);
    else groups.push({ origin, target: object.target, objects: [object] });
  }
  return groups;
}

async function crawl(origins: string[]) {
  const claims: Claim[] = [];
  const failed: Array<{ origin: string; reason: string }> = [];

  for (const origin of origins) {
    const result = await fetchSustainability(origin);
    if (result.status !== "ok") {
      failed.push({ origin, reason: result.status });
      continue;
    }
    // Every object is a claim of the origin that served it, with the period it
    // names, whatever was asked for. An empty array holds nothing to keep.
    for (const object of Array.isArray(result.document) ? result.document : [result.document]) {
      claims.push({ origin: new URL(result.url).origin, object });
    }
  }

  console.log(`Fetched ${origins.length - failed.length}/${origins.length} origins successfully.`);
  for (const f of failed) console.error(`  skipped ${f.origin}: ${f.reason}`);

  for (const { origin, target, objects } of groupClaims(claims)) {
    try {
      console.log(`Total of ${origin}'s claims for ${target}:`);
      console.log(JSON.stringify(total(objects), null, 2));
    } catch (err) {
      // Overlapping periods, or accounting methods that differ: never added.
      if (!(err instanceof TotalPreconditionError)) throw err;
      console.error(`  not added (${err.reason}): ${err.message}`);
    }
  }
}

if (require.main === module) {
  const origins = process.argv.slice(2);
  if (origins.length === 0) {
    console.error("Usage: crawl-many-origins.ts <origin1> [origin2] ...");
    process.exit(2);
  }
  crawl(origins).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
