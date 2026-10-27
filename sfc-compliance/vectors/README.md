# Test vectors of the SFC profile, version 2.0

Inputs and expected results for every rule and check of the profile, generated from fixed values and checked by two independent implementations. They are normative for implementers: an implementation matches when it reproduces every row of `expected/`.

Every figure, name and URI is invented (reserved `.example` names). All signatures use the RFC 8032 section 7.1 test 1 key, whose private half is public: they prove format, never who signed. Where a second key is needed (rotation, a former registrar key, another network) the vectors use test key 2 of the same section.

## Run

```
node vectors/make-vectors.mjs     # writes inputs/, expected/, worked/ and ../examples/ (Node 22.13 or later, no network)
python3 vectors/crosscheck.py     # recomputes everything with Python's standard library only; exit 0 when all 184 scenarios match
npm test                          # both of the above, the schemas and the examples
```

`make-vectors.mjs` is deterministic: the clock is T = 2026-05-02T00:10:00Z (given as an explicit T, so the evaluation window is April 2025 to March 2026), there is no randomness, and a second run writes the same bytes. `--out <dir>` writes to `<dir>/vectors` and `<dir>/examples` instead.

## Files

| Path | What it holds |
|---|---|
| `make-vectors.mjs` | The generator. Cases are in `cases/`; the builders that make the signed objects are in `build/`; `scenario-report.mjs` and `functions.mjs` compute `expected/` with the checker in `../lib/`, the one JavaScript reference verifier. |
| `crosscheck.py`, `sfcx/` | The cross-check: its own RFC 8785, SHA-256, Ed25519 (RFC 8032 section 6 arithmetic, section 5.1.7 checks), exact decimals, rules, replay, sums and checks. It reads only `inputs/`, `worked/` and `expected/`. |
| `inputs/<id>.json` | One file per case: `scenarios`, and `excerpts` shared by several scenarios (`excerptRef`). |
| `expected/<id>.json` | For each scenario, `rows` (the report rows), `summary` (rows counted by result word) and, where the scenario asks, `effective` and `derived`. |
| `worked/` | One generated case: three operators, the twelve months of the evaluation window, one correction, one silent month, 1 500 kg of a 2 t retirement in January and 500 kg in February, one rounding case (a tie in the seventh decimal that rounds down). Where this description and the files in `worked/` differ, the files win. |

## Scenario and row format

A scenario has a `name` and either `fn` (a pure function: `canonical`, `ed25519`, `eventHash`, `b64url`, `figure`, `round`, `mechanism`, `registry1xTo2x`; the result is `result`) or the inputs of a check run:

| Member | Meaning |
|---|---|
| `excerpt`, `excerptRef`, `excerptText` | The ledger read (5.8), shared, or as raw text when a literal must stay as written. |
| `declarations`, `declarationText` | The served objects, or the served text. |
| `parameters`, `pins` | The methodology parameters (7.6) and what the checker pinned out of band: `registrar` keys per network host, `methodology` (the document is pinned), `publisherKeys`, `operatorKeys`, `entries1x`. |
| `T`, `now` | An explicit T, or the checker's clock. |
| `consumer` | The verdict of the published consumer library per object (step S2). The cross-check does not recompute it. |
| `limits` | Limits lowered for the scenario, so the input stays small. |
| `prior`, `oldLedgers`, `network`, `retrievalUri`, `select`, `derive`, `effectiveAt` | Earlier verified entry versions, old-ledger reads, the origin for S4, the retrieval URI, the row ids to report, figures to derive, the cut-off of the effective set. |

A row is `{id, result, scope?, detail?}`. `result` is a word of 9.1 (PASS, FAIL, NOT-EVALUABLE, DECLARED, NOT-DECLARED, INFO) or an object verdict (COMPLETE, INCOMPLETE, NOT-APPLICABLE). `scope` names the operator, month, window or object; `detail` is the exact reason, with the tokens sorted and joined by `; `. Row ids: `S2` to `S6.x`, `C-SFC-n`, `D1` to `D8`, with `.event`, `.chain`, `.entry`, `.void`, `.checkpoint`, `.info` for the parts of D2 to D5; `D5.1x` carries the 1.x notes; `PAIR`, `LEGACY`, `URI`, `VERDICT` carry the pairing of 7.3, the reading of 12.1 rule 3, the checks of section 10 on URIs, and the object verdict. A per-event row appears only for an event that fails or is not evaluable; each chain has one row.

## Cases

