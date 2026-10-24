/**
 * Reading the body of a response as a declaration document: strict I-JSON
 * (`parseStrict`) within a bound on how deeply the value nests. The bound is
 * the consumer's own (draft -10 §Security Considerations: a body that is
 * "deeply nested" is one of the things a consumer limits); an excess is an
 * error, and no part of the body is used.
 */
import { parseStrict } from "./json";

/** Default bound on how deeply a body may nest, counting the outermost array or object as 1. */
export const DEFAULT_MAX_DEPTH = 32;

/** How deeply `value` nests: a scalar is 0, an object or array one more than its deepest member. Iterative, so a hostile body cannot exhaust the stack here. */
export function nestingDepth(value: unknown): number {
  let deepest = 0;
  const pending: Array<[unknown, number]> = [[value, 0]];
  while (pending.length > 0) {
    const [v, depth] = pending.pop() as [unknown, number];
    if (typeof v !== "object" || v === null) continue;
    deepest = Math.max(deepest, depth + 1);
    for (const child of Array.isArray(v) ? v : Object.values(v)) pending.push([child, depth + 1]);
  }
  return deepest;
}

/** The parsed value of `text`, or why it is not usable. */
export function parseBody(text: string, maxDepth: number): { value: unknown } | { error: string } {
  let value: unknown;
  try {
    value = parseStrict(text);
  } catch (err) {
    return { error: `response body is not valid I-JSON (${(err as Error).message})` };
  }
  const depth = nestingDepth(value);
  if (depth > maxDepth) return { error: `response body nests ${depth} levels deep, beyond the ${maxDepth} this consumer accepts` };
  return { value };
}
