# `sfc-compliance/`

The checker, schemas, test vectors and examples of the Sustainability-First Consensus (SFC) profile,
version 2.0 (short name: SFC 2). The profile text is one file, in the greentech repository:
[`SFC_COMPLIANCE.md`](https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md).
Nothing in this folder defines the profile; where this folder and that text differ, the text wins.

The checker reads a sustainability declaration (draft-besleaga-sustainability-wellknown-10, served at
`/.well-known/sustainability-data`) and, when it is given a ledger read, recomputes the declaration's
figures from it.

## Run the checker

Node 22.13 or later; Python 3 for the cross-check of the vectors (without `python3` that test is skipped; set
`SFC_REQUIRE_PYTHON=1`, as the workflow does, to make it fail instead).

```
npm ci
node sfc-check.mjs examples/sfc-network.example.json --now 2026-05-02T00:10:00Z
node sfc-check.mjs ledger.example                    # an origin: fetches https://ledger.example/.well-known/sustainability-data
node sfc-check.mjs <declaration> --excerpt <read.json> --parameters <methodology.md> --parameters-sha256 <hex> \
  --trusted-key <publisher.jwk> --registrar-key <registrar.jwk> --network <host> --at 2026-05-02T00:10:00Z --json
```

| Option | Meaning |
|---|---|
| `<declaration file or origin>` | A file is read as it is. Anything else is an origin: S1 fetches it over https, with bounded time, size and redirects, and refuses plain `http`, userinfo and addresses the consumer library blocks. A path that does not exist is fetched as an origin, unless it ends in `.json`, `.jsonld` or `.txt`, or starts with `./`, `../` or `/`, in which case it is an error (exit 2, "file not found"). |
| `--excerpt <file>` | The ledger read (excerpt format 2, profile 5.8). Turns on the deep check. |
| `--fetch-ledger` | Fetches the read from the declaration's own `ledger-access-uri` instead (https only; a refused read is NOT-EVALUABLE). |
| `--parameters <file>` | The methodology parameters (profile 7.6): JSON, or a Markdown file with a `## SFC parameters` block. |
| `--parameters-sha256 <hex>` | Pins the methodology document: the hash, obtained out of band, must equal the file's. Without it the parameters are used but their registrar keys are not trusted. |
| `--trusted-key <jwk file>` | A public key pinned for `signed` of both levels, network and operator declarations (Ed25519, or P-256 for ES256). Repeatable. |
| `--publisher-key <jwk file>` | A key pinned for network declarations only. When given, `--trusted-key` no longer applies to them. Repeatable. |
| `--operator-key <jwk file>` | A key pinned for operator declarations only. When given, `--trusted-key` no longer applies to them. Repeatable. |
| `--registrar-key <jwk file>` | A registrar public key (Ed25519: `kty` `OKP`, `crv` `Ed25519`, `x` of 32 bytes) pinned for the network named by `--network`, or for the host of a URL source. A file with another key type, or without `x`, is a usage error. Repeatable. |
| `--network <host>` | The network host the registrar keys are pinned for. Needed with `--registrar-key` when the source is a file or an operator declaration; a network declaration fetched by URL pins for its host. The key is bound to this host, not to the network the read claims, and never to a host the fetched document names. |
| `--at <instant>` | An explicit check instant T. Later than the read's `read-at`, the checks that need a fresh read are NOT-EVALUABLE. |
| `--now <instant>` | A fixed clock. The default is the current time, which also limits the age of a read (24 hours). |
| `--json` | The report as JSON: rows, counts, object verdicts, the overall `verdict` and the record of what the run knew. |

Output: one line per row (`PASS`, `FAIL`, `NOT-EVALUABLE`, `DECLARED`, `NOT-DECLARED`, `INFO`, or an object
verdict), a count line, the overall result, and the record of the run (T and its source, `read-at`, the
period selected, the age of `updated`, the consumer library and its version, which keys were pinned).

Exit status: 1 when any row is `FAIL`. Otherwise 2 when a stage stopped (an `ERROR` row: the run is incomplete,
so 0 would read as clean). Otherwise 0. A usage error or an unexpected error is also 2; the message is printed,
never a stack trace. The status is not a conformance statement: read the overall result. Any other `NOT-EVALUABLE`
row leaves the status at 0, never fails the run and never counts as a pass: the overall result is `NOT-EVALUABLE` while an applicable row of
C-SFC-1, 2, 4, 5, 6 or 7 is, and also when the S1 fetch gave no document (refused, other non-2xx, timeout,
TLS failure, size limit, plain `http`): the site was not read, so it is not reported as out of scope.
`NOT-APPLICABLE` means a document was read and no object in it claims SFC.

