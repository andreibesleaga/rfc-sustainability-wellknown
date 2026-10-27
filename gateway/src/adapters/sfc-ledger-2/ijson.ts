/**
 * A strict JSON reader that reports what `JSON.parse` hides: duplicate member
 * names, unpaired surrogates, nesting depth, the longest number literal and the
 * longest string (UTF-8 bytes). Section 10, Parsing: events, Registry entries,
 * excerpts, the served declaration and the decoded `signed` payload are read as
 * I-JSON (RFC 7493). Throws on a syntax error.
 */
import type { Json } from "./primitives";

/** The duplicate member names and lone surrogates found in one served object (one top-level array element). */
export interface ElementIssues {
  duplicates: string[];
  loneSurrogate: boolean;
}

export interface IJsonIssues extends ElementIssues {
  depth: number;
  maxLiteral: number;
  maxStringBytes: number;
  /** The findings of each top-level array element (of the whole value when it is not an array), so a finding in one served object is charged to that object alone. */
  elements: ElementIssues[];
}

/** A JSON number literal, matched in place at `lastIndex`; no length cut here: the length limit is a decision of limits.ts. */
const NUMBER_RE = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/**
 * Nesting deeper than this is not read at all (the recursive reader would overflow the stack): a limit at once.
 * The limit of section 10 is 32; a nesting of 33 to this bound is read and reaches the limit scan.
 */
export const MAX_READ_DEPTH = 64;

export const NESTING_LIMIT = "JSON nesting depth";

/** What the reader throws: a syntax error, or a limit that stopped the reading (`limit`), or a number no binary64 holds (`literalLength`). */
export interface ReadError extends Error {
  limit?: string;
  literalLength?: number;
}
const SIMPLE_ESCAPES: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

const LITERALS = [["true", true], ["false", false], ["null", null]] as const;

/** The syntax error of a number that no binary64 value holds (I-JSON, RFC 7493 section 2.2); `literalLength` lets the caller apply the literal limit first. */
function outOfRange(literalLength: number, at: number): ReadError {
  const e: ReadError = new Error(`JSON syntax: number out of I-JSON range at ${at}`);
  e.literalLength = literalLength;
  return e;
}

/** One reading of one text: the position and the issues recorded so far. Each method stays small. */
class Reader {
  readonly issues: IJsonIssues = { duplicates: [], loneSurrogate: false, depth: 0, maxLiteral: 0, maxStringBytes: 0, elements: [] };
  private i = 0;
  private lone = 0;

  constructor(private readonly text: string) {}

  /** The whole text as one value; throws on a syntax error or trailing data. */
  readAll(): Json {
    const value = this.value(1);
    this.skipSpace();
    if (this.i !== this.text.length) this.fail("trailing data");
    if (!Array.isArray(value)) this.issues.elements = [this.findingsSince(0, 0)];
    return value;
  }

  /** The findings made since (`d0` duplicates, `l0` lone surrogates): the issues of one top-level element. */
  private findingsSince(d0: number, l0: number): ElementIssues {
    return { duplicates: this.issues.duplicates.slice(d0), loneSurrogate: this.lone > l0 };
  }

  private fail(m: string): never {
    throw new Error(`JSON syntax: ${m} at ${this.i}`);
  }

  private skipSpace(): void {
    while (this.i < this.text.length && " \t\n\r".includes(this.text[this.i])) this.i++;
  }

  private value(depth: number): Json {
    this.skipSpace();
    const c = this.text[this.i];
    if (c === "{" || c === "[") this.enter(depth);
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return this.string();
    return this.literalOrNumber();
  }

  /** Record the depth of a container; stop reading when it passes the reader's bound. */
  private enter(depth: number): void {
    if (depth > MAX_READ_DEPTH) {
      const e: ReadError = new Error(`limit: ${NESTING_LIMIT}`);
      e.limit = NESTING_LIMIT;
      throw e;
    }
    this.issues.depth = Math.max(this.issues.depth, depth);
  }

  private literalOrNumber(): Json {
    for (const [word, value] of LITERALS) {
      if (this.text.startsWith(word, this.i)) {
        this.i += word.length;
        return value;
      }
    }
    return this.number();
  }

