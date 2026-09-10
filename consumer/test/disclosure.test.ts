/**
 * Tests for the disclosure-link helpers, and in particular for what
 * fetchDisclosure() REFUSES to dereference (draft -06 §Payload Format: the
 * three URI members MUST be absolute "https" URIs, and clients MUST NOT
 * automatically dereference a member carrying any other scheme).
 */
import { describe, expect, it, vi } from "vitest";
import { fetchDisclosure, resolveDisclosureLinks } from "../src/disclosure";
import { SustainabilityMetrics } from "../src/types";

describe("resolveDisclosureLinks()", () => {
  it("reads both links off a document without touching the network", () => {
    const links = resolveDisclosureLinks({
      "disclosure-uri": "https://example.com/disclosures",
      "verifiable-attestation-uri": "https://example.com/vc",
    } as unknown as SustainabilityMetrics);
    expect(links).toEqual({
      disclosureUri: "https://example.com/disclosures",
      attestationUri: "https://example.com/vc",
    });
  });
});

describe("fetchDisclosure() refuses a non-https URI (-06)", () => {
  for (const uri of [
    "http://example.com/disclosures",
    "ftp://example.com/disclosures",
    "file:///etc/passwd",
    "data:text/plain,disclosure",
  ]) {
    it(`refuses ${uri} before calling fetch`, async () => {
      const spy = vi.fn();
      await expect(fetchDisclosure(uri, spy as unknown as typeof fetch)).rejects.toThrow(/https/i);
      // The point of refusing early: the URI never reaches the fetch impl.
      expect(spy).not.toHaveBeenCalled();
    });
  }

  it("refuses a value that is not an absolute URI", async () => {
    const spy = vi.fn();
    await expect(fetchDisclosure("/disclosures", spy as unknown as typeof fetch)).rejects.toThrow(/absolute/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches an https URI when the caller explicitly asks for it", async () => {
    const fetchImpl = vi.fn(async () => new Response("the disclosure text", { status: 200 }));
    const text = await fetchDisclosure("https://example.com/disclosures", fetchImpl as unknown as typeof fetch);
    expect(text).toBe("the disclosure text");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws on a non-2xx https response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      fetchDisclosure("https://example.com/missing", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/404/);
  });
});
