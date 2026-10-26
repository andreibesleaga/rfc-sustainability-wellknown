# SFC 2 quickstart

Four recipes for implementers of [SFC profile 2.0](SFC-PROFILE-2.0.md) (the spec): emit attestations, publish a
declaration, verify one, and move from 1.x. Each step names the spec section, the schema file and the test
vector that proves it. Vectors are in `vectors/` (cases in spec Appendix B); schemas are in `schemas/`. The
spec is authoritative: if a row here differs from spec 7.3 or 7.4, the spec wins.

Not yet published: the files of `schemas/` and `vectors/` are planned for the release and are not in the folder
today, so the Schema and Vector columns cannot be followed yet.

## What you need

- Node 22.13 or later to run the checker `sfc-check.mjs` and `vectors/make-vectors.mjs`; Python 3 (standard
  library) for `vectors/crosscheck.py`.
- Or another language with these parts: RFC 8785 JSON canonicalisation (JCS), Ed25519 (RFC 8032), SHA-256,
  exact decimal arithmetic rounded half to even to 6 decimals, RFC 3339 date-time parsing, JSON Schema 2020-12
  for the files in `schemas/`, and JWS Compact (RFC 7515) verification with Ed25519 and ES256.
- The test key is the RFC 8032 section 7.1 test 1 key. It proves nothing about who signed. Never use it for real data.

## Recipe 1. Emit attestations

Once a month ends, each operator emits one `EnergyAttested` and one `CarbonAttested` per month, at or after the
month's end bound (spec 3.2 to 3.5).

```text
event   = { type, network, subject: did, actor: did, prev, ts, payload }   # no sig yet
bytes   = jcs(event)                                                  # RFC 8785
sig     = base64url_nopad( ed25519_sign(key, bytes) )                 # 86 characters
event.sig = { alg: "Ed25519", value: sig }
hash    = hex( sha256( jcs(event) ) )                                 # sig included
event.prev of the next event of this type and subject = hash          # the chain
```

| Step | Do | Spec | Schema | Vector |
|---|---|---|---|---|
| 1 | Build the payload: whole-month `period`, figures in kWh or kg (at most 15 significant digits and 6 decimals, not negative), `retirements` and `offsetsKgCO2e` (the exact sum of `kg`), and `netZero` = [ S1 + S2 + S3 ≤ offsets ]. `network` is the network's `target`. | 1.3, 3.2 to 3.4, 4 | `schemas/event-energy.json`, `schemas/event-carbon.json` | `v12-wrong-flag`, `v14-tolerance`, `v23-wrong-network` |
| 2 | Canonicalise the event without `sig` (RFC 8785). | 1.6 | | `v01-canonical` |
| 3 | Sign with Ed25519; write the signature as canonical base64url without padding. Verifiers reject a signature whose S is not below the group order. | 1.5, 1.6 | | `v02-hash`, `v16-noncanonical-signature` |
| 4 | Hash the whole event with `sig`; this hash is the next event's `prev`. | 1.6, 3.2 | | `v02-hash` |
| 5 | A correction is a new event with `supersedes` = hash of the current effective event for that month. | 3.5 L6 | | `v03-effective` |
| 6 | Retire credits at the registry so that `retiredAt` is at or before the due instant, 5 days after the month ends. Each citation of a retirement repeats the same `tonnesRetired` and `retiredAt`, writes `registry` in the form the methodology document names, and the `kg` of all citations of one retirement add up to at most `tonnesRetired` × 1 000, so one retirement may be split over months. | 1.2, 3.4, 3.5 L8b, L9, L10 | | `v10-duplicate-retirement`, `v11-late-retirement` |

The ledger rejects an event that breaks rules L1 to L11 (spec 3.5). The operator's key and active months come
from its signed Registry entry (`schemas/registry-entry.json`, spec 3.1).

## Recipe 2. Publish a declaration

Inputs: a ledger read (spec 3.7) and a cut-off, which is the value of `updated` you will write.

1. For each operator active in the period and each month, select the **effective** event of each type committed
   at or before `updated` (spec 1.2). Vector: `v03-effective`.
2. Sum per operator in exact decimal arithmetic, rounded half to even to 6 decimals (spec 1.3, 5.4).
   Vectors: `v04-sums-month`, `v05-sums-year`.
3. If any active operator-month is silent for a type, or a month has no active operator, the object is
   incomplete: omit the derived members and say so (spec 5.5). Vector: `v07-silent`.
