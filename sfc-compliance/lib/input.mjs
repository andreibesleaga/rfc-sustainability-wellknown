/**
 * Reading input: files, fetched documents and the parsed form every check reads.
 *
 * `prepareInput` turns the raw members of an input (served text or objects, excerpt text or object) into
 * what the checks need; the file and fetch helpers below fill those members for the command line.
 */
import { readFileSync } from "node:fs";
import { secureGet, classifyMediaType, resolveWellKnownUrl } from "sustainability-wellknown-consumer";
import { readIJson } from "./ijson.mjs";
import { sha256hex, unb64u } from "./canonical.mjs";
import { objectsOf, bodyShapeRows, EXT } from "./declaration.mjs";
import { isObject, isHost, isInstant } from "./forms.mjs";
import { withLimits } from "./limits.mjs";
import { row, PASS, FAIL, NE, INFO } from "./rows.mjs";

// ---- the parsed input ---------------------------------------------------------------------

const LITERAL_LIMIT = "characters in a number literal";

/**
 * Parse text as I-JSON: { value, issues }, { error } for a syntax error, or { limit } for a number that no
 * binary64 value holds and whose literal is over the literal limit of section 10 (not expanded, never FAIL),
 * or for a document nested deeper than MAX_JSON_DEPTH.
 */
export function parseText(text, limits = withLimits()) {
  try {
    return readIJson(text);
  } catch (e) {
    if (e.limit) return { limit: e.limit };
    return e.literalLength > limits.literalChars ? { limit: LITERAL_LIMIT } : { error: e.message };
  }
}

const SIGNED_NAME = new RegExp(`"${EXT}ledger-evidence-2"\\s*:`);

const isObjectArray = (v) => Array.isArray(v) && v.every(isObject);
/** An absent list is empty; a present one, `null` included, must be an array of objects. */
const isOptionalObjectArray = (v) => v === undefined || isObjectArray(v);

/** Why a value cannot be read as an excerpt (5.8) at all, or null (checkedExcerpt calls it for version 2 only: D1 reports any other version as such): the structure the checks walk, not its content rules. */
export function excerptProblem(ex) {
  if (!isObject(ex)) return "not an object";
  if (!isHost(ex.network)) return "network is not a host";
  if (!isInstant(ex["read-at"])) return "read-at is not an instant";
  if (!isObjectArray(ex.registry)) return "registry is not an array of objects";
  if (!isOptionalObjectArray(ex.voids)) return "voids is not an array of objects";
  if (ex.checkpoint !== undefined && !isObject(ex.checkpoint)) return "checkpoint is not an object";
  if (ex.registrar !== undefined && !isObject(ex.registrar)) return "registrar is not an object";
  if (!isObjectArray(ex.ledger)) return "ledger is not an array of entries";
  const bad = ex.ledger.findIndex((l) => typeof l.commit !== "string" || !isInstant(l.commit) || typeof l.hash !== "string" || !isObject(l.event));
  return bad >= 0 ? `ledger entry ${bad} lacks a commit instant, a hash or an event object` : null;
}

/**
 * Resolve the raw members of an input.
 *   declarations | declarationText   the served objects, or the served text (kept for duplicate detection)
 *   excerpt | excerptText            the ledger read, or its text
 * Returns the input with `objs`, `bodyIssues`, `objectIssues` (the issues of each object of `objs`), `bodyShapeRows`
 * (S2 FAIL rows for a body that is not a declaration object or an array of them), `rawClaims`, `excerpt`,
 * `excerptIssues`, `declarationError`, `excerptError`.
 */
export function prepareInput(input) {
  const limits = withLimits(input.limits);
  const out = { ...input, bodyIssues: null, objectIssues: null, bodyShapeRows: [], rawClaims: false, objs: [] };
  let doc = "declarations" in input ? input.declarations : undefined;
  if (typeof input.declarationText === "string") {
    if (Buffer.byteLength(input.declarationText) > limits.declarationBytes) out.declarationError = { limit: "bytes per declaration" };
    else {
      const parsed = parseText(input.declarationText, limits);
      if (parsed.error) out.declarationError = { syntax: parsed.error };
      else if (parsed.limit) out.declarationError = { limit: parsed.limit };
      else if (parsed.issues.maxLiteral > limits.literalChars) out.declarationError = { limit: LITERAL_LIMIT };
      else { doc = parsed.value; out.bodyIssues = parsed.issues; }
      // a body that is not I-JSON claims SFC when the name appears in its text, in any duplicate (3.2)
      out.rawClaims = SIGNED_NAME.test(input.declarationText);
    }
  }
  if (doc !== undefined) {
    out.objs = objectsOf(doc);
    out.bodyShapeRows = bodyShapeRows(doc);
    out.objectIssues = objectIssuesOf(doc, out.bodyIssues);
  }
  if (typeof input.excerptText === "string") Object.assign(out, readExcerptText(input.excerptText, limits));
  Object.assign(out, checkedExcerpt(out.excerpt));
  return out;
}

