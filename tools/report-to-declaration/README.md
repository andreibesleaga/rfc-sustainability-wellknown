# report-to-declaration — a published report in, a candidate declaration out

**Status: demonstration.** It shows that the last manual step in publishing a declaration — reading
an organisation's PDF and typing its figures in — can be assisted by a model without giving up the
rule this project rests on:

> Every figure is read from the public source document named in `methodology-uri`.
> Nothing is estimated, interpolated or apportioned.

The tool never invents a number, and it cannot produce a document that claims a review nobody did.

## How it works

```
source (PDF / HTML / text, ≤ 50 MB, SHA-256 recorded)
  │  pdftotext -layout (pages kept), or HTML with table rows and entities preserved
  ▼
plain text, read in overlapping 100k-character parts — never truncated
  │
  ▼
model (OpenRouter: any concrete model, priced before the call; or a recorded reply offline)
  │   returns, for each figure: member, value, VERBATIM QUOTE, and a note (e.g. which accounting basis)
  ▼
deterministic verification — the part that does not trust the model
  • the quote must appear in the source, character for character (invisible spaces normalized)
  • the page is located by the tool, not taken from the model
  • the number must appear inside that quote, not as part of a longer number
  • a figure "in thousands" is refused, not multiplied; a negative only where the quote shows the sign
  • a period that has not ended (a target like "net zero by 2050") is refused
  • two different values for one member (a prior year, the other basis) are both refused: a person chooses
  • scopes must sum to the total; a renewable share of electricity is flagged; a quote without the year is flagged
  ▼
candidate.json  (provider: "CANDIDATE, NOT REVIEWED — must not be published")
evidence.md     (every figure, page, quote, check and flag; every rejection and why)
  │
  ▼  a person reads evidence.md and runs again with --approve --reviewer "<name>"
declaration.json (provider names the reviewer and the date) + approval.json (who, when, source hash, document hash)
```

The schema is checked with the repository's consumer library (`consumer/dist`). Approval is refused
if that check did not run.

## Use

```bash
# Offline demonstration: no key, no network, deterministic.
npm run demo

# Live, through OpenRouter:
export OPENROUTER_API_KEY=sk-or-...
node extract.mjs --source https://example.com/sustainability-2025.pdf \
                 --target "Example Hosting Ltd" --methodology-uri https://example.com/sustainability-2025.pdf \
                 --model google/gemini-2.5-flash --max-cost-usd 0.05

# After reading out/evidence.md: the same command plus
node extract.mjs ... --approve --reviewer "Your Name"
# Approval calls no model: it re-checks the saved reply, and refuses if the source
# or the accepted figures differ from the run that was read. A local --source
# needs --source-differs (it cannot be checked against --methodology-uri).
```

| Output | What it is |
|---|---|
| `candidate.json` | Always written. Marked NOT REVIEWED in its `provider`. Never publish it. |
| `evidence.md` | One row per figure: value, page, the model's note, the checks passed, the flags to resolve, the quote. Read this. |
| `rejected.json` | What the model proposed that did not survive, with the reason. |
| `model-reply.json` | Exactly what the model returned, so a run can be replayed and audited. |
| `declaration.json` | Only with `--approve --reviewer`. Its `provider` names the reviewer and the date. |
| `approval.json` | Who approved, when, the source's SHA-256 and the declaration's SHA-256. |

**Calling a model.**
- The run's cost is estimated before any call, from OpenRouter's published price for the named model.
- It refuses:
  - a router or an unpriced model;
  - a model the price list does not contain;
  - a price list it cannot read;
  - any estimate above `--max-cost-usd`.
- Requests go only to providers that honour the JSON schema (`require_parameters`) and that do not
  keep the input (`data_collection: deny`).

OpenRouter has no per-request spending cap of its own. Put a limit on the key as well.

## What it must never do

- **Publish without a person.** `--approve` requires `--reviewer`. Without both, the only document
  written is a candidate that says it must not be published.
- **Emit a figure the source does not contain**, or choose between two figures the source gives for
  the same thing.
- **Convert units or scale numbers.** Writing "tCO2e" as `mtCO2e` is the same unit, so that is
  allowed. Turning "30.31 thousand" into 30310 is a calculation, so that is refused.
- **Claim a meter reading.** `measurement-method` is not extracted from the report. It is set by the
  operator (`--measurement-method`, default `third-party-modeled`), and this tool never writes
  `hardware-metered`.
- **Follow instructions found in the report.** The text is data. A planted sentence can make a quote
  exist, but it cannot get past the checks above or past the reviewer.

## Honest limits

- A mechanical check proves the number is **in the document**, not that it is the **right** number
  for the member. Published research (ESGReveal, arXiv:2312.17264) measures unreviewed extraction at about 77% correct, which is
  why the human step exists.
- Numbers that exist only inside a chart image are invisible. A scanned PDF without a text layer is
  refused.
- Two-column layouts can interleave lines. When that breaks a quote, the figure is rejected, not
  guessed.
- `carbon-intensity` is reported, not checked: scope 2 over energy is the intensity only when the
  energy figure is electricity alone, and the tool says so.