4. Write the **primary** object. Write the seven members the draft requires (`updated` = the cut-off,
   `capabilities`, `provider`, `measurement-method` the least direct token, `methodology-uri`, `period`,
   `target`; spec 5.1; `capabilities` is `basic` when the server supports no query parameter and `extended`
   otherwise). Then `target-type` `service` for the network (or `origin` for an operator); `period` of one
   calendar year for a network, both bounds written `Z`; `energy-unit` and `carbon-unit` explicit;
   `carbon-accounting` `market-based`; `scope-2` = Σ `scope2KgCO2e`; `carbon-footprint` = Σ scope 1 + Σ scope 2
   + Σ scope 3; `carbon-intensity-gCO2e-per-kWh` = (Σ `scope2KgCO2e` in kg × 1 000) ÷ (Σ `kWhConsumed` in kWh),
   from the exact ledger sums in kg and kWh, divided exactly, rounded half to even to 6 decimals, and omitted
   when energy is 0; and `disclosure-uri` (spec 5.1, 5.4).
5. If every attestation carries `scope2LocationKgCO2e`, write the optional **second** object: the same
   `target`, `target-type`, `period`, `energy-consumption`, `energy-unit`, `carbon-unit` and `disclosure-uri`
   as the primary, `carbon-accounting` `location-based`, its own `scope-2` (Σ `scope2LocationKgCO2e`),
   `carbon-footprint` and intensity, no extensions, and its own `signed` (step 7). Do not perturb it (spec 5.3).
   Vector: `v06-two-objects`.
6. Add the extensions: `hardware-lifecycle`, `carbon-neutrality`, `network-topology` and `ledger-evidence-2`
   with heads, counts and sums per operator (spec 6; `schemas/ext-*.json`, `schemas/ext-ledger-evidence-2.json`).
   `net-zero-status` follows the order of spec 5.4. Vector: `v21-net-zero-order`.
7. Do not perturb any figure (spec 5.2 rule 3). Sign each object with `signed` (JWS Compact, `Ed25519`, `cty`
   `sustainability-data+json`); `signed` is required when `ledger-evidence-2` is present, and must decode to the
   object you serve.
8. Serve at `/.well-known/sustainability-data` over HTTPS with `application/sustainability-data+json`.

Claims. `net-zero-status` and `netZero` mean only that retired credits at least equal gross emissions (offset
coverage, spec section 4). They are not a finding of net zero or neutrality. A conforming system MUST NOT
present them as a consumer-facing claim of climate neutrality (spec section 4). Do not label them neutral, net
zero or green in any UI or text. Publish them beside the gross figures, never instead of them (spec 6.3).

Examples: `examples/sfc-network.example.json` (two objects), `examples/sfc-operator.example.json`, and
`examples/METHODOLOGY.md` (the methodology document template). Every figure in them is invented.

### Worked example

`vectors/worked/` holds one generated case: three operators, twelve months, one correction (`prev` = the tip,
`supersedes` = the hash of the January event), one silent month, 1 500 kg of a 2 t retirement in January and
the remaining 500 kg in February, one rounding case, and the resulting `operators` entries. It is signed with the
test key, and every figure is invented. `vectors/make-vectors.mjs` writes it; do not copy hashes by hand.

## Recipe 3. Verify a declaration

### Shallow check (HTTPS only; spec 7.3)

| Step | Do | Spec | Schema | Vector |
|---|---|---|---|---|
| S1 | Fetch the well-known URI over HTTPS; check the media type. | 7.3 | | |
| S2 | Validate against draft -10 with the consumer library `sustainability-wellknown-consumer` (npm, 0.8.1 or a later 0.8 release). In another language, implement the draft's CDDL and MUST rules; the library is the reference for what counts as a violation. | 7.3, App. D | | |
| S3 | Verify `signed` under a pinned or out-of-band key; the payload must equal the served object; optional attestation fetch. | 5.2, 7.3 | | none (event signatures: `v09-bad-signature` in D3) |
| S4 | Select the annual network object (skip `member-of-network`; latest year ending at or before T); run C-SFC-2 (disclosure form). | 7.2, 7.3 | | `v07-silent`, `v20-selection` |
| S5 | Run C-SFC-5: required members of spec 5.4 (or INCOMPLETE), units explicit, `disclosure-uri`, `signed` present with `ledger-evidence-2`, `Z` period bounds. | 7.2 | | |
| S6 | Check coherence: required members, sums against top-level figures by the tolerance rule, footprint, intensity, `network-offset-coverage`, `net-zero-status`; report `hardware-lifecycle`, `net-zero-status` and `validated-node-count` as DECLARED, never PASS; read an old `ledger-evidence` name as profile 1.1 evidence, reported and judged only by the 1.1 rules (spec 7.3 S6 g, h; 9.1 rule 3). | 7.3 | `schemas/ext-ledger-evidence-2.json` | `v14-tolerance`, `v07-silent`, `v15-profile-1x` |
| S7 | Record: attributed to the origin, integrity verified or not, figures self-asserted, accuracy unknown; print T. | 7.3, 8 | | |

