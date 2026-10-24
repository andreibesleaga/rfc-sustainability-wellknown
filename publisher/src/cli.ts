/**
 * CLI / config loader. Builds a {@link Publisher} from a JSON config and either
 * starts the standalone server or prints one document (`--once`).
 *
 * Config shape:
 * {
 *   "adapter":  { "type": "computed", "options": { ... } },
 *   "publisher":{ "normalize": {...}, "security": {...}, "cacheTtlMs": 0 },
 *   "server":   { "port": 8080, "maxAge": 86400 }
 * }
 *
 * `publisher.normalize.target` sets the mandatory `target` member (the
 * reporting subject) for adapters that do not supply one themselves; for an
 * origin-wide report use the origin's host (e.g. "example.com").
 */
import {
  carbonTxtApiAdapter,
  climatiqAdapter,
  co2jsAdapter,
  computedAdapter,
  csvAdapter,
  keplerPrometheusAdapter,
  msSustainabilityAdapter,
  salesforceNzcAdapter,
  slurmSacctAdapter,
  staticAdapter,
  staticFileAdapter,
  watershedAdapter,
} from "./adapters";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { emitCarbonTxt } from "./carbontxt";
import { CarbonTxtServeOptions, RateLimitOptions } from "./handler";
import { parseStrict } from "./json";
import {
  assertSignedMatches,
  exportPrivateJwk,
  generateSigningKey,
  importSigningKey,
  pemToX5c,
  signDocument,
  SigningAlg,
  SigningKey,
} from "./jws";
import { Publisher, PublisherOptions } from "./publisher";
import { createSustainabilityServer } from "./server";
import { SourceAdapter, SustainabilityDocument } from "./types";
import { upgradeOptionsError, UpgradeOptions, upgradeText } from "./upgrade";
import { readJson } from "./util";
import { assertValid, validateDocument } from "./validate";

const ADAPTER_FACTORIES: Record<string, (opts: any) => SourceAdapter> = {
  static: staticAdapter,
  "static-file": staticFileAdapter,
  computed: computedAdapter,
  "kepler-prometheus": keplerPrometheusAdapter,
  climatiq: climatiqAdapter,
  co2js: co2jsAdapter,
  "carbontxt-api": carbonTxtApiAdapter,
  "salesforce-nzc": salesforceNzcAdapter,
  "ms-sustainability": msSustainabilityAdapter,
  watershed: watershedAdapter,
  csv: csvAdapter,
  "slurm-sacct": slurmSacctAdapter,
};

export interface PublisherConfig {
  adapter: { type: string; options: Record<string, unknown> };
  publisher?: Omit<PublisherOptions, "signing">;
  /**
   * Signing configuration (draft §Signing). `keyFile` is the path of a private
   * JWK file as written by `keygen --out`; the environment variable
   * `SUSTAINABILITY_SIGNING_KEY` (the JWK JSON itself) takes precedence, so a
   * container platform can inject the key without a file. With a key
   * configured, every declaration object the publisher emits carries the
   * `signed` member; `keyId` puts that identifier in the JWS header as `kid`
   * instead of embedding the public key as `jwk`. `x5cFile` is a PEM file with
   * a certificate chain for the key, leaf first; the header then carries `x5c`
   * instead of `jwk`.
   */
  signing?: { keyFile?: string; keyId?: string; x5cFile?: string };
  server?: {
    port?: number;
    maxAge?: number;
    /** The language of the response, sent as `Content-Language`. */
    contentLanguage?: string;
    extraPaths?: string[];
    /** When set, also serve a bidirectional carbon.txt. */
    carbonTxt?: CarbonTxtServeOptions;
    /** Requests per client address per window; over it the server answers 429. Unset, no limit. */
    rateLimit?: RateLimitOptions;
  };
}

export function buildAdapter(type: string, options: Record<string, unknown>): SourceAdapter {
  const factory = ADAPTER_FACTORIES[type];
  if (!factory) {
    throw new Error(
      `Unknown adapter type "${type}". Known: ${Object.keys(ADAPTER_FACTORIES).join(", ")}`,
    );
  }
  return factory(options);
}

