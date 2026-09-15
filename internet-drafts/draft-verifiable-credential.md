# Verifiable Credential for `verifiable-attestation-uri`

The draft defines an OPTIONAL `verifiable-attestation-uri` member. It MAY point
to a statement signed by a party other than the publisher — an auditor, a
certification body, a hosting provider — about the published figures or about
the method that produces them. The draft deliberately does not fix the format of
that statement. This document describes the one shape the reference
implementation produces and verifies: a W3C Verifiable Credential, Data Model
2.0, secured with JOSE as `vc+jwt`.

It is the shape the reference gateway uses live. The credential below is the
real structure that `gateway/scripts/issue-attestation.mjs` issues, with the
signature left symbolic.

## What the credential is

A **VC Data Model 2.0** credential (`@context` starts with
`https://www.w3.org/ns/credentials/v2`; validity is `validFrom` / `validUntil`)
whose subject is the well-known document's URL, secured by an **enveloping
proof**: the credential JSON is the payload of a compact JWS whose protected
header carries `typ: "vc+jwt"` and `cty: "vc"` (W3C *Securing Verifiable
Credentials using JOSE and COSE*). No JSON-LD processing is needed to verify it;
the signature covers the credential's bytes. The media type of the hosted file
is `application/vc+jwt`.

## The credential (payload of the JWS)

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
* **credentialSubject** — what is being attested. This example attests the
  **model**: the constants and the formula that produce every monthly document,
  so one credential covers five years of documents and nothing needs
  re-issuing. A credential can instead carry the figures themselves (an
  auditor's statement about one reporting period), in which case a consumer
  compares them with the served document.
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

* `sustainability-wellknown-publisher` (0.6.5): `signAttached(credential, key, { typ: "vc+jwt", cty: "vc" })`
  produces the JWS; `sustainability-publisher keygen` generates the attester key.
* `sustainability-wellknown-consumer` (0.6.5): `verifyAttestation(uri)` — never
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
