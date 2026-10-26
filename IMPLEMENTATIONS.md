# Implementations and deployments

This file records the software that implements `draft-besleaga-sustainability-wellknown` and the
origins known to serve `/.well-known/sustainability-data`. It follows the spirit of RFC 7942
("Improving Awareness of Running Code: The Implementation Status Section"): it is information
for reviewers and implementers, not an endorsement by anyone listed, and it describes the state
on the date given. It tracks revision `-10` (posted 2026-10-24; it changes the wire format relative to `-09`: `period` bounds and query bounds are RFC 3339 date-times, and four token members take one of a listed set). A row that still says `-07` has not been converted to `-10` yet.

An entry says who operates the origin. Origins run by the draft's author are marked
**author**; they show that the format can be deployed, not that anyone else has adopted it.
Everyone else is marked **independent**.

## Software

| Implementation | Role | Language | Licence | Location | Tracks |
|---|---|---|---|---|---|
| `sustainability-wellknown-publisher` | publisher: serves and signs declarations (HTTP middleware and an offline `sustainability-sign` tool for static hosts) | TypeScript / Node.js | BSD-3-Clause | `publisher/`, npm | `-10` (`0.8.0`) |
| `sustainability-wellknown-consumer` | consumer: fetches, validates and (on request) verifies signatures and attestations | TypeScript / Node.js | BSD-3-Clause | `consumer/`, npm | `-10` (`0.8.0`; reads the `-08` and `-09` forms by default) |
| JTD validator | validates a document against the JTD schema (RFC 8927) | Python | BSD-3-Clause | `schemas-validators/validator-json.py` | `-10` |
| CDDL validator | validates a document against the CDDL schema (RFC 8610) | Python | BSD-3-Clause | `schemas-validators/validator-cddl.py` | `-10` |
| Reference gateway | serves the format live and relays declarations for third-party subjects | TypeScript / Node.js | BSD-3-Clause | `gateway/` | `-10` (`0.2.0`) |
| Initializer `create-sustainability-data` | asks a few questions and writes a conformant declaration, signed with Ed25519 if a key is given, with the configuration for the host | Node.js | BSD-3-Clause | `tools/create-sustainability-data/` | `-10` (`0.2.0`) |
| `report-to-declaration` | demonstration: a published report in, a candidate declaration out, with a verbatim quote behind every figure | Node.js | BSD-3-Clause | `tools/report-to-declaration/` | `-10` (`0.3.0`) |
| Deployment kit | configuration and one-route examples for the most used hosts, web servers and frameworks, each CI-run recipe validated with the consumer in strict mode | nginx, Apache, Caddy, HAProxy, Envoy, Traefik, IIS; Node.js, Python, PHP, Go, Java, C#, Ruby, Rust | BSD-3-Clause | `deploy/` | `-10` |
| WordPress plugin "Sustainability Data (well-known)" | serves and signs a declaration from a settings page; no external calls | PHP | GPLv2-or-later | `deploy/wordpress/` | `-10` (`0.2.0`) |
| One-click node | a signed declaration from environment variables, on the publisher library (Railway or any container host) | TypeScript / Node.js | BSD-3-Clause | `deploy/one-click/railway/` | `-10` (`0.1.0`, publisher `0.8.0`) |
| GitHub Action | validates a file or a live origin in CI with the consumer | composite action | BSD-3-Clause | `deploy/github-action/` | `-10` (consumer `0.8.0`) |
| Behaviour scenarios and fitness functions | one scenario or more for every normative sentence of the draft (traced by id), and cross-package rules as tests | cucumber-js, node:test | BSD-3-Clause | `bdd/`, `fitness/` | `-10` |

All of the above are maintained by the draft's author. The two validators are independent of
each other (different schema languages, different libraries), and the publisher and consumer
interoperate; none of them is an independent implementation in the RFC 7942 sense.

## Deployments

The machine-readable list is [`implementations.json`](implementations.json). A scheduled
workflow (`.github/workflows/live-deployments.yml`) fetches every listed origin daily and checks
the media type and the schema; `schemas-validators/check-live.py` runs the same check locally. An origin that still serves the `-08` or `-09` form is reported as `legacy` until it is converted.

| Origin | Operator | How it is served | Signed | Listed since | Last checked |
|---|---|---|---|---|---|
| <https://sustainability.up.railway.app/.well-known/sustainability-data> | author | reference gateway (`gateway/`) | yes | 2026-07 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://andreibesleaga.com/.well-known/sustainability-data> | author | static file, signed offline with `sustainability-sign` | yes | 2026-07 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://agenticsystemcore.com/.well-known/sustainability-data> | author | static file; signed offline with `sustainability-sign` | yes | 2026-10 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://patterns.agenticsystemcore.com/.well-known/sustainability-data> | author | static file; signed offline with `sustainability-sign` | yes | 2026-10 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://agenticsystempatterns.com/.well-known/sustainability-data> | author | static file; signed offline with `sustainability-sign` | yes | 2026-10 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://medicine-finder.up.railway.app/.well-known/sustainability-data> | author | static file; signed offline with `sustainability-sign` | yes | 2026-10 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |
| <https://zfeeder.up.railway.app/.well-known/sustainability-data> | author | static file; signed offline with `sustainability-sign` | yes | 2026-10 | 2026-10-26: 200, `application/sustainability-data+json`, schema-valid (`-10`) |

No independent deployment is known on 2026-10-26.

## Adding a deployment

Open an issue or a pull request that adds the origin to `implementations.json` and a row to the
table above. An entry needs only the origin, who operates it, and how the document is produced.
The check is the one the workflow runs: the origin answers `200` at
`/.well-known/sustainability-data` with `application/sustainability-data+json` (or
`application/json`), and the body validates against `schemas-validators/response-schema.json`.
An origin that answers `200` with `text/html` for every path (a single-page-application
fallback) does not count.