export function buildPublisher(config: PublisherConfig, signingKey?: SigningKey): Publisher {
  const adapter = buildAdapter(config.adapter.type, config.adapter.options ?? {});
  return new Publisher(adapter, {
    onWarning: (message) => process.stderr.write(`sustainability-publisher: warning: ${message}\n`),
    ...(config.publisher ?? {}),
    ...(signingKey
      ? {
          signing: {
            key: signingKey,
            keyId: config.signing?.keyId,
            x5c: config.signing?.x5cFile ? pemToX5c(readFileSync(config.signing.x5cFile, "utf8")) : undefined,
          },
        }
      : {}),
  });
}

interface CliArgs {
  config?: string;
  once: boolean;
  port?: number;
  emitCarbonTxt: boolean;
  noiseDisclosed: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { once: false, emitCarbonTxt: false, noiseDisclosed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--config" || a === "-c") out.config = value();
    else if (a === "--once") out.once = true;
    else if (a === "--emit-carbon-txt") out.emitCarbonTxt = true;
    else if (a === "--noise-disclosed") out.noiseDisclosed = true;
    else if (a === "--port" || a === "-p") {
      out.port = Number(value());
      if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) throw new Error(`${a} needs a port number`);
    } else throw new Error(`unknown argument "${a}"`);
  }
  return out;
}

const USAGE =
  "Usage: sustainability-publisher --config <config.json> [--once] [--emit-carbon-txt] [--port <n>] [--noise-disclosed]\n" +
  "       sustainability-publisher keygen [--alg Ed25519|ES256] [--out <private.jwk>]\n" +
  "       sustainability-publisher sign <in.json> <out.json> --key <private.jwk> [--kid <id>] [--x5c <chain.pem>]\n" +
  "       sustainability-publisher upgrade <in.json> [<out.json>] [--check] [--updated <date-time>] [--offset <+hh:mm>] [--measurement-method <token>]\n" +
  "       sustainability-sign <in.json> <out.json> --key <private.jwk> [--kid <id>] [--x5c <chain.pem>]\n";

/**
 * Resolve the signing key for the server from the environment (the JWK JSON
 * in `SUSTAINABILITY_SIGNING_KEY`) or the config's `signing.keyFile`.
 * Undefined when neither is set: the publisher then does not sign.
 */
export async function loadSigningKey(
  config: PublisherConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SigningKey | undefined> {
  const fromEnv = env.SUSTAINABILITY_SIGNING_KEY;
  if (fromEnv && fromEnv.trim() !== "") return importSigningKey(fromEnv);
  const file = config.signing?.keyFile;
  if (file) return importSigningKey(readFileSync(file, "utf8"));
  return undefined;
}

/**
 * `keygen`: generate a key pair, write the PRIVATE JWK to `--out` (mode 0600,
 * directories created) and print only the PUBLIC JWK to stdout — the file
 * goes into the deployment's secret store, the printed key is what gets hosted.
 */
export async function runKeygen(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<void> {
  let alg: SigningAlg = "Ed25519";
  let outFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--alg") {
      const v = argv[++i];
      if (v === "EdDSA") throw new Error('keygen: --alg EdDSA is not generated; the key is Ed25519 and signs with "Ed25519" (RFC 9864): use --alg Ed25519');
      if (v !== "Ed25519" && v !== "ES256") throw new Error(`keygen: --alg must be Ed25519 or ES256 (got "${v}")`);
      alg = v;
    } else if (a === "--out") outFile = argv[++i];
    else throw new Error(`keygen: unknown argument "${a}"`);
  }
  const key = await generateSigningKey(alg);
  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true, mode: 0o700 });
    const privateJwk = await exportPrivateJwk(key);
    writeFileSync(outFile, JSON.stringify(privateJwk, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  }
  out.write(JSON.stringify(key.publicJwk, null, 2) + "\n");
}

