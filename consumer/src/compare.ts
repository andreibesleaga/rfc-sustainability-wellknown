/**
 * Structural comparison of two declaration objects.
 *
 * Two places in -07 need it and need it to mean the same thing: the `signed`
 * member (is the object around the signature the object that was signed?) and
 * the attestation credential (does the copy the issuer signed match the object
 * served?). Both compare JSON values, so the comparison is JSON's: member
 * order is irrelevant, array order is not, and numbers compare by value.
 */

/** A copy of a declaration object without its `signed` member — what a JWS payload is. */
export function withoutSigned(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return obj;
  const { signed: _signed, ...rest } = obj as Record<string, unknown>;
  return rest;
}

/**
 * Deep structural equality of two JSON values.
 *
 * Written with an explicit work stack rather than recursion. The values
 * compared here come off the wire — a declaration object and the payload of
 * its own `signed` member — and `extensions` values are unconstrained JSON, so
 * an origin can nest one thousands of levels deep. A recursive comparison
 * would exhaust the call stack on such a document and throw `RangeError` out of
 * `verifyEmbeddedSignature`, which promises never to throw; the loop below is
 * bounded by the heap instead, so a hostile document is compared and reported,
 * not crashed on.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[a, b]];
  while (pending.length > 0) {
    const [x, y] = pending.pop() as [unknown, unknown];
    if (x === y) continue;
    if (typeof x !== typeof y) return false;
    if (x === null || y === null) return false;
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) pending.push([x[i], y[i]]);
      continue;
    }
    if (typeof x !== "object") return false;
    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    const xk = Object.keys(xo);
    if (xk.length !== Object.keys(yo).length) return false;
    for (const k of xk) {
      if (!Object.prototype.hasOwnProperty.call(yo, k)) return false;
      pending.push([xo[k], yo[k]]);
    }
  }
  return true;
}

/** The member paths at which two JSON objects differ, for a human-readable detail string. */
export function differingMembers(a: unknown, b: unknown, prefix = ""): string[] {
  if (deepEqual(a, b)) return [];
  const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [prefix || "(value)"];
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  const out: string[] = [];
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) out.push(prefix ? `${prefix}.${k}` : k);
  }
  return out;
}
