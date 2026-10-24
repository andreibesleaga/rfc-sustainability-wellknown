import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runUpgrade } from "../src/cli";
import { importSigningKey, signDeclaration } from "../src/jws";
import { upgradeDocument, upgradeOptionsError, upgradeText } from "../src/upgrade";

const CORPUS = resolve(process.cwd(), "..", "schemas-validators", "examples");
const read = (path: string): string => readFileSync(join(CORPUS, path), "utf8");

interface Entry {
  id: string;
  path: string;
  converted?: string[];
  disregarded?: string[];
  golden?: string;
  signature?: string;
}
const manifest: Entry[] = JSON.parse(read("manifest.json"));
const legacy = manifest.filter((entry) => entry.id.startsWith("L"));

const work = mkdtempSync(join(tmpdir(), "upgrade-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
let counter = 0;
const file = (content: string): string => {
  const path = join(work, `f${counter++}.json`);
  writeFileSync(path, content);
  return path;
};

const sink = () => {
  let text = "";
  return { stream: { write: (chunk: string) => ((text += chunk), true) } as unknown as NodeJS.WritableStream, get text() { return text; } };
};
// Run the command; `out` and `err` are what it wrote to standard output and standard error.
function run(...argv: string[]) {
  const out = sink();
  const err = sink();
  const status = runUpgrade(argv, { stdout: out.stream, stderr: err.stream });
  return { status, out: out.text, err: err.text };
}

const current = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustain@example.com)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "/sustainability/methodology",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "Example Corp",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e",
};
const older = (over: Record<string, unknown>, drop: string[] = []) => {
  const copy: Record<string, unknown> = { ...current, ...over };
  for (const name of drop) delete copy[name];
  return copy;
};
// A -09 object: the inclusive pair of dates.
const v09 = (over: Record<string, unknown> = {}) => older({ period: { start: "2025-01-01", end: "2025-12-31" }, ...over });
// A -08 object: the label.
const v08 = (label: unknown, over: Record<string, unknown> = {}) => {
  const { period: _period, ...rest } = current;
  return { ...rest, "reporting-period": label, ...over };
};

const upgrade = (document: unknown, options = {}) => upgradeDocument(document, options);
const converted = (document: unknown, options = {}) => {
  const result = upgrade(document, options);
  expect(result.errors).toEqual([]);
  return result.document as any;
};

