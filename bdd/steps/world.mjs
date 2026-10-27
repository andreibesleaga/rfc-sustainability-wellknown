/**
 * The world of the behaviour suite: the built publisher, consumer and gateway, loopback servers, the two
 * fixed clocks, fixtures, and the state the steps share. Nothing here touches the network or reads the
 * wall clock; every server listens on 127.0.0.1 and is closed after its scenario.
 *
 * WHAT THE STEP FILES MAY USE
 *
 * Packages (the built code, never the sources):
 *   publisher, consumer, jose          the libraries; jose is the one the consumer uses
 *   BIN.publisher, BIN.consumer, BIN.createData   the command-line programs (run them with runNode)
 *   ROOT                               the repository root
 *
 * Constants:
 *   WELL_KNOWN, MEDIA_TYPE             the path and the media type of the draft
 *   DEFAULT_NOW                        2026-10-24T12:00:00Z, the clock of every scenario but the gateway's
 *   GATEWAY_NOW                        2026-10-17T12:00:00Z, the clock of a gateway started by a step
 *   LABEL_EXTENSION                    the extension that carries the label of a held object (see holdPeriods)
 *
 * Fixtures and helpers (plain functions):
 *   baseDeclaration(overrides)         a valid -10 object (one year, 2025, an origin, energy and carbon)
 *   legacyDocument(revision, overrides)   the same object in the form of "-08" or "-09"
 *   rawMetrics(overrides)              the same figures as a publisher input (RawMetrics)
 *   value(text)                        a step argument as JSON when it looks like JSON, else the text; \uXXXX escapes are decoded
 *   decodeEscapes(text)                the text with its \uXXXX escapes decoded
 *   coerce(member, text)               text read as the number a numeric member carries, else the text
 *   getPath / setPath / deletePath     dotted paths into an object: "period.end", "upstream[0].role"
 *   periodFromText(text)               "start/end" or a calendar label (2025, 2025-03, 2025-03-14) as a period
 *   cellValue(member, cell)            a table cell as the value of a member ("" means absent)
 *   objectsFromTable(table)            one declaration object per row of a data table (header = member names)
 *   draftExample(title)                the first JSON example under "## <title>" of the draft in the repository
 *   withoutSigned(object)              the object without its signed member
 *   flatComparisons(list)              every comparison of an upstream walk, nested ones included
 *   sameInstant(a, b)                  two date-times name the same instant
 *   mergeSpans(periods)                periods that meet or overlap, merged into spans
 *   rawJws({ alg, cty, payload, key, secret, header })   a compact JWS made by hand (alg none, a MAC, a header of your own)
 *   textOf(result)                     any result as searchable text (hyphens also written as spaces)
 *   cddlAccepts(value)                 the verdict of the draft CDDL (cddl gem) on a JSON value; throws if the tool is missing
 *   jtdAccepts(schema, value)          the verdict of a JTD schema (Ajv) on an object or an array of objects
 *   runNode(args, options)             run node on a program; returns { status, stdout, stderr }
 *   startGateway(options)              start the real gateway on a loopback port (see below)
 *
 * The World (this, in a step) keeps these fields. A step that changes one says so in its own comment.
 *
 *   Clock          now (Date)                       setClock(text) moves it, and the running gateway's clock with it
 *   Subject        doc                              the declaration under test: an object or an array
 *                  docText                          the raw text of the document, when a step needs the exact bytes
 *                  lastSet                          "doc", "response" or "fetch": which was set last
 *                  subject()                        the object or array the next step is about: doc, the body of the last response,
 *                                                   or the document of the last successful fetch
 *                  setDoc(doc)                      makes doc the subject; mutateDoc(fn) edits it; ensureDoc() makes a valid one if none
 *   Validation     result { valid, errors, warnings }   warnings are "code: message" texts
 *                  read { mode, document, converted, disregarded }   the document as read in "strict" or "compatibility" mode
 *                  readAs(mode)                     runs the reading on the subject and sets both
 *   Signature      keys, namedKey(name, alg)        named signing keys ("K1", "K2"), created on first use
 *                  policy                           the SignaturePolicy for verification: trustedKeys, pinnedKeys, trustAnchors, held
 *                  signObject(doc, key, { alg })    signs a copy with a header jwk; alg "EdDSA" is signed here, the publisher refuses it
 *                  sig, sigs, sigNotes              the last SignatureResult, all of them, the warnings of the verification
 *                  verifySubject()                  verifies every object of the subject through fetchSustainability on a loopback server
 *   Publisher      input                            the publisher input (RawMetrics) of the "a publisher given" steps
 *                  inputPatch(patch)                merges into input and invalidates the build
 *                  adapter                          a source adapter that replaces input (a CSV or scheduler adapter)
 *                  publisherConfig                  { normalize, security, signing, representation, capabilities }
 *                  built()                          builds once per change: { objects, warnings, error }; steps that change input,
 *                                                   adapter or publisherConfig call invalidateBuild()
 *                  publisher                        a Publisher to serve (holdPeriods or a step sets it)
 *                  holdPeriods(rows, options)       an extended publisher holding objects; rows { label, start, end, target }
 *                  heldRows                         the rows given to holdPeriods; labelOf(object) is the label of a held object
 *                  servePublisher({ staticFile })   serves publisher, input, adapter or doc; sets base
 *                  serverOptions                    options of createSustainabilityServer (contentLanguage, mediaType, extraPaths)
 *   HTTP           base                             the origin under test (no trailing slash)
 *                  send(method, path, headers)      sets response { status, headers, body, bytes, json() }; records the request
 *                  requests                         the requests the loopback servers received { method, url, headers }
 *                  serveText(body, options)         a loopback server that answers the well-known path with a fixed body
 *                  listen(server)                   starts a server on a free port, closes it after the scenario; returns its origin
 *   Consumer       fetchLocal(params, extra)        fetchSustainability(base, ...) with allowInsecure; sets fetchResult
 *                  fetchResult, lastFetchParams     the last fetch and the parameters asked for
 *                  recorder                         a fetch stand-in: connections lists every URL it was asked for; answers 404
 *                  connections                      the URLs of the recorder (a refused URI never reaches it)
 *                  total, totalRefusal              the last total over an array
 *                  presentation()                   what the command-line consumer says about lastOrigin: { status, stdout, stderr }
 *   Upstream       upstream { docs, log }           declarations by URI, and every URI asked for; chainUri(i) is the URI of level i
 *                  walkOptions                      extra options for compareUpstream (maxRetrievals, base, walkDepth)
 *                  comparisons                      the result of the last walk
 *   Attestation    credentials                      Map of URI -> { status, contentType, body } for the credential steps
 *                  attestationOptions               extra options of verifyAttestation (trustedIssuerKeys, base, declaration)
 *                  attestation, attestationReads    the last result, and the URIs read
 *   Gateway        gateway(options)                 the gateway of this scenario, started on first use
 *                  gatewayHandle                    { gw, base, close, now, setNow }
 *   Files          tempDir(name)                    a fresh directory, removed after the scenario
 *                  run                              the last program run { program, status, stdout, stderr, outDir, files }
 *                  answers                          the answers of the create-sustainability-data tool, by option name
 *                  upgrade                          the last upgrade { status, stdout, stderr, outFile, output }
 *                  written                          the file the create-sustainability-data tool wrote { path, json }
 *                  gatewayDataFile                  { name, json }: a data file for a gateway that starts on gatewayDataDir(...)
 *                  walkVisited                      the Set of URIs a walk already holds (the subject's own retrieval URI)
 *                  addExtension(name, object)       an extension of the tool's answers, or of the document
 *                  filesUnder(dir), gatewayDataDir(extra), writeFileIn(dir, name, text)
 *                  check                            { passed, message }: the outcome of the last check or test program
 *                  publishedText                    the text a wording test runs on
 *                  csvText, csvConfig               the CSV and the adapter settings of the CSV steps; adapterOutput { objects, skipped }
 *                  retrievedFrom, forwarded         the retrieval URI of the declaration, and the record of a relay
 *
 * A step that needs a new field adds it to the constructor below and to this list.
 */
