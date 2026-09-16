# Verifiable Credential for `verifiable-attestation-uri`

The draft defines an OPTIONAL `verifiable-attestation-uri` member. It MAY point
to a statement signed by a party other than the publisher — an auditor, a
certification body, a hosting provider — about the published figures or about
the method that produces them. The draft deliberately does not fix the format of
that statement. This document describes the shape the reference implementation
produces and verifies: a W3C Verifiable Credential, Data Model 2.0, secured
with JOSE as `vc+jwt`.

## What the credential is

A **VC Data Model 2.0** credential (`@context` starts with
`https://www.w3.org/ns/credentials/v2`; validity is `validFrom` / `validUntil`),
secured by an **enveloping proof**: the credential JSON is the payload of a
compact JWS whose protected header carries `typ: "vc+jwt"` and `cty: "vc"` (W3C
*Securing Verifiable Credentials using JOSE and COSE*). No JSON-LD processing is
needed to verify it; the signature covers the credential's bytes. The media
type of the hosted file is `application/vc+jwt`.

As of draft revision `-07`, the draft's own worked example (Appendix A, "Worked
Example: A Live Deployment") shows a credential whose `credentialSubject` carries a copy of the declaration
object, without `signed`, in a member of its own. A credential built this way
binds to the declaration by carrying that copy directly — never a byte hash or
digest of the served document — so a consumer compares the credential's
embedded copy against the (verified, if signed) declaration member-by-member
instead of recomputing anything. That is the shape of the first example below.

## Two shapes of `credentialSubject`

The draft does not constrain the format of the statement `verifiable-attestation-uri`
points to, and `credentialSubject` can attest either of two things. Both remain
valid under `-07`; which one an attester uses depends on what it is actually
vouching for.

### 1. Figures for one reporting period (embeds a declaration copy)

An auditor who reviewed one period's figures issues a credential whose
`credentialSubject` is a copy of that declaration object, with `signed`
omitted — the shape the draft's own Appendix A worked example describes. One
credential per reporting period; a consumer fetches both and compares the
embedded copy against the served (and, if present, verified) declaration. The
example below reuses the draft's own "Signed Declaration with Scopes and
Attestation" example object (its `signed` member removed, since a credential
subject never carries a `signed` member of the declaration it copies).

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "id": "https://storage.example/attestations/2026-03.vc.jwt",
  "type": ["VerifiableCredential", "SustainabilityDataFiguresAttestation"],
  "issuer": "https://storage.example",
  "validFrom": "2026-03-25T00:00:00Z",
  "validUntil": "2026-06-25T00:00:00Z",
  "name": "Attestation of the reported figures for reporting-period 2026-03-20",
  "description": "The issuer reviewed the raw meter data and the methodology behind this declaration and attests that the embedded copy accurately reflects them for this reporting period. This credential does not attest any other period.",
  "credentialSubject": {
    "updated": "2026-03-21T00:05:00Z",
    "capabilities": "extended",
    "provider": "Global Storage Inc. (compliance@storage.example)",
    "measurement-method": "hardware-estimated",
    "methodology-uri": "https://storage.example/transparency/methods",
    "reporting-period": "2026-03-20",
    "target": "/app/storage",
    "target-type": "path",
    "energy-consumption": 12,
    "energy-unit": "kWh",
    "carbon-footprint": 3.2,
    "carbon-unit": "kgCO2e",
    "carbon-accounting": "market-based",
    "scope-1": 0.0,
    "scope-2": 2.1,
    "scope-3": 1.1
  }
}
```

### 2. A reporting model, covering many periods (the reference gateway's live shape)

Instead of one period's figures, a credential can attest the **model** — the
constants and formula that produce every document a publisher issues under it
— so one credential covers many reporting periods and nothing needs re-issuing
each month. This is not a copy of any single declaration object; it names the
inputs and the formula instead, and a consumer checks that a given declaration's
figures follow from them. It is the shape `gateway/scripts/issue-attestation.mjs`
issues for the reference gateway today.

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "id": "https://andreibesleaga.com/attestations/sustainability-data-gateway-2026.vc.jwt",
  "type": ["VerifiableCredential", "SustainabilityDataModelAttestation"],
  "issuer": "https://andreibesleaga.com",
  "validFrom": "2026-09-15T10:00:00Z",
  "validUntil": "2031-09-15T10:00:00Z",
  "name": "Attestation of the reporting model of the Sustainability Data Reference Gateway",
  "description": "The issuer attests that the gateway's own /.well-known/sustainability-data document is derived by the model below, from the stated constants, for each reporting period since the gateway went live. The issuer and the gateway operator are the same person; this credential demonstrates the attestation mechanism of draft-besleaga-sustainability-wellknown and is not independent assurance.",
  "credentialSubject": {
    "id": "https://sustainability.up.railway.app/.well-known/sustainability-data",
    "target": "sustainability-data-gateway",
    "target-type": "service",
    "measurement-method": "third-party-modeled",
    "methodology-uri": "https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/gateway/METHODOLOGY.md",
    "live-since": "2026-07-30T00:00:00Z",
    "model": {
      "constant-draw-watts": 3,
      "grid-intensity-gCO2e-per-kWh": 373,
      "carbon-accounting": "location-based",
      "reporting-period": "the most recently completed calendar month (parameterless); any period since live-since on request",
      "hours": "hours of the period inside [live-since, now)",
      "energy-kWh": "constant-draw-watts × hours / 1000",
      "carbon-gCO2e": "energy-kWh × grid-intensity-gCO2e-per-kWh"
    }
  }
}
```

