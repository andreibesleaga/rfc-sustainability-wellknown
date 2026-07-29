# sustainability-data gateway

A small HTTP service that serves conformant
[`/.well-known/sustainability-data`](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/)
documents for many reporting subjects at once — a registry of real, sourced,
annual sustainability disclosures in the wire format, at the right path, with
the right headers.

```
GET  /{domain}/.well-known/sustainability-data   one subject's document
GET  /.well-known/sustainability-data            the gateway's own report
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
- **Not an Extended-service implementation.** It declares
  `capabilities: "basic"` and ignores query parameters, as the specification
  requires of a Basic server.

Anything invented lives under a reserved `.example` name (RFC 2606), says
`SYNTHETIC EXAMPLE` in capitals, and is badged as such in the index.

## Quick start

```bash
npm install
npm run build
npm test                       # 196 tests
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

Private to this repository; not published to npm.