import { execFile, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { After, setDefaultTimeout, setWorldConstructor } from "@cucumber/cucumber";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..", "..");

export const publisher = require(resolve(ROOT, "publisher", "dist", "index.js"));
export const consumer = require(resolve(ROOT, "consumer", "dist", "index.js"));
export const jose = createRequire(resolve(ROOT, "consumer", "package.json"))("jose");
const gatewayApp = require(resolve(ROOT, "gateway", "dist", "app.js"));
const gatewayConfig = require(resolve(ROOT, "gateway", "dist", "config.js"));
const JtdAjv = createRequire(resolve(ROOT, "publisher", "package.json"))("ajv/dist/jtd");

export const BIN = {
  publisher: resolve(ROOT, "publisher", "bin", "sustainability-publisher.js"),
  consumer: resolve(ROOT, "consumer", "bin", "sustainability-fetch.js"),
  createData: resolve(ROOT, "tools", "create-sustainability-data", "bin", "create.mjs"),
};

export const WELL_KNOWN = "/.well-known/sustainability-data";
export const MEDIA_TYPE = "application/sustainability-data+json";
export const DEFAULT_NOW = new Date("2026-10-24T12:00:00Z");
export const GATEWAY_NOW = new Date("2026-10-17T12:00:00Z");
export const LABEL_EXTENSION = "https://example.com/extensions/held-label";

setDefaultTimeout(30_000);

// ---- fixtures ----------------------------------------------------------------------------------------

/** A valid -10 declaration object: one whole year, an origin, energy and carbon. */
export function baseDeclaration(overrides = {}) {
  return {
    updated: "2026-02-15T08:00:00Z",
    capabilities: "basic",
    provider: "Example Org (https://example.com/contact)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "example.com",
    "target-type": "origin",
    "energy-consumption": 120,
    "energy-unit": "kWh",
    "carbon-footprint": 29.4,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

/** The same object in the form of draft -08 (a reporting-period label) or -09 (two full dates). */
export function legacyDocument(revision, overrides = {}) {
  const { period: _period, ...rest } = baseDeclaration();
  revision = String(revision).padStart(2, "0"); // a step regex hands over 09 as the number 9
  if (revision === "08") return { ...rest, "reporting-period": "2025", ...overrides };
  if (revision === "09") return { ...rest, period: { start: "2025-01-01", end: "2025-12-31" }, ...overrides };
  return baseDeclaration(overrides);
}

/** A publisher input that yields the same figures; `period` is the whole of 2025 unless given, and `updated` is the clock's. */
export function rawMetrics(overrides = {}) {
  return {
    provider: "Example Org (https://example.com/contact)",
    measurementMethod: "hardware-metered",
    methodologyUri: "https://example.com/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    energy: { value: 120, unit: "kWh" },
    carbon: { value: 29.4, unit: "kgCO2e" },
    ...overrides,
  };
}

/** The text with every \uXXXX written in it decoded: a table cell cannot hold a trailing space or an invisible character. */
export const decodeEscapes = (text) => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** A step argument: JSON where it looks like JSON, the text otherwise (with its \uXXXX escapes decoded). */
export function value(text) {
  if (/^[[{]/.test(text) || ["true", "false", "null"].includes(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return decodeEscapes(text);
    }
  }
  return decodeEscapes(text);
}

const NUMERIC_MEMBERS = new Set([...consumer.METRIC_MEMBERS, "scope-1", "scope-2", "scope-3"]);

/** The text as the number a numeric member carries, else as the text. */
export function coerce(member, text) {
  const leaf = member.split(".").pop();
  return NUMERIC_MEMBERS.has(leaf) && text !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
}

const steps = (path) => path.split(/\.|(?=\[)/).map((s) => (s.startsWith("[") ? Number(s.slice(1, -1)) : s));

export function getPath(object, path) {
  return steps(path).reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), object);
}

export function setPath(object, path, newValue) {
  const parts = steps(path);
  const last = parts.pop();
  const parent = parts.reduce((o, k) => (o[k] === undefined ? (o[k] = {}) : o[k]), object);
  parent[last] = newValue;
}

export function deletePath(object, path) {
  const parts = steps(path);
  const last = parts.pop();
  const parent = parts.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), object);
  if (parent !== undefined && parent !== null) delete parent[last];
}

/** "start/end" as a period; a calendar label (2025, 2025-03, 2025-03-14) as that whole year, month or day in UTC. */
export function periodFromText(text) {
  if (text.includes("/")) {
    const [start, end] = text.split("/");
    return { start, end };
  }
  return publisher.periodFromReportingPeriod(text);
}

/** One cell of a data table as the value of a member; an empty cell is absent (undefined). */
export function cellValue(member, cell) {
  if (cell === "") return undefined;
  if (member === "period") return periodFromText(cell);
  return coerce(member, cell);
}

/** One valid object per row of a data table: the header names members, an empty cell leaves one out. */
export function objectsFromTable(table) {
  return table.hashes().map((row) => {
    const object = baseDeclaration({ capabilities: "extended" });
    for (const [member, cell] of Object.entries(row)) {
      const v = cellValue(member, cell);
      if (v === undefined) delete object[member];
      else object[member] = v;
    }
    return object;
  });
}

/** The first JSON example under the heading "## <title>" of the draft in the repository. */
export function draftExample(title) {
  const draft = readFileSync(resolve(ROOT, "internet-drafts", "draft-besleaga-sustainability-wellknown-11.md"), "utf8");
  const start = draft.indexOf(`\n## ${title}\n`);
  if (start < 0) throw new Error(`the draft has no section "${title}"`);
  const open = draft.indexOf("~~~ json\n", start);
  const close = draft.indexOf("\n~~~", open + 1);
  return JSON.parse(draft.slice(open + "~~~ json\n".length, close));
}

export function withoutSigned(object) {
  const { signed: _signed, ...rest } = object;
  return rest;
}

/** Any result as text to search: JSON, with hyphens also written as spaces ("wrong-media-type" mentions "media type"). */
export function textOf(result) {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return `${text}\n${text.replace(/-/g, " ")}`;
}

/**
 * A JWS compact serialization built by hand, for the signatures a publisher refuses to make: alg "none" (any case),
 * a MAC (HS256, HS384, HS512, keyed with `secret`), or a header of the caller's own (`header` members are added; cty null leaves it out).
 * Any other alg is signed with `key` (a publisher SigningKey) and carries its public key as jwk unless the header gives one.
 */
export async function rawJws({ alg, cty = publisher.SIGNED_CTY, payload, key, secret, header = {} }) {
  const bytes = new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload));
  const protectedHeader = { alg, ...(cty === null ? {} : { cty }), ...header };
  if (alg.toLowerCase() === "none") {
    const b64 = (text) => Buffer.from(text).toString("base64url");
    return `${b64(JSON.stringify(protectedHeader))}.${Buffer.from(bytes).toString("base64url")}.`;
  }
  const signer = new jose.CompactSign(bytes);
  if (/^HS/.test(alg)) return signer.setProtectedHeader(protectedHeader).sign(secret);
  return signer.setProtectedHeader({ jwk: publisher.embeddedJwk(key), ...protectedHeader }).sign(key.privateKey);
}

