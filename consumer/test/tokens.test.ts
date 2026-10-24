import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";
import {
  CAPABILITIES,
  CARBON_ACCOUNTING,
  CARBON_TO_G,
  CARBON_UNITS,
  ENERGY_UNITS,
  FUNCTIONAL_UNITS,
  GRANULARITIES,
  isCapabilities,
  isCarbonAccounting,
  isCarbonUnit,
  isEnergyUnit,
  isFunctionalUnit,
  isGranularity,
  isMeasurementMethod,
  isTargetType,
  isUpstreamRole,
  leastDirect,
  legacyCarbonUnit,
  legacyFunctionalUnit,
  MEASUREMENT_METHODS,
  RESIDUAL_METHOD,
  TARGET_TYPES,
  UPSTREAM_ROLES,
} from "../src/tokens";

const REPO = resolve(process.cwd(), "..", "schemas-validators");
const cddl = readFileSync(resolve(REPO, "response-schema.cddl"), "utf8");
const schema = JSON.parse(readFileSync(resolve(REPO, "response-schema.json"), "utf8"));

/** The choice written after `member:` in the CDDL: its quoted strings, in order. */
function cddlChoice(member: string): string[] {
  const match = new RegExp(`${member}:\\s*("[^"]*"(?:\\s*/\\s*"[^"]*")*)`).exec(cddl);
  if (!match) throw new Error(`no choice for ${member} in the CDDL`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

const optional = schema.optionalProperties;
const SETS: [string, readonly string[], string[], string[]][] = [
  ["capabilities", CAPABILITIES, cddlChoice("capabilities"), schema.properties.capabilities.enum],
  ["measurement-method", MEASUREMENT_METHODS, cddlChoice("measurement-method"), schema.properties["measurement-method"].enum],
  ["energy-unit", ENERGY_UNITS, cddlChoice("energy-unit"), optional["energy-unit"].enum],
  ["carbon-unit", CARBON_UNITS, cddlChoice("carbon-unit"), optional["carbon-unit"].enum],
  ["carbon-accounting", CARBON_ACCOUNTING, cddlChoice("carbon-accounting"), optional["carbon-accounting"].enum],
  ["functional-unit", FUNCTIONAL_UNITS, cddlChoice("functional-unit"), optional["functional-unit"].enum],
  ["target-type", TARGET_TYPES, cddlChoice("target-type"), optional["target-type"].enum],
  ["role", UPSTREAM_ROLES, cddlChoice("role"), optional.upstream.elements.optionalProperties.role.enum],
];

describe("the closed token sets agree with the CDDL, the schema file and the embedded schema", () => {
  for (const [name, tokens, inCddl, inSchema] of SETS) {
    it(name, () => {
      expect([...tokens]).toEqual(inCddl);
      expect([...tokens]).toEqual(inSchema);
    });
  }

  it("the embedded schema holds the same enums", () => {
    const embedded = RESPONSE_JTD_SCHEMA.optionalProperties;
    expect([...embedded["functional-unit"].enum]).toEqual([...FUNCTIONAL_UNITS]);
    expect([...embedded["target-type"].enum]).toEqual([...TARGET_TYPES]);
    expect([...embedded.upstream.elements.optionalProperties.role.enum]).toEqual([...UPSTREAM_ROLES]);
    expect([...RESPONSE_JTD_SCHEMA.properties["measurement-method"].enum]).toEqual([...MEASUREMENT_METHODS]);
  });

  it("the query values are the ones of the ABNF, in its order", () => {
    expect([...GRANULARITIES]).toEqual(["yearly", "monthly", "daily"]);
  });

  it("the draft lists twelve functional units, nine target types, six roles and four methods", () => {
    expect([FUNCTIONAL_UNITS.length, TARGET_TYPES.length, UPSTREAM_ROLES.length, MEASUREMENT_METHODS.length]).toEqual([12, 9, 6, 4]);
  });
});

describe("type guards compare exactly", () => {
  const GUARDS: [string, (v: unknown) => boolean, readonly string[]][] = [
    ["capabilities", isCapabilities, CAPABILITIES],
    ["measurement-method", isMeasurementMethod, MEASUREMENT_METHODS],
    ["energy-unit", isEnergyUnit, ENERGY_UNITS],
    ["carbon-unit", isCarbonUnit, CARBON_UNITS],
    ["carbon-accounting", isCarbonAccounting, CARBON_ACCOUNTING],
    ["functional-unit", isFunctionalUnit, FUNCTIONAL_UNITS],
    ["target-type", isTargetType, TARGET_TYPES],
    ["role", isUpstreamRole, UPSTREAM_ROLES],
    ["granularity", isGranularity, GRANULARITIES],
  ];
  for (const [name, guard, tokens] of GUARDS) {
    it(name, () => {
      for (const token of tokens) expect(guard(token), token).toBe(true);
      for (const other of [
        "",
        " ",
        "unknown",
        null,
        undefined,
        7,
        {},
        [],
        ...tokens.flatMap((t) => [t.toUpperCase(), t.toLowerCase(), `${t} `, ` ${t}`, t.slice(1)]),
      ].filter((v) => !tokens.includes(v as string))) {
        expect(guard(other), String(other)).toBe(false);
      }
    });
  }

  it("mtCO2e, TWh, hourly and Per-Request are not members", () => {
    expect(isCarbonUnit("mtCO2e")).toBe(false);
    expect(isEnergyUnit("TWh")).toBe(false);
    expect(isGranularity("weekly")).toBe(false);
    expect(isFunctionalUnit("Per-Request")).toBe(false);
    expect(isMeasurementMethod("Hardware-Metered")).toBe(false);
    expect(isUpstreamRole("transit")).toBe(false);
    expect(isTargetType("datacenter")).toBe(false);
  });
});

describe("carbon unit factors", () => {
  it("are grams per unit", () => {
    expect(CARBON_TO_G).toEqual({ gCO2e: 1, kgCO2e: 1000, tCO2e: 1_000_000 });
  });
});

describe("leastDirect", () => {
  it("returns the least direct of any pair, whatever the order", () => {
    for (const [i, a] of MEASUREMENT_METHODS.entries()) {
      for (const [j, b] of MEASUREMENT_METHODS.entries()) {
        expect(leastDirect([a, b]), `${a} and ${b}`).toBe(MEASUREMENT_METHODS[Math.max(i, j)]);
      }
    }
  });

  it("combines a triple and accepts any iterable", () => {
    expect(leastDirect(["hardware-metered", "cloud-billing", "hardware-estimated"])).toBe("cloud-billing");
    expect(leastDirect(new Set(["hardware-metered", "hardware-estimated"]))).toBe("hardware-estimated");
    expect(leastDirect(["hardware-metered"])).toBe("hardware-metered");
  });

  it("takes the residual token for nothing and for a value outside the set", () => {
    expect(RESIDUAL_METHOD).toBe("third-party-modeled");
    expect(leastDirect([])).toBe(RESIDUAL_METHOD);
    expect(leastDirect(["metered"])).toBe(RESIDUAL_METHOD);
    expect(leastDirect(["hardware-metered", "Hardware-Metered"])).toBe(RESIDUAL_METHOD);
  });
});

describe("legacyCarbonUnit", () => {
  it("reads the metric tonne of the earlier revision as tCO2e, and nothing else", () => {
    expect(legacyCarbonUnit("mtCO2e")).toBe("tCO2e");
    expect(legacyCarbonUnit("tCO2e")).toBeUndefined();
    expect(legacyCarbonUnit("MtCO2e")).toBeUndefined();
    expect(legacyCarbonUnit("lbCO2e")).toBeUndefined();
  });
});

describe("legacyFunctionalUnit", () => {
  const read = (unit: string, score?: number) => {
    const r = legacyFunctionalUnit(unit, score);
    return r && { unit: r.unit, score: r.score };
  };

  it("scales a score stated per thousand or per million", () => {
    expect(read("per-thousand-requests", 12)).toEqual({ unit: "per-request", score: 0.012 });
    expect(read("per-thousand-API-requests", 0.42)).toEqual({ unit: "per-request", score: 0.00042 });
    expect(read("per-million-requests", 5)).toEqual({ unit: "per-request", score: 0.000005 });
    expect(read("per-1000-calls", 7)).toEqual({ unit: "per-request", score: 0.007 });
    expect(read("per-1000-transactions", 40)).toEqual({ unit: "per-transaction", score: 0.04 });
    expect(read("per-million-tokens", 2)).toEqual({ unit: "per-token", score: 0.000002 });
    expect(read("per-thousand-inferences", 300)).toEqual({ unit: "per-inference", score: 0.3 });
  });

  it("keeps every digit of a score divided by a power of ten", () => {
    expect(read("per-thousand-requests", 0.123456)).toEqual({ unit: "per-request", score: 0.000123456 });
  });

  it("renames without scaling: plurals, a missing prefix, other nouns", () => {
    expect(read("per-requests", 3)).toEqual({ unit: "per-request", score: 3 });
    expect(read("per-users", 2)).toEqual({ unit: "per-user", score: 2 });
    expect(read("request")).toEqual({ unit: "per-request", score: undefined });
    expect(read("per-call", 2)).toEqual({ unit: "per-request", score: 2 });
    expect(read("per-query", 2)).toEqual({ unit: "per-request", score: 2 });
    expect(read("per-visit", 1.5)).toEqual({ unit: "per-page-view", score: 1.5 });
    expect(read("per-pageview", 1.5)).toEqual({ unit: "per-page-view", score: 1.5 });
    expect(read("per-run", 20)).toEqual({ unit: "per-job", score: 20 });
    expect(read("per-gigabyte", 0.6)).toEqual({ unit: "per-gigabyte", score: 0.6 });
    expect(read("per-device", 150)).toEqual({ unit: "per-device", score: 150 });
  });

  it("reads in any letter case", () => {
    expect(read("Per-Thousand-Requests", 12)).toEqual({ unit: "per-request", score: 0.012 });
  });

  it("converts storage over time to gigabyte-hours, exactly", () => {
    expect(read("per-gigabyte-hour", 7)).toEqual({ unit: "per-gigabyte-hour", score: 7 });
    expect(read("per-gigabyte-day", 48)).toEqual({ unit: "per-gigabyte-hour", score: 2 });
    expect(read("per-gigabyte-day", 24)).toEqual({ unit: "per-gigabyte-hour", score: 1 });
    expect(read("per-terabyte-hour", 1000)).toEqual({ unit: "per-gigabyte-hour", score: 1 });
    expect(read("per-terabyte-day", 24000)).toEqual({ unit: "per-gigabyte-hour", score: 1 });
    expect(read("per-terabyte-day", 0.85)).toEqual({ unit: "per-gigabyte-hour", score: 0.0000354 });
  });

  it("reports the divisor", () => {
    expect(legacyFunctionalUnit("per-million-requests", 5)?.factor).toBe(1_000_000);
    expect(legacyFunctionalUnit("per-terabyte-day", 1)?.factor).toBe(24_000);
    expect(legacyFunctionalUnit("per-request", 1)?.factor).toBe(1);
  });

  it("reads a token of the draft as itself, per-session and per-vcpu-hour among them", () => {
    for (const unit of FUNCTIONAL_UNITS.filter((u) => u !== "per-session" && u !== "per-vcpu-hour")) {
      expect(read(unit, 4.2), unit).toEqual({ unit, score: 4.2 });
    }
  });

  it("finds no rule for a unit over a month, a lifecycle or an abbreviation", () => {
    for (const unit of [
      "per-unit-lifecycle",
      "per-active-user-per-month",
      "per-cluster-month",
      "per-gigabyte-month",
      "req",
      "per-gb",
      "per-1k-requests",
      "per-visit-per-day",
      "per-minute",
      "",
    ]) {
      expect(legacyFunctionalUnit(unit, 4.2), unit).toBeUndefined();
    }
  });
});
