#!/usr/bin/env node
/**
 * Extracts every normative sentence (RFC 2119 / RFC 8174 keywords) from the
 * draft's markdown source and writes requirements.json: one entry per sentence
 * with a stable id derived from the sentence text, its section, and the
 * keywords it carries. Code blocks, YAML front matter and the Changelog are
 * excluded; the Changelog describes history, not requirements.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KEYWORDS = /\b(MUST NOT|MUST|REQUIRED|SHALL NOT|SHALL|SHOULD NOT|SHOULD|NOT RECOMMENDED|RECOMMENDED|MAY|OPTIONAL)\b/g;

export function extract(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let section = "(front)";
  let chapter = "(front)";
  let inCode = false;
  let inFront = false;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (/^#+\s/.test(text) || /^changelog$/i.test(chapter)) return;
    // Sentence split: a period/question mark followed by a space and a capital,
    // a quote or a backtick; abbreviations such as "e.g." are rejoined below.
    const parts = text.split(/(?<=[.?])\s+(?=[A-Z"`(\[])/);
    const sentences = [];
    for (const p of parts) {
      if (sentences.length && /\b(e\.g|i\.e|cf|vs|etc|Sec|Section|No)\.$/.test(sentences[sentences.length - 1])) {
        sentences[sentences.length - 1] += ` ${p}`;
      } else sentences.push(p);
    }
    for (const s of sentences) {
      const kws = [...new Set((s.match(KEYWORDS) ?? []))];
      if (!kws.length) continue;
      // Sentences that merely define the keywords (Requirements Language) are not requirements.
      if (/RFC\s?2119|RFC\s?8174|BCP\s?14/.test(s) && /interpreted|described/.test(s)) continue;
      const id = `req-${createHash("sha1").update(s).digest("hex").slice(0, 8)}`;
      out.push({ id, section, keywords: kws, text: s });
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "---" && out.length === 0 && !inFront && para.length === 0 && section === "(front)") { inFront = true; continue; }
    if (inFront) { if (/^---( |$)/.test(line)) inFront = false; continue; }
    if (/^--- (middle|back|abstract)\s*$/.test(line)) { flush(); continue; }
    if (/^(```|~~~)/.test(line)) { flush(); inCode = !inCode; continue; }
    if (inCode) continue;
    const h = /^(#+)\s+(.*)$/.exec(line);
    if (h) { flush(); section = h[2].trim(); if (h[1].length === 1) chapter = section; continue; }
    // A list item is its own paragraph: one requirement per bullet or step.
    if (/^\s*([*-]|\d+\.)\s+/.test(line)) { flush(); para.push(line.replace(/^\s*([*-]|\d+\.)\s+/, "")); continue; }
    if (/^\s*$/.test(line)) { flush(); continue; }
    if (/^\s*>\s*\\?\[Note to the RFC Editor/.test(line)) continue;
    para.push(line.trim());
  }
  flush();
  return out;
}

const supplementPath = join(here, "supplement.json");
/** Keyword-less requirements kept by hand; each must still occur verbatim in the draft. */
export function supplement(markdown) {
  if (!existsSync(supplementPath)) return [];
  const entries = JSON.parse(readFileSync(supplementPath, "utf8")).requirements;
  const flat = markdown.replace(/\s+/g, " ");
  return entries.map((r) => ({ ...r, present: flat.includes(r.text.replace(/\s+/g, " ")) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const draft = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(here, "..", "..", "internet-drafts", "draft-besleaga-sustainability-wellknown-08.md");
const reqs = extract(readFileSync(draft, "utf8")).concat(supplement(readFileSync(draft, "utf8")).map(({ present, ...r }) => r));
if (process.argv.includes("--write")) {
  writeFileSync(join(here, "requirements.json"), `${JSON.stringify({ source: draft.split("/").pop(), count: reqs.length, requirements: reqs }, null, 2)}\n`);
  console.log(`${reqs.length} normative sentences written to requirements.json`);
} else {
  for (const r of reqs) console.log(`${r.id} [${r.section}] (${r.keywords.join(",")}) ${r.text}`);
}
}
