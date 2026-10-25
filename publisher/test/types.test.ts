import { describe, expect, it } from "vitest";
import { DEFINED_MEMBERS, extensionNameError, isExtensionName, isUriReference, METRIC_MEMBERS } from "../src/types";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";

describe("isUriReference (RFC 3986, Section 4.1)", () => {
  it("accepts a URI and every kind of relative reference, syntax only", () => {
    for (const value of [
      "https://example.com/a?b=c#d",
      "http://x",
      "ftp://x/y",
      "mailto:a@b.example",
      "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845",
      "//example.com/path",
      "/absolute/path",
      "relative/path",
      "../up/./x",
      "?query",
      "#fragment",
      "",
      "a/b:c",
      "https://x/%20y",
      "https://[::1]:8443/x",
      "tag:example.com,2026:x",
    ]) {
      expect(isUriReference(value), JSON.stringify(value)).toBe(true);
    }
  });

  it("rejects what RFC 3986 does not allow in one", () => {
    for (const value of [
      "not a uri",
      " https://x",
      "https://x/ y",
      "https://x/<y>",
      'https://x/"y"',
      "https://x/\\y",
      "https://x/{y}",
      "https://x/%zz",
      "https://x/%2",
      "https://exämple.com",
      "https://x/\n",
      "1a:b", // a colon in the first segment of a relative reference, and not a scheme
      "a b:c",
      ":x",
    ]) {
      expect(isUriReference(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("extension names", () => {
  it("are URIs with a scheme, in any letter case, written as given", () => {
    for (const key of ["https://example.com/ext", "HTTPS://Example.COM/Ext", "urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845", "urn:oid:1.3.6.1.4.1.32473.1", "tag:example.com,2026:x", "https://example.com/e#frag"]) {
      expect(extensionNameError(key), key).toBeUndefined();
      expect(isExtensionName(key), key).toBe(true);
    }
  });

  it("are not a relative reference, a bare identifier, empty, or written with a space", () => {
    for (const key of ["/relative", "com.example.pue", "", "https://example.com/a b", "water", "a:b c", "\u00e9:x", "x:\ud800"]) {
      expect(isExtensionName(key), JSON.stringify(key)).toBe(false);
    }
    expect(extensionNameError("water")).toContain("draft, Extensions");
  });
});

describe("the members of a declaration object", () => {
  it("are the 26 of the draft, and the same as the schema's", () => {
    expect(DEFINED_MEMBERS).toHaveLength(26);
    expect(new Set(DEFINED_MEMBERS)).toEqual(
      new Set([...Object.keys(RESPONSE_JTD_SCHEMA.properties), ...Object.keys(RESPONSE_JTD_SCHEMA.optionalProperties)]),
    );
  });

  it("include the nine numeric metric members", () => {
    expect(METRIC_MEMBERS).toHaveLength(9);
    for (const member of METRIC_MEMBERS) expect(DEFINED_MEMBERS).toContain(member);
  });
});
