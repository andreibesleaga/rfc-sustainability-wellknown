/** Value forms of section 3.5 and the figure rules of 3.3. */
import { isInstant, isMonthBound, isFullDate } from "./time.mjs";
import { unb64u } from "./canonical.mjs";

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isHex64 = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export const isB64Url = (v, bytes) => { const b = unb64u(v); return b !== null && (bytes === undefined || b.length === bytes); };
const IDCHAR = "(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})";
export const isDid = (v) => typeof v === "string" && new RegExp(`^did:[a-z0-9]+:(?:${IDCHAR}*:)*${IDCHAR}+$`).test(v);
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
export const isHost = (v) => typeof v === "string" && v.length <= 253 && new RegExp(`^${LABEL}(?:\\.${LABEL})*$`).test(v);
export const isHttpsUri = (v) => typeof v === "string" && /^https:\/\/[^\s]+$/.test(v);
export const isUriAbs = (v) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(v);
/** ASCII lower-casing only (3.5 `host`): other characters are compared as they are. */
export const asciiLower = (s) => String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
export const sameHost = (a, b) => typeof a === "string" && typeof b === "string" && asciiLower(a) === asciiLower(b);
/** The same `target` (7.3, S4): host names are compared after ASCII lower-casing (3.5 `host`, Appendix D); any other target as an exact string. */
export const sameTarget = (a, b) => a === b || (isHost(a) && isHost(b) && sameHost(a, b));
export const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;
export const isNum = (v, min = 0) => typeof v === "number" && Number.isFinite(v) && v >= min;
export { isInstant, isMonthBound, isFullDate };

/** 3.3 rule 2 on the RFC 8785 text of a figure: plain decimal, at most 15 digits, at most 6 after the point, not negative. */
export function figureOk(x) {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return false;
  const text = JSON.stringify(x);
  const m = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
  if (!m) return false;
  const frac = m[2] ?? "";
  if (frac.length > 6) return false;
  const digits = (m[1] === "0" && frac === "" ? 0 : m[1].length + frac.length);
  return digits <= 15;
}
/** `tonnesRetired`: an integer of at least 1 and at most 15 digits. */
export const tonnesOk = (x) => Number.isInteger(x) && x >= 1 && String(x).length <= 15;