/** Every comparison of an upstream walk, nested ones included, in the order walked. */
export function flatComparisons(list, out = []) {
  for (const c of list ?? []) {
    out.push(c);
    flatComparisons(c.upstream, out);
  }
  return out;
}

/** True when two date-times name the same instant. */
export const sameInstant = (a, b) => consumer.compareDateTimes(a, b) === 0;

/** The periods merged into the spans they cover: periods that meet or overlap are one span; a gap separates two. */
export function mergeSpans(periods) {
  const sorted = [...periods].sort((a, b) => consumer.comparePeriodStart(a, b));
  const spans = [];
  for (const p of sorted) {
    const last = spans[spans.length - 1];
    if (last && consumer.compareDateTimes(p.start, last.end) <= 0) {
      if (consumer.compareDateTimes(p.end, last.end) > 0) last.end = p.end;
    } else spans.push({ start: p.start, end: p.end });
  }
  return spans;
}

// ---- programs and validators -------------------------------------------------------------------------

/**
 * Run node on a program and wait for it. The output is returned, never printed. The wait is asynchronous: a program
 * that talks to a server of this process (the command-line consumer) needs the event loop to go on answering.
 */
export function runNode(args, options = {}) {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      args,
      { encoding: "utf8", timeout: 60_000, cwd: options.cwd, env: { ...process.env, ...options.env }, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => done({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr, error: error ?? undefined }),
    );
    child.stdin.end(options.input ?? "");
  });
}

