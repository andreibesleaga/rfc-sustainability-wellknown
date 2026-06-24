# 03 — Problem Statement

*Non-normative.*

## Problem

Organizations can now *calculate* their digital carbon footprint with high fidelity, but
there is **no standardized, discoverable, machine-readable way to publish it** at the
origin. The calculation layer (Salesforce Net Zero Cloud, Microsoft Sustainability
Manager, Watershed, Persefoni, Sweep, Climatiq, Kepler, GSF Impact Framework) is rich and
fragmented; the disclosure layer is a PDF or a bespoke authenticated API. Consumers —
clients, load balancers, aggregators, regulators — have nowhere uniform to look.

## Consequences

- **No discovery.** There is no `robots.txt`-style convention for carbon; every integration
  is bespoke (N producers × M consumers).
- **Rebound risk.** The naive alternative — per-request HTTP carbon headers — increases the
  footprint it reports and opens DoS/fingerprinting vectors.
- **Unverifiable claims.** Without a machine-readable methodology link and attestation,
  published numbers cannot be checked, inviting greenwashing.
- **Wasted calculation.** Audit-grade numbers already exist inside enterprise suites but
  never reach a public, programmatic surface.

## Who has the problem

| Actor | Pain |
|---|---|
| Web-server / platform operator | Wants to disclose a footprint without buying an enterprise suite or inventing a format. |
| Enterprise sustainability lead | Has the numbers in NZC/MS/Watershed; cannot expose them in a standard, automated way. |
| Aggregator / regulator | Must collect comparable data across many origins; faces N bespoke formats. |
| Carbon-aware client / scheduler | Needs a programmatic read of an origin's intensity to make routing/procurement decisions. |

## Goal

A single, standardized HTTP endpoint — `GET /.well-known/sustainability` — that returns a
small, validated JSON document of energy and carbon metrics, fed by whatever source the
operator already has, and safe to serve at scale.

## Success looks like

1. Any operator can publish a **schema-valid** document in minutes.
2. Existing enterprise data (NZC/MS/Watershed) and live telemetry (Kepler/Climatiq) can be
   projected to the endpoint automatically.
3. A consumer can GET one path across many origins and parse uniform fields.
4. The endpoint cannot become a DoS or fingerprinting vector (safeguards built in).

See [04-requirements.md](04-requirements.md).
