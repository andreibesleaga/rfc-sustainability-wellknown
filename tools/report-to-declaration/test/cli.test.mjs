/**
 * The command line end to end, offline: the recorded demonstration reply, the
 * two steps (extract, then approve), and the refusals that must leave nothing
 * publishable behind. The schema check needs consumer/ built, as in the tool.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const consumerDist = join(root, "..", "..", "consumer", "dist", "index.js");
const built = existsSync(consumerDist);
const ARGS = [
  "--source", join(root, "fixtures", "demo-report.txt"), "--replay", join(root, "fixtures", "demo-model-reply.json"),
  "--target", "Example Hosting Ltd", "--methodology-uri", "https://hosting.example/reports/2025.pdf",
  "--target-type", "organization", "--source-differs",
];

function cli(args, out) {
  return spawnSync(process.execPath, [join(root, "extract.mjs"), ...args, "--out", out], { encoding: "utf8" });
}
function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "r2d-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), "utf8"));

test("golden: extraction writes a candidate in the -10 form and exits 3; approval writes the declaration", { skip: !built && "consumer/ is not built" }, async () => {
  const { validateDocument } = await import(pathToFileURL(consumerDist).href);
  withDir((dir) => {
    const first = cli(ARGS, dir);
    assert.equal(first.status, 3, first.stderr);
    const candidate = read(dir, "candidate.json");
    assert.deepEqual(candidate.period, { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    assert.equal(candidate["carbon-unit"], "tCO2e");
    assert.match(candidate.provider, /^CANDIDATE, NOT REVIEWED/);
    assert.equal(validateDocument(candidate).valid, true);
    assert.match(readFileSync(join(dir, "evidence.md"), "utf8"), /2025-01-01T00:00:00Z to 2026-01-01T00:00:00Z/);

    const second = cli([...ARGS, "--approve", "--reviewer", "A. Reviewer"], dir);
    assert.equal(second.status, 0, second.stderr);
    const declaration = read(dir, "declaration.json");
    assert.match(declaration.provider, /checked by A\. Reviewer on \d{4}-\d{2}-\d{2}\.$/);
    assert.equal(validateDocument(declaration).valid, true);
    assert.equal(read(dir, "approval.json").offset, "Z");
  });
});

test("a stated offset reaches the candidate; approval with another offset is refused", { skip: !built && "consumer/ is not built" }, () => {
  withDir((dir) => {
    assert.equal(cli([...ARGS, "--offset", "+02:00"], dir).status, 3);
    assert.deepEqual(read(dir, "candidate.json").period, { start: "2025-01-01T00:00:00+02:00", end: "2026-01-01T00:00:00+02:00" });
    const refused = cli([...ARGS, "--approve", "--reviewer", "A. Reviewer"], dir);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /accepted figures differ/);
    assert.equal(existsSync(join(dir, "declaration.json")), false);
  });
});

test("error: a reply with nothing usable leaves no candidate, and a stale one is removed", () => {
  withDir((dir) => {
    writeFileSync(join(dir, "candidate.json"), "{}");
    const empty = join(dir, "empty-reply.json");
    writeFileSync(empty, JSON.stringify({ reply: { figures: [] } }));
    const args = ARGS.map((a, i) => (ARGS[i - 1] === "--replay" ? empty : a));
    const run = cli(args, dir);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /no reporting period was found/);
    assert.equal(existsSync(join(dir, "candidate.json")), false);
    assert.equal(existsSync(join(dir, "evidence.md")), true);
  });
});

test("error: bad options are refused before anything is read", () => {
  withDir((dir) => {
    for (const [extra, message] of [
      [["--offset", "Europe/Berlin"], /--offset: .* not Z or a fixed offset/],
      [["--offset", "+0200"], /--offset/],
      [["--target-type", "company"], /--target-type must be one of origin, path, organization, facility/],
      [["--measurement-method", "hardware-metered"], /--measurement-method must be one of hardware-estimated, cloud-billing, third-party-modeled/],
    ]) {
      const run = cli([...ARGS, ...extra], dir);
      assert.equal(run.status, 2, extra.join(" "));
      assert.match(run.stderr, message);
    }
  });
});
