import { describe, expect, it } from "vitest";
import { targetsEqual } from "../src/target";

describe("target equality (draft -10 §Optional Members, target)", () => {
  it("is string equality, with a host name compared case-insensitively", () => {
    expect(targetsEqual("example.com", "example.com")).toBe(true);
    expect(targetsEqual("example.com", "Example.COM")).toBe(true);
    expect(targetsEqual("www.example.com:8443", "WWW.Example.com:8443")).toBe(true);
    expect(targetsEqual("example.com", "example.org")).toBe(false);
  });

  it("an origin-typed target is a host whatever it looks like; a name that is not a host is exact", () => {
    expect(targetsEqual("Localhost", "localhost", "origin")).toBe(true);
    expect(targetsEqual("Localhost", "localhost")).toBe(false);
    expect(targetsEqual("Acme Corp", "ACME CORP")).toBe(false);
    expect(targetsEqual("/API/v1", "/api/v1")).toBe(false);
  });

  it("a host and a path under it are two targets; non-strings are never equal unless identical", () => {
    expect(targetsEqual("example.com", "example.com/api")).toBe(false);
    expect(targetsEqual(undefined, "example.com")).toBe(false);
    expect(targetsEqual(undefined, undefined)).toBe(true);
  });

  it("the JSON-escaped spelling of a character is the character: the values are already decoded", () => {
    expect(targetsEqual(JSON.parse('"exampl\\u0065.com"'), "example.com")).toBe(true);
  });
});
