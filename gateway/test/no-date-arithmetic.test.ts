/**
 * The gateway never does calendar arithmetic of its own: periods, months, days and
 * offsets come from the publisher library's period functions. This guard fails on
 * the hand-rolled forms (Date.UTC, UTC getters and setters, Date.parse and
 * new Date over a string or a variable, month arithmetic, date regular expressions)
 * anywhere in src/, outside the one module that counts hours in milliseconds and the
 * HTTP-date lines. Log timestamps (`toISOString()` of the injected clock) are not
 * calendar arithmetic and are allowed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

/** The module that turns the period functions' date-times into milliseconds for the hours model. */
const HOURS_MODULE = "src/adapters/self-report.ts";

const HAND_ROLLED: [string, RegExp][] = [
  ["Date.UTC", /\bDate\.UTC\s*\(/],
  ["a UTC getter or setter", /\.(get|set)UTC[A-Z]\w*\s*\(/],
  ["Date.parse", /\bDate\.parse\s*\(/],
  ["new Date over a string or a variable", /\bnew Date\((["'`]|[a-z])/],
  ["days-in-month or month arithmetic", /\bdaysInMonth\b|\bmonth\s*\+=\s*1\b|\bm\s*===?\s*13\b/],
  ["a date regular expression", /\\d\{4\}\s*-\s*\\d\{2\}|\[0-9\]\{4\}\s*-\s*\[0-9\]\{2\}|\(\\d\{4\}\)-\(\\d\{2\}\)/],
  ["a Temporal import", /temporal-polyfill|@js-temporal/],
];

/** HTTP-dates (RFC 9110) are not calendar periods: conditional requests and Last-Modified. */
const HTTP_DATE_LINE = /If-Modified-Since|ifModifiedSince|Last-Modified|toUTCString|httpDate/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

describe("no hand-rolled date code in src", () => {
  it("finds none outside the hours module and the HTTP-date lines", () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(ROOT, path).split("\\").join("/");
      if (rel === HOURS_MODULE) continue;
      const lines = readFileSync(path, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
        const context = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
        for (const [what, re] of HAND_ROLLED) {
          if (re.test(code) && !(HTTP_DATE_LINE.test(context) && what !== "a Temporal import")) found.push(`${rel}:${i + 1} ${what}: ${line.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("the guard itself recognises each hand-rolled form", () => {
    const samples = [
      "const d = Date.UTC(2026, 3, 1);",
      "d.getUTCMonth()",
      "Date.parse(s)",
      "new Date(ms)",
      "new Date('2026-01-01')",
      "daysInMonth(y, m)",
      "const R = /^(\\d{4})-(\\d{2})$/;",
      'import "temporal-polyfill";',
    ];
    for (const sample of samples) expect(HAND_ROLLED.some(([, re]) => re.test(sample)), sample).toBe(true);
    expect(HAND_ROLLED.some(([, re]) => re.test("clock().toISOString()"))).toBe(false);
  });

  it("no module outside node_modules imports a Temporal polyfill", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => /temporal/.test(d))).toEqual([]);
  });
});
