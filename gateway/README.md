# Sustainability Data Reference Gateway

A small HTTP service that serves conformant
[`/.well-known/sustainability-data`](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/)
documents for many reporting subjects at once — a registry of real, sourced,
annual sustainability disclosures in the wire format, at the right path, with
the right headers.

```
GET  /{domain}/.well-known/sustainability-data   one subject's declaration
GET  /.well-known/sustainability-data            the gateway's own report (Extended: ?period= &granularity=)
                                                 signed in place: each object carries `signed` (OPTIONAL)
GET  /                                           human-readable index
GET  /index.json                                 machine-readable index
GET  /healthz                                    liveness
```

## What it is

- A **reference deployment** of the convention, so clients, validators and
  reviewers have something concrete to work against before organizations deploy
  the endpoint themselves.
- A **registry** of sustainability data that real organizations already publish,
  transcribed into the wire format from their own reports, with the source URL
  and retrieval date recorded for every figure in
  [`data/README.md`](data/README.md).
- A **worked example** of generating these documents from a publisher adapter
  rather than by hand — see [GUIDE.md](GUIDE.md#wiring-an-adapter).
- A **complete -07 publication** for its own report: the Extended service
  (`period`/`granularity` since go-live), the OPTIONAL `signed` member embedded
  in every declaration object it emits, a linked Verifiable Credential
  attesting the reporting model, and per-client rate limiting — with the honesty caveats stated on the page (the figures are a
  model; operator and attester are the same person). See
  [METHODOLOGY.md](METHODOLOGY.md#5-signature-and-attestation) and, for the
  deployment procedure for any publisher or attester,
  [SIGNING-AND-ATTESTATION.md](../SIGNING-AND-ATTESTATION.md).

It reuses the published
[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)
package for normalization, validation, ETags and caching; it adds multi-subject
routing and the honesty machinery.

## What it is not

- **Not an authoritative origin for anybody.** Documents about third parties are
  illustrative mappings prepared by the gateway operator from those
  organizations' own published reports. They are **not published, reviewed,
  authorized, or endorsed by their reporting subjects**. Every document says so
  in its `provider` member; the index says so too.
- **Not a source of estimates.** Nothing is interpolated, apportioned or
  invented on a real organization's behalf. A figure the source does not support
  is omitted — the format has no "not reported" marker precisely so that
  omission means exactly that. Subjects that publish nothing usable are listed
  as such, with the evidence, rather than quietly left out.
- **Not a replacement** for an organization publishing at its own origin, which
  is what the specification actually describes. A gateway is what you do while
  waiting.
- **Not an Extended-service relay.** Relayed declarations declare
  `capabilities: "basic"` and ignore query parameters, as the specification
  requires of a server that supports none of them; only the gateway's *own*
  report is Extended, because only its figures come from a model the gateway can
  evaluate for any period. Nor does it sign or attest anything on a third
  party's behalf: a relayed declaration carries no `signed` member, on purpose.
  The gateway's own declaration carries no `upstream` member either — the
  hosting platform publishes no declaration, so naming one would be false.

Anything invented lives under a reserved `.example` name (RFC 2606), says
`SYNTHETIC EXAMPLE` in capitals, and is badged as such in the index.

## Quick start

**Node.js 22.12 or newer** is required (runtime and tests: the JOSE library is loaded as an ES module through `require()`, unflagged since 22.12; Vitest 5 needs 22.12 too).

```bash
npm install
npm run build
npm test                       # 348 tests
node dist/index.js             # 0.0.0.0:8080
curl -sS http://127.0.0.1:8080/index.json | jq '.subjects[].domain'
```

## Documentation

| | |
|---|---|
| [GUIDE.md](GUIDE.md) | Full guide: honesty rules, routes and HTTP contract, adding a subject, wiring an adapter, validation, verification, deployment, configuration. |
| [GUIDE-RAILWAY.md](GUIDE-RAILWAY.md) | Step-by-step Railway deployment runbook — CLI and dashboard, custom domains, verification. |
| [METHODOLOGY.md](METHODOLOGY.md) | How the gateway's own figures are derived, and what they do and do not assert. |
| [data/README.md](data/README.md) | Provenance for every published figure: source URL, retrieval date, caveats. |

**Before adding any data**, read
[GUIDE.md § The honesty rules](GUIDE.md#the-honesty-rules). They are enforced by
the test suite.

Private to this repository; not published to npm (a container image is published to ghcr.io, see GUIDE-RAILWAY.md).
