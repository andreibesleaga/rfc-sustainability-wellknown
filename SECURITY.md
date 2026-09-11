# Security Policy

This repository contains an Internet-Draft (`internet-drafts/`) and two reference
implementations published to npm: `sustainability-wellknown-publisher` and
`sustainability-wellknown-consumer`, plus a reference gateway (`gateway/`, not published).

## Supported versions

| Package | Version | Supported |
|---|---|---|
| `sustainability-wellknown-publisher` | 0.6.x | Yes |
| `sustainability-wellknown-consumer` | 0.6.x | Yes |
| both | 0.5.x and earlier | No — upgrade to 0.6.x |

These are reference implementations of a draft specification, offered under the Revised BSD
License with no warranty. They are maintained on a best-effort basis by one author.

## Reporting a vulnerability

Email **andrei.besleaga@ieee.org** with "SECURITY" in the subject. Please include the affected
package and version, what an attacker gains, and the smallest reproduction you have.

Please do **not** open a public GitHub issue for a vulnerability that is not yet fixed.

What to expect:

- acknowledgement within **7 days**;
- an assessment, with a fix or an explanation of why it is not a vulnerability, within
  **30 days**;
- credit in the release notes if you want it.

If 90 days pass without a fix or a good reason, treat yourself as free to disclose.

## Scope

In scope: anything in `publisher/`, `consumer/`, `gateway/`, `example-scripts/` and
`server-configurations/` — for example a way to make a consumer parse a hostile document
unsafely, to make a publisher emit a document that violates the draft's requirements, or to
exhaust memory or CPU through the query parameters.

Out of scope:

- **The self-asserted nature of the data.** A document at `/.well-known/sustainability-data`
  is a claim by its publisher. Retrieving it establishes who published it, nothing more. The
  draft says so normatively, and a publisher stating false figures is not a vulnerability in
  this software.
- The accuracy of the illustrative third-party documents served by the reference gateway.
  Those are transcriptions from public reports, are not endorsed by their subjects, and are
  documented in [`gateway/data/README.md`](gateway/data/README.md). Corrections are welcome as
  ordinary issues.
- Findings against the draft **text** rather than the code. Those belong in the IETF process —
  see the Datatracker page for the draft.