### Deep check (needs a ledger read; spec 7.4)

| Step | Do | Spec | Schema | Vector |
|---|---|---|---|---|
| D1 | Get the ledger read from `ledger-access-uri` within the limits of spec 7.6 (a 401 or 403 means NOT-EVALUABLE, not FAIL). | 3.7, 7.4, 7.6 | `schemas/ledger-excerpt.json` | `v17-limits` |
| D2 | Check the operator set and the Registry signatures under a registrar key you pinned, not the excerpt's own copy; for an operator, `origin` equals `target`; the excerpt's `network` equals `target`. | 7.4 | `schemas/registry-entry.json` | `v18-registry-1x` |
| D3 | For each operator and type fetch the whole chain; recompute every hash; check encoding and rules L1 to L3; verify every signature under the key valid at commit (L5). | 1.6, 3.5, 7.4 | | `v02-hash`, `v09-bad-signature`, `v16-noncanonical-signature` |
| D4 | Walk `prev` to null or to a takeover link; look for forks; compare head and count; check the checkpoint if present. | 7.4 | | `v08-fork` |
| D5 | Select effective events; run C-SFC-4 over the declaration's months with cut-off `updated`, and rules L4 and L6 to L11. | 3.5, 4, 7.4 | | `v03-effective`, `v10-duplicate-retirement`, `v11-late-retirement`, `v12-wrong-flag`, `v24-1x-after-2x` |
| D5b | Run C-SFC-1 and C-SFC-2 (ledger form) over the evaluation window with T (the read's `read-at` unless given). | 7.2, 7.4 | | `v19-window` |
| D5c | Run C-SFC-3 on the Registry. | 7.2, 7.4 | | `v18-registry-1x` |
| D5d | Run C-SFC-6 (the public case needs no ledger read). | 7.2, 7.4 | | `v19-window` |
| D6 | Recompute every sum and flag; compare with the declaration (C-SFC-7). | 7.4 | | `v05-sums-year`, `v06-two-objects` |
| D7 | Report corrections committed after `updated` as INFO "superseded since publication", with the as-of-`read-at` result. | 3.6, 7.4 | | `v13-late-correction` |
| D8 | Optional: confirm the retirements at the registries. | 7.4 | | |
| D9 | Record: `updated` and `read-at`, agrees with the read as of `updated`, whether D8 ran, who ran it, when. | 7.4, 8 | | |

The window checks (C-SFC-1, C-SFC-2 ledger form, C-SFC-4 and the permissioned case of C-SFC-6) use the 12 months
that ended at least 5 days before the check instant T (spec 1.2). C-SFC-3 reads the Registry for operators
active in any month of that window rather than a ledger read. T is the `read-at` of the read unless you give
one; run with a fixed T when testing: the vectors use 2026-05-02T00:10:00Z. In the deep check (D5), C-SFC-4
instead uses the months of the declaration's `period` and its `updated`.

When you report a result, say "offset coverage held", never "carbon neutral" or "net zero". Spec section 8 lists
what a report may and must not say.

## Recipe 4. Move from 1.x to 2.0

1. Do not rewrite or re-emit old events. Keep the existing chain. The first 2.0 event's `prev` is the hash of
   the last 1.x event, as in Recipe 1. 1.x months stay as they are, and the 2.0 sums use their figures
   unchanged, except a 1.x figure on the location basis or of unstated basis (spec 9.1 rules 1, 2).
2. From the adoption commit on, emit only 2.0 forms: month-bound `period {start, end}`, `evidence`,
   `scope1KgCO2e` and `network`. Never emit `from`/`to` or `evidenceCid`; a 1.x-form event after a 2.0 event
   FAILS L11 (spec 9.1 rule 4, 3.5; Appendix C). Vector: `v24-1x-after-2x`.
3. Registry: the registrar appends 2.0-form intervals and keys after adoption, and the entry meets the 2.0
   shape (spec 3.1; `schemas/registry-entry.json`). The 1.x intervals stay readable until then (spec 9.1
   rule 6). Vector: `v18-registry-1x`.
4. Declaration: write `ledger-evidence-2` and stop using the superseded `ledger-evidence` name (spec 6.1, 6.5).
   Already-published 1.1 declarations stay readable (spec 9.1 rule 3).
5. Verifying: a mixed chain reports "profile 1.x events" for the pre-adoption months, judged by the 1.x rules
   and never failed retroactively (spec 9.1 rule 2; vector `v15-profile-1x`). A declaration period that spans
   the adoption commit combines both forms in the sums (spec 9.1 rules 1, 2).

## Check your implementation

Run `node vectors/make-vectors.mjs` to regenerate the vectors, then `python3 vectors/crosscheck.py` for the
independent cross-check. Your implementation matches when it reproduces every row of `vectors/expected/`.
