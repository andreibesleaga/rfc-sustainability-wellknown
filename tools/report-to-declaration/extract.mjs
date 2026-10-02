#!/usr/bin/env node
/**
 * report-to-declaration — a published sustainability report in, a candidate
 * declaration out, with a verbatim quote behind every figure.
 *
 * The model proposes; this file disposes. Nothing the model returns is trusted
 * until `verify.mjs` has found the quote in the source text and the number
 * inside the quote. See README.md for what this tool must never do.
 *
 * Node >= 20. No dependencies. PDF support needs `pdftotext` (poppler-utils) on
 * PATH; without it, HTML and plain text still work.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, env, exit } from "node:process";
import { buildDeclaration, verifyFigures } from "./verify.mjs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    `usage: node extract.mjs --source <url|file> --target <subject> --methodology-uri <url> [options]

  --source URL|PATH        the published report: .pdf, .html or .txt
  --target NAME            the reporting subject, as it goes in the "target" member
  --methodology-uri URL    the public source document (required by the format)
  --provider TEXT          publisher identification; a default is composed if omitted
  --target-type TYPE       origin|path|organization|service|product|device|tenant|data-source
  --out DIR                output directory (default ./out)

  --model NAME             OpenRouter model (default ${DEFAULT_MODEL})
  --max-cost-usd N         refuse to call a model priced above this per run (default 0.10)
  --replay FILE            use a recorded model reply instead of calling anything (offline)
  --approve                the human has read evidence.md and accepts the result

Environment: OPENROUTER_API_KEY for live runs.`,
  );
  exit(msg ? 2 : 0);
}

const DEFAULT_MODEL = "google/gemini-2.5-flash";

function parseArgs(args) {
  const out = { out: "./out", model: DEFAULT_MODEL, maxCostUsd: 0.1 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i] ?? usage(`${a} needs a value`);
    switch (a) {
      case "--source": out.source = next(); break;
      case "--target": out.target = next(); break;
      case "--methodology-uri": out.methodologyUri = next(); break;
      case "--provider": out.provider = next(); break;
      case "--target-type": out.targetType = next(); break;
      case "--out": out.out = next(); break;
      case "--model": out.model = next(); break;
      case "--max-cost-usd": out.maxCostUsd = Number(next()); break;
      case "--replay": out.replay = next(); break;
      case "--approve": out.approve = true; break;
      case "-h": case "--help": usage(); break;
      default: usage(`unknown argument ${a}`);
    }
  }
  if (!out.source) usage("--source is required");
  if (!out.target) usage("--target is required");
  if (!out.methodologyUri) usage("--methodology-uri is required");
  if (!/^https:\/\//.test(out.methodologyUri)) usage("--methodology-uri must be an absolute https URI");
  return out;
}

/** The report as plain text, plus a page index so a quote can be located. */
async function sourceText(source) {
  let bytes, name;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok) throw new Error(`fetching ${source}: HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    name = new URL(source).pathname;
  } else {
    bytes = readFileSync(source);
    name = basename(source);
  }
  const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  if (isPdf) {
    const tmp = join(env.TMPDIR ?? "/tmp", `r2d-${Date.now()}.pdf`);
    writeFileSync(tmp, bytes);
    const r = spawnSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) {
      throw new Error("this is a PDF and `pdftotext` is not available (install poppler-utils)");
    }
    const text = r.stdout;
    if (text.replace(/\s/g, "").length < 200) {
      throw new Error("the PDF has almost no text layer — it is probably scanned; extraction is not possible");
    }
    return { text, kind: "pdf", name };
  }
  let text = bytes.toString("utf8");
  if (/<html[\s>]/i.test(text) || name.endsWith(".html")) {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    return { text, kind: "html", name };
  }
  return { text, kind: "text", name };
}

/** The members a model may propose. Everything else is ignored by design. */
const EXTRACTABLE = [
  "reporting-period", "energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit",
  "carbon-accounting", "scope-1", "scope-2", "scope-3", "renewable-energy",
  "carbon-intensity-gCO2e-per-kWh", "measurement-method",
];

const SYSTEM_PROMPT = `You read corporate sustainability reports and extract figures exactly as published.

Rules you must follow:
- Return ONLY figures that appear in the text given to you. Never calculate, convert, estimate or infer a value.
- For every figure, return the VERBATIM quote from the text that contains it, copied character for character, at most 300 characters. If you cannot quote it, do not return it.
- Use the unit as published. Do not convert units. Reporting "tCO2e", "tonnes CO2e" or "metric tons CO2e" as "mtCO2e" is a change of spelling for the same unit and is allowed; changing 12,480 MWh into kWh is a conversion and is not.
- If a figure is reported on both a location-based and a market-based basis, return the one you can quote and say which basis in "note".
- Omit anything you are unsure about. An omitted figure is correct behaviour; a wrong figure is not.`;

function userPrompt(text, target) {
  const body = text.length > 120_000 ? `${text.slice(0, 120_000)}\n[...truncated]` : text;
  return `Reporting subject: ${target}

Extract these members where the report states them: ${EXTRACTABLE.join(", ")}.
Units: energy-unit one of Wh, kWh, MWh, GWh. carbon-unit one of gCO2e, kgCO2e, mtCO2e. carbon-accounting one of location-based, market-based. renewable-energy is a percentage 0-100. reporting-period is YYYY, YYYY-MM or YYYY-MM-DD.

Report text:
---
${body}
---

Return JSON: {"figures":[{"member":"...","value":<number or string>,"quote":"...","page":<number or null>,"note":"..."}]}`;
}

const REPLY_SCHEMA = {
  type: "object",
  required: ["figures"],
  additionalProperties: false,
  properties: {
    figures: {
      type: "array",
      items: {
        type: "object",
        required: ["member", "value", "quote"],
        additionalProperties: false,
        properties: {
          member: { type: "string", enum: EXTRACTABLE },
          value: { type: ["number", "string"] },
          quote: { type: "string" },
          page: { type: ["number", "null"] },
          note: { type: "string" },
        },
      },
    },
  },
};

/** Refuse a model whose published price would exceed the run budget. */
async function checkPrice(model, maxCostUsd, apiKey) {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) return { checked: false, reason: `model list unavailable (HTTP ${res.status})` };
  const { data } = await res.json();
  const m = data?.find((x) => x.id === model);
  if (!m) return { checked: false, reason: `model ${model} is not in OpenRouter's list` };
  const pIn = Number(m.pricing?.prompt ?? 0);
  const pOut = Number(m.pricing?.completion ?? 0);
  // One run is bounded by the prompt cap above plus a small reply.
  const estimate = pIn * 40_000 + pOut * 2_000;
  if (estimate > maxCostUsd) {
    throw new Error(
      `${model} would cost about $${estimate.toFixed(4)} per run, above the --max-cost-usd limit of $${maxCostUsd}`,
    );
  }
  return { checked: true, estimateUsd: Number(estimate.toFixed(6)), free: pIn === 0 && pOut === 0 };
}