/**
 * `sign`: the offline signing path for static hosts (draft, Appendix A, step 7
 * — "a publisher on static hosting produces the same object with an offline
 * tool that signs and writes one file"). Reads a declaration file (one object
 * or an array, every object signed individually), validates it, inserts the
 * `signed` member as each object's last member and writes the result to
 * `<out.json>`. `--kid` identifies an out-of-band key instead of embedding the
 * public key as `jwk`. `--x5c` is a PEM file with the certificate chain of the
 * key, leaf first: the header carries it as `x5c` instead of `jwk`, and the
 * leaf must hold the signing key.
 *
 * `<in.json>` and `<out.json>` may be the same path: the output is written only
 * after the input has been read, parsed, validated and signed.
 */
export async function runSign(argv: string[], out: NodeJS.WritableStream = process.stdout): Promise<void> {
  const positional: string[] = [];
  let keyFile: string | undefined;
  let keyId: string | undefined;
  let x5cFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`sign: ${a} needs a value`);
      return argv[++i];
    };
    if (a === "--key") keyFile = value();
    else if (a === "--kid") keyId = value();
    else if (a === "--x5c") x5cFile = value();
    else if (a.startsWith("-")) throw new Error(`sign: unknown argument "${a}"`);
    else positional.push(a);
  }
  const [inFile, outFile] = positional;
  if (positional.length > 2) throw new Error(`sign: unexpected argument "${positional[2]}"`);
  if (!inFile) throw new Error("sign: an input declaration file is required");
  if (!outFile) throw new Error("sign: an output file is required (sign <in.json> <out.json>)");
  if (!keyFile) throw new Error("sign: --key <private.jwk> is required");

  const key = await importSigningKey(readFileSync(keyFile, "utf8"));
  let document: SustainabilityDocument;
  try {
    document = parseStrict(readFileSync(inFile, "utf8")) as SustainabilityDocument;
  } catch (e) {
    throw new Error(`sign: ${inFile} is not valid I-JSON (${(e as Error).message})`);
  }
  // Never sign a document that could not be published: the signature would
  // attest to a non-conformant object.
  assertValid(document);
  for (const warning of validateDocument(document, { legacyCompat: false }).warnings) {
    process.stderr.write(`sign: warning: ${warning.message}\n`);
  }
  const x5c = x5cFile !== undefined ? pemToX5c(readFileSync(x5cFile, "utf8")) : undefined;
  const signed = await signDocument(document, key, { ...(keyId !== undefined ? { keyId } : {}), ...(x5c !== undefined ? { x5c } : {}) });
  // Draft §Signing: never write out an object whose `signed` payload differs
  // from the object it accompanies, and never a payload carrying `signed`
  // itself (a re-signed file's previous signature is dropped, not nested).
  assertSignedMatches(signed);
  const path = dirname(outFile);
  if (path && path !== ".") mkdirSync(path, { recursive: true });
  writeFileSync(outFile, JSON.stringify(signed, null, 2) + "\n");
  const count = Array.isArray(signed) ? signed.length : 1;
  out.write(`signed ${count} declaration object${count === 1 ? "" : "s"} (${key.alg}) -> ${outFile}\n`);
}

export interface UpgradeStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/**
 * `upgrade`: convert a declaration file written for -08 or -09 to the current
 * form (draft, Appendices B.1 and C.1), and say what was converted. The result
 * goes to standard output; with `<out.json>` it is written there, and the input
 * is replaced only when the same path is given twice. The result is built in
 * memory and written once, so a file that cannot be converted leaves no output.
 * `--check` writes nothing. The notes go to standard error, so that standard
 * output holds the document alone.
 *
 * Returns the exit status: 0 when the file is converted, or has nothing to
 * convert (with `--check`, only the latter); 1 when it cannot be converted, or
 * with `--check` would be changed; 2 for a usage error.
 */
