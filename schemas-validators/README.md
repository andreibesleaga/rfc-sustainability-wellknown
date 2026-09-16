# schemas-validators

Schemas and validators for the `/.well-known/sustainability-data` URI response format, as defined in [draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

## Files

| File | Description |
|---|---|
| `response-schema.json` | JTD (JSON Type Definition) schema for the response |
| `response-schema.cddl` | CDDL (Concise Data Definition Language) schema for the response |
| `validator-json.py` | Validates a JSON response against `response-schema.json` using JTD |
| `validator-cddl.py` | Validates a JSON response against `response-schema.cddl` using the `cddl` Ruby gem |
| `validate-all.sh` | Runs both validators against all examples in `../example-responses/` |
| `requirements.txt` | Python dependencies |
| `install.py` | Installs all dependencies (pip packages + `cddl` Ruby gem) |

## Setup

```bash
python3 install.py
```

This installs:
- `jtd` Python package (used by `validator-json.py`)
- `cddl` Ruby gem (used by `validator-cddl.py`)

`install.py` runs `pip install -r requirements.txt` (retrying with
`--break-system-packages` if needed) and `gem install cddl` (retrying with
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

## Usage

### Validate all examples at once

```bash
./validate-all.sh
```

Runs both validators against every `.json` file in `../example-responses/` and prints a pass/fail summary.

### Validate a single file

```bash
# JTD (JSON schema)
python3 validator-json.py ../example-responses/example-response.json

# CDDL schema
python3 validator-cddl.py ../example-responses/example-response.json
```

Both validators must be run from the `schemas-validators/` directory so they can locate the schema files.

## What the formal schemas do and do not enforce

The JTD and CDDL schemas validate **structure**: field types, required fields,
and — as of draft `-07` — a **closed top-level member set**: `-07` removes the
`version` member, drops the mandatory-member count from eight to seven, and
states that a publisher MUST NOT add other top-level members, so the schemas
no longer permit an unrecognized top-level member to pass (a consumer still
ignores one it encounters in the wild, per the draft's prose, rather than
rejecting the document outright — see the tolerance note below). Extensibility
now lives entirely inside the OPTIONAL `extensions` member, an object keyed by
absolute URI (RFC 3986, scheme in lowercase — an `https` URI under the
definer's control, or `urn:uuid:` plus a lowercase hyphenated UUID, RFC 9562) whose per-key values are
open (`additionalProperties` true / no `properties` constraint), which both
schemas express structurally.
The schemas deliberately do **not** — and technically **cannot** — express a
small number of the draft's other cross-field and value-range prose rules,
because neither CDDL nor JTD can encode conditional dependencies between fields
or numeric bounds in a way these validators check. In particular:

- **`sci-score` ⇒ `functional-unit`** — the draft states a MUST: "If `sci-score`
  is present, `functional-unit` MUST also be present." This is a cross-field
  conditional dependency, which neither CDDL nor JTD can express, so a document
  carrying `sci-score` **without** `functional-unit` passes both validators.
- **Numeric ranges** — the non-negativity rules on the gross-quantity members
  (`energy-consumption`, `carbon-footprint`, `sci-score`,
  `carbon-intensity-gCO2e-per-kWh`, `estimated-annual-emissions-kgCO2e`) and the
  `0`–`100` bound on `renewable-energy`. The formal schemas type these as
  numbers but do not enforce the bounds. (`scope-1/2/3` MAY legitimately be
  negative, per the draft, to express removals/net accounting.)
- **Default units** — when `energy-consumption` is present without
  `energy-unit`, the default `kWh` applies; when `carbon-footprint` (or a scope)
  is present without `carbon-unit`, the default `gCO2e` applies. The schemas
  cannot bind a default to an absent member; consumers apply it when reading.
- **Date formats** — the draft's date rules are prose-only: `updated` MUST be an
  RFC 3339 date-time, and `reporting-period` MUST be one of the calendar-date
  precision forms `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` (only the last is an
  RFC 3339 `full-date`). The formal schemas type both as plain strings and do
  not check the formats.
- **Array uniformity of `target-type`** — in an array response, all entries MUST
  share the same `target` value and, when present, the same `target-type` value.
  Cross-entry rules cannot be expressed in either schema language.
- **`target-type` tolerance for unrecognized values** — the schemas close the
  `target-type` enum (`origin`, `path`, `organization`, `service`, `product`,
  `device`, `tenant`, `data-source`), but the draft directs clients that
  encounter an unrecognized value in an enumerated member NOT to reject the
  document: they disregard the member and interpret `target` as if `target-type`
  were absent. That tolerance is applied at the application layer — a validator
  failure on such a value alone does not make the document unusable to a
  conformant client.
- **Minimum-reporting rule** — a declaration object MUST carry at least one
  numeric metric member, or `disclosure-uri`, or `verifiable-attestation-uri`;
  an object with none of the three is not conformant. (Draft `-06`'s further
  condition — that, absent a metric, the `methodology-uri` resource itself must
  be openly retrievable without authentication or payment — is removed in
  `-07`.) This is an at-least-one-of-several-members rule, not expressible in
  either schema language.
- **`sci-score`-style cross-field rules aside, the `signed`, `upstream`, and
  `extensions` members are structurally open** — the schemas type `signed` as a
  string, `upstream` as an array of `{ declaration, role? }`, and `extensions`
  as a URI-keyed object of open objects, but cannot check that `signed` is a
  well-formed JWS over the rest of the object, that `upstream[].declaration` is
  an absolute `https` URI, or that an `extensions` key is an absolute URI in one
  of the two forms the draft permits (the CDDL schema constrains the key format
  with a `.regexp`, in the rule named `ext-name`, which admits only the
  characters RFC 3986 allows in a URI; the JTD schema, which has no analogous
  construct, does not).
  These are checked at the application layer.

These rules are checked at the **application layer**: this repo's `publisher/`
and `consumer/` implementations validate the `sci-score` ⇒ `functional-unit`
dependency and the numeric ranges, and apply the unit defaults. Treat a "PASS"
from the formal validators as "structurally valid", not "fully conformant to
every prose MUST in the draft".