An `ERROR` row and the unexpected-error message are fixed texts: exception text can carry data the subject
controls. Set `SFC_DEBUG=1` to print the cause of a stopped stage, or of an unexpected error, to standard error.

A read with no pinned registrar key is the source's word. D2.entry is then `NOT-EVALUABLE`, and a pass of
C-SFC-1, 2, 4 and 6 computed from that Registry reads `NOT-EVALUABLE` ("consistent but not authenticated"), so
the overall result is never `PASS`. With a registrar key pinned, an operator declaration's `signed` is also tried
under the operator's Registry keys that are valid at T (row `D2.signed`, `PASS` only).

## Run the vectors

```
npm test              # the checker against every vector, the schemas, the examples, the units
npm run check         # both examples, fixed clock
npm run vectors       # regenerate vectors/ and examples/ from fixed values, then cross-check in Python
```

`npm test` runs every scenario of `vectors/` through the checker and compares its rows with
`vectors/expected/`. `vectors/crosscheck.py` recomputes the same expectations with Python's standard
library only. An implementation in another language matches when it reproduces every row of `vectors/expected/`.

## Check code complexity

The code keeps each function at a cyclomatic complexity of 15 or less (`&&`, `||` and `??` counted, as ESLint 9
and later count them). ESLint is a development dependency, configured in `eslint.config.mjs`:

```
npm run lint          # eslint lib vectors sfc-check.mjs
```

It prints nothing when every function is within the limit. Functions scoring 13 to 15 are acceptable.

## Hostile input

The checker reads data that its subject controls, so each of these is bounded and answers NOT-EVALUABLE with the
limit named, never a crash and never a pass:

- Time: a check stops after 600 seconds (`secondsPerCheck`, section 10). The replay tests the clock once per
  event, and the signature loops test it once per key, so a Registry entry with many keys cannot outrun the limit
  inside one event. The weak-key test of a key runs once per read. A caller can pass `clock`, a function that returns milliseconds, in place of `performance.now`; the tests
  use a fake clock so that no test depends on the wall clock.
- Size: a read that hits the limit on bytes per read, events per chain, entries in `voids` or entries in the
  Registry is not walked: D1 is NOT-EVALUABLE with the limit named and the rows that need the read follow. A read
  text over the byte limit is refused before it is parsed. The loops of D3, D4, D5 and the void acts test the clock too.
- Shape: an excerpt of a version other than 2 is reduced to its version (plus `network` and `read-at` when they are
  well formed) before any check reads it; D1 says "excerpt version N". A version 2 excerpt without `registry` or
  `ledger` is a malformed read, not walked. A served body that is valid JSON but not a declaration object or an
  array of them (a string, a number, `null`, an array holding a non-object) is an S2 FAIL naming the item; the
  objects beside a bad item are still checked. A checkpoint whose members have the wrong
  type is a D4.checkpoint FAIL ("mismatch: shape"). An unexpected error in a stage becomes one ERROR row for that
  stage; the rows of the other stages stay, so it cannot hide a FAIL. On the command line it is a message and
  exit status 2, never a stack trace.
- Fetching: one deadline covers the headers and the body. A server that stalls after the headers, or declares a
  length over the byte limit, gives a `NOT-EVALUABLE` row that names the limit ("limit: seconds per fetch (30)",
  "limit: bytes (N)"); any other failure while reading the body names its cause ("network-error: ...").
- Takeover: with no pinned methodology document, a chain whose first event has a non-null `prev` hides its earlier
  events. D4.chain, and every D5 and C-SFC-7, are `NOT-EVALUABLE` ("takeover not verified"), also when a checkpoint
  is verified.
- Nesting: the reader stops at 64 levels (`MAX_JSON_DEPTH`) and reports the limit "JSON nesting depth", the same
  on every engine; between 33 and 64 levels the scan of section 10 reports it. The JWS header of `signed` is read
  once: a repeated member name, as `alg` or `crit`, makes it malformed (RFC 7515 section 4).
- Work: the single-use rule L9 reads an index of the effective retirements (`lib/tonne-index.mjs`), so one event
  costs time in its own citations, not in all citations of the read. The deep check walks only a period of one
  month or one calendar year (`usablePeriod` in `lib/declaration.mjs`).
- Numbers: a literal over 32 characters is not expanded; `1e999` and other numbers no binary64 value holds are a
  JSON syntax error (I-JSON), unless the literal is over 32 characters, which is a limit.
- Names: a unit, host or key that is also a name on `Object.prototype` (`constructor`, `__proto__`) is an unknown name.
- Text: the report escapes control, bidi and invisible format characters taken from the data.

## What it can and cannot conclude

