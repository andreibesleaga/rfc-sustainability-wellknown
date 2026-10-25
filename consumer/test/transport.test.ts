/**
 * The transport rules (draft -10 §Location and Transport, §Security
 * Considerations): https on every hop, certificate and host name verified, the
 * address checked where the connection is made, user information refused, and
 * the time, size and redirects of every fetch bounded.
 *
 * No test touches live DNS or the network: servers are on 127.0.0.1, names are
 * resolved by an injected resolver, and the TLS tests use a test CA committed
 * under fixtures/tls.
 */
import { readFileSync } from "node:fs";
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAttestation } from "../src/attestation";
import { fetchDisclosure } from "../src/disclosure";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { yearPeriod } from "../src/period";
import { BodyTooLargeError, connectLookup, isBlockedAddress, readBodyCapped, secureGet } from "../src/transport";
import { compareUpstream } from "../src/upstream";
import { ALLOW_INSECURE, listenTls, PUBLIC_LOOKUP, TEST_CA } from "./helpers";

const DOC = {
  updated: "2026-01-01T00:00:00Z",
  capabilities: "basic",
  provider: "T",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://t.example/m",
  period: yearPeriod(2025),
  target: "t.example",
  "energy-consumption": 1,
  "energy-unit": "kWh",
};
const BODY = JSON.stringify(DOC);
const TYPE = { "Content-Type": "application/sustainability-data+json" };

const servers: Server[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  while (closers.length) await closers.pop()!();
});

