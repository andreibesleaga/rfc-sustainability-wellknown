# Internet RFC Draft Proposal
## IETF I-D (work in progress)
### rfc-sustainability-wellknown - The 'sustainability' Well-Known URI

Datatracker: [draft-besleaga-green-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-green-sustainability-wellknown/)

**Author:** Andrei Nicolae Besleaga
**Working Group:** IETF GREEN WG

---

## What this defines

A standardized `/.well-known/sustainability` URI that allows any web server or digital service to publish its aggregated energy consumption and carbon footprint metrics in a machine-readable JSON format. Out-of-band, asynchronous reporting, not per-request overhead.

---

## Repository Structure
The normative specification is the Internet‑Draft; this repo provides non‑normative examples, tooling, and documentation.

```
rfc-sustainability-wellknown/
├── documents/               # RFC draft source files and supporting documents
├── example-responses/       # Valid JSON response examples (all validators pass)
├── schemas-validators/      # Formal schemas (CDDL, JTD) and validation tooling
├── example-scripts/                 # Server-side security middleware (Python, JS, PHP)
└── server-configurations/   # Web server configuration snippets (nginx, Apache)
```

---

## documents/

RFC draft in multiple formats plus supplementary documents.

| File | Description |
|---|---|
| `draft-besleaga-green-sustainability-wellknown-03.md` | Latest draft (current) — Markdown source |
| `draft-besleaga-green-sustainability-wellknown-02/01/00.*` | Previous revisions (md, xml, txt, html) |
| `draft-verifiable-credential.md` | Supplementary: W3C Verifiable Credential structure for anti-greenwashing attestations |

The draft defines the full data model, mandatory/optional fields, CDDL and JTD formal schemas, security and privacy considerations, and IANA registration request.

---

## example-responses/

Four JSON response files covering all service levels defined in the draft. All pass both CDDL and JTD validation.

| File | Description |
|---|---|
| `example-response.json` | Basic service — single object, aggregate host metrics |
| `example-response-extended.json` | Extended service — single object, all optional fields including GHG scopes and `verifiable-attestation-uri` |
| `example-response_yearly.json` | Extended service — array of 12 monthly objects for a full year trend |
| `example-response-yearly-monthly-target.json` | Extended service — array scoped to a specific `target-path` |

---

## schemas-validators/

Formal schemas and validation tooling. See [schemas-validators/README.md](schemas-validators/README.md) for full setup and usage.

| File | Description |
|---|---|
| `response-schema.json` | JTD (RFC 8927) schema |
| `response-schema.cddl` | CDDL (RFC 8949) schema — matches the formal definition in the draft |
| `validator-json.py` | Validates a JSON file against the JTD schema; handles single objects and arrays |
| `validator-cddl.py` | Validates a JSON file against the CDDL schema using the `cddl` Ruby gem |
| `validate-all.sh` | Runs both validators against all files in `example-responses/` |
| `requirements.txt` | Python dependencies (`jtd`) |
| `install.py` | Installs all dependencies: `jtd` via pip, `cddl` via gem |

**Quick start:**
```bash
cd schemas-validators/
python3 install.py
./validate-all.sh
```

---

## scripts/

Server-side security middleware implementing the mandatory safeguards from the draft's Security and Privacy sections. Three languages for broad adoption.

| File | Description |
|---|---|
| `security.py` | Python — DoS cap, sub-daily filter, 1% noise injection |
| `security.js` | TypeScript — same three safeguards |
| `security.php` | PHP — same three safeguards + `Content-Type: application/json` header |
| `README.md` | Endpoint spec, service levels, mandatory safeguards, caching, validation field table |

**Three mandatory safeguards** (draft §Security / §Privacy):

| Safeguard | Detail |
|---|---|
| **DoS protection** | Cap response arrays at 366 objects maximum |
| **Traffic analysis prevention** | Reject entries with `reporting-period` finer than 24 hours (string length > 10) |
| **Anti-fingerprinting** | Apply ~1% random noise to `energy-consumption`, `carbon-footprint`, `scope-1/2/3` |

---

## server-configurations/

Drop-in configuration snippets for serving `/.well-known/sustainability`. See [server-configurations/README.md](server-configurations/README.md) for setup instructions.

| File | Description |
|---|---|
| `nginx.conf` | Nginx `location` block: media type, caching, CORS, method restriction, rate limiting (commented) |
| `apache.conf` | Apache `Alias` + `<Location>` block: same features, rate limiting options (commented) |
| `README.md` | Setup instructions, feature comparison table, security notes |

Both configurations implement:
- `Content-Type: application/json` (MUST)
- `Cache-Control: public, max-age=86400` (RECOMMENDED)
- `ETag` / `Last-Modified` (auto, RECOMMENDED)
- `Access-Control-Allow-Origin: *` for aggregator access
- GET/HEAD-only method restriction
- Rate limiting snippet (commented — activate for dynamic `period`/`granularity` parameters)

---

## Key data model fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `version` | Yes | string | Schema version, e.g. `"1.0"` |
| `updated` | Yes | string | RFC 3339 timestamp |
| `capabilities` | Yes | `"basic"` / `"extended"` | |
| `provider` | Yes | string | |
| `measurement-method` | Yes | string | `hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled` |
| `methodology-uri` | Yes | string | Link to calculation methodology |
| `reporting-period` | Yes | string | e.g. `"2026-02"`, `"2025"`, `"2026-03-20"` |
| `energy-consumption` | Yes | number | |
| `energy-unit` | Yes | enum | `"Wh"`, `"kWh"`, `"MWh"`, `"GWh"` |
| `carbon-footprint` | Yes | number | |
| `carbon-unit` | Yes | enum | `"gCO2e"`, `"kgCO2e"`, `"mtCO2e"` |
| `carbon-accounting` | No | enum | `"location-based"` / `"market-based"` (GHG Protocol) |
| `scope-1` / `scope-2` / `scope-3` | No | number | GHG Protocol Scope emissions |
| `sci-score` | No | number | Green Software Foundation SCI |
| `functional-unit` | No | string | e.g. `"per-request"`, `"per-terabyte-day"` |
| `carbon-intensity-gCO2-per-kWh` | No | number | Weighted grid carbon intensity |
| `estimated-annual-emissions-kgCO2` | No | number | |
| `renewable-energy` | No | number | Percentage of renewable energy |
| `verifiable-attestation-uri` | No | string | Link to W3C Verifiable Credential |

---

## Anti-greenwashing: Verifiable Credentials

The `verifiable-attestation-uri` field links to a W3C Verifiable Credential (VC) signed by a trusted third-party auditor. 

Example VC structure is documented in [documents/draft-verifiable-credential.md](documents/draft-verifiable-credential.md). 
This allows automated tools to cryptographically verify published sustainability claims against external authoritative reports.