/** The reader's per-element findings aligned with `objectsOf(doc)` (items that are not objects are left out), or null without served text. */
function objectIssuesOf(doc, issues) {
  if (!issues) return null;
  if (!Array.isArray(doc)) return [issues.elements[0]];
  return doc.flatMap((x, i) => (isObject(x) ? [issues.elements[i]] : []));
}

/** The excerpt text as { excerpt, excerptIssues } or { excerptError }; a text over the read limit is not parsed. */
function readExcerptText(text, limits) {
  if (Buffer.byteLength(text) > limits.readBytes) return { excerptError: { limit: "bytes per read" } };
  const parsed = parseText(text, limits);
  if (parsed.error) return { excerptError: { syntax: parsed.error } };
  if (parsed.limit) return { excerptError: { limit: parsed.limit } };
  return { excerpt: parsed.value, excerptIssues: parsed.issues };
}

/**
 * What the later stages may hold of an excerpt: { excerpt } or { excerptError, excerpt: undefined }.
 * An excerpt of another version is not walked: only its version and, when valid, its network and read-at
 * survive, so D1 can name the version and nothing reads an unvalidated member.
 */
function checkedExcerpt(excerpt) {
  if (excerpt === undefined) return { excerpt };
  if (isObject(excerpt) && excerpt["excerpt-version"] !== 2) return { excerpt: versionShell(excerpt) };
  const problem = excerptProblem(excerpt);
  return problem ? { excerptError: { malformed: problem }, excerpt: undefined } : { excerpt };
}

function versionShell(ex) {
  const shell = { "excerpt-version": ex["excerpt-version"], registry: [], voids: [], ledger: [] };
  if (isHost(ex.network)) shell.network = ex.network;
  if (isInstant(ex["read-at"])) shell["read-at"] = ex["read-at"];
  return shell;
}

// ---- files --------------------------------------------------------------------------------

export const readFileText = (path) => readFileSync(path, "utf8");
export const readFileBytes = (path) => readFileSync(path);
export const sha256OfBytes = sha256hex;

/** A JWK file: one JWK object, public members only. */
export function readJwkFile(path) {
  const jwk = JSON.parse(readFileText(path));
  if (jwk === null || typeof jwk !== "object" || Array.isArray(jwk) || typeof jwk.kty !== "string") throw new Error(`${path} is not a JWK`);
  if ("d" in jwk) throw new Error(`${path} holds a private key; give the public JWK`);
  return jwk;
}

/** The `x` of a registrar key file, which must be an Ed25519 public key (kty OKP, crv Ed25519, x of 32 bytes in base64url). */
export function readRegistrarKeyFile(path) {
  const jwk = readJwkFile(path);
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") throw new Error(`${path} is not an Ed25519 public key (kty OKP, crv Ed25519)`);
  if (unb64u(jwk.x)?.length !== 32) throw new Error(`${path} has no x of 32 bytes in base64url`);
  return jwk.x;
}

const PARAMETERS_HEADING = /^## SFC parameters\s*$/m;
/** The parameters of 7.6 from a JSON file, or the fenced `json` block under `## SFC parameters` of a Markdown or text file. */
export function parametersFromText(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return JSON.parse(text);
  const heading = PARAMETERS_HEADING.exec(text);
  if (!heading) throw new Error("no JSON object and no `## SFC parameters` heading");
  const rest = text.slice(heading.index + heading[0].length);
  const block = /```json\s*\n([\s\S]*?)\n```/.exec(rest);
  if (!block) throw new Error("no fenced json block under `## SFC parameters`");
  return JSON.parse(block[1]);
}

// ---- fetching -----------------------------------------------------------------------------

const MAX_REDIRECTS = 3;
const hasUserinfo = (u) => /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(u);

