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

/** A number as written, held until the reviver knows the member it belongs to. */
class Literal {
  constructor(readonly text: string) {}
}

/** Where a value sits, for a message: its member name, or its place in an array. */
function where(holder: unknown, key: string): string {
  if (Array.isArray(holder)) return `array item ${key}`;
  return key === "" ? "the document" : `member "${key}"`;
}

// A literal is within binary64 when the double it parses to prints back with the
// same significant digits: 1e308 and 5e-324 are, 9007199254740993 and 1e400 are not.
function number(text: string, place: string): number {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || splitNumber(text).digits !== splitNumber(String(value)).digits) {
    throw new SyntaxError(`${place}: the number ${text} exceeds the magnitude or precision of IEEE 754 binary64 (RFC 7493, Section 2.2)`);
  }
  return value;
}

function wellFormed(this: unknown, key: string, value: unknown): unknown {
  if (!key.isWellFormed()) {
    throw new SyntaxError(`a member name holds an unpaired surrogate (RFC 7493, Section 2.1)`);
  }
  if (value instanceof Literal) return number(value.text, where(this, key));
  if (typeof value === "string" && !value.isWellFormed()) {
    throw new SyntaxError(`${where(this, key)}: a string holds an unpaired surrogate (RFC 7493, Section 2.1)`);
  }
  return value;
}

/**
 * Parse `text`; throws a `SyntaxError` for malformed JSON and for each of the
 * three refusals above. The message names the member (a duplicate name is named
 * by the parser itself).
 */
export function parseStrict(text: string): unknown {
  const value = parse(text, wellFormed, (literal) => new Literal(literal));
  refuseRepeatedNames(text);
  return value;
}

/**
 * The parser refuses a repeated member name only when the two values differ; RFC 7493
 * Section 2.3 refuses every repeat. Run on text the parser has already accepted, this
 * walks it once and throws for the first name an object holds twice. Names are compared
 * as decoded, so `"a"` and `"\u0061"` are one name.
 */
function refuseRepeatedNames(text: string): void {
  // One entry per open container: the names of an object, or null for an array.
  const open: Array<Set<string> | null> = [];
  let expectName = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const names = open[open.length - 1];
      if (expectName && names) {
        const name = JSON.parse(text.slice(i, end + 1)) as string;
        if (names.has(name)) throw new SyntaxError(`Duplicate key '${name}' encountered at position ${i}`);
        names.add(name);
        expectName = false;
      }
      i = end;
    } else if (c === "{" || c === "[") {
      open.push(c === "{" ? new Set() : null);
      expectName = c === "{";
    } else if (c === "}" || c === "]") {
      open.pop();
      expectName = false;
    } else if (c === "," && open[open.length - 1]) {
      expectName = true;
    }
  }
}
