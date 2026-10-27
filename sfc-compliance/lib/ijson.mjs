import { MAX_JSON_DEPTH, NESTING_LIMIT } from "./limits.mjs";

/** A JSON number literal, matched in place at `lastIndex` (no length cut: the length limit is a decision of limits.mjs). */
const NUM = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;

/** The syntax error of a number that no binary64 value holds (I-JSON, RFC 7493 section 2.2); `literalLength` lets the caller apply the literal limit first. */
function outOfRange(literalLength, at) {
  const e = new Error(`JSON syntax: number out of I-JSON range at ${at}`);
  e.literalLength = literalLength;
  return e;
}

/**
 * A strict JSON reader that reports what JSON.parse hides: duplicate member names, unpaired
 * surrogates, nesting depth, the longest number literal and the longest string (UTF-8 bytes).
 * `issues.elements` holds the duplicates and lone surrogates of each top-level array element (of the whole
 * value when it is not an array), so a finding in one served object is charged to that object alone.
 * Returns { value, issues } or throws on a syntax error; a document nested deeper than MAX_JSON_DEPTH throws an error with `limit` set.
 */
export function readIJson(text) {
  const issues = { duplicates: [], loneSurrogate: false, depth: 0, maxLiteral: 0, maxStringBytes: 0, elements: [] };
  let lone = 0;
  let i = 0;
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++; };
  const fail = (m) => { throw new Error(`JSON syntax: ${m} at ${i}`); };
  /** One escape sequence after a backslash; returns the character it stands for. */
  function escape() {
    const e = text[i++];
    if (e === "u") {
      const h = text.slice(i, i + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("bad escape");
      i += 4;
      return String.fromCharCode(parseInt(h, 16));
    }
    if (!'"\\/bfnrt'.includes(e)) fail("bad escape");
    return { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[e] ?? e;
  }
  /** One raw character of a string: a control character is a syntax error. */
  function plainChar(c) {
    if (c < " ") fail("control character");
    return c;
  }
  /** Record a lone surrogate and the byte length of a finished string. */
  function noteString(out) {
    for (let k = 0; k < out.length; k++) {
      const u = out.charCodeAt(k);
      if (u >= 0xd800 && u <= 0xdbff) {
        const n = out.charCodeAt(k + 1);
        if (n >= 0xdc00 && n <= 0xdfff) k++;
        else lone++;
      } else if (u >= 0xdc00 && u <= 0xdfff) lone++;
    }
    issues.loneSurrogate = lone > 0;
    issues.maxStringBytes = Math.max(issues.maxStringBytes, Buffer.byteLength(out.replace(/[\ud800-\udfff]/g, "\ufffd"), "utf8"));
  }
  function str() {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) fail("unterminated string");
      const c = text[i++];
      if (c === '"') break;
      out += c === "\\" ? escape() : plainChar(c);
    }
    noteString(out);
    return out;
  }
  function object(depth) {
    i++;
    const o = {};
    const seen = new Set();
    ws();
    if (text[i] === "}") { i++; return o; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail("member name");
      const k = str();
      if (seen.has(k)) issues.duplicates.push(k);
      seen.add(k);
      ws();
      if (text[i++] !== ":") fail("colon");
      Object.defineProperty(o, k, { value: val(depth + 1), enumerable: true, writable: true, configurable: true });
      ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i++] === "}") return o;
      fail("object");
    }
  }
  /** The findings made since (`d0` duplicates, `l0` lone surrogates): the issues of one top-level element. */
  const findingsSince = (d0, l0) => ({ duplicates: issues.duplicates.slice(d0), loneSurrogate: lone > l0 });
  function array(depth) {
    i++;
    const a = [];
    ws();
    if (text[i] === "]") { i++; return a; }
    for (;;) {
      const d0 = issues.duplicates.length, l0 = lone;
      a.push(val(depth + 1));
      if (depth === 1) issues.elements.push(findingsSince(d0, l0));
      ws();
      if (text[i] === ",") { i++; continue; }
      if (text[i++] === "]") return a;
      fail("array");
    }
  }
  /** `true`, `false` or `null` at the cursor, or undefined. */
  function keyword() {
    for (const [word, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(word, i)) { i += word.length; return { value }; }
    }
    return undefined;
  }
  function number() {
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (!m) fail("value");
    i += m[0].length;
    issues.maxLiteral = Math.max(issues.maxLiteral, m[0].length);
    const n = Number(m[0]);
    if (!Number.isFinite(n)) throw outOfRange(m[0].length, i);
    return n;
  }
  function val(depth) {
    ws();
    const c = text[i];
    if (c === "{" || c === "[") {
      if (depth > MAX_JSON_DEPTH) throw Object.assign(new Error(`JSON limit: ${NESTING_LIMIT}`), { limit: NESTING_LIMIT });
      issues.depth = Math.max(issues.depth, depth);
    }
    if (c === "{") return object(depth);
    if (c === "[") return array(depth);
    if (c === '"') return str();
    const word = keyword();
    return word ? word.value : number();
  }
  const value = val(1);
  ws();
  if (i !== text.length) fail("trailing data");
  if (!Array.isArray(value)) issues.elements = [findingsSince(0, 0)];
  return { value, issues };
}