/** The cause texts of the limits of section 10 that a fetch can hit; the tests use the same functions. */
export const bytesLimitCause = (maxBytes) => `limit: bytes (${maxBytes})`;
export const timeLimitCause = (timeoutMs) => `limit: seconds per fetch (${timeoutMs / 1000})`;

const isTimeout = (e) => e?.name === "TimeoutError" || e?.name === "AbortError";

/** The declared length of a response, or null when absent or not a number. */
function declaredLength(res) {
  const n = Number(res.headers?.get("content-length"));
  return res.headers?.get("content-length") !== null && Number.isFinite(n) ? n : null;
}

/** Read the chunks of a body up to `maxBytes`; returns the text, or null when the body is larger. */
async function readChunks(res, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    total += chunk.length;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The body of a response as { text } or { cause }: a declared or actual size over `maxBytes`, the time limit
 * ending the read, or any other failure while reading is a cause, never an exception (section 10).
 * The one deadline of the fetch covers the body, so a server that stalls after the headers ends here.
 */
async function readBody(res, { maxBytes, timeoutMs }) {
  const declared = declaredLength(res);
  if (declared !== null && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return { cause: bytesLimitCause(maxBytes) };
  }
  try {
    const text = await readChunks(res, maxBytes);
    return text === null ? { cause: bytesLimitCause(maxBytes) } : { text };
  } catch (e) {
    return { cause: isTimeout(e) ? timeLimitCause(timeoutMs) : `network-error: ${e?.message ?? e}` };
  }
}

/**
 * GET a document under section 10: https only, bounded time, size and redirects, no userinfo, no address
 * the consumer library refuses. Returns { ok: true, text, contentType, url } or { ok: false, cause, refused }.
 * `refused` is true for HTTP 401 and 403 (the read was refused, not absent).
 */
export async function fetchDocument(uri, { maxBytes, timeoutMs, fetchImpl, lookup, accept } = {}) {
  if (hasUserinfo(uri)) return { ok: false, cause: "userinfo in URI" };
  let url;
  try { url = new URL(uri); } catch { return { ok: false, cause: "not a URI" }; }
  if (url.protocol !== "https:") return { ok: false, cause: "plain http refused" };
  let hops = 0;
  const refuseHop = (target) => {
    if (hasUserinfo(target.href)) return "userinfo in URI";
    return ++hops > MAX_REDIRECTS ? "more than 3 redirects" : undefined;
  };
  const result = await secureGet(url, { timeoutMs, fetchImpl, lookup, headers: accept ? { accept } : undefined, refuseHop });
  if (!result.ok) return { ok: false, cause: `${result.refusal.reason}${result.refusal.detail ? `: ${result.refusal.detail}` : ""}` };
  const { res } = result;
  if (!res.ok) return { ok: false, cause: `HTTP ${res.status}`, refused: res.status === 401 || res.status === 403 };
  const body = await readBody(res, { maxBytes, timeoutMs });
  if (body.cause) return { ok: false, cause: body.cause };
  return { ok: true, text: body.text, contentType: res.headers.get("content-type"), url: result.url.href };
}

/**
 * S1 fetch of `https://<origin>/.well-known/sustainability-data`. Returns { rows, text, url } where `text` is
 * absent when there is no document. `application/sustainability-data+json` is PASS, `application/json` is INFO,
 * any other type FAILs; no document is NOT-EVALUABLE with the cause.
 */
export async function fetchDeclaration(origin, options = {}) {
  const base = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(origin) ? origin : `https://${origin}`;
  if (!base.startsWith("https://")) return { rows: [row("S1", NE, "plain http refused", origin)] };
  let url;
  try { url = resolveWellKnownUrl(base).href; } catch { return { rows: [row("S1", NE, "not an origin or URL", origin)] }; }
  const got = await fetchDocument(url, { maxBytes: 1048576, timeoutMs: 30000, accept: "application/sustainability-data+json, application/json;q=0.9", ...options });
  if (!got.ok) return { rows: [row("S1", NE, got.cause, url)], url };
  const kind = classifyMediaType(got.contentType);
  const rows = [kind === "sustainability-data+json" ? row("S1", PASS, `${got.url} (${got.contentType})`, url)
    : kind === "json" ? row("S1", INFO, `generic media type: ${got.contentType}`, url)
      : row("S1", FAIL, `media type ${got.contentType ?? "absent"}`, url)];
  return { rows, text: got.text, url: got.url };
}
