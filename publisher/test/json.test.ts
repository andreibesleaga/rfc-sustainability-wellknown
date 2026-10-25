import { describe, expect, it } from "vitest";
import { parseStrict } from "../src/json";

describe("parseStrict reads I-JSON", () => {
  it("reads ordinary JSON as JSON.parse does", () => {
    const text = '{"a":[1,2.5,-3e2,true,null,"x"],"b":{"c":"\\u00e9\\ud83d\\ude00"},"d":0.1}';
    expect(parseStrict(text)).toEqual(JSON.parse(text));
  });

  it("refuses a duplicate member name, at any depth", () => {
    expect(() => parseStrict('{"a":1,"a":2}')).toThrow(/Duplicate key 'a'/);
    expect(() => parseStrict('{"x":{"a":1,"b":2,"a":3}}')).toThrow(/Duplicate key/);
  });

  it("refuses a repeated member name whose values are equal, spelled alike or by escape", () => {
    expect(() => parseStrict('{"a":1,"a":1}')).toThrow(/Duplicate key 'a'/);
    expect(() => parseStrict('{"p":{"x":1},"p":{"x":1}}')).toThrow(/Duplicate key 'p'/);
    expect(() => parseStrict('{"a":1,"\\u0061":1}')).toThrow(/Duplicate key 'a'/);
    expect(() => parseStrict('[{"a":1},{"a":1}]')).not.toThrow();
    expect(parseStrict('{"a":{"a":1},"b":["a",{"a":2}],"c ":"\\"a\\":"}')).toEqual({ a: { a: 1 }, b: ["a", { a: 2 }], "c ": '"a":' });
    expect(() => parseStrict('[{"a":1},{"a":1}]')).not.toThrow();
    expect(() => parseStrict('{"a":{"a":1}}')).not.toThrow();
  });

  it("refuses a number beyond the magnitude or precision of binary64", () => {
    for (const text of ["12345678901234567890", "9007199254740993", "0.1234567890123456789", "1e400", "-1e400", "1e-400", "123456789012345678"]) {
      expect(() => parseStrict(text), text).toThrow(/binary64/);
      expect(() => parseStrict(`{"v":${text}}`), text).toThrow(/binary64/);
    }
  });

  it("names the member in each refusal", () => {
    expect(() => parseStrict('{"energy-consumption":1e400}')).toThrow(/member "energy-consumption".*binary64/);
    expect(() => parseStrict('{"x":{"energy-consumption":9007199254740993}}')).toThrow(/member "energy-consumption"/);
    expect(() => parseStrict('{"list":[1,12345678901234567890]}')).toThrow(/array item 1/);
    expect(() => parseStrict('{"provider":"ab\\ud800cd"}')).toThrow(/member "provider".*unpaired surrogate/);
  });

  it("accepts the numbers binary64 holds, at its limits too", () => {
    for (const [text, value] of [
      ["9007199254740991", 9007199254740991],
      ["5e-324", 5e-324],
      ["1.7976931348623157e308", 1.7976931348623157e308],
      ["1e308", 1e308],
      ["0.30000000000000004", 0.30000000000000004],
      ["12345.678", 12345.678],
      ["1E3", 1000],
      ["0.0", 0],
      ["-0", -0],
    ] as const) {
      expect(parseStrict(text), text).toBe(value);
    }
  });

  it("refuses a string or a member name with an unpaired surrogate", () => {
    expect(() => parseStrict('"\\ud800"')).toThrow(/unpaired surrogate/);
    expect(() => parseStrict('"\\udc00x"')).toThrow(/unpaired surrogate/);
    expect(() => parseStrict('{"a":["ok","\\ud83d"]}')).toThrow(/unpaired surrogate/);
    expect(() => parseStrict('{"\\ud800":1}')).toThrow(/unpaired surrogate/);
    expect(() => parseStrict('"\\ud83d\\ude00"')).not.toThrow();
  });

  it("keeps __proto__ and constructor as plain data", () => {
    const parsed = parseStrict('{"__proto__":{"polluted":true},"constructor":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["__proto__", "constructor"]);
  });

  it("refuses malformed JSON", () => {
    for (const text of ["", "{", "[1,]", "{'a':1}", "01", "NaN", "[1] x"]) {
      expect(() => parseStrict(text), text).toThrow();
    }
  });
});
