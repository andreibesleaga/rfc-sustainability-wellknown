/**
 * Tests for runCli() argument handling.
 *
 * These exist because the first live deployment of the well-known URI could not
 * be verified with the documented command: the CLI read argv[0] as the origin,
 * so `--strict <origin>` (and the bin name that `npx <pkg> sustainability-fetch`
 * passes through) landed in `new URL()` and threw a bare "Invalid URL".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";
import * as fs from "node:fs";
import { normalizeOrigin, runCli } from "../src/cli";
import { WELL_KNOWN_PATH } from "../src/fetch";

const EXAMPLE_DOC = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../example-responses/example-response.json"), "utf8"),
);

let server: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    const s = server;
    server = undefined;
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

    const code = await runCli([origin, "--format=ndjson"]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("accepts options BEFORE the origin", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli(["--format=ndjson", origin]);

    expect(code).toBe(0);
    expect(out.join("\n")).toContain('"target"');
  });

  it("ignores a leading bin-name token, as `npx <pkg> sustainability-fetch ...` passes through", async () => {
    const origin = await startServer();
    const out = captureStdout();

    const code = await runCli(["sustainability-fetch", origin]);

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

    const code = await runCli([`http://127.0.0.1:${port}/subject.example`, "--format=ndjson"]);

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