export function runUpgrade(
  argv: string[],
  streams: UpgradeStreams = { stdout: process.stdout, stderr: process.stderr },
): number {
  const { stdout, stderr } = streams;
  const positional: string[] = [];
  const options: UpgradeOptions = {};
  let check = false;
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      const value = () => {
        if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
        return argv[++i];
      };
      if (a === "--check") check = true;
      else if (a === "--offset") options.offset = value();
      else if (a === "--updated") options.updated = value();
      else if (a === "--measurement-method") options.measurementMethod = value() as UpgradeOptions["measurementMethod"];
      else if (a.startsWith("-")) throw new Error(`unknown argument "${a}"`);
      else positional.push(a);
    }
    if (positional.length === 0) throw new Error("an input declaration file is required");
    if (positional.length > 2) throw new Error(`unexpected argument "${positional[2]}"`);
    const problem = upgradeOptionsError(options);
    if (problem !== undefined) throw new Error(problem);
  } catch (e) {
    stderr.write(`upgrade: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }

  const [inFile, outFile] = positional;
  let text: string;
  try {
    text = readFileSync(inFile, "utf8");
  } catch (e) {
    stderr.write(`upgrade: ${inFile} cannot be read (${(e as Error).message})\n`);
    return 1;
  }
  const result = upgradeText(text, options);
  for (const note of result.notes) stderr.write(`upgrade: ${inFile}: ${note.message}\n`);
  for (const warning of result.warnings) stderr.write(`upgrade: ${inFile}: warning: ${warning}\n`);
  if (result.errors.length > 0) {
    for (const error of result.errors) stderr.write(`upgrade: ${inFile}: ${error}\n`);
    return 1;
  }
  const changed = result.notes.length > 0;
  if (!changed) stderr.write(`upgrade: ${inFile}: nothing to change\n`);
  if (check) return changed ? 1 : 0;

  const converted = result.text as string;
  if (outFile === undefined) stdout.write(converted);
  else if (resolve(outFile) !== resolve(inFile) || changed) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, converted);
  }
  return 0;
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv[0] === "keygen") return runKeygen(argv.slice(1));
  if (argv[0] === "sign") return runSign(argv.slice(1));
  if (argv[0] === "upgrade") {
    process.exitCode = runUpgrade(argv.slice(1));
    return;
  }

  const args = parseArgs(argv);
  if (!args.config) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  const config = readJson<PublisherConfig>(args.config);
  if (args.noiseDisclosed) {
    config.publisher = { ...config.publisher, security: { ...config.publisher?.security, noiseDisclosed: true } };
  }

  if (args.emitCarbonTxt) {
    const serve = config.server?.carbonTxt;
    if (!serve?.sustainabilityUrl) {
      throw new Error(
        "--emit-carbon-txt requires server.carbonTxt.sustainabilityUrl in the config",
      );
    }
    process.stdout.write(emitCarbonTxt({ ...serve, sustainabilityUrl: serve.sustainabilityUrl }));
    return;
  }

  const signingKey = await loadSigningKey(config);
  const publisher = buildPublisher(config, signingKey);

  if (args.once) {
    const doc = await publisher.getDocument();
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return;
  }

  const port = args.port ?? config.server?.port ?? 8080;
  const server = createSustainabilityServer(publisher, {
    maxAge: config.server?.maxAge,
    contentLanguage: config.server?.contentLanguage,
    extraPaths: config.server?.extraPaths,
    carbonTxt: config.server?.carbonTxt,
    rateLimit: config.server?.rateLimit,
  });
  server.listen(port, () => {
    process.stdout.write(
      `sustainability-publisher listening on http://localhost:${port}/.well-known/sustainability-data\n` +
        (signingKey
          ? `signing enabled (${signingKey.alg}, ${config.signing?.keyId ? `kid ${config.signing.keyId}` : config.signing?.x5cFile ? "certificate chain as x5c" : "key embedded as jwk"}); ` +
            "every declaration object carries the signed member\n"
          : ""),
    );
  });
}
