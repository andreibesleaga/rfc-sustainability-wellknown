/**
 * Schedules origins: `concurrency` at a time, each origin strictly sequential
 * inside probeOrigin. Results are committed in list order whatever order they
 * finish in, so the output file is the same on every run.
 */
import { RequestBudgetExceeded, probeOrigin } from "./probe.mjs";

const REQUESTS_PER_ORIGIN = 7; // robots.txt (twice at most), four paths, random path (redirect hops come on top; the hard cap in probeOrigin covers them)

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

/** The records of one origin, or null when the hard request cap cut it short. */
async function probeOrFinish(host, probeDeps) {
  try {
    return await probeOrigin(host, probeDeps);
  } catch (err) {
    if (err instanceof RequestBudgetExceeded) return null;
    throw err;
  }
}

/**
 * @param {{pending: string[], store: object, probeDeps: object, concurrency: number,
 *          maxRequests: number, shouldStop?: () => boolean, onProgress?: (n:number)=>void}} job
 */
export async function runCrawl(job) {
  const { pending, store, concurrency, maxRequests } = job;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
  const probeDeps = { ...job.probeDeps, maxRequests }; // the hard cap: every request actually sent is counted
  const commit = createCommitter(pending, store);
  let cursor = 0;
  let committed = 0;
  let inFlight = 0;
  // Soft gate, conservative: every origin in flight is charged its full seven requests on top of those made.
  const hasBudget = () => probeDeps.requests.count + REQUESTS_PER_ORIGIN * (inFlight + 1) <= maxRequests;
  const mayStart = () => cursor < pending.length && hasBudget() && !job.shouldStop?.();
  async function worker() {
    while (mayStart()) {
      const index = cursor++;
      inFlight++;
      const records = await probeOrFinish(pending[index], probeDeps);
      inFlight--;
      if (!records) return; // cut by the hard cap: not committed, crawled afresh on the next run
      committed = await commit(index, records);
      job.onProgress?.(committed);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { committed, remaining: pending.length - committed, requests: probeDeps.requests.count };
}
