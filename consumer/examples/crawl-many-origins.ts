/**
 * Illustrative multi-origin script — NOT a shipped feature (a built-in crawler
 * is a non-goal). Shows how an aggregator would be built ON TOP of this
 * library: fetch each origin's declaration, report failures individually (one
 * bad origin must not abort the batch), keep every figure with the origin that
 * claims it, and add figures only where the draft allows it (Section 5.3):
 * objects of one target, with periods that do not overlap and one
 * `carbon-accounting` value or none. Different origins have different
 * targets, so the objects are grouped by target before they are added.
 *
 * A production crawler would add: concurrency limiting, politeness/rate
 * limiting per origin, persistence of ETags across runs, and retry/backoff,
 * all deliberately out of scope here to keep the illustration readable.
 *
 * Run: npx tsx examples/crawl-many-origins.ts origin1.example origin2.example ...
 */
import { fetchSustainability, SustainabilityMetrics, total, TotalPreconditionError } from "../src/index";

async function crawl(origins: string[]) {
  const claims: Array<{ origin: string; object: SustainabilityMetrics }> = [];
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

  const byTarget = new Map<string, SustainabilityMetrics[]>();
  for (const { object } of claims) byTarget.set(object.target, [...(byTarget.get(object.target) ?? []), object]);

  for (const [target, objects] of byTarget) {
    try {
      console.log(`Total for ${target}:`);
      console.log(JSON.stringify(total(objects), null, 2));
    } catch (err) {
      // Overlapping periods, or accounting methods that differ: never added.
      if (!(err instanceof TotalPreconditionError)) throw err;
      console.error(`  not added (${err.reason}): ${err.message}`);
    }
  }
}

const origins = process.argv.slice(2);
if (origins.length === 0) {
  console.error("Usage: crawl-many-origins.ts <origin1> [origin2] ...");
  process.exit(2);
}
crawl(origins).catch((err) => {
  console.error(err);
  process.exit(1);
});