type Handler = Parameters<typeof createServer>[1];
function listen(handler: Handler): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((resolveUrl) => {
    s.listen(0, "127.0.0.1", () => resolveUrl(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}
const portOf = (base: string): string => new URL(base).port;

/** A fetch that records every URL it is asked for, so "never requested" is testable. */
function recording(respond?: (url: string) => Response): { impl: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  const impl = (async (url: string) => {
    asked.push(String(url));
    return respond ? respond(String(url)) : new Response(BODY, { status: 200, headers: TYPE });
  }) as unknown as typeof fetch;
  return { impl, asked };
}

describe("an address may be connected to only when it is public unicast", () => {
  const refused = [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.5.5",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.0.1",
    "192.0.0.8",
    "224.0.0.1",
    "255.255.255.255",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
    "64:ff9b::a00:1", // NAT64 of 10.0.0.1
    "2002:7f00:1::1", // 6to4 of 127.0.0.1
    "2001::1", // Teredo
  ];
  const allowed = ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"];

  for (const address of refused) it(`refuses ${address}`, () => expect(isBlockedAddress(address)).toBe(true));
  for (const address of allowed) it(`allows ${address}`, () => expect(isBlockedAddress(address)).toBe(false));

  it("treats a string that is not an IP address as no address at all", () => {
    expect(isBlockedAddress("not-an-address")).toBe(false);
    expect(isBlockedAddress("[::1]")).toBe(true);
  });

  it("the connect-time lookup refuses when any answer is not allowed, and answers both calling conventions", async () => {
    const asked: string[] = [];
    const lookup = connectLookup(async (host) => {
      asked.push(host);
      return host === "split.test" ? ["93.184.216.34", "127.0.0.1"] : ["93.184.216.34", "2606:4700::1111"];
    }, true);
    const call = (host: string, all: boolean) =>
      new Promise<{ err: Error | null; address: unknown; family: unknown }>((done) =>
        lookup(host, { all }, ((err: Error | null, address: unknown, family: unknown) => done({ err, address, family })) as never),
      );
    const one = await call("public.test", false);
    expect(one).toMatchObject({ err: null, address: "93.184.216.34", family: 4 });
    const many = await call("public.test", true);
    expect(many.address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1111", family: 6 },
    ]);
    // One blocked answer among public ones is enough: the shape a rebinding attack takes.
    expect((await call("split.test", true)).err?.message).toMatch(/split.test resolves to 127.0.0.1/);
    expect(asked).toEqual(["public.test", "public.test", "split.test"]);
  });

  it("with enforcement off the same answers pass", async () => {
    const lookup = connectLookup(async () => ["127.0.0.1"], false);
    const answer = await new Promise<unknown>((done) => lookup("dev.test", {}, ((err: Error | null, address: unknown) => done(err ?? address)) as never));
    expect(answer).toBe("127.0.0.1");
  });
});

describe("the address is checked at the connection the request makes", () => {
  it("refuses a name that resolves to a loopback address, asks the resolver once, and connects nowhere", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const asked: string[] = [];
    const r = await secureGet(new URL(`http://inside.test:${portOf(base)}${WELL_KNOWN_PATH}`), {
      timeoutMs: 5_000,
      allowInsecure: true,
      allowPrivateAddresses: false,
      lookup: async (host) => {
        asked.push(host);
        return ["127.0.0.1"];
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe("blocked-address");
    expect(r.refusal.detail).toContain("inside.test resolves to 127.0.0.1");
    expect(asked).toEqual(["inside.test"]);
    expect(hits).toBe(0);
  });

  it("connects to the address the resolver returned, once per connection, when private addresses are allowed", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const asked: string[] = [];
    const r = await fetchSustainability(`http://named.test:${portOf(base)}`, {
      ...ALLOW_INSECURE,
      lookup: async (host) => {
        asked.push(host);
        return ["127.0.0.1"];
      },
    });
    expect(r.status).toBe("ok");
    expect(asked).toEqual(["named.test"]);
    expect(hits).toBe(1);
  });

  it("checks a literal IP host before connecting, because it never reaches the resolver", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const r = await fetchSustainability(base, {
      allowInsecure: true,
      allowPrivateAddresses: false,
      lookup: async () => {
        throw new Error("the resolver must not be called for a literal IP host");
      },
    });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("blocked-address");
    expect(r.detail).toContain("the host is 127.0.0.1");
    expect(hits).toBe(0);
  });

  it("refuses a redirect to a literal private address before requesting it", async () => {
    const { impl, asked } = recording((url) =>
      url.includes("outside.example")
        ? new Response(null, { status: 302, headers: { Location: "https://10.0.0.5/.well-known/sustainability-data" } })
        : new Response(BODY, { status: 200, headers: TYPE }),
    );
    const r = await fetchSustainability("https://outside.example", { fetchImpl: impl });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("blocked-address");
    expect(r.url).toContain("10.0.0.5");
    expect(asked).toHaveLength(1);
  });

  it("refuses a final URL on a private address for a transport that followed redirects itself", async () => {
    const fetchImpl = (async () => {
      const res = new Response(BODY, { status: 200, headers: TYPE });
      Object.defineProperty(res, "url", { value: "https://192.168.0.9/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    const r = await fetchSustainability("https://outside.example", { fetchImpl });
    expect(r.status).toBe("refused-uri");
    expect(r.status === "refused-uri" && r.detail).toContain("192.168.0.9");
  });

  it("refuses a literal public-looking form of a blocked address (NAT64, 6to4, mapped)", async () => {
    for (const host of ["[64:ff9b::7f00:1]", "[2002:7f00:1::1]", "[::ffff:127.0.0.1]", "100.64.0.1", "198.18.0.1", "224.0.0.1"]) {
      const { impl, asked } = recording();
      const r = await fetchSustainability(`https://${host}`, { fetchImpl: impl });
      expect(r.status, host).toBe("refused-uri");
      expect(asked, host).toEqual([]);
    }
    for (const host of ["8.8.8.8", "[2606:4700::1111]", "[::ffff:8.8.8.8]"]) {
      expect((await fetchSustainability(`https://${host}`, { fetchImpl: recording().impl })).status, host).toBe("ok");
    }
  });

  it("allowPrivateAddresses opts out on its own and keeps the https requirement", async () => {
    const { impl, asked } = recording();
    expect((await fetchSustainability("https://10.0.0.1", { fetchImpl: impl, allowPrivateAddresses: true })).status).toBe("ok");
    expect(asked).toHaveLength(1);
    expect((await fetchSustainability("http://10.0.0.1", { fetchImpl: impl, allowPrivateAddresses: true })).status).toBe("insecure-transport");
  });

  it("allowInsecure permits http and loopback only: a private or link-local address stays refused", async () => {
    for (const host of ["10.0.0.1", "192.168.1.1", "169.254.169.254", "[fe80::1]", "[fd12:3456::1]"]) {
      const { impl, asked } = recording();
      const r = await fetchSustainability(`http://${host}`, { fetchImpl: impl, allowInsecure: true });
      expect(r.status, host).toBe("refused-uri");
      expect(asked, host).toEqual([]);
    }
    for (const host of ["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]"]) {
      expect((await fetchSustainability(`http://${host}`, { fetchImpl: recording().impl, allowInsecure: true })).status, host).toBe("ok");
    }
    const { impl } = recording();
    const both = await fetchSustainability("http://10.0.0.1", { fetchImpl: impl, allowInsecure: true, allowPrivateAddresses: true });
    expect(both.status).toBe("ok");
  });

  it("allowInsecure alone lets the connect-time check pass loopback but not a private answer", async () => {
    const lookup = connectLookup(async (host) => [host === "lo.test" ? "127.0.0.1" : "10.0.0.5"], true, true);
    const call = (host: string) => new Promise<Error | null>((done) => lookup(host, {}, ((err: Error | null) => done(err)) as never));
    expect(await call("lo.test")).toBeNull();
    expect((await call("lan.test"))?.message).toMatch(/lan.test resolves to 10.0.0.5/);
  });

  it("guards the upstream walk, the disclosure fetch and the attestation fetch alike", async () => {
    const { impl, asked } = recording();
    const subject = { ...DOC, upstream: [{ declaration: "https://169.254.169.254/.well-known/sustainability-data", role: "cloud" }] } as never;
    const [comparison] = await compareUpstream(subject, { fetchImpl: impl, timeoutMs: 5_000, maxBytes: 10_000, maxObjects: 10 });
    expect(comparison.verdict).toBe("unreachable");
    expect(comparison.detail).toContain("blocked-address");
    await expect(fetchDisclosure("https://169.254.169.254/d", impl)).rejects.toThrow(/blocked-address/);
    const attestation = await verifyAttestation("https://169.254.169.254/vc", { fetchImpl: impl });
    expect(attestation.valid === false && attestation.reason).toBe("blocked-address");
    expect(asked).toEqual([]);
  });

  it("an upstream whose name resolves inward is reported, not followed", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const subject = { ...DOC, upstream: [{ declaration: `http://inside.test:${portOf(base)}/p` }] } as never;
    const [comparison] = await compareUpstream(subject, {
      timeoutMs: 5_000,
      maxBytes: 10_000,
      maxObjects: 10,
      allowInsecure: true,
      allowPrivateAddresses: false,
      lookup: async () => ["127.0.0.1"],
    });
    expect(comparison.detail).toContain("blocked-address");
    expect(hits).toBe(0);
  });
});

describe("user information is refused", () => {
  it("refuses a URI carrying userinfo, with no opt-out, and never echoes the credentials", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://alice:hunter2@outside.example", { fetchImpl: impl, ...PUBLIC_LOOKUP });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("userinfo-in-uri");
    expect(asked).toEqual([]);
    expect(`${r.url} ${r.detail}`).not.toContain("hunter2");
    expect(`${r.url} ${r.detail}`).not.toContain("alice");
    const again = await fetchSustainability("https://alice:hunter2@outside.example", { fetchImpl: impl, allowInsecure: true, allowPrivateAddresses: true });
    expect(again.status).toBe("refused-uri");
  });

  it("refuses user information in a redirect target", async () => {
    const { impl, asked } = recording((url) =>
      url.includes("outside.example") ? new Response(null, { status: 302, headers: { Location: "https://u:p@other.example/x" } }) : new Response(BODY, { status: 200, headers: TYPE }),
    );
    const r = await fetchSustainability("https://outside.example", { fetchImpl: impl });
    expect(r.status === "refused-uri" && r.reason).toBe("userinfo-in-uri");
    expect(asked).toHaveLength(1);
  });
});

describe("https on every hop", () => {
  it("without allowInsecure an http URL is refused before it is requested", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(200);
      res.end(BODY);
    });
    expect((await fetchSustainability(base)).status).toBe("insecure-transport");
    expect(await verifyAttestation(`${base}/a.jwt`)).toMatchObject({ valid: false, reason: "not-https-uri" });
    await expect(fetchDisclosure(`${base}/d`)).rejects.toThrow(/https/);
    expect(hits).toBe(0);
  });

  it("an https origin redirecting to http is refused, and the http hop is never requested", async () => {
    const { impl, asked } = recording((url) =>
      url.startsWith("https://")
        ? new Response(null, { status: 301, headers: { Location: "http://plain.example/.well-known/sustainability-data" } })
        : new Response(BODY, { status: 200, headers: TYPE }),
    );
    const r = await fetchSustainability("https://secure.example", { fetchImpl: impl, ...PUBLIC_LOOKUP });
    expect(r.status).toBe("insecure-transport");
    expect(r.status === "insecure-transport" && r.detail).toContain("reached through a redirect");
    expect(asked).toEqual(["https://secure.example/.well-known/sustainability-data"]);
  });

  it("an https to https redirect is followed", async () => {
    const { impl, asked } = recording((url) =>
      url.includes("first.example")
        ? new Response(null, { status: 308, headers: { Location: "https://second.example/.well-known/sustainability-data" } })
        : new Response(BODY, { status: 200, headers: TYPE }),
    );
    const r = await fetchSustainability("https://first.example", { fetchImpl: impl });
    expect(r.status === "ok" && r.url).toBe("https://second.example/.well-known/sustainability-data");
    expect(asked).toHaveLength(2);
  });

  it("allowInsecure permits an http loopback test server", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    expect((await fetchSustainability(base, ALLOW_INSECURE)).status).toBe("ok");
  });

  it("a same-origin-pinned fetch refuses a cross-origin redirect without contacting that origin", async () => {
    let otherHits = 0;
    const other = await listen((_req, res) => {
      otherHits++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const base = await listen((_req, res) => {
      res.writeHead(302, { Location: `${other}${WELL_KNOWN_PATH}` });
      res.end();
    });
    const r = await secureGet(new URL(base + WELL_KNOWN_PATH), { timeoutMs: 5_000, allowInsecure: true, sameOrigin: base });
    expect(!r.ok && r.refusal.reason).toBe("cross-origin-redirect");
    expect(otherHits).toBe(0);
  });

  it("a document redirect to another origin is followed and the result is attributed to the final URL", async () => {
    const final = await listen((_req, res) => {
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    const base = await listen((_req, res) => {
      res.writeHead(307, { Location: `${final}${WELL_KNOWN_PATH}` });
      res.end();
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status === "ok" && r.url).toBe(`${final}${WELL_KNOWN_PATH}`);
  });
});

describe("time, size and redirects are bounded", () => {
  it("follows five redirects and stops at the sixth", async () => {
    let hits = 0;
    const base = await listen((req, res) => {
      hits++;
      const n = Number(new URL(req.url ?? "/", "http://x").searchParams.get("n") ?? "0");
      if (n < 5) {
        res.writeHead(302, { Location: `${WELL_KNOWN_PATH}?n=${n + 1}` });
        res.end();
        return;
      }
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    expect((await fetchSustainability(base, ALLOW_INSECURE)).status).toBe("ok");
    expect(hits).toBe(6);
  });

  it("a redirect loop ends after the sixth request with a too-many-redirects result, not a hang", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(302, { Location: WELL_KNOWN_PATH });
      res.end();
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status).toBe("too-many-redirects");
    expect(r.status === "too-many-redirects" && r.detail).toMatch(/more than 5 redirects/);
    expect(hits).toBe(6);
  });

  it("a chain of seven distinct redirects is the same result", async () => {
    const base = await listen((req, res) => {
      const n = Number(new URL(req.url ?? "/", "http://x").searchParams.get("n") ?? "0");
      res.writeHead(302, { Location: `${WELL_KNOWN_PATH}?n=${n + 1}` });
      res.end();
    });
    expect((await fetchSustainability(base, ALLOW_INSECURE)).status).toBe("too-many-redirects");
  });

  it("a server that never answers times out", async () => {
    const base = await listen(() => undefined);
    expect(await fetchSustainability(base, { ...ALLOW_INSECURE, timeoutMs: 150 })).toEqual({ status: "timeout", timeoutMs: 150 });
  });

  it("a chunked oversized body is cut off, never buffered", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/vc+jwt" });
      res.write("a".repeat(40_000));
      res.write("b".repeat(40_000));
      res.end("c");
    });
    const r = await verifyAttestation(`${base}/big.jwt`, { ...ALLOW_INSECURE, maxBytes: 65_536 });
    expect(r).toMatchObject({ valid: false, reason: "too-large" });
    expect(r.valid === false && r.detail).toMatch(/exceeds maxBytes \(65536\)/);
  });

  it("a gzip body that expands past the limit is cut off, counting the bytes after decoding", async () => {
    const zeros = gzipSync(Buffer.alloc(2_000_000));
    expect(zeros.length).toBeLessThan(10_000);
    const base = await listen((_req, res) => {
      res.writeHead(200, { ...TYPE, "Content-Encoding": "gzip" });
      res.end(zeros);
    });
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, maxBytes: 100_000 });
    expect(r.status).toBe("too-large");
  });

  it("a stream that never ends is cut at the limit", async () => {
    let closed = false;
    const base = await listen((req, res) => {
      res.writeHead(200, TYPE);
      const timer = setInterval(() => res.write("x".repeat(10_000)), 1);
      req.on("close", () => {
        closed = true;
        clearInterval(timer);
      });
    });
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, maxBytes: 50_000 });
    expect(r.status).toBe("too-large");
    await new Promise((done) => setTimeout(done, 100));
    expect(closed).toBe(true);
  });

  it("an advertised Content-Length over the limit is refused unread", async () => {
    const { impl } = recording(() => new Response("x".repeat(20), { status: 200, headers: { ...TYPE, "Content-Length": "20" } }));
    const res = (await secureGet(new URL("https://a.example/"), { fetchImpl: impl, timeoutMs: 1000 })) as { ok: true; res: Response };
    await expect(readBodyCapped(res.res, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("a chunked oversized disclosure page is refused the same way", async () => {
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode("x".repeat(100_000)));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as unknown as typeof fetch;
    await expect(fetchDisclosure("https://d.example/d", fetchImpl)).rejects.toThrow(/exceeds maxBytes/);
  });
});

describe("certificate and host name are verified on every https connection", () => {
  /** One TLS server presenting `fixture`, reached as good.test through an injected resolver; counts the requests that got through. */
  async function tlsFetch(fixture: string, options: { ca?: string } = { ca: TEST_CA }) {
    let served = 0;
    const server = await listenTls(fixture, (_req, res) => {
      served++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    closers.push(server.close);
    const result = await fetchSustainability(`https://good.test:${server.port}`, {
      allowPrivateAddresses: true,
      lookup: async () => ["127.0.0.1"],
      ...options,
    });
    return { result, served: () => served };
  }

  it("accepts a certificate from the trusted test CA that names the host", async () => {
    const { result, served } = await tlsFetch("good");
    expect(result.status).toBe("ok");
    expect(served()).toBe(1);
  });

  it("accepts a leaf below an intermediate when the server sends the chain", async () => {
    expect((await tlsFetch("chained")).result.status).toBe("ok");
  });

  for (const [fixture, why] of [
    ["expired", "an expired certificate"],
    ["wrong-host", "a certificate for another host name"],
    ["self-signed", "a self-signed certificate"],
    ["untrusted", "a certificate from an issuer that is not trusted"],
  ] as const) {
    it(`refuses ${why}, and no request, so no body, is read`, async () => {
      let served = 0;
      const server = await listenTls(fixture, (_req, res) => {
        served++;
        res.writeHead(200, TYPE);
        res.end(BODY);
      });
      closers.push(server.close);
      const options = { allowPrivateAddresses: true, lookup: async () => ["127.0.0.1"], ca: TEST_CA };
      await expect(fetchSustainability(`https://good.test:${server.port}`, options)).rejects.toThrow(/did not verify/);
      const got = await secureGet(new URL(`https://good.test:${server.port}/`), { timeoutMs: 5_000, ...options });
      expect(!got.ok && got.refusal.reason).toBe("tls-error");
      expect(served).toBe(0);
    });
  }

  it("a certificate from the test CA is not trusted unless the CA is added", async () => {
    await expect(
      (async () => {
        const { result } = await tlsFetch("good", {});
        return result;
      })(),
    ).rejects.toThrow(/did not verify/);
  });

  it("offers no member that switches verification off", async () => {
    let served = 0;
    const server = await listenTls("self-signed", (_req, res) => {
      served++;
      res.writeHead(200, TYPE);
      res.end(BODY);
    });
    closers.push(server.close);
    const hostile = { rejectUnauthorized: false, insecure: true, strictSSL: false, verify: false, allowSelfSigned: true } as never;
    await expect(
      fetchSustainability(`https://good.test:${server.port}`, { allowPrivateAddresses: true, lookup: async () => ["127.0.0.1"], ...(hostile as object) }),
    ).rejects.toThrow(/did not verify/);
    expect(served).toBe(0);
    const source = readFileSync(resolve(process.cwd(), "src", "transport.ts"), "utf8");
    expect(source).not.toMatch(/rejectUnauthorized/);
    expect(readFileSync(resolve(process.cwd(), "src", "cli.ts"), "utf8")).not.toMatch(/rejectUnauthorized|--insecure|--no-verify/);
  });
});
