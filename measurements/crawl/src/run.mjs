/**
 * Schedules origins: `concurrency` at a time, each origin strictly sequential
 * inside probeOrigin. Results are committed in list order whatever order they
 * finish in, so the output file is the same on every run.
 */
import { probeOrigin } from "./probe.mjs";

const REQUESTS_PER_ORIGIN = 7; // robots.txt (twice at most), four paths, random path (redirect hops come on top)

/** Hosts still to do: the first `limit` of the list, minus the finished ones. */
export function pendingHosts(hosts, done, limit) {
  const window = Number.isFinite(limit) ? hosts.slice(0, limit) : hosts;
  return window.filter((h) => !done.has(h));
}

/** Writes finished origins in list order, one at a time (a queue, so two finishers never write together). */
function createCommitter(pending, store) {
  const finished = new Map();
  let next = 0;
  let queue = Promise.resolve();
  async function flush() {
    while (finished.has(next)) {
      const index = next++;
      const records = finished.get(index);
      finished.delete(index);
      await store.commit(pending[index], records);
    }
  }
  return function commit(index, records) {
    finished.set(index, records);
    queue = queue.then(flush);
    return queue.then(() => next);
  };
}

/**
 * @param {{pending: string[], store: object, probeDeps: object, concurrency: number,
 *          maxRequests: number, shouldStop?: () => boolean, onProgress?: (n:number)=>void}} job
 */
export async function runCrawl(job) {
  const { pending, store, probeDeps, concurrency, maxRequests } = job;
  const commit = createCommitter(pending, store);
  let cursor = 0;
  let committed = 0;
  let inFlight = 0;
  // Conservative: every origin in flight is charged its full seven requests on top of those made.
  const hasBudget = () => probeDeps.requests.count + REQUESTS_PER_ORIGIN * (inFlight + 1) <= maxRequests;
  const mayStart = () => cursor < pending.length && hasBudget() && !job.shouldStop?.();
  async function worker() {
    while (mayStart()) {
      const index = cursor++;
      inFlight++;
      const records = await probeOrigin(pending[index], probeDeps);
      inFlight--;
      committed = await commit(index, records);
      job.onProgress?.(committed);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { committed, remaining: pending.length - committed, requests: probeDeps.requests.count };
}
