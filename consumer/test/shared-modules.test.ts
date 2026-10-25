import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");


// The three modules are written once, in the publisher, and carried here byte for byte.
const PUBLISHER_SRC = resolve(process.cwd(), "..", "publisher", "src");

describe("the shared modules are byte-identical to the publisher's", () => {
  for (const name of ["period.ts", "tokens.ts", "json.ts"]) {
    it(name, () => {
      expect(readFileSync(join(SRC, name), "utf8")).toBe(readFileSync(join(PUBLISHER_SRC, name), "utf8"));
    });
  }
});

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gms)].map((m) => m[1]);

describe("the modules the consumer holds as copies", () => {
  it("period.ts depends on the date library and a type of tokens.ts, nothing of the publisher", () => {
    expect(importsOf(join(SRC, "period.ts")).sort()).toEqual(["./tokens", "temporal-polyfill"]);
  });

  it("tokens.ts imports nothing", () => {
    expect(importsOf(join(SRC, "tokens.ts"))).toEqual([]);
  });

  it("json.ts depends only on the JSON library", () => {
    expect(importsOf(join(SRC, "json.ts"))).toEqual(["lossless-json"]);
  });

  it("period.ts reads no clock", () => {
    const source = readFileSync(join(SRC, "period.ts"), "utf8");
    expect(source).not.toMatch(/Temporal\.Now|new Date|Date\.now/);
  });
});

describe("calendar and instant arithmetic lives in period.ts", () => {
  it("no other source file imports the date library or does arithmetic on Date", () => {
    const offenders = files(SRC)
      .filter((f) => !f.endsWith("period.ts"))
      .flatMap((f) => {
        const source = readFileSync(f, "utf8");
        const found = importsOf(f).includes("temporal-polyfill") ? ["imports temporal-polyfill"] : [];
        if (/Date\.UTC|\.getUTC\w+\(|\.setUTC\w+\(/.test(source)) found.push("computes with Date");
        return found.map((what) => `${relative(SRC, f)} ${what}`);
      });
    expect(offenders).toEqual([]);
  });

  it("the declarations of period.ts do not expose a Temporal type", () => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      declaration: true,
      emitDeclarationOnly: true,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      types: ["node"],
    };
    const program = ts.createProgram([join(SRC, "period.ts")], options);
    let declarations = "";
    program.emit(
      program.getSourceFile(join(SRC, "period.ts")),
      (name, text) => {
        if (name.endsWith("period.d.ts")) declarations = text;
      },
      undefined,
      true,
    );
    expect(declarations).toContain("export declare function parsePeriod");
    expect(declarations).not.toMatch(/Temporal/);
  });
});
