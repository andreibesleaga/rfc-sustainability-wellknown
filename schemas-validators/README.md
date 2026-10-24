# schemas-validators

Schemas, validators and the example corpus for the `/.well-known/sustainability-data` URI response format, as defined in [draft-besleaga-sustainability-wellknown-10](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

## Files

| File | Description |
|---|---|
| `response-schema.cddl` | CDDL schema of the response; byte-identical to the CDDL block of the draft (Section 3.7) |
| `response-schema.json` | JTD (JSON Type Definition, RFC 8927) schema of the same format, kept in step with the CDDL; the draft carries no JTD block |
| `validator-cddl.py` | Validates a JSON response against `response-schema.cddl` using the `cddl` Ruby gem |
| `validator-json.py` | Validates a JSON response against `response-schema.json` using the `jtd` Python package |
| `examples/` | The example corpus: `valid/`, `tolerated/`, `invalid/`, `prose/` and `manifest.json` (see below) |
| `validate-all.sh` | Runs both validators over the corpus and compares every exit status with the manifest |
| `check-live.py` | Fetches every origin in `../implementations.json` (or `--origin <url>`) and checks the HTTP status, the media type and the JTD schema; `--csv` appends a dated row per origin; `--require 10` rejects origins still serving an older form. Run daily by the `live-deployments` workflow |
| `requirements.txt` | Python dependencies |
| `install.py` | Installs all dependencies (pip packages + `cddl` Ruby gem) |

## Setup

```bash
python3 install.py
```

This installs:
- `jtd` Python package (used by `validator-json.py`)
- `cddl` Ruby gem, pinned to 0.12.14 (used by `validator-cddl.py`; the `.cat` operator of the date-time rule needs it)

`install.py` runs `pip install -r requirements.txt` (retrying with
`--break-system-packages` if needed) and `gem install cddl -v 0.12.14` (retrying with
`sudo` only if the first attempt fails).

Ruby must be present on the system. If not:
- Ubuntu/Debian: `sudo apt install ruby-full`
- macOS: `brew install ruby`

### Important: put the Ruby user-gem bin directory on your PATH

On a stock **non-root** Linux box, `gem install cddl` (no `sudo`) succeeds but
installs the `cddl` executable into your *user* gem directory — e.g.
`~/.local/share/gem/ruby/X.Y.0/bin` — which is **not** on `$PATH` by default.
When that happens, `validate-all.sh` reports
`[CDDL] FAIL (Error: 'cddl' tool not found.)` on every example even though the
installer said "OK".

Find your user-gem bin directory and add it to PATH:

```bash
# Show the user gem directory (the executable lives in <user_dir>/bin):
ruby -e 'puts Gem.user_dir'          # e.g. /home/you/.local/share/gem/ruby/3.2.0
gem environment | grep -i 'user'     # alternative: 'USER INSTALLATION DIRECTORY'

# Add its bin/ to PATH for the current shell (and persist it in ~/.bashrc):
export PATH="$(ruby -e 'print Gem.user_dir')/bin:$PATH"
echo 'export PATH="$(ruby -e '"'"'print Gem.user_dir'"'"')/bin:$PATH"' >> ~/.bashrc
```

To be explicit about a per-user install you can also run
`gem install --user-install cddl` (still requires the PATH step above).

**Verify before running `validate-all.sh`:** `cddl --help` must work.

```bash
cddl --help   # should print usage, not "command not found"
```

Only once `cddl --help` works will the CDDL leg of `./validate-all.sh` pass.

## The example corpus and the manifest

`examples/manifest.json` is an array with one entry per file:
`{ "id": "I06", "path": "invalid/period-bound-not-string.json", "cddl": false, "jtd": false, ... }`.
`path` is relative to `examples/`; `cddl` and `jtd` are the verdicts expected of
`validator-cddl.py` and `validator-json.py` (true = the file is accepted). The
four directories mean:

| Directory | Meaning |
|---|---|
| `valid/` | Conforming declarations: every validator and the code gate accept them |
| `tolerated/` | Declarations a consumer reads although a publisher must not emit them (unknown member, unrecognised token value, ...); the schemas accept or refuse them as the manifest records |
| `invalid/` | Declarations the schemas refuse |
| `prose/` | Rules no schema states (start before end, non-negative numbers, at least one metric or link, a real calendar date, ...); the manifest records which schema happens to catch them anyway |

The verdict of each validator is recorded per file rather than inferred from the
directory name, because the engines differ on a few files (for example, the CDDL
date-time rule checks the form only and accepts `2025-02-30T00:00:00Z`, which the
JTD `timestamp` type refuses). `validate-all.sh` fails when a verdict differs from
the manifest in either direction, so it also fails if an engine starts agreeing on
a file recorded as differing. Every file in the four directories must be listed.

## Usage

### Validate the corpus

```bash
./validate-all.sh
```

First compares the CDDL block of the draft with `response-schema.cddl`, then runs
both validators on every manifest entry and prints a summary; the exit status is
non-zero on any mismatch.

`../example-responses/` still holds the files served for the earlier form until
they are converted. They are therefore not part of the default run; to check
them against the -10 schemas (both validators must pass) use the temporary
switch, which goes away once they are converted:

```bash
./validate-all.sh --example-responses     # or: EXAMPLE_RESPONSES=10 ./validate-all.sh
```

`PYTHON=/path/to/python3 ./validate-all.sh` selects the interpreter that has the `jtd` package.

### Validate a single file

```bash
# JTD (JSON schema)
python3 validator-json.py examples/valid/<file>.json

# CDDL schema
python3 validator-cddl.py examples/valid/<file>.json
```

Both validators must be run from the `schemas-validators/` directory so they can locate the schema files.

### Check the live deployments

```bash
python3 check-live.py                                   # every origin in ../implementations.json
python3 check-live.py --origin https://example.org      # one origin
python3 check-live.py --require 10                      # an origin on an older form fails
```

An origin that answers `200` with `text/html` for any path is reported as a failure.
An origin that still serves the earlier `reporting-period` string (-08) or a `period`
with date-only bounds (-09) is converted in memory for reporting only: the period
column says `(-08 form)` or `(-09 form)` and the schema column says `legacy`. With
`--require 10` such an origin fails.

## What the formal schemas do and do not enforce

Both schemas check **structure**: member types, the seven mandatory members, the
closed token sets, and the form of `updated`, `period.start` and `period.end`
(RFC 3339 `date-time`: the CDDL with a regular expression, the JTD with
`timestamp`). The closed token sets are `measurement-method` (4), `functional-unit`
(12), `target-type` (9), upstream `role` (6), `carbon-unit` (`gCO2e`, `kgCO2e`,
`tCO2e`), `energy-unit` (`Wh`, `kWh`, `MWh`, `GWh`), `carbon-accounting` (2) and
`capabilities` (`basic`, `extended`). There is no `granularity` member.

Both schemas are **open**: a top-level member the draft does not define passes (a
later revision may define it and a consumer ignores it), and so does an unknown
member inside `period` or an `upstream` entry. A publisher still must not emit one;
the publisher's code gate refuses it. `extensions` is an object of objects with
any content. The JTD schema may therefore accept a document that the code gate
(publisher `assertValid`, consumer strict mode) rejects; a "PASS" from the formal
validators means "structurally valid", not "conformant to every MUST of the draft".

The schemas deliberately do **not**, and technically **cannot**, express:

- **`period.start` before `period.end`**, a period that is a whole calendar unit,
  or the day-floor recommendation; neither language compares two members.
- **A real calendar date.** The CDDL regular expression checks form only, so it
  accepts `2025-02-30T00:00:00Z`, month 13, hour 24 and offset `+99:99`; the
  Python JTD validator refuses most of these, the ajv JTD validator (used by the
  publisher and consumer) accepts an out-of-range offset. The code gate refuses all.
- **`sci-score` implies `functional-unit`.** A document with `sci-score` and no
  `functional-unit` passes both validators.
- **Numeric ranges**: the non-negativity of `energy-consumption`,
  `carbon-footprint`, `sci-score`, `carbon-intensity-gCO2e-per-kWh` and
  `estimated-annual-emissions-kgCO2e`, and the 0 to 100 bound of
  `renewable-energy`. (`scope-1/2/3` may be negative.) Numbers beyond binary64
  (`1e999`) are likewise a code-gate matter.
- **Default units**: `kWh` when `energy-unit` is absent, `gCO2e` when `carbon-unit`
  is absent. Consumers apply them when reading.
- **Minimum reporting**: at least one numeric metric member, or `disclosure-uri`,
  or `verifiable-attestation-uri`.
- **Array rules**: all entries of an array response share one `target` and, when
  present, one `target-type`; ordering by `period.start`; and an empty `upstream`
  array (the CDDL refuses it with `[+ ...]`, the JTD accepts it).
- **`target` for a `path` target** starting with "/", and the target-type specific
  meaning of `target`.
- **`extensions` names**: a URI compared as a string; neither schema checks the
  form of the name.
- **`signed`** is typed as a string; whether it is a well-formed JWS over the rest
  of the object, and the URI members being URI references, are checked by the consumer.
- **Tolerance for unrecognised values.** The schemas close the token sets, but the
  draft directs a consumer that meets an unrecognised value in an enumerated member
  not to reject the document: it disregards the member (`target-type`: it reads
  `target` as if the member were absent). That is applied in the application layer.

The `prose/` directory of the corpus holds one file per rule above; its manifest
entries record which engine, if any, refuses each.
