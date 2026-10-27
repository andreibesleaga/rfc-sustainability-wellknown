/** The per-check time limit of section 10 (seconds per check), with a clock the caller can replace. */

/** Thrown when the check ran longer than its limit; the stage that was running becomes NOT-EVALUABLE with the limit named. */
export class CheckLimit extends Error {
  constructor(limit) {
    super(`limit: ${limit}`);
    this.limit = limit;
  }
}

const monotonicMs = () => performance.now();

/**
 * A function that throws CheckLimit once `seconds` have passed since this call. `clock` returns milliseconds
 * and defaults to performance.now; a test passes a fake clock, so no test depends on wall-clock time.
 */
export function startDeadline(seconds, clock = monotonicMs) {
  const started = clock();
  return () => {
    if (clock() - started > seconds * 1000) throw new CheckLimit("seconds per check");
  };
}
