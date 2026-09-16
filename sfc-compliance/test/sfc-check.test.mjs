/**
 * sfc-check against the eight fixtures. No network: the attestation test
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
  it("warns about the non https evidence link and stays valid", async () => {
    const result = await checkDocument(fixture("http-uri.json"));
    expect(result.conformant).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(statusOf(result, "draft-warning")).toContain("WARN");
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

describe("determinism", () => {
  it("two runs of the same document are identical", async () => {
    const a = await checkDocument(fixture("pass.json"));
    const b = await checkDocument(fixture("pass.json"), { clock: new Date(DEFAULT_CLOCK) });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

describe("selection", () => {
  it("reads a trend array and refuses C1 when no year is covered", () => {
    const objects = objectsOf([fixture("sub-annual.json"), { ...fixture("sub-annual.json"), "reporting-period": "2025-07" }]);
    const selection = selectAnnualNetworkObject(objects);
    expect(selection.object).toBeUndefined();
    expect(selection.reason).toContain("2025-06, 2025-07");
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