async function askModel({ text, target, model, maxCostUsd }) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set — use --replay for an offline run");
  }
  const price = await checkPrice(model, maxCostUsd, apiKey);
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "report-to-declaration",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(text, target) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "figures", strict: true, schema: REPLY_SCHEMA } },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("the model did not return JSON; try a model that supports structured output");
  }
  return { reply: parsed, meta: { model, price, usage: body.usage ?? null, id: body.id ?? null } };
}

function evidenceSheet({ accepted, rejected, meta, opts, src }) {
  const rows = accepted.map(
    (f) => `| \`${f.member}\` | ${f.value}${f.unit ? ` ${f.unit}` : ""} | ${f.page ?? "—"} | ${f.checks.join(", ")} | ${f.quote.replace(/\|/g, "\\|").slice(0, 160)} |`,
  );
  const bad = rejected.map((f) => `| \`${f.member}\` | ${f.value ?? "—"} | ${f.reason} |`);
  return `# Evidence — ${opts.target}

Read this before approving. Every row below was proposed by a model and then checked mechanically
against the source text. A mechanical check proves the number is **in the document**; only you can
confirm it is the **right** number for that member.

- Source: ${opts.source}
- Source kind: ${src.kind}, ${src.text.length.toLocaleString()} characters of text
- Model: ${meta.model}${meta.replayed ? " (recorded reply, offline run)" : ""}
- Run: ${new Date().toISOString()}

## Accepted figures (${accepted.length})

| Member | Value | Page | Checks passed | Quote from the source |
|---|---|---|---|---|
${rows.join("\n") || "| — | — | — | — | none |"}

## Rejected (${rejected.length})

| Member | Proposed | Why it was dropped |
|---|---|---|
${bad.join("\n") || "| — | — | none |"}

## What to check by hand

1. Does each quote mean what the member says it means? A number in a report can be a target, a prior
   year, a subsidiary, or a restated figure.
2. Is the accounting basis right? Location-based and market-based totals are not interchangeable.
3. Is the period the one the report covers, and is it a calendar period? A fiscal year is not.
4. Is the boundary the subject you are naming in \`target\`?
5. Anything the report says that the format cannot carry belongs in the methodology document.
`;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  const src = await sourceText(opts.source);

  let reply, meta;
  if (opts.replay) {
    const recorded = JSON.parse(readFileSync(opts.replay, "utf8"));
    reply = recorded.reply ?? recorded;
    meta = { ...(recorded.meta ?? {}), model: recorded.meta?.model ?? "recorded", replayed: true };
  } else {
    ({ reply, meta } = await askModel({ text: src.text, target: opts.target, model: opts.model, maxCostUsd: opts.maxCostUsd }));
  }

  const { accepted, rejected } = verifyFigures(reply.figures ?? [], src.text);
  const declaration = buildDeclaration({ accepted, opts, meta });

  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "model-reply.json"), `${JSON.stringify({ reply, meta }, null, 2)}\n`);
  writeFileSync(join(opts.out, "rejected.json"), `${JSON.stringify(rejected, null, 2)}\n`);
  writeFileSync(join(opts.out, "evidence.md"), evidenceSheet({ accepted, rejected, meta, opts, src }));
  writeFileSync(join(opts.out, "declaration.json"), `${JSON.stringify(declaration.document, null, 2)}\n`);

  console.log(`source      ${opts.source} (${src.kind})`);
  console.log(`model       ${meta.model}${meta.replayed ? " [recorded]" : ""}`);
  console.log(`accepted    ${accepted.length} figure(s): ${accepted.map((f) => f.member).join(", ") || "none"}`);
  console.log(`rejected    ${rejected.length}: ${rejected.map((f) => `${f.member} (${f.reason})`).join("; ") || "none"}`);
  console.log(`conformant  ${declaration.conformant ? "yes" : `NO — ${declaration.problems.join("; ")}`}`);
  console.log(`written to  ${opts.out}/`);

  if (!declaration.conformant) {
    console.error("\nThe candidate is not a conformant declaration. Nothing to approve.");
    exit(1);
  }
  if (!opts.approve) {
    console.error(`\nRead ${join(opts.out, "evidence.md")}. Re-run with --approve once you have checked every row.`);
    exit(3);
  }
  console.log("\nApproved by the operator. The provider member records that this was machine-extracted and human-checked.");
}

main().catch((e) => {
  console.error(`error: ${e.message}`);
  exit(1);
});
