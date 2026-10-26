/**
 * Tests for runCli() argument handling.
 *
 * These exist because the first live deployment of the well-known URI could not
 * be verified with the documented command: the CLI read argv[0] as the origin,
 * so `--strict <origin>` (and the bin name that `npx <pkg> sustainability-fetch`
 * passes through) landed in `new URL()` and threw a bare "Invalid URL".
 *
 * NOTE: the fixture server serves `application/json` on purpose — the generic
 * type the draft still has consumers process, and which the battery reports as
 * WARN. It listens on plain HTTP, so the runs below pass `--allow-http`, the
 * flag that opts out of the draft's HTTPS MUST.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { normalizeOrigin, runCli } from "../src/cli";
import { WELL_KNOWN_PATH } from "../src/fetch";
import { DECLARATION_CTY } from "../src/jws";

const EXAMPLE_DOC = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "CLI Test Co",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://cli.example/methodology",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "cli.example",
  "energy-consumption": 100,
  "energy-unit": "kWh",
  "carbon-footprint": 40,
  "carbon-unit": "kgCO2e",
};

let server: Server | undefined;
/** Extra fixture servers a single test starts (an upstream, a dead credential host). */
const extraServers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  while (extraServers.length) {
    const s = extraServers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function startServer(): Promise<string> {
  const body = JSON.stringify(EXAMPLE_DOC);
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WELL_KNOWN_PATH) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", ETag: '"cli-test"' });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/** Captures stdout so the document a run prints can be asserted on. */
function captureStdout() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

describe("runCli() argument handling", () => {
  it("accepts options after the origin", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli([origin, "--format=ndjson", "--allow-http"]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("accepts options BEFORE the origin", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli(["--format=ndjson", "--allow-http", origin]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("ignores a leading bin-name token, as `npx <pkg> sustainability-fetch ...` passes through", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli(["sustainability-fetch", origin, "--allow-http"]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("resolves prefixed base URLs and full document URLs (gateway pattern)", async () => {
    const { resolveWellKnownUrl } = await import("../src/fetch");
    // plain origin: well-known at the root
    expect(resolveWellKnownUrl("https://example.org").toString()).toBe(
      "https://example.org/.well-known/sustainability-data",
    );
    // base with a path prefix (multi-subject gateway): resolved UNDER the prefix
    expect(resolveWellKnownUrl("https://gateway.example/cloudflare.com").toString()).toBe(
      "https://gateway.example/cloudflare.com/.well-known/sustainability-data",
    );
    expect(resolveWellKnownUrl("https://gateway.example/cloudflare.com/").toString()).toBe(
      "https://gateway.example/cloudflare.com/.well-known/sustainability-data",
    );
    // full document URL: used as-is
    expect(resolveWellKnownUrl("https://example.org/.well-known/sustainability-data").toString()).toBe(
      "https://example.org/.well-known/sustainability-data",
    );
    expect(
      resolveWellKnownUrl("https://gateway.example/x.com/.well-known/sustainability-data").toString(),
    ).toBe("https://gateway.example/x.com/.well-known/sustainability-data");
  });

  it("fetches through a prefixed base URL end-to-end", async () => {
    // Server publishes ONLY under /subject.example/.well-known/... — the root
    // well-known 404s, so a prefix-stripping regression fails this test.
    const body = JSON.stringify(EXAMPLE_DOC);
    const prefixed = "/subject.example" + WELL_KNOWN_PATH;
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== prefixed) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", ETag: '"prefix-test"' });
        res.end(body);
      });
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server!.address() as AddressInfo;
    const out = captureStdout();

    const code = await runCli([`http://127.0.0.1:${port}/subject.example`, "--format=ndjson", "--allow-http"]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("promotes a bare hostname to https and rejects non-http schemes", () => {
    expect(normalizeOrigin("example.org")).toBe("https://example.org/");
    expect(normalizeOrigin("https://example.org")).toBe("https://example.org/");
    expect(normalizeOrigin("http://example.org")).toBe("http://example.org/");
    expect(normalizeOrigin("file:///etc/passwd")).toBeUndefined();
    expect(normalizeOrigin("::not a url::")).toBeUndefined();
  });

  it("reports an unusable origin cleanly instead of throwing", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    const code = await runCli(["::not a url::"]);

    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Not a usable origin");
  });

  it("prints usage for --help and exits 0", async () => {
    const out = captureStdout();
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Usage: sustainability-fetch");
    // The -06 escape hatch is documented in the usage text, not just accepted.
    expect(out.join("\n")).toContain("--allow-http");
  });

  it("prints usage and exits 2 when no origin is given", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const code = await runCli([]);
    expect(code).toBe(2);
    expect(errors.join("\n")).toContain("Usage: sustainability-fetch");
  });
});

describe("-10: the CLI's HTTPS requirement and the --allow-http escape hatch", () => {
  it("refuses an http:// origin without --allow-http, in one line naming the flag", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    let requests = 0;
    const origin = await new Promise<string>((resolve) => {
      server = createServer((_req, res) => {
        requests++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${port}`);
      });
    });

    const code = await runCli([origin]);

    expect(code).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("--allow-http");
    expect(errors[0]).toContain("HTTPS");
    // Refused before any request was made — no loopback exemption.
    expect(requests).toBe(0);
  });

  it("fetches the same origin with --allow-http", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli([origin, "--allow-http", "--format=ndjson"]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("still promotes a bare hostname to https (the flag changes nothing there)", () => {
    expect(normalizeOrigin("example.org")).toBe("https://example.org/");
  });

  it("--strict against an origin serving the generic application/json prints WARN and still exits 0", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli([origin, "--strict", "--allow-http"]);

    const lines = out.join("\n");
    const mediaTypeLine = out.find((l) => l.includes("media type"));
    expect(mediaTypeLine).toBeDefined();
    expect(mediaTypeLine?.startsWith("WARN")).toBe(true);
    expect(mediaTypeLine).toContain("[MUST]");
    expect(mediaTypeLine).toContain("generic media type");
    expect(lines).toContain("application/sustainability-data+json");
    // A warn never sets the exit code — only a failed MUST does.
    expect(code).toBe(0);
  });
});

describe("--verify, --upstream and --verify-attestation", () => {
  function captureStderr() {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    return lines;
  }

  /** Serve one body (a declaration, signed or not) from a second fixture server. */
  function startWith(body: unknown, extra?: (req: IncomingMessage, res: ServerResponse) => boolean): Promise<string> {
    const text = JSON.stringify(body);
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        if (extra && extra(req, res)) return;
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== WELL_KNOWN_PATH) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json", ETag: '"cli-verify"' });
        res.end(text);
      });
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
    });
  }

  const DECLARATION = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "CLI Test Co",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://cli.example/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "cli.example",
    "energy-consumption": 100,
    "energy-unit": "kWh",
  };

  async function signed(object: Record<string, unknown>, alg = "Ed25519"): Promise<Record<string, unknown>> {
    const key = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const publicJwk = { ...(await jose.exportJWK(key.publicKey)), kid: "cli-key" };
    const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(object)))
      .setProtectedHeader({ alg, cty: DECLARATION_CTY, kid: "cli-key", jwk: publicJwk })
      .sign(key.privateKey);
    return { ...object, signed: jws };
  }

  it("--verify prints the signature outcome on stderr and keeps the declaration on stdout", async () => {
    const origin = await startWith(await signed(DECLARATION));
    const out = captureStdout();
    const err = captureStderr();
    const code = await runCli([origin, "--verify", "--allow-http"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).target).toBe("cli.example");
    const line = err.find((l) => l.startsWith("signature:"));
    expect(line).toMatch(/^signature: integrity verified Ed25519 kid=\S*cli-key\S*: the holder of the key with thumbprint [A-Za-z0-9_-]{43} signed the other members of this object only/);
    // What it does not say: that the provider signed, or that a figure is accurate.
    expect(line).toContain("accuracy unknown");
    expect(line).toContain("not the array around it, the HTTP header fields or the retrieval URI");
    expect(line).not.toMatch(/signed by|accurate|\btrue\b/);
  });

  it("--verify on an EdDSA-signed origin names the identifier as deprecated", async () => {
    const origin = await startWith(await signed(DECLARATION, "EdDSA"));
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--verify", "--allow-http"])).toBe(0);
    expect(err.find((l) => l.startsWith("signature:"))).toMatch(/^signature: integrity verified EdDSA \(deprecated identifier, same algorithm as Ed25519\) kid=\S*cli-key/);
  });

  it("--require-signed exits 1 and names the unsigned object", async () => {
    const origin = await startWith(DECLARATION);
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--require-signed", "--allow-http"])).toBe(1);
    expect(err.join("\n")).toContain("object 1 is unsigned");
  });

  it("--verify against an unsigned origin reports `unsigned`, exit 0", async () => {
    const origin = await startServer();
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--verify", "--allow-http"])).toBe(0);
    expect(err.find((l) => l.startsWith("signature:"))).toContain("unsigned");
  });

  it("--verify reports an unverifiable signature without changing the exit code", async () => {
    const good = await signed(DECLARATION);
    const origin = await startWith({ ...DECLARATION, signed: (good.signed as string).slice(0, -4) + "AAAA" });
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--verify", "--allow-http"])).toBe(0);
    expect(err.find((l) => l.startsWith("signature:"))).toMatch(/unverified .* not false/);
  });

  it("--upstream says so when the declaration names no upstream providers", async () => {
    const origin = await startServer();
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--upstream", "--allow-http"])).toBe(0);
    expect(err.find((l) => l.startsWith("upstream:"))).toContain("none");
  });

  it("--upstream prints a verdict per upstream and says it is evidence, never proof", async () => {
    // The upstream is served from a second origin; both are local.
    const upstreamDoc = { ...DECLARATION, target: "tenant-1", "target-type": "tenant", "energy-consumption": 40 };
    const upstreamOrigin = await new Promise<string>((resolve) => {
      const s2 = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== WELL_KNOWN_PATH) return void res.writeHead(404).end();
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
        res.end(JSON.stringify(upstreamDoc));
      });
      extraServers.push(s2);
      s2.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s2.address() as AddressInfo).port}`));
    });
    const origin = await startWith({
      ...DECLARATION,
      upstream: [{ declaration: `${upstreamOrigin}${WELL_KNOWN_PATH}`, role: "cloud" }],
    });
    captureStdout();
    const err = captureStderr();
    // A plain-http upstream is only followed because --allow-http is set.
    expect(await runCli([origin, "--upstream", "--allow-http"])).toBe(0);
    const lines = err.filter((l) => l.startsWith("upstream:"));
    expect(lines.some((l) => l.includes("consistent"))).toBe(true);
    expect(lines.some((l) => l.includes("never proof"))).toBe(true);
  });

  it("--verify-attestation on a declaration without the member says so and does not fail", async () => {
    const origin = await startServer();
    captureStdout();
    const err = captureStderr();
    expect(await runCli([origin, "--verify-attestation", "--allow-http"])).toBe(0);
    expect(err.find((l) => l.startsWith("attestation:"))).toContain("none");
  });

  it("--strict --verify-attestation exits 1 when the credential cannot be retrieved", async () => {
    // The credential URI is an https URL (as the draft requires) pointing at a
    // plain-HTTP local port: the TLS handshake fails, so the credential cannot
    // be retrieved. No live network is involved.
    const dead = createServer((_req, res) => res.writeHead(404).end());
    extraServers.push(dead);
    const deadBase = await new Promise<string>((resolve) =>
      dead.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(dead.address() as AddressInfo).port}`)),
    );
    const origin = await startWith({
      ...DECLARATION,
      "verifiable-attestation-uri": `${deadBase.replace("http:", "https:")}/a.vc.jwt`,
    });
    captureStdout();
    const err = captureStderr();
    const code = await runCli([origin, "--strict", "--verify-attestation", "--allow-http"]);
    expect(code).toBe(1);
    expect(err.find((l) => l.startsWith("attestation:"))).toMatch(/^attestation: invalid \((tls-error|network-error)/);
  });
});

describe("flags, output and exit codes", () => {
  const stderr = () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    return lines;
  };

  /** Serve `body` (any value) for every well-known request and record the URLs. */
  function startRecording(body: unknown): Promise<{ origin: string; asked: string[] }> {
    const asked: string[] = [];
    const text = JSON.stringify(body);
    return new Promise((resolve) => {
      server = createServer((req, res) => {
        asked.push(req.url ?? "");
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json", ETag: '"flags"' });
        res.end(text);
      });
      server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, asked }));
    });
  }

  const month = (n: number) => ({
    ...EXAMPLE_DOC,
    period: { start: `2025-${String(n).padStart(2, "0")}-01T00:00:00Z`, end: n === 12 ? "2026-01-01T00:00:00Z" : `2025-${String(n + 1).padStart(2, "0")}-01T00:00:00Z` },
  });

  it("--period is gone: it prints the migration line and exits 2 before any request", async () => {
    const { origin, asked } = await startRecording(EXAMPLE_DOC);
    const err = stderr();
    expect(await runCli([origin, "--period=2025", "--allow-http"])).toBe(2);
    expect(err.join("\n")).toContain("--period is gone since draft -10: use --start=<date-time> and --end=<date-time>");
    expect(asked).toEqual([]);
  });

  it("--help does not mention --period=", async () => {
    const out = captureStdout();
    await runCli(["--help"]);
    expect(out.join("\n")).not.toContain("--period");
    expect(out.join("\n")).toContain("--start=");
  });

  it("an unknown option, a flag without its value and a value on a switch are usage errors", async () => {
    const { origin, asked } = await startRecording(EXAMPLE_DOC);
    for (const bad of ["--stict", "--start", "--target=", "--strict=yes", "--format=xml", "--max-bytes=0", "--max-objects=many", "--timeout=-1"]) {
      const err = stderr();
      expect(await runCli([origin, bad, "--allow-http"]), bad).toBe(2);
      expect(err.join("\n"), bad).toContain("Usage: sustainability-fetch");
      vi.restoreAllMocks();
    }
    expect(asked).toEqual([]);
  });

  it("rejects a malformed --start or --end before any request, with the reason", async () => {
    const { origin, asked } = await startRecording(EXAMPLE_DOC);
    for (const bad of ["--start=2025-02-30", "--end=2025-02-30T00:00:00Z", "--start=2025-01-01t00:00:00z", "--start=yesterday"]) {
      const err = stderr();
      expect(await runCli([origin, bad, "--allow-http"]), bad).toBe(2);
      expect(err.join("\n"), bad).toContain(`--${bad.slice(2, bad.indexOf("="))}:`);
      vi.restoreAllMocks();
    }
    expect(asked).toEqual([]);
  });

  it("rejects a granularity outside the three tokens", async () => {
    const err = stderr();
    expect(await runCli(["https://example.org", "--granularity=weekly"])).toBe(2);
    expect(err.join("\n")).toContain("--granularity must be one of yearly, monthly, daily");
  });

  it("sends --start with an offset as UTC with Z, and the other parameters as given", async () => {
    const { origin, asked } = await startRecording([EXAMPLE_DOC]);
    captureStdout();
    stderr();
    const code = await runCli([
      origin, "--allow-http", "--start=2025-01-01T08:00:00+08:00", "--end=2026-01-01T00:00:00Z", "--granularity=yearly", "--target=cli.example",
    ]);
    expect(code).toBe(0);
    const q = new URL(asked[0], "http://x").searchParams;
    expect(q.get("start")).toBe("2025-01-01T00:00:00Z");
    expect(q.get("end")).toBe("2026-01-01T00:00:00Z");
    expect(q.get("granularity")).toBe("yearly");
    expect(q.get("target")).toBe("cli.example");
  });

  it("sends --start=2025-01 --end=2025-03 as the first quarter in UTC date-times", async () => {
    const { origin, asked } = await startRecording([EXAMPLE_DOC]);
    captureStdout();
    stderr();
    expect(await runCli([origin, "--allow-http", "--start=2025-01", "--end=2025-03"])).toBe(0);
    const q = new URL(asked[0], "http://x").searchParams;
    expect([q.get("start"), q.get("end")]).toEqual(["2025-01-01T00:00:00Z", "2025-04-01T00:00:00Z"]);
  });

  it("an empty array prints [] and a note, and exits 0", async () => {
    const { origin } = await startRecording([]);
    const out = captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--start=2030-01-01T00:00:00Z"])).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual([]);
    expect(err.join("\n")).toContain("empty array");
  });

  it("--format=csv has the two period columns and the source of every row", async () => {
    const { origin } = await startRecording([month(1), month(2)]);
    const out = captureStdout();
    stderr();
    expect(await runCli([origin, "--allow-http", "--format=csv"])).toBe(0);
    const rows = out.join("\n").split("\n");
    expect(rows[0]).toContain("source-url,claimed-by,signature,provider,target");
    expect(rows[0]).toContain("period-start,period-end");
    expect(rows).toHaveLength(3);
    for (const row of rows.slice(1)) expect(row.startsWith(`${origin}/.well-known/sustainability-data,${origin},`)).toBe(true);
    expect(rows[2]).toContain("2025-02-01T00:00:00Z,2025-03-01T00:00:00Z");
  });

  it("--format=ndjson wraps each object in its source and claimant", async () => {
    const { origin } = await startRecording([month(1), month(2)]);
    const out = captureStdout();
    stderr();
    expect(await runCli([origin, "--allow-http", "--format=ndjson", "--verify"])).toBe(0);
    const lines = out.join("\n").split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ "source-url": `${origin}/.well-known/sustainability-data`, "claimed-by": origin, signature: "unsigned" });
    expect(lines[1].declaration.period.start).toBe("2025-02-01T00:00:00Z");
  });

  it("every run says whose claim the figures are, and that retrieval checks nothing", async () => {
    const { origin } = await startRecording(EXAMPLE_DOC);
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http"])).toBe(0);
    expect(err.join("\n")).toContain(`claim: every figure above is a claim of ${origin}`);
    expect(err.join("\n")).toContain("retrieval does not check it");
  });

  it("--total prints the sum of twelve months under the rule of Section 5.3", async () => {
    const { origin } = await startRecording(Array.from({ length: 12 }, (_, i) => month(i + 1)));
    const out = captureStdout();
    stderr();
    expect(await runCli([origin, "--allow-http", "--total"])).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({
      target: "cli.example",
      "energy-consumption": 1200,
      "energy-unit": "kWh",
      "carbon-footprint": 480,
      "carbon-unit": "kgCO2e",
      coverage: "contiguous",
      objects: 12,
      period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    });
  });

  it("--total over a year and one of its months is refused with the reason, exit 1", async () => {
    const { origin } = await startRecording([EXAMPLE_DOC, month(1)]);
    const out = captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--total"])).toBe(1);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("total refused (overlapping-periods)");
  });

  it("converts an old-format declaration by default, says so line by line, and not under --strict", async () => {
    const old: Record<string, unknown> = { ...EXAMPLE_DOC, "reporting-period": "2025" };
    delete old.period;
    const { origin } = await startRecording(old);
    const out = captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http"])).toBe(0);
    expect(JSON.parse(out.join("\n")).period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(err.join("\n")).toMatch(/compatibility: converted period/);
    vi.restoreAllMocks();
    captureStdout();
    expect(await runCli([origin, "--allow-http", "--strict"])).toBe(1);
  });

  it("--strict prints the section of every check and the capabilities", async () => {
    const { origin } = await startRecording(EXAMPLE_DOC);
    const out = captureStdout();
    expect(await runCli([origin, "--allow-http", "--strict"])).toBe(0);
    expect(out.join("\n")).toContain("(Query Parameters)");
    expect(out).toContain("capabilities: basic");
  });

  it("--conformance is the same as --strict", async () => {
    const { origin } = await startRecording(EXAMPLE_DOC);
    const out = captureStdout();
    expect(await runCli([origin, "--allow-http", "--conformance"])).toBe(0);
    expect(out.join("\n")).toContain("PASS");
  });

  it("--strict exits 1 when a MUST fails (an origin that refuses a bad query value)", async () => {
    const origin = await new Promise<string>((resolve) => {
      server = createServer((req, res) => {
        const q = new URL(req.url ?? "/", "http://x").searchParams;
        if (q.get("granularity") === "Monthly") return void res.writeHead(400).end();
        res.writeHead(200, { "Content-Type": "application/sustainability-data+json", ETag: '"x"' });
        res.end(JSON.stringify(EXAMPLE_DOC));
      });
      server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
    });
    const out = captureStdout();
    expect(await runCli([origin, "--allow-http", "--strict"])).toBe(1);
    expect(out.find((l) => l.startsWith("FAIL"))).toContain("Query Parameters");
  });

  it("--disclosure makes no request and says so when the declaration has no disclosure-uri", async () => {
    const { origin, asked } = await startRecording(EXAMPLE_DOC);
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--disclosure"])).toBe(0);
    expect(err.join("\n")).toContain("disclosure: none");
    expect(asked).toHaveLength(1);
  });

  it("--disclosure resolves a relative reference against the URL retrieved from, and an http one is refused, exit unchanged", async () => {
    const { origin, asked } = await startRecording({ ...EXAMPLE_DOC, "disclosure-uri": "/reports/index.json" });
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--disclosure"])).toBe(0);
    expect(err.join("\n")).toContain(`refusing to dereference "${origin}/reports/index.json"`);
    expect(err.join("\n")).toContain("could not be retrieved");
    expect(err.join("\n")).toContain("only https URIs");
    expect(asked).toHaveLength(1);
  });

  it("--max-objects bounds what is accepted", async () => {
    const { origin } = await startRecording([month(1), month(2), month(3)]);
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--max-objects=2"])).toBe(1);
    expect(err.join("\n")).toContain("above this consumer's limit of 2");
  });

  it("a redirect loop exits 1 with the reason, not a stack trace", async () => {
    server = createServer((_req, res) => {
      res.writeHead(302, { Location: WELL_KNOWN_PATH });
      res.end();
    });
    const origin = await new Promise<string>((resolve) =>
      server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)),
    );
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http"])).toBe(1);
    expect(err.join("\n")).toContain("Too many redirects");
  });

  it("--allow-http alone does not reach a private address; --allow-private is the separate flag", async () => {
    captureStdout();
    const err = stderr();
    expect(await runCli(["http://10.0.0.1", "--allow-http"])).toBe(1);
    expect(err.join("\n")).toContain("blocked-address");
    expect(err.join("\n")).toContain("--allow-private");
  });

  it("--follow-upstream is --upstream", async () => {
    const { origin } = await startRecording(EXAMPLE_DOC);
    captureStdout();
    const err = stderr();
    expect(await runCli([origin, "--allow-http", "--follow-upstream"])).toBe(0);
    expect(err.find((l) => l.startsWith("upstream:"))).toContain("none");
  });
});
