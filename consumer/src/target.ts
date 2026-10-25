/**
 * Equality of two `target` values (draft -10 §Optional Members, `target`): a
 * target is compared as a string, after JSON escapes are decoded, and where
 * `target-type` is `origin` or the value is otherwise a host name, the host is
 * compared case-insensitively. The values here are parsed JSON strings, so the
 * escapes are already decoded. The comparison of a signature's payload with
 * the object around it is NOT this one: that one is "as strings", exactly.
 */

/** A host name (an A-label form is ASCII), with an optional port: dotted labels of letters, digits and hyphens. */
const HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+\.?(?::\d{1,5})?$/;

/** Whether `value` is a host name, or `targetType` says it names an origin. */
export function isHostTarget(value: string, targetType?: unknown): boolean {
  return targetType === "origin" || HOST_NAME.test(value);
}

/** Whether two target values name the same target; `targetType` is the `target-type` of the objects, when known. */
export function targetsEqual(a: unknown, b: unknown, targetType?: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return a === b;
  if (a === b) return true;
  return isHostTarget(a, targetType) && isHostTarget(b, targetType) && a.toLowerCase() === b.toLowerCase();
}