It can show that a declaration conforms to the draft, that its published figures agree with each other under
the profile's tolerance rule, and, with a ledger read, that they agree with that read as of the declaration's
`updated` instant. With a pinned registrar key it also shows that the read's Registry entries are the
registrar's.

It cannot show that any figure is true, that the Registry lists every operator or node, who owns a retired
credit, or that a read is complete when it carries no verified checkpoint. A valid `signed` shows integrity,
not accuracy or freshness. Hardware, the offset-coverage position and node counts are reported
`DECLARED`, never passed. Section 11 of the profile lists what a statement about a declaration may and may not claim.

Not done: D8 (the registry records of retirements are not fetched), `verifiable-attestation-uri`,
`x5c` certificate chains, reads of an old ledger after a takeover (the library accepts them as input; the
command line does not fetch them), and the connected address of each fetch (the library refuses blocked
addresses at the connection but does not report the address it used).

## Files

| Path | What it is |
|---|---|
| [`PROFILE.md`](PROFILE.md) | A pointer to the profile text, so old links keep working. |
| [`sfc-check.mjs`](sfc-check.mjs) | The command line entry point. |
| [`lib/cli.mjs`](lib/cli.mjs), [`lib/input.mjs`](lib/input.mjs) | Arguments, files, fetching and the parsed input. |
| [`lib/check.mjs`](lib/check.mjs) | `runChecks(input)`: runs the shallow and the deep check and returns the report. |
| [`lib/shallow.mjs`](lib/shallow.mjs), [`lib/signed.mjs`](lib/signed.mjs), [`lib/disclosure.mjs`](lib/disclosure.mjs), [`lib/coherence.mjs`](lib/coherence.mjs) | S2 to S6: conformance, `signed`, year selection with C-SFC-2 and C-SFC-5, coherence of figures. |
| [`lib/deep.mjs`](lib/deep.mjs), [`lib/deep-registry.mjs`](lib/deep-registry.mjs), [`lib/deep-chains.mjs`](lib/deep-chains.mjs), [`lib/registry-signed.mjs`](lib/registry-signed.mjs), [`lib/bridge.mjs`](lib/bridge.mjs) | D1 to D9 from a ledger read (a stage that throws gives one ERROR row), `D2.signed`, and C-SFC-7. |
| [`lib/window.mjs`](lib/window.mjs) | C-SFC-1, 2 (ledger form), 3, 4 and 6 over the evaluation window. |
| [`lib/rules.mjs`](lib/rules.mjs), [`lib/replay.mjs`](lib/replay.mjs), [`lib/derive.mjs`](lib/derive.mjs) | Acceptance rules L1 to L12, the replay of 5.6, and the sums of 7.4. |
| [`lib/profile1x.mjs`](lib/profile1x.mjs) | Reading 1.x events, Registry entries and declarations (12.1). |
| [`lib/report.mjs`](lib/report.mjs) | Counts, the overall verdict, the record, text and JSON output. |
| `lib/decimal.mjs`, `lib/canonical.mjs`, `lib/ed25519.mjs`, `lib/time.mjs`, `lib/forms.mjs`, `lib/ijson.mjs`, `lib/limits.mjs`, `lib/shapes.mjs`, `lib/registry.mjs`, `lib/ledger.mjs`, `lib/parameters.mjs`, `lib/declaration.mjs`, `lib/uris.mjs`, `lib/rows.mjs`, `lib/deadline.mjs`, `lib/tonne-index.mjs`, `lib/debug.mjs` | Exact decimals, RFC 8785 and hashing, strict Ed25519, instants, month arithmetic, the due instants and grace period (`time.mjs`), value forms, the I-JSON reader, limits of section 10, member tables, Registry and ledger reading, parameters, declaration helpers, the per-check time limit (`deadline.mjs`), the index of effective retirements for L9 (`tonne-index.mjs`), the `SFC_DEBUG` note (`debug.mjs`). |
| [`schemas/`](schemas) | JSON Schemas of the ledger records, the extensions and the parameters (Appendix A). |
| [`vectors/`](vectors) | Test vectors, their generator and the Python cross-check (Appendix B). |
| [`examples/`](examples) | Two reference declarations, the parameters file and a methodology document. |
| [`test/`](test) | The tests, and `test/fixtures/profile-1.1/`, the 1.1.1 declarations kept for the backward reading. |

Dependencies: `sustainability-wellknown-consumer` (`^0.8.2`) validates the declaration against the draft (S2),
classifies media types and fetches. Node's `crypto` does SHA-256 and the Ed25519 and ES256 group operations;
small-order and canonical-encoding rejections are done here, as section 10 asks. Development dependencies:
`vitest`, `ajv` with `ajv-formats` (the schema tests) and `eslint` (the complexity bound).
The package is private; it is not published to npm.