let gemBin;
/** The verdict of the draft CDDL on a JSON value (the cddl gem 0.12.14, as validate-all.sh uses it). */
export function cddlAccepts(json) {
  gemBin ??= spawnSync("ruby", ["-e", "print Gem.user_dir"], { encoding: "utf8" }).stdout;
  const dir = mkdtempSync(join(tmpdir(), "bdd-cddl-"));
  try {
    const file = join(dir, "case.json");
    writeFileSync(file, typeof json === "string" ? json : JSON.stringify(json));
    const r = spawnSync("cddl", [join(ROOT, "schemas-validators", "response-schema.cddl"), "validate", file], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${gemBin}/bin:${process.env.PATH}` },
    });
    if (r.error) throw new Error(`the cddl tool is not installed (gem install cddl -v 0.12.14): ${r.error.message}`);
    return r.status === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The verdict of a JTD schema on an object, or on every object of an array. */
export function jtdAccepts(schema, json) {
  const validate = new (JtdAjv.default ?? JtdAjv)({ allErrors: true }).compile(schema);
  return (Array.isArray(json) ? json : [json]).every((object) => validate(object));
}

// ---- the gateway ---------------------------------------------------------------------------------------

const realDateNow = Date.now;

/** Make `Date.now()` answer `read()` until `restoreDateNow()`. */
function holdDateNow(read) {
  Date.now = read;
}

/** Give `Date.now()` back to the wall clock (called by the After hook). */
function restoreDateNow() {
  Date.now = realDateNow;
}

/**
 * Start the real gateway (gateway/dist, run on the source builds of the publisher and consumer) on a loopback
 * port, exactly as the gateway's own tests do. Options: now, rateLimitPerMinute, signing (default true: a fresh
 * key signs the gateway's own object), attestationUri, selfPeriod, baseUrl, dataDir, examplesDir, and validator (the
 * dependencies of the public validator; by default it is answered from the gateway's own subjects; null disables it).
 * Throws what the gateway throws when it refuses to start (a data file that is not a -10 declaration).
 */
export async function startGateway(options = {}) {
  const signingKeyJwk =
    options.signing === false ? undefined : JSON.stringify(await publisher.exportPrivateJwk(await publisher.generateSigningKey("Ed25519")));
  const config = gatewayConfig.loadConfig({
    port: 0,
    host: "127.0.0.1",
    dataDir: options.dataDir ?? resolve(ROOT, "gateway", "data"),
    ...(options.examplesDir !== undefined ? { examplesDir: options.examplesDir } : {}),
    maxAge: 86_400,
    rateLimit: { perMinute: options.rateLimitPerMinute ?? 0, trustProxy: 1 },
    signingKeyJwk,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  });
  if (options.selfPeriod) config.self.period = options.selfPeriod;
  config.self.measured = false;
  // 3 W entered for every month the scenarios' clocks reach: a month without an entry is not reported.
  config.self.wattsByMonth = Object.fromEntries([...Array(15).keys()].flatMap((i) => [...Array(12).keys()].map((m) => [`${2026 + i}-${String(m + 1).padStart(2, "0")}`, 3])).filter(([k]) => k >= "2026-07"));
  config.self.verifiableAttestationUri = options.attestationUri ?? "https://attestation.example.com/gateway-model.vc.jwt";
  const handle = { now: options.now ?? GATEWAY_NOW, setNow(date) { handle.now = date; } };
  // The rate-limit library reads Date.now() itself, so a limited gateway gets a scoped override that follows
  // the scenario's clock; the After hook restores it.
  if ((options.rateLimitPerMinute ?? 0) > 0) holdDateNow(() => handle.now.getTime());
  // The public validator reaches no network: an origin it is asked about is answered from this gateway's own subject route.
  const selfFetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    return fetch(`${handle.base}/${url.hostname}${url.pathname}${url.search}`, init);
  };
  handle.gw = await gatewayApp.createGateway({
    config,
    log: () => undefined,
    now: handle.now,
    clock: () => handle.now,
    fetchImpl: null,
    env: {},
    validator: options.validator === undefined ? { fetchImpl: selfFetch, lookup: async () => ["93.184.216.34"] } : options.validator,
  });
  await new Promise((r) => handle.gw.server.listen(0, "127.0.0.1", r));
  handle.base = `http://127.0.0.1:${handle.gw.server.address().port}`;
  handle.close = () => new Promise((r) => handle.gw.server.close(() => r()));
  return handle;
}

// ---- the World -----------------------------------------------------------------------------------------

/** Publisher subclass that honours only some of the four parameters. */
class RestrictedPublisher extends publisher.Publisher {
  constructor(adapter, options, honours) {
    super(adapter, options);
    this.honours = honours;
  }

  honor(query) {
    const honored = super.honor(query);
    return Object.fromEntries(Object.entries(honored).filter(([name]) => this.honours.includes(name)));
  }
}

class World {
  constructor() {
    this.now = DEFAULT_NOW;
    this.doc = undefined;
    this.docText = undefined;
    this.lastSet = "doc";
    this.result = undefined;
    this.read = undefined;
    this.keys = new Map();
    this.policy = {};
    this.sig = undefined;
    this.sigs = [];
    this.sigNotes = [];
    this.input = undefined;
    this.adapter = undefined;
    this.publisherConfig = {};
    this.buildPromise = undefined;
    this.publisher = undefined;
    this.heldRows = undefined;
    this.publisherServer = undefined;
    this.serverOptions = {};
    this.base = undefined;
    this.response = undefined;
    this.statuses = [];
    this.requests = [];
    this.servers = [];
    this.fetchResult = undefined;
    this.walkVisited = undefined;
    this.written = undefined;
    this.gatewayDataFile = undefined;
    this.lastFetchParams = {};
    this.lastOrigin = undefined;
    this.connections = [];
    this.recorder = async (input) => {
      this.connections.push(typeof input === "string" ? input : input.url);
      return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    };
    this.total = undefined;
    this.totalRefusal = undefined;
    this.presented = undefined;
    this.upstream = { docs: new Map(), log: [] };
    this.walkOptions = {};
    this.comparisons = undefined;
    this.credentials = new Map();
    this.attestationOptions = {};
    this.attestation = undefined;
    this.attestationReads = [];
    this.gatewayHandle = undefined;
    this.dirs = [];
    this.run = undefined;
    this.answers = undefined;
    this.upgrade = undefined;
    this.csvText = undefined;
    this.csvConfig = {};
    this.adapterOutput = undefined;
    this.retrievedFrom = undefined;
    this.forwarded = undefined;
    this.operatorWarnings = [];
    this.verified = undefined;
    this.relayed = undefined;
    this.check = undefined;
    this.publishedText = undefined;
    this.walkError = undefined;
    this.heldOptions = undefined;
  }

  // -- clock

  setClock(text) {
    this.now = new Date(text);
    this.gatewayHandle?.setNow(this.now);
  }

  /** The `updated` a publisher writes when its input gives none: the fixed clock, in whole seconds. */
  clockText() {
    return this.now.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  // -- the subject

  setDoc(doc) {
    this.doc = doc;
    this.docText = undefined;
    this.lastSet = "doc";
  }

  /** A valid declaration object, when no step has made one: a scenario may begin with "the object is signed". */
  ensureDoc() {
    if (this.doc === undefined) this.setDoc(baseDeclaration());
  }

  mutateDoc(edit) {
    edit(this.doc);
    this.docText = undefined;
    this.lastSet = "doc";
  }

  /** The object or array the next step is about: the document, or the body of the last response. */
  subject() {
    if (this.lastSet === "response") return this.response.json();
    if (this.lastSet === "fetch") return this.fetchResult.document;
    return this.doc;
  }

  /** The subject as a list of objects. */
  subjectObjects() {
    const s = this.subject();
    return Array.isArray(s) ? s : [s];
  }

  /** Read the subject in "strict" mode (as served) or "compatibility" mode (the older forms converted), and validate it. */
  readAs(mode) {
    const document = structuredClone(this.subject());
    const report = { converted: [], disregarded: [] };
    if (mode === "compatibility") consumer.readDocument(document, report);
    const checked = consumer.validateDocument(document);
    this.read = { mode, document, ...report };
    this.result = { valid: checked.valid, errors: checked.errors, warnings: checked.warnings.map((w) => `${w.code}: ${w.message}`), raw: checked };
    return this.result;
  }

  // -- signatures

  async namedKey(name, alg = "Ed25519") {
    if (!this.keys.has(name)) this.keys.set(name, await publisher.generateSigningKey(alg));
    return this.keys.get(name);
  }

  /** A copy of doc with a signed member: the publisher signs Ed25519 and ES256, this signs "EdDSA" the way the older revision did. */
  async signObject(doc, key, { alg } = {}) {
    if (alg === undefined || alg === key.alg) return publisher.signDeclaration(doc, key);
    const payload = withoutSigned(doc);
    const header = { alg, cty: publisher.SIGNED_CTY, jwk: publisher.embeddedJwk(key) };
    const signed = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader(header).sign(key.privateKey);
    return { ...payload, signed };
  }

  /** Verify every object of the subject through fetchSustainability on a loopback server; sets sig, sigs, sigNotes. */
  async verifySubject() {
    const served = this.subject();
    const base = await this.serveText(JSON.stringify(served));
    this.lastOrigin = base;
    const result = await consumer.fetchSustainability(base, { allowInsecure: true, timeoutMs: 5_000, verifySignature: true, signaturePolicy: { ...this.policy } });
    if (result.status !== "ok") throw new Error(`the subject could not be fetched for verification: ${JSON.stringify(result).slice(0, 400)}`);
    this.sigs = result.signatures ?? [];
    this.sig = this.sigs[0];
    this.sigNotes = result.warnings ?? [];
    this.verified = result;
    return result;
  }

  // -- servers

  async listen(server) {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    this.servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }

  /** A loopback server answering the well-known path with a fixed body; every request is recorded. */
  async serveText(body, { status = 200, contentType = MEDIA_TYPE, headers = {} } = {}) {
    const server = createServer((req, res) => {
      this.requests.push({ method: req.method, url: req.url, headers: req.headers });
      if (!req.url.startsWith(WELL_KNOWN)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      res.writeHead(status, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff", ...headers });
      res.end(req.method === "HEAD" || status === 204 ? undefined : body);
    });
    return this.listen(server);
  }

  async send(method, path, headers = {}) {
    const res = await fetch(`${this.base}${path}`, { method, headers, redirect: "manual" });
    const bytes = Buffer.from(await res.arrayBuffer());
    const body = bytes.toString("utf8");
    this.response = { status: res.status, headers: res.headers, body, bytes, json: () => JSON.parse(body) };
    this.lastSet = "response";
    return this.response;
  }

  /** fetchSustainability against base, allowing the http scheme and loopback; never throws. */
  async fetchLocal(params = {}, extra = {}) {
    this.lastFetchParams = params;
    this.lastOrigin = this.base;
    try {
      this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 5_000, ...params, ...extra });
    } catch (e) {
      this.fetchResult = { status: "threw", error: String(e.message ?? e) };
    }
    if (this.fetchResult.status === "ok") this.lastSet = "fetch";
    return this.fetchResult;
  }

  /** What the command-line consumer says about the origin last fetched, with the signature checked. */
  async presentation() {
    if (!this.presented || this.presented.origin !== this.lastOrigin) {
      const r = await runNode([BIN.consumer, this.lastOrigin, "--allow-http", "--verify"]);
      this.presented = { origin: this.lastOrigin, status: r.status, stdout: r.stdout, stderr: r.stderr };
    }
    return this.presented;
  }

  // -- the publisher

  /** Merge into the publisher input. The input is a publisher of its own: it replaces a held publisher and an adapter. */
  inputPatch(patch) {
    this.input = { ...(this.input ?? rawMetrics()), ...patch };
    this.publisher = undefined;
    this.adapter = undefined;
    this.invalidateBuild();
  }

  invalidateBuild() {
    this.buildPromise = undefined;
  }

  /** The publisher this scenario is about: a held one, else one built from the adapter, the input or the document. */
  currentPublisher() {
    if (this.publisher) return this.publisher;
    const config = this.publisherConfig;
    const options = {
      cacheTtlMs: 0,
      normalize: { target: "example.com", targetType: "origin", clock: () => this.clockText(), ...config.normalize },
      security: config.security,
      signing: config.signing,
      representation: config.representation,
      onWarning: (message) => this.operatorWarnings.push(message),
    };
    let adapter = this.adapter;
    if (!adapter) {
      const data = this.input ?? (this.doc === undefined ? rawMetrics() : this.rawFromDocument());
      const declared = this.input === undefined ? this.subjectObjects()[0]?.capabilities : undefined;
      adapter = publisher.staticAdapter({ data, capabilities: config.capabilities ?? declared ?? "basic" });
    }
    return new publisher.Publisher(adapter, options);
  }

  rawFromDocument() {
    const objects = this.subjectObjects().map((o) => publisher.fromWire(o, { legacyCompat: false }));
    return objects.length === 1 ? objects[0] : objects;
  }

  /** Build once per change of input: { objects, warnings, error }. The warnings are the operator's: hook messages and validation findings. */
  built() {
    this.buildPromise ??= this.runBuild();
    return this.buildPromise;
  }

  async runBuild() {
    this.operatorWarnings = [];
    try {
      const document = await this.currentPublisher().build({});
      const objects = Array.isArray(document) ? document : [document];
      for (const object of objects) {
        // The day floor is the safeguards' to report, once, by the dayFloor option; the gate's own wording of it is not the operator's log.
        for (const w of publisher.validateDocument(object, { legacyCompat: false }).warnings) {
          if (w.code !== "period-below-day-floor") this.operatorWarnings.push(`${w.code}: ${w.message}`);
        }
      }
      return { objects, warnings: this.operatorWarnings, error: undefined };
    } catch (error) {
      return { objects: [], warnings: this.operatorWarnings, error };
    }
  }

  /**
   * An extended publisher holding one object per row ({ label, start, end, target }), in the order given. Each object
   * carries its label in the LABEL_EXTENSION extension, so labelOf(object) names it again. Options: honours (the
   * parameters it honours, default all four), signing (a key; every object is signed), security.
   */
  async holdPeriods(rows, { honours, signing, security } = {}) {
    this.heldRows = rows;
    this.heldOptions = { honours, signing, security };
    const held = rows.map((row) =>
      rawMetrics({
        period: { start: row.start, end: row.end },
        target: row.target,
        capabilities: "extended",
        extensions: { [LABEL_EXTENSION]: { label: row.label } },
      }),
    );
    const adapter = { name: "held", capabilities: "extended", fetch: async () => held };
    const options = {
      cacheTtlMs: 0,
      normalize: { target: "example.com", clock: () => this.clockText() },
      security: { dayFloor: "off", ...security },
      signing: signing ? { key: signing } : undefined,
      onWarning: (message) => this.operatorWarnings.push(message),
    };
    this.operatorWarnings = [];
    this.publisher = honours ? new RestrictedPublisher(adapter, options, honours) : new publisher.Publisher(adapter, options);
    this.adapter = undefined;
    if (this.publisherServer) await this.servePublisher();
  }

  /** Hold the same rows again with other options (for example, only some parameters honoured). */
  reholdWith(options) {
    // With nothing held yet, the publisher holds one entry, January 2026 of example.com.
    const rows = this.heldRows ?? [{ label: "2026-01", ...periodFromText("2026-01"), target: "example.com" }];
    return this.holdPeriods(rows, { ...this.heldOptions, ...options });
  }

  labelOf(object) {
    return object.extensions?.[LABEL_EXTENSION]?.label;
  }

  /** Serve the current publisher (or, with staticFile, the document as a plain file) on a loopback port; replaces an earlier one. */
  async servePublisher({ staticFile = false } = {}) {
    if (this.publisherServer) {
      await new Promise((r) => this.publisherServer.close(() => r()));
      this.servers = this.servers.filter((s) => s !== this.publisherServer);
      this.publisherServer = undefined;
    }
    let server;
    if (staticFile) {
      const body = this.docText ?? JSON.stringify(this.doc);
      server = createServer((req, res) => {
        this.requests.push({ method: req.method, url: req.url, headers: req.headers });
        res.writeHead(req.url.startsWith(WELL_KNOWN) ? 200 : 404, { "Content-Type": req.url.startsWith(WELL_KNOWN) ? MEDIA_TYPE : "application/json", "X-Content-Type-Options": "nosniff" });
        res.end(req.method === "HEAD" ? undefined : req.url.startsWith(WELL_KNOWN) ? body : "{}");
      });
    } else {
      this.operatorWarnings = [];
      server = publisher.createSustainabilityServer(this.currentPublisher(), { onError: () => undefined, ...this.serverOptions });
      server.on("request", (req) => this.requests.push({ method: req.method, url: req.url, headers: req.headers }));
    }
    this.base = await this.listen(server);
    this.publisherServer = server;
    return this.base;
  }

  // -- the gateway

  /** The gateway of this scenario, started on first use at GATEWAY_NOW (or the options' now). */
  async gateway(options = {}) {
    if (!this.gatewayHandle) {
      this.gatewayHandle = await startGateway({ now: GATEWAY_NOW, ...options });
      this.servers.push(this.gatewayHandle.gw.server);
    }
    this.base = this.gatewayHandle.base;
    return this.gatewayHandle;
  }

  // -- the upstream chain

  chainUri(i) {
    return `https://provider${i}.example${WELL_KNOWN}`;
  }

  /** A fetch that answers from upstream.docs (a declaration, or { status, contentType, body }) and logs every URI asked for. */
  upstreamFetch() {
    return async (input) => {
      const url = typeof input === "string" ? input : input.url;
      this.upstream.log.push(url);
      const entry = this.upstream.docs.get(url);
      if (entry === undefined) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
      if (entry.body === undefined) return new Response(JSON.stringify(entry), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
      return new Response(entry.body, { status: entry.status ?? 200, headers: { "Content-Type": entry.contentType ?? MEDIA_TYPE } });
    };
  }

  // -- files and programs

  tempDir(name = "run") {
    const dir = mkdtempSync(join(tmpdir(), `bdd-${name}-`));
    this.dirs.push(dir);
    return dir;
  }

  /** A copy of the gateway's data directory with the given files ({ name: json }) added; for a gateway that starts on it. */
  gatewayDataDir(extra = {}) {
    const dir = this.tempDir("gateway-data");
    cpSync(join(ROOT, "gateway", "data"), dir, { recursive: true });
    for (const [name, json] of Object.entries(extra)) writeFileSync(join(dir, name), JSON.stringify(json, null, 2));
    return dir;
  }

  /** Add an extension to the create-sustainability-data answers when the tool is the subject, else to the document. */
  addExtension(name, object) {
    if (this.answers) (this.answers.extension ??= []).push(`${name}=${JSON.stringify(object)}`);
    else this.mutateDoc((d) => (d.extensions = { ...(d.extensions ?? {}), [name]: object }));
  }

  /** Every file under dir as { relative path: text }. */
  filesUnder(dir, prefix = "") {
    const out = {};
    let entries;
    try {
      entries = readdirSync(join(dir, prefix));
    } catch (e) {
      if (e.code === "ENOENT") return out;
      throw e;
    }
    for (const entry of entries) {
      const relative = prefix === "" ? entry : `${prefix}/${entry}`;
      if (statSync(join(dir, relative)).isDirectory()) Object.assign(out, this.filesUnder(dir, relative));
      else out[relative] = readFileSync(join(dir, relative), "utf8");
    }
    return out;
  }

  writeFileIn(dir, relative, text) {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }
}

setWorldConstructor(World);

After(async function () {
  restoreDateNow();
  for (const server of this.servers) await new Promise((r) => (server.listening ? server.close(() => r()) : r()));
  for (const dir of this.dirs) rmSync(dir, { recursive: true, force: true });
});
