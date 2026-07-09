/**
 * Illustrative multi-origin aggregation script — NOT a shipped feature (see
 * PLAN.md §2 Non-goals: no built-in crawler). Shows how a real aggregator
 * would be built ON TOP of this library: fetch each origin's Basic document,
 * skip/report failures individually (one bad origin must not abort the
 * batch), and combine the successes into one summary.
 *
 * A production crawler would add: concurrency limiting, politeness/rate
 * limiting per origin, persistence of ETags across runs, and retry/backoff —
 * all deliberately out of scope here to keep the illustration readable.
 *
 * Run: npx tsx examples/crawl-many-origins.ts origin1.example origin2.example ...
 */
import { fetchSustainability, aggregate, SustainabilityMetrics } from "../src/index";

async function crawl(origins: string[]) {
  const succeeded: SustainabilityMetrics[] = [];
  const failed: Array<{ origin: string; reason: string }> = [];

  for (const origin of origins) {
    const result = await fetchSustainability(origin);
    if (result.status === "ok" && !Array.isArray(result.document)) {
      succeeded.push(result.document);
    } else if (result.status === "ok") {
      // A trend array at the Basic request path would itself be a conformance
      // problem (see conformance.ts) — but don't let one bad origin abort the batch.
      failed.push({ origin, reason: "Basic request unexpectedly returned an array" });
    } else {
      failed.push({ origin, reason: result.status });
    }
  }

  console.log(`Fetched ${succeeded.length}/${origins.length} origins successfully.`);
  for (const f of failed) console.error(`  skipped ${f.origin}: ${f.reason}`);

  if (succeeded.length > 0) {
    // Only combine origins already using the same units, or convert first —
    // aggregate() will normalize to the first entry's units by default.
    const summary = aggregate(succeeded, { by: "sum" });
    console.log("Combined footprint across all successfully-fetched origins:");
    console.log(JSON.stringify(summary, null, 2));
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