| Case | What it proves |
|---|---|
| v01-canonical | RFC 8785 bytes for key order in UTF-16 code units, escapes, number forms. |
| v02-hash | Signing input, event hash and signature of one event; the RFC 8032 test vectors. |
| v03-effective | A correction; a rule-breaking event is skipped and stays in the chain. |
| v04-sums-month, v05-sums-year | Sums, heads, counts for a month and a year of a three-operator network; the examples recompute from the year; an operator with only last-year events (head set, count 0). |
| v06-two-objects | The market and location objects; a location Scope 2 of 12.5 against the exact 12.51 fails. |
| v07-silent | Silent months, incomplete objects, a month with no operator, unpaired location objects, an operator declaration with all months silent. |
| v08-fork | A shared non-null `prev`, two chain starts, a cross-ledger fork; shared null starts are no fork. |
| v09-bad-signature, v16-noncanonical-signature | A failing signature, another algorithm, a wrong hash; non-canonical base64url and S not below L fail "encoding". |
| v10-duplicate-retirement | One tonne twice; order decides; trailing slash; non-canonical reference; overlapping ranges; citations whose `retiredAt` differ only in a fraction of a second (L9). |
| v11-late-retirement | A retirement after the due instant and after the commit instant; the boundary. |
| v12-wrong-flag | `netZero` that contradicts its figures, both directions, and the exact tie. |
| v13-late-correction | Corrections and a void act after `updated`: INFO, and the as-of-read results. |
| v14-tolerance | The tolerance rule at its edges, half-even rounding, the digit limit on events and on published figures, the quotient form; a wrong-typed optional extension member read as absent (INFO); a `network-topology` value with members of both levels (FAIL with `ledger-evidence-2`, INFO without). |
| v15-profile-1x | 1.x events read backward: location basis, non-month periods, other method, negative Scope 3, other algorithm, mixed chain, more than 20 events, a 1.2 figure member absent (L8, skipped), excerpt version 1, 1.1 declarations; an operator declaration over a 1.x month, whose C-SFC-7 names that operator's counted 1.x event alone. |
| v17-limits | One scenario per limit of section 10 (some lowered), relative and userinfo URIs, an unread `profile-version`, a limit hit after a FAIL. A number of 500 digits is a limit and `1e999` a syntax error, in the read and in a declaration. A unit named `constructor`, `toString` or `__proto__`, and a read of a network named `constructor`, are plain unknown names. |
| v18-registry-1x | A 1.x entry with and without a digest; conversion to 2.0 form with equal active months; a wrong `network`. |
| v19-window | Empty Registry, young network, explicit T after `read-at`, stale read, C-SFC-6 cases, a public assessment at exactly 18 months. |
| v20-selection | Which annual object S4 selects; a host `target` in upper case matches the network and pairs with its location object; a target that differs from the retrieval host (INFO). |
| v21-net-zero-order | The order of the status derivation, with and without a ledger. |
| v22-period-offset | A calendar year with `+02:00` bounds, with and without `ledger-evidence-2`. A month-bound period that is not one month or one calendar year (9 998 years, two years, thirteen months) is NOT-EVALUABLE and is not walked. |
| v23-wrong-network | An event replayed from another network; subject and actor that differ. |
| v24-1x-after-2x | L11 and L11b; `profile2From` later than a 2.0 event. |
| v25-replay-order | A correction after a dependent event; a retroactive key closure; a shortened `to`. |
| v26-operator-no-membership | No `member-of-network`; a claimed network without a pin. |
| v27-rollback | A lower entry version; checkpoint digests, a missing chain, a former key, another network. |
| v28-citation-void | Void acts: first citation, a correction, an already superseded event, invalid acts. A void with no pinned registrar key is not applied and NOT-EVALUABLE; a void under a former key stands, with INFO. |
| v29-signed-rejected, v29b-duplicate-members | Rejected JWS headers and signatures, any `crit` included, a differing payload, bytes that are not UTF-8 in the header or the payload, a byte-order mark, duplicate members, lone surrogates; a duplicate charged to the served object that holds it, not to its neighbour; a served body that is valid JSON but not a declaration object or an array of them (S2 FAIL per bad item; an empty array is NOT-APPLICABLE). |
| v30-registry-binding | Shared `operator` or `origin`, unordered or overlapping intervals, a wrong `operators[].origin`. |
| v31-parameters | Every item of 7.6; a missing item; mechanism spellings, `crash-fault-tolerant` included; a `consensus-mechanism` text in and outside the list (INFO); assessments of 11 and 12 months, with and without a fraction on the bounds (compared as moments); MWh. |
| v32-ledger-order | Commit instants that do not increase, a repeated hash, a void commit that clashes. |
| v33-registrar-objects | Registry entry in `voids[]` or as `checkpoint`; void act and checkpoint in `registry[]`; small-order keys as A and as R; a registrar key pinned for another host. |

## Reading choices

Where the profile leaves a form open, the vectors fix it, so that two implementations print the same rows:

- Signatures of events and entries must be the canonical 86-character base64url of a 64-byte Ed25519 signature; an event whose signature fails the encoding or small-order checks reports `encoding` or `weak key` and is skipped, without a second `L5`.
- `signed` is a JWS Compact whose payload is the RFC 8785 text of the object without `signed`.
- A reference with `range-first-last` is canonical as a single serial or as `first-last` with first below last.
- ES256 is not exercised: no vector pins an ES256 key, and a declaration signed with ES256 is reported as not verified.
- The seconds and fetch limits, and the bytes per declaration, belong to fetching and are not exercised.
- `S2` rows come from the consumer library (`consumer` in the input, one verdict per object of the body); the cross-check takes them as given.
- A `target` that is a host name is compared after ASCII lower-casing (S4 selection and 7.3 pairing); any other target as an exact string. The `signed` payload is compared as text, so the signed object carries the target as served.
