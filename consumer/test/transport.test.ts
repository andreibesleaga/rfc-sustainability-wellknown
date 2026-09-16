/**
 * The transport rules, checked at the hop: HTTPS on every hop, and the
 * same-origin pin available to callers that need one — both decided BEFORE a
 * hop is requested, so an excluded origin is never contacted. Also the
 * streaming byte cap on chunked bodies, redirect loops, and final-URL
 * attribution.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAttestation } from "../src/attestation";
import { fetchDisclosure } from "../src/disclosure";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { isBlockedAddress, secureGet } from "../src/transport";
import { compareUpstream } from "../src/upstream";
import { ALLOW_INSECURE, PUBLIC_LOOKUP } from "./helpers";

const DOC = {
  updated: "2026-01-01T00:00:00Z",
  capabilities: "basic",
  provider: "T",
  "measurement-method": "m",
  "methodology-uri": "https://t.example/m",
  "reporting-period": "2026-01",
  target: "t.example",
  "energy-consumption": 1,
  "energy-unit": "kWh",
};
const BODY = JSON.stringify(DOC);

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

type Handler = Parameters<typeof createServer>[1];
function listen(handler: Handler): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
}

describe("redirect hops are judged before they are requested", () => {
  it("a same-origin-pinned fetch refuses a cross-origin redirect without contacting that origin", async () => {
    let otherHits = 0;
    const other = await listen((_req, res) => {
      otherHits++;
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY);
    });
    const base = await listen((_req, res) => {
      res.writeHead(302, { Location: `${other}${WELL_KNOWN_PATH}` });
      res.end();
    });
    const r = await secureGet(new URL(base + WELL_KNOWN_PATH), {
      timeoutMs: 5_000,
      allowInsecure: true,
      sameOrigin: base,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.refusal.reason).toBe("cross-origin-redirect");
    expect(otherHits).toBe(0);
  });

  it("a document redirect to another origin is followed and the result is attributed to the final URL", async () => {
    const final = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY);
    });
    const base = await listen((_req, res) => {
      res.writeHead(307, { Location: `${final}${WELL_KNOWN_PATH}` });
      res.end();
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.url).toBe(`${final}${WELL_KNOWN_PATH}`);
  });

  it("a redirect loop ends after five hops as an error, not a hang", async () => {
    let hits = 0;
    const base = await listen((_req, res) => {
      hits++;
      res.writeHead(302, { Location: WELL_KNOWN_PATH });
      res.end();
    });
    await expect(fetchSustainability(base, ALLOW_INSECURE)).rejects.toThrow(/more than 5 redirects/);
    expect(hits).toBe(6);
  });

  it("without allowInsecure, an http hop is refused before it is requested", async () => {
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
});

describe("bodies are read under a streaming byte cap", () => {
  it("a chunked (no Content-Length) oversized attestation body is cut off, never buffered", async () => {
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

  it("a chunked oversized disclosure page is refused the same way", async () => {
    // A stand-in transport (the URL stays https, as fetchDisclosure requires)
    // streaming two megabytes with no Content-Length.
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
    await expect(fetchDisclosure("https://d.example/d", fetchImpl, PUBLIC_LOOKUP)).rejects.toThrow(/exceeds maxBytes/);
  });
});

describe("tolerance for unrecognized enumerated values (draft §Value Constraints and Omitted Metrics)", () => {
  it("disregards the member, and the numeric members a unit member parameterizes", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(
        JSON.stringify({
          ...DOC,
          "energy-unit": "kwh",
          // A metric no unit member parameterizes, so the object still carries
          // one after the strips below (the -07 at-least-one rule).
          "renewable-energy": 40,
          "carbon-footprint": 5,
          "scope-2": 2,
          "carbon-unit": "tonnes",
          "carbon-accounting": "hybrid",
          capabilities: "premium",
        }),
      );
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.disregarded).toEqual(["capabilities", "energy-unit", "energy-consumption", "carbon-unit", "carbon-footprint", "scope-2", "carbon-accounting"]);
    const doc = r.document as Record<string, unknown>;
    expect(doc.capabilities).toBe("basic");
    expect(doc["energy-consumption"]).toBeUndefined();
    expect(doc["carbon-footprint"]).toBeUndefined();
    // Strict mode validates as served: the closed enums fail the document.
    expect((await fetchSustainability(base, { ...ALLOW_INSECURE, legacyCompat: false })).status).toBe("invalid");
  });

  it("duplicate member names: the last value wins, consistently (the draft's documented alternative)", async () => {
    const base = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
      res.end(BODY.replace(/}$/, ',"energy-consumption":7,"target":"dup.example"}'));
    });
    const r = await fetchSustainability(base, ALLOW_INSECURE);
    expect(r.status === "ok" && r.document).toMatchObject({ "energy-consumption": 7, target: "dup.example" });
  });
});

/**
 * The address check (draft -07 §Consumer Considerations): a consumer "SHOULD
 * bound the time, size, and redirects of every fetch, including those of
 * upstream declarations, and SHOULD refuse URIs that resolve to private or
 * link-local addresses, since dereferencing URIs from an untrusted document
 * exposes it to server-side request forgery".
 *
 * Every URI this package dereferences was written by some other origin, so the
 * check runs on every hop of every fetch, BEFORE the request. The resolver is
 * injected throughout, so nothing here touches DNS.
 */
