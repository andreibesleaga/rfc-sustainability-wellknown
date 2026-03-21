# schemas-validators

Schemas and validators for the `/.well-known/sustainability` URI response format, as defined in [draft-besleaga-green-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-green-sustainability-wellknown/).

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

Ruby must be present on the system. If not:
- Ubuntu/Debian: `sudo apt install ruby-full`
- macOS: `brew install ruby`

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
