/**
 * Tests for the disclosure-link helpers: references resolve against the
 * retrieval URI, only https is dereferenced, the bytes come back in whatever
 * format with their media type, and a failure changes nothing else.
 */
import { describe, expect, it, vi } from "vitest";
import { DisclosureError, fetchDisclosure, resolveDisclosureLinks } from "../src/disclosure";
import { SustainabilityMetrics } from "../src/types";
import { PUBLIC_LOOKUP } from "./helpers";

const RETRIEVED = "https://a.example/.well-known/sustainability-data";
const doc = (members: Record<string, unknown>) => members as unknown as SustainabilityMetrics;

describe("resolveDisclosureLinks()", () => {
  it("reads both links off a document without touching the network", () => {
    const links = resolveDisclosureLinks(
      doc({ "disclosure-uri": "https://example.com/disclosures", "verifiable-attestation-uri": "https://example.com/vc" }),
    );
    expect(links).toEqual({ disclosureUri: "https://example.com/disclosures", attestationUri: "https://example.com/vc" });
  });

  it("returns nothing for a link the object does not carry", () => {
    expect(resolveDisclosureLinks(doc({}), RETRIEVED)).toEqual({});
  });

  it("resolves a relative reference against the retrieval URI (RFC 3986, Section 5)", () => {
    const links = resolveDisclosureLinks(doc({ "disclosure-uri": "/disclosures/index.json", "verifiable-attestation-uri": "vc/42" }), RETRIEVED);
    expect(links).toEqual({ disclosureUri: "https://a.example/disclosures/index.json", attestationUri: "https://a.example/.well-known/vc/42" });
  });

  it("after a redirect the base is the final URL, so a relayed declaration resolves where it was retrieved", () => {
    const links = resolveDisclosureLinks(doc({ "disclosure-uri": "../index.json" }), "https://gateway.example/org/.well-known/sustainability-data");
    expect(links.disclosureUri).toBe("https://gateway.example/org/index.json");
  });

  it("an absolute reference is kept as it is", () => {
    expect(resolveDisclosureLinks(doc({ "disclosure-uri": "https://b.example/d" }), RETRIEVED).disclosureUri).toBe("https://b.example/d");
  });

  it("a reference that cannot be resolved against the base is reported, not returned", () => {
    const links = resolveDisclosureLinks(doc({ "disclosure-uri": "https://[::1/d", "verifiable-attestation-uri": "https://ok.example/vc" }), RETRIEVED);
    expect(links).toEqual({ attestationUri: "https://ok.example/vc", unresolved: ["disclosure-uri"] });
  });
});

describe("fetchDisclosure()", () => {
  const impl = (response: () => Response) => vi.fn(async () => response()) as unknown as typeof fetch;

  for (const uri of ["http://example.com/disclosures", "ftp://example.com/disclosures", "file:///etc/passwd", "data:text/plain,disclosure"]) {
    it(`refuses ${uri} before calling fetch`, async () => {
      const spy = vi.fn();
      await expect(fetchDisclosure(uri, spy as unknown as typeof fetch)).rejects.toThrow(/dereferences only https URIs/);
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("refuses a relative reference when there is nothing to resolve it against", async () => {
    const spy = vi.fn();
    await expect(fetchDisclosure("/disclosures", spy as unknown as typeof fetch)).rejects.toBeInstanceOf(DisclosureError);
    await expect(fetchDisclosure("/disclosures", spy as unknown as typeof fetch)).rejects.toThrow(/no retrieval URI/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves a relative reference against the base, then applies the https rule to the result", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const got = await fetchDisclosure("/d/index.json", fetchImpl as unknown as typeof fetch, { base: RETRIEVED, ...PUBLIC_LOOKUP });
    expect(got.url).toBe("https://a.example/d/index.json");
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://a.example/d/index.json");
    const spy = vi.fn();
    await expect(fetchDisclosure("/d", spy as unknown as typeof fetch, { base: "http://a.example/x" })).rejects.toThrow(/only https/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns the bytes and the media type, in whatever format the index is", async () => {
    const html = impl(() => new Response("<p>reports</p>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
    const a = await fetchDisclosure("https://a.example/d", html, PUBLIC_LOOKUP);
    expect(a.mediaType).toBe("text/html; charset=utf-8");
    expect(a.text).toBe("<p>reports</p>");
    expect(Array.from(a.bytes)).toEqual(Array.from(new TextEncoder().encode("<p>reports</p>")));
    const pdf = impl(() => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
    const b = await fetchDisclosure("https://a.example/d.pdf", pdf, PUBLIC_LOOKUP);
    expect(b.mediaType).toBe("application/pdf");
    expect(Array.from(b.bytes)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("a link that answers 404 fails with that status and nothing else", async () => {
    const err = await fetchDisclosure("https://a.example/missing", impl(() => new Response("nope", { status: 404 })), PUBLIC_LOOKUP).catch((e) => e);
    expect(err).toBeInstanceOf(DisclosureError);
    expect(err.status).toBe(404);
    expect(err.message).toContain("404");
  });

  it("stops reading a body past one megabyte", async () => {
    const big = impl(() => new Response(new Uint8Array(1_048_577), { status: 200 }));
    await expect(fetchDisclosure("https://a.example/big", big, PUBLIC_LOOKUP)).rejects.toThrow();
  });
});
