# report-to-declaration — turn a published report into a declaration, with provenance

**Status: demonstration.** It shows that the last manual step in this project — reading an
organisation's PDF and typing its figures into a declaration — can be assisted by a model without
giving up the rule the whole project rests on:

> Every figure is read from the public source document named in `methodology-uri`.
> Nothing is estimated, interpolated or apportioned.

So this tool never invents a number, and never publishes one on its own.

## What it does

```
source (PDF / HTML / text)
  │  pdftotext -layout, or tag-stripping for HTML
  ▼
plain text  ──►  model (OpenRouter, any model, or a recorded reply offline)
                     returns, for each figure: member, value, unit, page, and a VERBATIM QUOTE
  ▼
deterministic verification   ← the part that does not trust the model
  • the quote must appear in the source text, character for character
  • the number must appear inside that quote
  • units must be ones the format defines
  • the scopes must sum to the total; intensity × energy must equal scope 2
  ▼
candidate declaration + evidence sheet  ──►  a human reads it and decides
```

A figure that fails any check is dropped and listed with the reason. The tool exits non-zero unless
a human passes `--approve`, and the approved document records that it was machine-extracted and
human-checked.

## Use

```bash
# Offline demonstration — no key, no network, deterministic (this is the demo):
node extract.mjs --source fixtures/demo-report.txt --replay fixtures/demo-model-reply.json \
                 --target "Example Hosting Ltd" --methodology-uri https://example.com/report.pdf

# Live, with a model through OpenRouter:
export OPENROUTER_API_KEY=sk-or-...
node extract.mjs --source https://example.com/sustainability-2025.pdf \
                 --target "Example Hosting Ltd" --methodology-uri https://example.com/sustainability-2025.pdf \
                 --model google/gemini-2.5-flash --max-cost-usd 0.05

# Publish only after reading evidence.md:
node extract.mjs ... --approve --out ./out
```

Outputs, in `--out` (default `./out`):

| File | What it is |
|---|---|
| `declaration.json` | The candidate document. Valid against the format's schema, or the run fails. |
| `evidence.md` | One row per figure: value, page, the quote it came from, and every check it passed. Read this. |
| `rejected.json` | Figures the model proposed that did not survive verification, with the reason. |
| `model-reply.json` | Exactly what the model returned, so a run can be replayed and audited. |

## What it must never do

- Publish without a human. `--approve` is the human; there is no flag that skips it.
- Emit a figure the source does not contain. A number that is not in a verbatim quote is dropped.
- Convert units silently. A conversion is a calculation, not a reading; the tool records the source
  value and unit as published.
- Guess a period, a boundary, or an accounting basis. Missing means omitted — which is what the
  format says "not reported" looks like.
- Claim a measurement method it cannot support. Extraction from a published report is
  `third-party-modeled` unless the report itself says the figures were metered, in which case the
  method is whatever the report states.

## Honest limits

- A model reads text, not meaning. It cannot tell a market-based total from a location-based one if
  the report is sloppy, and it cannot see numbers that exist only inside a chart image.
- Verbatim verification proves the number was **in the document**, not that it was the **right**
  number for the member it was assigned to. Only the human step covers that.
- Scanned reports without a text layer are out of scope; the tool says so rather than guessing.
- Tables that span columns or pages are where extraction fails most often. The evidence sheet exists
  so that failure is visible instead of silent.