describe("§Consumer Considerations: URIs that resolve to private addresses are refused", () => {
  /** A fetch that records every URL it is asked for, so "never requested" is testable. */
  function recording(): { impl: typeof fetch; asked: string[] } {
    const asked: string[] = [];
    const impl = (async (url: string) => {
      asked.push(String(url));
      return new Response(BODY, { status: 200, headers: { "Content-Type": "application/sustainability-data+json" } });
    }) as unknown as typeof fetch;
    return { impl, asked };
  }

  const never = async () => {
    throw new Error("the resolver must not be called for a literal IP host");
  };

  it("refuses a literal loopback, private, link-local, unique-local or unspecified host, without resolving it", async () => {
    for (const host of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.5.5",
      "192.168.1.1",
      "169.254.1.1",
      "0.0.0.0",
      "[::1]",
      "[fe80::1]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[::]",
      // IPv4-mapped IPv6, in both the dotted spelling and the hex form a URL
      // normalizes it to — the same address, so the same refusal.
      "[::ffff:10.0.0.1]",
      "[::ffff:a00:1]",
      "[::ffff:127.0.0.1]",
    ]) {
      const { impl, asked } = recording();
      const r = await fetchSustainability(`https://${host}`, { fetchImpl: impl, lookup: never });
      expect(r.status, host).toBe("refused-uri");
      if (r.status !== "refused-uri") continue;
      expect(r.reason, host).toBe("blocked-address");
      expect(r.detail, host).toContain("the host is");
      // Nothing was sent: the refusal is decided before the request.
      expect(asked, host).toEqual([]);
    }
  });

  it("allows a literal PUBLIC address, so the rule is a filter and not a ban on IP hosts", async () => {
    for (const host of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "[2606:4700:4700::1111]", "[::ffff:8.8.8.8]"]) {
      const { impl } = recording();
      const r = await fetchSustainability(`https://${host}`, { fetchImpl: impl, lookup: never });
      expect(r.status, host).toBe("ok");
    }
  });

  it("refuses a HOST NAME whose lookup returns a private address, and names it", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://inside.example", {
      fetchImpl: impl,
      lookup: async (hostname) => {
        expect(hostname).toBe("inside.example");
        return ["10.1.2.3"];
      },
    });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("blocked-address");
    expect(r.detail).toContain("inside.example resolves to 10.1.2.3");
    expect(asked).toEqual([]);
  });

  it("refuses a name that resolves to BOTH a public and a private address (the rebinding shape)", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://split.example", {
      fetchImpl: impl,
      lookup: async () => ["93.184.216.34", "127.0.0.1"],
    });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.detail).toContain("127.0.0.1");
    expect(asked).toEqual([]);
  });

  it("allows a host name that resolves only to public addresses", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://outside.example", {
      fetchImpl: impl,
      lookup: async () => ["93.184.216.34", "2606:4700:4700::1111"],
    });
    expect(r.status).toBe("ok");
    expect(asked).toHaveLength(1);
  });

  it("refuses a URI carrying userinfo, with no opt-out, and never echoes the credentials", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://alice:hunter2@outside.example", {
      fetchImpl: impl,
      ...PUBLIC_LOOKUP,
    });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("userinfo-in-uri");
    expect(asked).toEqual([]);
    // The password is not in the reported URL, nor in the detail.
    expect(`${r.url} ${r.detail}`).not.toContain("hunter2");
    expect(`${r.url} ${r.detail}`).not.toContain("alice");

    // Not even the local-development opt-outs reach it: credentials from a
    // third-party document are never put on the wire.
    const again = await fetchSustainability("https://alice:hunter2@outside.example", {
      fetchImpl: impl,
      allowInsecure: true,
      allowPrivateAddresses: true,
    });
    expect(again.status).toBe("refused-uri");
  });

  it("refuses a REDIRECT HOP that points at a private address, before requesting it", async () => {
    // The first origin answers honestly and then points inward — the case the
    // hop-by-hop check exists for.
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(String(url));
      if (String(url).includes("outside.example")) {
        return new Response(null, { status: 302, headers: { Location: "https://10.0.0.5/.well-known/sustainability-data" } });
      }
      return new Response(BODY, { status: 200, headers: { "Content-Type": "application/sustainability-data+json" } });
    }) as unknown as typeof fetch;

    const r = await fetchSustainability("https://outside.example", {
      fetchImpl,
      lookup: async () => ["93.184.216.34"],
    });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.reason).toBe("blocked-address");
    expect(r.url).toContain("10.0.0.5");
    // The first hop was requested; the inward one never was.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("outside.example");
  });

  it("refuses a FINAL url that lands on a private address, for a fetch impl that followed redirects itself", async () => {
    const fetchImpl = (async () => {
      const res = new Response(BODY, { status: 200, headers: { "Content-Type": "application/sustainability-data+json" } });
      Object.defineProperty(res, "url", { value: "https://192.168.0.9/.well-known/sustainability-data" });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    }) as unknown as typeof fetch;
    const r = await fetchSustainability("https://outside.example", { fetchImpl, lookup: async () => ["93.184.216.34"] });
    expect(r.status).toBe("refused-uri");
    if (r.status !== "refused-uri") return;
    expect(r.detail).toContain("192.168.0.9");
  });

  it("a lookup failure is the ordinary network error, not a refusal", async () => {
    const { impl } = recording();
    await expect(
      fetchSustainability("https://nowhere.example", {
        fetchImpl: impl,
        lookup: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/could not resolve nowhere.example/);
  });

  it("allowPrivateAddresses opts out on its own, keeping the HTTPS requirement", async () => {
    const { impl, asked } = recording();
    const r = await fetchSustainability("https://10.0.0.1", { fetchImpl: impl, allowPrivateAddresses: true });
    expect(r.status).toBe("ok");
    expect(asked).toHaveLength(1);
    // …and the transport MUST still holds.
    const insecure = await fetchSustainability("http://10.0.0.1", { fetchImpl: impl, allowPrivateAddresses: true });
    expect(insecure.status).toBe("insecure-transport");
  });

  it("allowInsecure implies it, which is what keeps a 127.0.0.1 development origin reachable", async () => {
    const { impl } = recording();
    const r = await fetchSustainability("http://127.0.0.1:8080", { fetchImpl: impl, ...ALLOW_INSECURE });
    expect(r.status).toBe("ok");
  });

  it("guards the upstream walk, the disclosure fetch and the attestation fetch alike", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(String(url));
      return new Response(BODY, { status: 200, headers: { "Content-Type": "application/sustainability-data+json" } });
    }) as unknown as typeof fetch;
    const inward = async () => ["169.254.169.254"]; // the classic cloud metadata address

    // upstream
    const subject = {
      ...DOC,
      upstream: [{ declaration: "https://metadata.example/.well-known/sustainability-data", role: "cloud" }],
    } as never;
    const [comparison] = await compareUpstream(subject, {
      timeoutMs: 5_000,
      maxBytes: 10_000,
      maxObjects: 10,
      lookup: inward,
    });
    expect(comparison.verdict).toBe("unreachable");
    expect(comparison.detail).toContain("blocked-address");
    expect(comparison.detail).toContain("169.254.169.254");

    // disclosure (explicit, caller-invoked)
    await expect(
      fetchDisclosure("https://metadata.example/d", fetchImpl, { lookup: inward }),
    ).rejects.toThrow(/blocked-address/);

    // attestation (explicit, caller-invoked)
    const attestation = await verifyAttestation("https://metadata.example/vc", { fetchImpl, lookup: inward });
    expect(attestation.valid).toBe(false);
    if (attestation.valid) return;
    expect(attestation.reason).toBe("blocked-address");

    // Not one of the three was contacted.
    expect(asked).toEqual([]);
  });

  it("isBlockedAddress is exported and says the same thing on its own", () => {
    for (const a of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.1.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::", "::ffff:10.0.0.1"]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(a), a).toBe(false);
    }
    expect(isBlockedAddress("not-an-address")).toBe(false);
  });
});