describe("the legacy corpus", () => {
  it("holds the twenty inputs of the matrix", () => {
    expect(legacy.map((entry) => entry.id)).toEqual(Array.from({ length: 20 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`));
  });

  for (const entry of legacy) {
    const input = read(entry.path);
    if (entry.golden === undefined) {
      it(`${entry.id} ${entry.path}: cannot be converted and writes nothing`, () => {
        const result = upgradeText(input);
        expect(result.errors.join("; ")).toContain('reporting-period "2026-13"');
        expect(run(join(CORPUS, entry.path), join(work, "never.json"))).toMatchObject({ status: 1, out: "" });
        expect(existsSync(join(work, "never.json"))).toBe(false);
      });
      continue;
    }
    const golden = read(entry.golden);
    describe(`${entry.id} ${entry.path}`, () => {
      it("is converted to the golden output, byte for byte", () => {
        const result = upgradeText(input);
        expect(result.errors).toEqual([]);
        expect(result.text).toBe(golden);
      });

      it("is converted by the command to standard output and to a file", () => {
        const inFile = join(CORPUS, entry.path);
        expect(run(inFile).out).toBe(golden);
        const outFile = join(work, `${entry.id}.json`);
        expect(run(inFile, outFile).status).toBe(0);
        expect(readFileSync(outFile, "utf8")).toBe(golden);
      });

      it("reports what was converted and what was disregarded", () => {
        const { notes } = upgradeText(input);
        const paths = (names: string[]) => notes.filter((note) => names.includes(note.path)).map((note) => note.path);
        for (const path of entry.converted ?? []) expect(paths([path]), path).toContain(path);
        for (const path of entry.disregarded ?? []) {
          // a score removed with its unit has no note of its own
          if (!path.endsWith("sci-score")) expect(paths([path]), path).toContain(path);
        }
      });

      it("is left alone when converted again", () => {
        const again = upgradeText(golden);
        expect(again.notes).toEqual([]);
        expect(again.text).toBe(golden);
      });

      it(`--check exits ${entry.id === "L19" ? 0 : 1} and writes nothing`, () => {
        const outFile = join(work, `check-${entry.id}.json`);
        const result = run("--check", join(CORPUS, entry.path), outFile);
        expect(result.status).toBe(entry.id === "L19" ? 0 : 1);
        expect(result.out).toBe("");
        expect(existsSync(outFile)).toBe(false);
      });
    });
  }

  it("leaves every valid document of the corpus as it is", () => {
    for (const entry of manifest.filter((e) => /^[VT]/.test(e.id))) {
      const text = read(entry.path);
      const result = upgradeText(text);
      expect(result.notes, entry.path).toEqual([]);
      expect(result.text, entry.path).toBe(text);
    }
  });
});

describe("the period", () => {
  it("reads a -08 label as the whole year, month or day, in order, where the label stood", () => {
    const result = converted(v08("2025-03"));
    expect(Object.keys(result)).toEqual(Object.keys(v08("2025-03")).map((k) => (k === "reporting-period" ? "period" : k)));
    expect(result.period).toEqual({ start: "2025-03-01T00:00:00Z", end: "2025-04-01T00:00:00Z" });
    expect(converted(v08("2024-02-29")).period).toEqual({ start: "2024-02-29T00:00:00Z", end: "2024-03-01T00:00:00Z" });
  });

  it("reads a -09 pair of inclusive dates as the start of the first day to the start of the day after the last", () => {
    expect(converted(v09()).period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(converted(v09({ period: { start: "2024-02-01", end: "2024-02-29" } })).period.end).toBe("2024-03-01T00:00:00Z");
  });

  it("starts the day at the offset it is given", () => {
    expect(converted(v08("2026-03"), { offset: "+08:00" }).period).toEqual({
      start: "2026-03-01T00:00:00+08:00",
      end: "2026-04-01T00:00:00+08:00",
    });
    expect(converted(v09(), { offset: "-05:00" }).period.start).toBe("2025-01-01T00:00:00-05:00");
  });

  it.each([["2025-13"], ["2025-00"], ["2025-02-30"], ["2025-02-29"], ["25"], ["2025-3"], ["Q1 2025"], [""]])(
    "does not convert the label %j, and names it",
    (label) => {
      const result = upgrade(v08(label));
      expect(result.errors[0]).toContain(`reporting-period ${JSON.stringify(label)} cannot be converted`);
    },
  );

  it("does not convert a label that is not a string", () => {
    expect(upgrade(v08(2025)).errors[0]).toContain("reporting-period 2025 is not a string");
  });

  it.each([
    [{ start: "2025-03-14", end: "2025-03-13" }],
    [{ start: "2025-02-30", end: "2025-03-31" }],
    [{ start: "2025-01-01", end: "2025-13-01" }],
  ])("does not convert the pair %j", (pair) => {
    expect(upgrade(v09({ period: pair })).errors[0]).toContain("cannot be converted");
  });

  it("leaves a half-converted pair to fail validation", () => {
    expect(upgrade(v09({ period: { start: "2025-01-01", end: "2026-01-01T00:00:00Z" } })).errors.join()).toContain("period");
  });
});

describe("the fiscal year", () => {
  const extension = "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041";
  const fiscal = (basis: string, label = "2025", other: Record<string, unknown> = {}) =>
    v08(label, { extensions: { [extension]: { "reporting-period-basis": basis, ...other }, "https://other.example/x": { a: 1 } } });

  it("gives the exact period and removes the basis, keeping every other extension", () => {
    const result = converted(fiscal("fiscal-year-ended-2025-09-30"));
    expect(result.period).toEqual({ start: "2024-10-01T00:00:00Z", end: "2025-10-01T00:00:00Z" });
    expect(result.extensions).toEqual({ "https://other.example/x": { a: 1 } });
  });

  it("keeps the other members of the extension that holds the basis", () => {
    expect(converted(fiscal("fiscal-year-ended-2026-03-31", "2026", { note: "kept" })).extensions[extension]).toEqual({ note: "kept" });
  });

  it("drops the extensions member when the basis was all it held", () => {
    const { extensions: _, ...rest } = fiscal("fiscal-year-ended-2025-09-30");
    const result = converted({ ...rest, extensions: { [extension]: { "reporting-period-basis": "fiscal-year-ended-2025-09-30" } } });
    expect("extensions" in result).toBe(false);
  });

  it("starts a year that ended on a leap day on the first of March", () => {
    expect(converted(fiscal("fiscal-year-ended-2024-02-29", "2024")).period).toEqual({
      start: "2023-03-01T00:00:00Z",
      end: "2024-03-01T00:00:00Z",
    });
  });

  it("applies the offset to both bounds", () => {
    expect(converted(fiscal("fiscal-year-ended-2025-09-30"), { offset: "+01:00" }).period.start).toBe("2024-10-01T00:00:00+01:00");
  });

  it("does not guess when the label is not the year the fiscal year ended in", () => {
    expect(upgrade(fiscal("fiscal-year-ended-2025-09-30", "2024")).errors[0]).toContain("not the year of the fiscal year that ended 2025-09-30");
  });

  it("does not read a basis it does not understand", () => {
    expect(converted(fiscal("some other text")).period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  });

  it("names a fiscal year that ended on no date", () => {
    expect(upgrade(fiscal("fiscal-year-ended-2025-02-30")).errors[0]).toContain("cannot be converted");
  });
});

describe("measurement-method", () => {
  it.each(["Hardware-Metered", "metered", "calculated from activity data x emission factors", ""])("takes the residual token for %j", (text) => {
    const result = upgrade(v09({ "measurement-method": text }));
    expect((result.document as any)["measurement-method"]).toBe("third-party-modeled");
    expect(result.notes.find((note) => note.rule === "measurement-method")?.message).toContain("--measurement-method");
  });

  it("takes the token it is given for a value outside the set", () => {
    const result = upgrade(v09({ "measurement-method": "metered" }), { measurementMethod: "hardware-metered" });
    expect((result.document as any)["measurement-method"]).toBe("hardware-metered");
  });

  it("never replaces a token", () => {
    const result = upgrade(v09({ "measurement-method": "cloud-billing" }), { measurementMethod: "hardware-metered" });
    expect((result.document as any)["measurement-method"]).toBe("cloud-billing");
    expect(result.notes.map((note) => note.rule)).toEqual(["period"]);
  });

  it("does not convert a value that is not a string", () => {
    expect(upgrade(v09({ "measurement-method": 3 })).errors[0]).toContain("measurement-method 3 is not a string");
  });
});

describe("functional-unit and sci-score", () => {
  it("scales the score with the unit", () => {
    const result = converted(v09({ "functional-unit": "per-thousand-requests", "sci-score": 12 }));
    expect([result["functional-unit"], result["sci-score"]]).toEqual(["per-request", 0.012]);
  });

  it("converts a unit that has no score", () => {
    expect(converted(v09({ "functional-unit": "per-thousand-requests" }))["functional-unit"]).toBe("per-request");
  });

  it("converts storage over time to gigabyte-hours (rule 5a)", () => {
    const result = converted(v09({ "functional-unit": "per-terabyte-day", "sci-score": 0.85 }));
    expect([result["functional-unit"], result["sci-score"]]).toEqual(["per-gigabyte-hour", 0.0000354]);
  });

  it("removes a unit no rule converts together with its score, and says to restate it", () => {
    const result = upgrade(v09({ "functional-unit": "per-gigabyte-month", "sci-score": 4.2 }));
    expect(result.document).not.toHaveProperty("functional-unit");
    expect(result.document).not.toHaveProperty("sci-score");
    expect(result.notes[1].message).toContain("restate by hand");
  });

  it("keeps a unit of the current set, and its score, with no note", () => {
    const result = upgrade(v09({ "functional-unit": "per-session", "sci-score": 0.2 }));
    expect(result.notes.map((note) => note.rule)).toEqual(["period"]);
    expect((result.document as any)["sci-score"]).toBe(0.2);
  });
});

describe("carbon-unit", () => {
  it("renames mtCO2e and leaves the figures", () => {
    const result = converted(v09({ "carbon-unit": "mtCO2e", "carbon-footprint": 610, "scope-3": 300 }));
    expect([result["carbon-unit"], result["carbon-footprint"], result["scope-3"]]).toEqual(["tCO2e", 610, 300]);
  });

  it("removes any other unit with the figures it parameterizes, and nothing else", () => {
    const result = upgrade(v09({ "carbon-unit": "lbCO2e", "scope-3": 300, "disclosure-uri": "https://example.com/d" }));
    expect(Object.keys(result.document as object)).not.toEqual(expect.arrayContaining(["carbon-unit"]));
    expect(result.document).not.toHaveProperty("carbon-footprint");
    expect(result.document).not.toHaveProperty("scope-3");
    expect(result.document).toHaveProperty("disclosure-uri");
    expect(result.notes.find((note) => note.rule === "carbon-unit")?.message).toContain("carbon-footprint, scope-3");
  });
});

describe("upstream role and target-type", () => {
  const upstream = [
    { declaration: "https://a.example/s", role: "transit" },
    { declaration: "https://b.example/s", role: "Cloud" },
    { declaration: "https://c.example/s", role: "colocation" },
    { declaration: "https://d.example/s" },
  ];

  it("removes a role outside the six and keeps the entry", () => {
    const result = converted(v09({ upstream }));
    expect(result.upstream).toEqual([
      { declaration: "https://a.example/s" },
      { declaration: "https://b.example/s" },
      { declaration: "https://c.example/s", role: "colocation" },
      { declaration: "https://d.example/s" },
    ]);
  });

  it("names each role it removes", () => {
    expect(upgrade(v09({ upstream })).notes.filter((note) => note.rule === "role").map((note) => note.path)).toEqual([
      "upstream[0].role",
      "upstream[1].role",
    ]);
  });

  it("removes a target-type outside the nine and keeps one of them", () => {
    expect(converted(v09({ "target-type": "datacenter" }))).not.toHaveProperty("target-type");
    expect(converted(v09({ "target-type": "facility", "carbon-unit": "mtCO2e" }))["target-type"]).toBe("facility");
  });
});

describe("what goes with a converted object", () => {
  it("writes the provider in Normalization Form C", () => {
    expect(converted(v09({ provider: "Müller GmbH (sustain@example.com)" })).provider).toBe("Müller GmbH (sustain@example.com)");
  });

  it("leaves a provider alone in a document that is already valid", () => {
    const decomposed = { ...current, provider: "Müller GmbH (sustain@example.com)" };
    expect(upgrade(decomposed).notes).toEqual([]);
  });

  it("does not carry signed over, and says to sign again", () => {
    const result = upgrade(v09({ signed: "a.b.c" }));
    expect(result.document).not.toHaveProperty("signed");
    expect(result.notes.find((note) => note.rule === "signed")?.message).toContain("sustainability-sign");
  });

  it("keeps the signed member of an object that is already valid", () => {
    const text = read("signed/ed25519-single.json");
    const result = upgradeText(text);
    expect(result.notes).toEqual([]);
    expect(result.text).toBe(text);
  });

  it("sets updated on a converted object only", () => {
    const options = { updated: "2026-11-02T00:00:00Z" };
    expect(converted(v09(), options).updated).toBe("2026-11-02T00:00:00Z");
    expect(upgrade(current, options).document).toBe(current);
  });

  it("keeps the members the rules do not touch, unknown ones included", () => {
    const extensions = { "https://acme.example/ext": { a: [1, 2, { b: null }] } };
    const result = converted(v09({ extensions, "x-unknown": [true, "text"] }));
    expect(result.extensions).toEqual(extensions);
    expect(result["x-unknown"]).toEqual([true, "text"]);
    const { period: _a, ...rest } = result;
    const { period: _b, ...before } = v09({ extensions, "x-unknown": [true, "text"] });
    expect(rest).toEqual(before);
  });
});

describe("shapes", () => {
  it("converts an array object by object, and names the object in each note", () => {
    const result = upgrade([v08("2025-01"), current, v08("2025-03")]);
    expect(result.errors).toEqual([]);
    const items = result.document as any[];
    expect(items[1]).toBe(current);
    expect(items[0].period.start).toBe("2025-01-01T00:00:00Z");
    expect(result.notes.map((note) => note.path)).toEqual(["[0].period", "[2].period"]);
    expect(result.notes[0].message.startsWith("[0] ")).toBe(true);
  });

  it("keeps an empty array", () => {
    expect(upgradeText("[]")).toMatchObject({ text: "[]", notes: [], errors: [] });
  });

  it("keeps a gateway wrapper and its other members, and converts the declaration inside", () => {
    const result = upgrade({ document: v08("2025"), note: "kept" });
    expect(result.errors).toEqual([]);
    expect(result.document).toEqual({ document: converted(v08("2025")), note: "kept" });
  });

  it("converts an array inside the wrapper", () => {
    const result = converted({ document: [v08("2025-01"), v08("2025-02")] });
    expect(result.document.map((item: any) => item.period.end)).toEqual(["2025-02-01T00:00:00Z", "2025-03-01T00:00:00Z"]);
  });

  it.each([
    ["a wrapper whose document is not an object", { document: "text" }, 'the "document" member is not a declaration object or an array'],
    ["a string", "hello", "the document is not a declaration object or an array"],
    ["a number", 3, "the document is not a declaration object or an array"],
    ["an array holding a number", [v08("2025"), 3], "[1] is not a declaration object"],
  ])("does not convert %s", (_what, document, message) => {
    expect(upgrade(document).errors[0]).toContain(message);
  });

  it("reports every object of an array that cannot be converted", () => {
    const result = upgrade([v08("2025-13"), current, v08("2025-14")]);
    expect(result.errors.map((error) => error.slice(0, 4))).toEqual(["[0] ", "[2] "]);
  });

  it("says why text that is not I-JSON cannot be read", () => {
    for (const text of ["{", '{"a": 1, "a": 2}', '{"a": "\\ud800"}', "9007199254740993"]) {
      expect(upgradeText(text).errors[0], text).toContain("I-JSON");
    }
  });

  it("checks a document that needs no conversion, and fails it when it is not valid", () => {
    const result = upgrade({ ...current, "energy-consumption": 3, "energy-unit": "TWh" });
    expect(result.notes).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not convert an energy-unit, a carbon-accounting or a capabilities value that never had an earlier form", () => {
    for (const over of [{ "energy-consumption": 1, "energy-unit": "TWh" }, { "carbon-accounting": "hourly-market-based" }, { capabilities: "full" }]) {
      const result = upgrade(v09(over));
      expect(result.notes.map((note) => note.rule)).toEqual(["period"]);
      expect(result.errors.length, JSON.stringify(over)).toBeGreaterThan(0);
    }
  });

  it("returns what the publisher would say about a document it serves", () => {
    expect(upgrade(v09({ updated: "2025-06-01T00:00:00Z" })).warnings.join()).toContain("updated");
  });
});

describe("the options", () => {
  it.each([
    [{ offset: "8" }],
    [{ offset: "+25:00" }],
    [{ offset: "+08:60" }],
    [{ offset: "Europe/Paris" }],
    [{ updated: "2026-11-02" }],
    [{ updated: "2026-11-02t00:00:00z" }],
    [{ measurementMethod: "spend-based" }],
  ])("refuses %j", (options) => {
    expect(upgradeOptionsError(options as any)).toBeDefined();
    expect(() => upgrade(current, options)).toThrow(RangeError);
  });

  it.each([[{}], [{ offset: "Z" }], [{ offset: "-23:59" }], [{ updated: "2026-11-02T00:00:00+01:00" }], [{ measurementMethod: "cloud-billing" }]])(
    "accepts %j",
    (options) => {
      expect(upgradeOptionsError(options as any)).toBeUndefined();
    },
  );
});

describe("the command", () => {
  const input = () => file(JSON.stringify(v09({ "measurement-method": "metered", "functional-unit": "per-thousand-requests", "sci-score": 12 })));

  it("writes the document to standard output and the notes to standard error", () => {
    const result = run(input());
    expect(result.status).toBe(0);
    expect(JSON.parse(result.out).period.end).toBe("2026-01-01T00:00:00Z");
    expect(result.err).toMatch(/period .*\n.*measurement-method .*\n.*functional-unit /);
  });

  it("writes OUT and leaves IN untouched", () => {
    const inFile = input();
    const before = readFileSync(inFile, "utf8");
    const outFile = join(work, "nested", "out.json");
    expect(run(inFile, outFile)).toMatchObject({ status: 0, out: "" });
    expect(JSON.parse(readFileSync(outFile, "utf8")).period.start).toBe("2025-01-01T00:00:00Z");
    expect(readFileSync(inFile, "utf8")).toBe(before);
  });

  it("converts in place when the same path is given twice, in whatever spelling", () => {
    const inFile = input();
    expect(run(inFile, inFile).status).toBe(0);
    expect(JSON.parse(readFileSync(inFile, "utf8")).period.start).toBe("2025-01-01T00:00:00Z");
    const again = file(readFileSync(inFile, "utf8"));
    expect(run(again, join(work, ".", `f${counter - 1}.json`)).status).toBe(0);
  });

  it("applies the flags", () => {
    const inFile = file(JSON.stringify(v09({ "measurement-method": "metered" })));
    const result = run(inFile, "--offset", "+08:00", "--updated", "2026-11-02T00:00:00Z", "--measurement-method", "hardware-metered");
    const document = JSON.parse(result.out);
    expect(document.period.start).toBe("2025-01-01T00:00:00+08:00");
    expect(document.updated).toBe("2026-11-02T00:00:00Z");
    expect(document["measurement-method"]).toBe("hardware-metered");
  });

  it("does not replace a token with --measurement-method", () => {
    const inFile = file(JSON.stringify(v09({ "measurement-method": "cloud-billing" })));
    expect(JSON.parse(run(inFile, "--measurement-method", "hardware-metered").out)["measurement-method"]).toBe("cloud-billing");
  });

  it("exits 0 and prints the file as it was when there is nothing to change", () => {
    const text = JSON.stringify(current);
    const result = run(file(text));
    expect(result).toMatchObject({ status: 0, out: text });
    expect(result.err).toContain("nothing to change");
  });

  it("changes nothing in its own output", () => {
    const first = run(input()).out;
    expect(run(file(first)).out).toBe(first);
  });

  it("with --check exits 1 for a file it would change, names each rule, and writes nothing", () => {
    const outFile = join(work, "check-out.json");
    const result = run("--check", input(), outFile);
    expect(result).toMatchObject({ status: 1, out: "" });
    for (const name of ["period", "measurement-method", "functional-unit"]) expect(result.err).toContain(name);
    expect(existsSync(outFile)).toBe(false);
  });

  it("with --check exits 0 for a file that is current, also with a value only the current set has", () => {
    expect(run("--check", file(JSON.stringify({ ...current, "functional-unit": "per-session", "sci-score": 0.2 }))).status).toBe(0);
  });

  it("with --check does not rewrite the file in place", () => {
    const inFile = input();
    const before = readFileSync(inFile, "utf8");
    expect(run("--check", inFile, inFile).status).toBe(1);
    expect(readFileSync(inFile, "utf8")).toBe(before);
  });

  it.each([[[]], [["--check"]]])("exits 1 for a file it cannot convert, with and without --check (%j)", (flags) => {
    const inFile = file(JSON.stringify(v08("2025-13")));
    const outFile = join(work, "failed.json");
    const result = run(...flags, inFile, outFile);
    expect(result.status).toBe(1);
    expect(result.err).toContain("reporting-period");
    expect(existsSync(outFile)).toBe(false);
  });

  it("writes nothing for an array whose second object cannot be converted", () => {
    const outFile = join(work, "partial.json");
    expect(run(file(JSON.stringify([v08("2025"), v08("2025-13")])), outFile).status).toBe(1);
    expect(existsSync(outFile)).toBe(false);
  });

  it("leaves the file as it was when an in-place conversion fails", () => {
    const text = JSON.stringify(v08("2025-13"));
    const inFile = file(text);
    expect(run(inFile, inFile).status).toBe(1);
    expect(readFileSync(inFile, "utf8")).toBe(text);
  });

  it("exits 1 for a document that is not JSON, a string, a missing file and a document still invalid after conversion", () => {
    expect(run(file("{")).err).toContain("JSON");
    expect(run(file('"hello"')).err).toContain("declaration");
    expect(run(join(work, "missing.json"))).toMatchObject({ status: 1, out: "" });
    expect(run(file(JSON.stringify(v09({ "energy-consumption": -1 })))).status).toBe(1);
  });

  it.each([
    [["--unknown-flag"]],
    [["--offset", "8"]],
    [["--offset", "+25:00"]],
    [["--offset"]],
    [["--updated", "2026-11-02"]],
    [["--measurement-method", "spend-based"]],
    [[]],
  ])("exits 2 and prints the usage for the arguments %j", (flags) => {
    const inFile = input();
    const outFile = join(work, "usage.json");
    const result = run(...(flags.length === 0 ? [] : [inFile, outFile]), ...flags);
    expect(result).toMatchObject({ status: 2, out: "" });
    expect(result.err).toContain("Usage");
    expect(existsSync(outFile)).toBe(false);
  });

  it("exits 2 for a third file name", () => {
    expect(run(input(), join(work, "a.json"), join(work, "b.json")).status).toBe(2);
  });
});

describe("the signed corpus", () => {
  const PUBLIC = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" }, format: "jwk" });
  const objectOf = (path: string): any => {
    const document = JSON.parse(read(path));
    return Array.isArray(document) ? document[0] : document;
  };
  // The reference check: the signature over the first two parts, with the test key.
  const signatureHolds = (jws: string): boolean => {
    const parts = jws.split(".");
    return parts.length === 3 && verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), PUBLIC, Buffer.from(parts[2], "base64url"));
  };

  it("is what the generator makes, byte for byte", async () => {
    const { files } = await import("../../schemas-validators/gen/signed.mjs");
    const fresh = files() as Record<string, string>;
    expect(Object.keys(fresh)).toHaveLength(22);
    for (const [path, text] of Object.entries(fresh)) expect(read(path), path).toBe(text);
    expect(manifest.filter((entry) => entry.signature !== undefined).map((entry) => entry.path).sort()).toEqual(Object.keys(fresh).sort());
  });

  it("is what the publisher makes with the same key", async () => {
    const key = await importSigningKey(
      JSON.stringify({ kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A" }),
    );
    const { signed: _signed, ...object } = objectOf("signed/ed25519-single.json");
    // The same header, the same payload and a deterministic Ed25519 signature: the same string.
    const signed = ((await signDeclaration(object, key)) as any).signed;
    expect(signed).toBe(objectOf("signed/ed25519-single.json").signed);
  });

  it("has signatures that hold for the positives and for the files that only misuse a good one", () => {
    for (const entry of manifest.filter((e) => e.signature === "verified")) {
      expect(signatureHolds(objectOf(entry.path).signed), entry.path).toBe(true);
    }
    for (const path of ["signed/bad/payload-target-differs.json", "signed/bad/modified-after-signing.json", "signed/bad/cty-other.json"]) {
      expect(signatureHolds(objectOf(path).signed), path).toBe(true);
    }
  });

  it("has signatures that do not hold where the signature is the fault", () => {
    for (const path of ["signed/bad/signature-corrupted.json", "signed/bad/alg-none.json", "signed/bad/alg-hs256.json", "signed/bad/not-compact-serialization.json"]) {
      expect(signatureHolds(objectOf(path).signed), path).toBe(false);
    }
  });

  it("has an object that is valid -10 in every file, so that only the signature is in question", () => {
    for (const entry of manifest.filter((e) => e.signature !== undefined)) {
      expect(upgradeText(read(entry.path)).notes, entry.path).toEqual([]);
    }
  });
});
