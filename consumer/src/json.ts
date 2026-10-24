/**
 * Reading JSON text as I-JSON (RFC 7493), the form in which the draft says a
 * declaration is published (§Body) and the form a consumer hardens its parser
 * for (§Security Considerations): a duplicate member name, a number beyond what
 * IEEE 754 binary64 holds, and a string with an unpaired surrogate are all
 * refused.
 *
 * Shared module: it depends only on `lossless-json` and is copied byte for byte
 * into the consumer.
 */
import { parse, splitNumber } from "lossless-json";

// A literal is within binary64 when the double it parses to prints back with the
// same significant digits: 1e308 and 5e-324 are, 9007199254740993 and 1e400 are not.
function number(text: string): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || splitNumber(text).digits !== splitNumber(String(value)).digits) {
    throw new SyntaxError(`the number ${text} exceeds the magnitude or precision of IEEE 754 binary64 (RFC 7493, Section 2.2)`);
  }
  return value;
}

function wellFormed(key: string, value: unknown): unknown {
  if (!key.isWellFormed() || (typeof value === "string" && !value.isWellFormed())) {
    throw new SyntaxError("a string holds an unpaired surrogate (RFC 7493, Section 2.1)");
  }
  return value;
}

/** Parse `text`; throws a `SyntaxError` for malformed JSON and for each of the three refusals above. */
export function parseStrict(text: string): unknown {
  return parse(text, wellFormed, number);
}
