/**
 * The per-check time limit of section 10 (seconds per check), with a clock the caller can replace.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (section 10, Limits)
 */

/** Thrown when the check ran longer than its limit; the stage that was running becomes NOT-EVALUABLE with the limit named. */
export class CheckLimit extends Error {
  constructor(readonly limit: string) {
    super(`limit: ${limit}`);
    this.name = "CheckLimit";
  }
}

/** Milliseconds from a monotonic clock. */
export type Clock = () => number;

const monotonicMs: Clock = () => performance.now();

/**
 * A function that throws CheckLimit once `seconds` have passed since this call. `clock` returns
 * milliseconds and defaults to the monotonic clock; a test passes a fake clock, so no test depends on wall-clock time.
 */
export function startDeadline(seconds: number, clock: Clock = monotonicMs): () => void {
  const started = clock();
  return () => {
    if (clock() - started > seconds * 1000) throw new CheckLimit("seconds per check");
  };
}