## The JOSE protected header

```json
{
  "alg": "EdDSA",
  "typ": "vc+jwt",
  "cty": "vc",
  "kid": "https://andreibesleaga.com/keys/sustainability-attester.jwk#<RFC 7638 thumbprint>",
  "jwk": { "kty": "OKP", "crv": "Ed25519", "x": "…", "kid": "<thumbprint>", "alg": "EdDSA", "use": "sig" }
}
```

The hosted file is the compact serialization `BASE64URL(header).BASE64URL(credential).BASE64URL(signature)`.

## Key components explained

* **issuer** — an `https` URL naming the attesting party. The issuer's public
  key is published under that origin (here, the JWK the `kid` points at), so a
  verifier can pin it rather than trust the copy in the header. A DID works
  equally; the reference implementation resolves nothing and simply compares
  the signing key against keys the caller supplies.
* **credentialSubject** — what is being attested. Example 1 attests the
  **figures**: a copy of one declaration object, so a consumer compares it
  directly against the served (and, if present, verified) document for that
  period. Example 2 attests the **model** instead — the constants and the
  formula that produce every monthly document, so one credential covers five
  years of documents and nothing needs re-issuing; a consumer then checks that
  the served figures follow from the model rather than comparing an embedded
  copy.
* **validFrom / validUntil** — the validity window (VC 2.0). A consumer treats
  the credential as invalid outside it.
* **The proof** — the JWS signature. Note what it does and does not cover: it
  protects the credential's own contents, **not** the document served at
  `/.well-known/sustainability-data`. Editing the served document does not
  invalidate the credential. A consumer that wants assurance fetches both and
  compares the values (or, for a model attestation, checks that the served
  figures follow the model); the served document on its own proves nothing,
  and the draft says a consumer MUST NOT treat the presence of the member as
  verification.

## What the reference implementation does

* `sustainability-wellknown-publisher` (attestation support added at 0.6.5; 0.7.0 is the
  current release): `signAttached(credential, key, { typ: "vc+jwt", cty: "vc" })`
  produces the JWS; `sustainability-publisher keygen` generates the attester key.
* `sustainability-wellknown-consumer` (attestation support added at 0.6.5; 0.7.0 is the
  current release): `verifyAttestation(uri)` — never
  called automatically — fetches the credential over HTTPS, verifies the JWS
  (EdDSA or ES256; `none` and MACs rejected; unknown `crit` rejected), checks the
  VC 2.0 shape and validity window, and reports whether the key was pinned by
  the caller (`issuer-key-pinned`) or taken from the header
  (`self-asserted-key`). The CLI flag is `--verify-attestation[=<issuer JWK url or file>]`.
* The reference gateway links its credential through `verifiable-attestation-uri`
  and states on its index page that operator and issuer are the same person.

## Implementation workflow

1. **Generate metrics** — produce the `/.well-known/sustainability-data`
   document (the publisher library, or a static file).
2. **Audit** — provide the raw data and methodology to the attesting party.
3. **Issue** — the attesting party builds the credential and signs it with its
   private key (`signAttached`, or any JOSE library producing `vc+jwt`).
4. **Publish** — host the signed credential at a public `https` URL with
   `Content-Type: application/vc+jwt`, host the attester's public JWK, and set
   `verifiable-attestation-uri` in the well-known document to the credential's URL.
5. **Verify** — `sustainability-fetch <origin> --verify-attestation=<issuer JWK url>`.
