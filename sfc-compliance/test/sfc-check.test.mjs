/**
 * sfc-check against the eleven fixtures. No network: the attestation test
 * injects its own fetch, and every clock is fixed, so a run means the same
 * thing today and in ten years.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkDocument, parseArgs, selectAnnualNetworkObject, objectsOf, DEFAULT_CLOCK } from "../sfc-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const statusOf = (result, id) => result.rows.filter((r) => r.id === id).map((r) => r.status);
const detailOf = (result, id) => result.rows.filter((r) => r.id === id).map((r) => r.detail).join(" ");

describe("the reference declarations", () => {
  it("the network example passes every check a reader can make", async () => {
    const doc = JSON.parse(readFileSync(join(root, "examples", "sfc-network.example.json"), "utf8"));
    const result = await checkDocument(doc);
    expect(result.conformant).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(statusOf(result, "C1-energy")).toEqual(["PASS"]);
    expect(statusOf(result, "C2-hardware-lifecycle")).toEqual(["DECLARED"]);
    expect(statusOf(result, "C3-net-zero")).toEqual(["DECLARED"]);
    expect(statusOf(result, "C3-gross-coherence")).toEqual(["PASS"]);
  });

  it("the operator example declares its membership and is refused C1", async () => {
    const doc = JSON.parse(readFileSync(join(root, "examples", "sfc-operator.example.json"), "utf8"));
    const result = await checkDocument(doc);
    expect(result.conformant).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(statusOf(result, "C1-energy")).toEqual(["REFUSED"]);
    expect(statusOf(result, "M-membership")).toEqual(["DECLARED"]);
  });
});

describe("fixture: pass", () => {
  it("conforms, is under the cap, and exits 0", async () => {
    const result = await checkDocument(fixture("pass.json"));
    expect(result).toMatchObject({ conformant: true, capExceeded: false, exitCode: 0 });
    expect(detailOf(result, "C1-energy")).toContain("0.8 GWh");
  });

  it("never says a declared claim passed", async () => {
    const result = await checkDocument(fixture("pass.json"));
    for (const id of ["C2-hardware-lifecycle", "C3-net-zero", "M-topology"]) {
      expect(statusOf(result, id)).toEqual(["DECLARED"]);
    }
  });
});

describe("fixture: ledger-evidence", () => {
  // pass.json plus a ledger-evidence entry. The operator entry copies the invented
  // operator 7 values of the paper's worked example, with the window moved into
  // the fixture's reporting year so that it lies inside reporting-period. The entry
  // only exercises the DECLARED row: its values do not reconcile with the fixture's
  // annual figures (ledger profile 1.2 section 9.3, step 5), as its provider says.
  it("reports the extension as DECLARED, never PASS, and leaves the exit code alone", async () => {
    const result = await checkDocument(fixture("ledger-evidence.json"));
    expect(result).toMatchObject({ conformant: true, capExceeded: false, exitCode: 0 });
    expect(statusOf(result, "ledger-evidence")).toEqual(["DECLARED"]);
    expect(detailOf(result, "ledger-evidence")).toContain("1 operator entry");
    expect(detailOf(result, "ledger-evidence")).toContain("profile-version 1.2");
  });

  it("reports pass.json, which carries no such extension, as ABSENT", async () => {
    const result = await checkDocument(fixture("pass.json"));
    expect(statusOf(result, "ledger-evidence")).toEqual(["ABSENT"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("fixture: over-cap", () => {
  it("fails C1 and exits non zero although the document is conformant", async () => {
    const result = await checkDocument(fixture("over-cap.json"));
    expect(result.conformant).toBe(true);
    expect(result.capExceeded).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(detailOf(result, "C1-energy")).toContain("2.6 GWh");
  });
});

describe("fixture: missing-extension", () => {
  it("reports the hardware extension absent without failing the document", async () => {
    const result = await checkDocument(fixture("missing-extension.json"));
    expect(statusOf(result, "C2-hardware-lifecycle")).toEqual(["ABSENT"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("fixture: sub-annual", () => {
  it("refuses C1 on a month and says why", async () => {
    const result = await checkDocument(fixture("sub-annual.json"));
    expect(statusOf(result, "C1-energy")).toEqual(["REFUSED"]);
    expect(detailOf(result, "C1-energy")).toContain("whole calendar year");
    expect(result.exitCode).toBe(0);
  });
});

describe("fixture: operator-level", () => {
  it("refuses C1 on an operator declaration and names the target-type", async () => {
    const result = await checkDocument(fixture("operator-level.json"));
    expect(statusOf(result, "C1-energy")).toEqual(["REFUSED"]);
    expect(detailOf(result, "C1-energy")).toContain("target-type is origin");
    expect(statusOf(result, "M-membership")).toEqual(["DECLARED"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("fixture: non-conformant", () => {
  it("fails draft conformance and exits non zero", async () => {
    const result = await checkDocument(fixture("non-conformant.json"));
    expect(result.conformant).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(statusOf(result, "draft-conformance")).toEqual(["FAIL"]);
  });
});

describe("fixture: http-uri", () => {
  // -10 no longer restricts URI members to https (the -07 consumer warned), so the
  // consumer says nothing here and the document stays valid.
  it("stays valid, and the consumer raises no warning for an http link", async () => {
    const result = await checkDocument(fixture("http-uri.json"));
    expect(result.conformant).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(statusOf(result, "draft-warning")).toEqual([]);
  });
});

describe("fixture: bad-uri", () => {
  it("reports the consumer's warning (an object with a message) as a WARN row and stays valid", async () => {
    const result = await checkDocument(fixture("bad-uri.json"));
    expect(result.conformant).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(statusOf(result, "draft-warning")).toEqual(["WARN"]);
    expect(detailOf(result, "draft-warning")).toContain("disclosure-uri");
  });
});

describe("fixture: attestation-absent", () => {
  it("says nobody else has spoken about the figures", async () => {
    const result = await checkDocument(fixture("attestation-absent.json"));
    expect(statusOf(result, "C3-attestation")).toEqual(["ABSENT"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("the attestation flag", () => {
  it("fetches nothing by default", async () => {
    const result = await checkDocument(fixture("pass.json"), {
      fetchImpl: () => {
        throw new Error("the checker fetched without being asked to");
      },
    });
    expect(statusOf(result, "C3-attestation")).toEqual(["INFO"]);
    expect(detailOf(result, "C3-attestation")).toContain("evidence of nothing");
  });

  it("reports a statement that does not check out as a warning, not a failure", async () => {
    const fetchImpl = async () =>
      new Response("not a credential", { status: 200, headers: { "content-type": "text/plain" } });
    const lookup = async () => ["203.0.113.7"];
    const result = await checkDocument(fixture("pass.json"), { verifyAttestation: true, fetchImpl, lookup });
    expect(statusOf(result, "C3-attestation")).toEqual(["WARN"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("fixture: legacy-08", () => {
  // A file still written for -08 (reporting-period, mtCO2e). The checker reads the strict
  // -10 wire exactly as the consumer's validateDocument does, so it is reported invalid.
  it("is reported as not conforming, and C1 is refused for lack of a period", async () => {
    const result = await checkDocument(fixture("legacy-08.json"));
    expect(result.conformant).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(statusOf(result, "draft-conformance")).toEqual(["FAIL"]);
    expect(detailOf(result, "draft-conformance")).toContain("period");
    expect(statusOf(result, "C1-energy")).toEqual(["REFUSED"]);
  });
});

describe("determinism", () => {
  it("two runs of the same document are identical", async () => {
    const a = await checkDocument(fixture("pass.json"));
    const b = await checkDocument(fixture("pass.json"), { clock: new Date(DEFAULT_CLOCK) });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("selection", () => {
  it("reads a trend array and refuses C1 when no year is covered", () => {
    const july = { start: "2025-07-01T00:00:00Z", end: "2025-08-01T00:00:00Z" };
    const objects = objectsOf([fixture("sub-annual.json"), { ...fixture("sub-annual.json"), period: july }]);
    const selection = selectAnnualNetworkObject(objects);
    expect(selection.object).toBeUndefined();
    expect(selection.reason).toContain("2025-06-01T00:00:00Z to 2025-07-01T00:00:00Z, 2025-07-01T00:00:00Z to 2025-08-01T00:00:00Z");
  });

  it("takes a whole calendar year in any one offset and refuses twelve months from another day", () => {
    const year = (start, end) => ({ ...fixture("pass.json"), period: { start, end } });
    const pick = (o) => selectAnnualNetworkObject([o]).object;
    expect(pick(year("2025-01-01T00:00:00+02:00", "2026-01-01T00:00:00+02:00"))).toBeDefined();
    expect(pick(year("2025-02-01T00:00:00Z", "2026-02-01T00:00:00Z"))).toBeUndefined();
    expect(pick(year("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z"))).toBeUndefined();
  });

  it("parses the command line", () => {
    const parsed = parseArgs(["doc.json", "--verify-attestation", "--now=2030-05-05T00:00:00Z"]);
    expect(parsed.subject).toBe("doc.json");
    expect(parsed.options.verifyAttestation).toBe(true);
    expect(parsed.options.clock.toISOString()).toBe("2030-05-05T00:00:00.000Z");
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});

describe("the command line", () => {
  const run = (args) => spawnSync(process.execPath, [join(root, "sfc-check.mjs"), ...args], { encoding: "utf8" });

  it("exits 0 on the network example and prints the report", () => {
    const r = run([join(root, "examples", "sfc-network.example.json")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("PASS     C1-energy");
  });

  it("exits 1 on the over-cap fixture", () => {
    const r = run([join(here, "fixtures", "over-cap.json")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL     C1-energy");
  });

  it("refuses an http origin", () => {
    const r = run(["http://ledger.example"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("https");
  });

  it("exits 2 with usage when given nothing", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("usage:");
  });
});