  private number(): number {
    NUMBER_RE.lastIndex = this.i;
    const m = NUMBER_RE.exec(this.text);
    if (!m) this.fail("value");
    const literal = (m as RegExpExecArray)[0];
    this.i += literal.length;
    this.issues.maxLiteral = Math.max(this.issues.maxLiteral, literal.length);
    const n = Number(literal);
    if (!Number.isFinite(n)) throw outOfRange(literal.length, this.i);
    return n;
  }

  /** After the opening bracket: true when the container is empty (and its close is consumed). */
  private isEmpty(close: string): boolean {
    this.i++;
    this.skipSpace();
    if (this.text[this.i] !== close) return false;
    this.i++;
    return true;
  }

  /** After one element: true when a comma was consumed (another follows), false when `close` was; fails otherwise. */
  private more(close: string, what: string): boolean {
    this.skipSpace();
    if (this.text[this.i] === ",") {
      this.i++;
      return true;
    }
    if (this.text[this.i++] === close) return false;
    return this.fail(what);
  }

  private object(depth: number): Json {
    const o: Record<string, Json> = {};
    if (this.isEmpty("}")) return o;
    const seen = new Set<string>();
    do {
      const k = this.memberName(seen);
      Object.defineProperty(o, k, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
    } while (this.more("}", "object"));
    return o;
  }

  /** A member name and the colon after it; a name met before is recorded as a duplicate. */
  private memberName(seen: Set<string>): string {
    this.skipSpace();
    if (this.text[this.i] !== '"') this.fail("member name");
    const k = this.string();
    if (seen.has(k)) this.issues.duplicates.push(k);
    seen.add(k);
    this.skipSpace();
    if (this.text[this.i++] !== ":") this.fail("colon");
    return k;
  }

  private array(depth: number): Json {
    const a: Json[] = [];
    if (this.isEmpty("]")) return a;
    do {
      const d0 = this.issues.duplicates.length;
      const l0 = this.lone;
      a.push(this.value(depth + 1));
      if (depth === 1) this.issues.elements.push(this.findingsSince(d0, l0));
    } while (this.more("]", "array"));
    return a;
  }

  private string(): string {
    this.i++;
    const out = this.stringBody();
    this.noteSurrogates(out);
    this.issues.maxStringBytes = Math.max(this.issues.maxStringBytes, Buffer.byteLength(out.replace(/[\ud800-\udfff]/g, "\ufffd"), "utf8"));
    return out;
  }

  /** The characters up to the closing quote, escapes decoded. */
  private stringBody(): string {
    let out = "";
    for (;;) {
      if (this.i >= this.text.length) this.fail("unterminated string");
      const c = this.text[this.i++];
      if (c === '"') return out;
      out += c === "\\" ? this.escape() : this.plainChar(c);
    }
  }

  private plainChar(c: string): string {
    if (c < " ") this.fail("control character");
    return c;
  }

  private escape(): string {
    const e = this.text[this.i++];
    if (e === "u") return this.unicodeEscape();
    if ('"\\/bfnrt'.includes(e)) return SIMPLE_ESCAPES[e] ?? e;
    return this.fail("bad escape");
  }

  private unicodeEscape(): string {
    const h = this.text.slice(this.i, this.i + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail("bad escape");
    this.i += 4;
    return String.fromCharCode(parseInt(h, 16));
  }

  private noteSurrogates(out: string): void {
    for (let k = 0; k < out.length; k++) {
      const u = out.charCodeAt(k);
      if (u >= 0xd800 && u <= 0xdbff) k += this.pairedLow(out, k) ? 1 : this.markLone();
      else if (u >= 0xdc00 && u <= 0xdfff) this.markLone();
    }
  }

  private pairedLow(out: string, k: number): boolean {
    const n = out.charCodeAt(k + 1);
    return n >= 0xdc00 && n <= 0xdfff;
  }

  private markLone(): 0 {
    this.lone++;
    this.issues.loneSurrogate = true;
    return 0;
  }
}

export function readIJson(text: string): { value: Json; issues: IJsonIssues } {
  const reader = new Reader(text);
  const value = reader.readAll();
  return { value, issues: reader.issues };
}
