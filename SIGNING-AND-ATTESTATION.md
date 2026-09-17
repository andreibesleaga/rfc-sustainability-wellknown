# Signing and attestation: how to deploy them

Draft -07 defines two OPTIONAL mechanisms next to the document itself. This page
is the short procedure for each, for the three kinds of party involved, using the
reference implementation (`sustainability-wellknown-publisher` and
`sustainability-wellknown-consumer`, 0.7.0 or later). It is non-normative; the
draft's "Signing" section and the `verifiable-attestation-uri`
member definition are the rules.

There is only **one** registered resource, `/.well-known/sustainability-data`.
`-07` withdraws the companion `/.well-known/sustainability-data.jws` resource and
its detached signature entirely — no legacy support, no redirect, no fallback.
Signing now happens *inside* the document: each declaration object MAY carry an
OPTIONAL `signed` member, a JWS whose payload is that same object with `signed`
itself removed.

| Mechanism | What it is | What it establishes | What it does not |
|---|---|---|---|
| **Embedded signature**, the `signed` member of a declaration object | A JWS Compact Serialization (RFC 7515) whose payload is the object it appears in, minus `signed`, serialized by the publisher; `cty: "sustainability-data+json"`; EdDSA or ES256; key as `jwk`/`x5c`/`kid` | Integrity after the fact and key continuity: the object a consumer holds is the object this key signed, and successive documents came from the same key. Precedence follows Verification: the payload's values replace the plain members only where the key is trusted out of band, pinned (which gives continuity of authorship, not identity), or chained through `x5c` to an anchor already trusted; a key trusted no further than the declaration that carries it leaves the origin-served members in use | Who holds the key; whether the figures are right. An absent `signed` member is not evidence of anything; a failing one makes the object *unverified*, never *false* |
| **Attestation** linked by `verifiable-attestation-uri` | A statement signed by a party **other than the publisher**. The reference shape is a W3C Verifiable Credential (Data Model 2.0) secured as `vc+jwt`, whose `credentialSubject` carries a copy of the declaration object (`signed` omitted) or, for a model attestation, the formula that produces it; `application/vc+jwt` | Whatever the credential says, backed by the attester's key — about the figures, or about the method that produces them | Anything about the served bytes on its own: editing the document does not invalidate the credential. A consumer fetches both and compares |

Keys: one Ed25519 key per role, generated with `sustainability-publisher keygen`.
The **private** half lives only where it is used (a secret store or a `0600` file);
the **public** half is hosted as a JWK so verifiers can pin it. Never commit a
private key. Rotation is a new key, a new hosted public key, a redeploy.
Host keys at ordinary paths, never under /.well-known/: RFC 8615 reserves that prefix for registered names.

## 1. Publisher: sign your own document

Signing is no longer a separate route or a separate file: each declaration
object gets its own `signed` member, computed over that object (minus `signed`)
and embedded back into it before serving.

**A served deployment** (the publisher library, Express, Fastify, the CLI server):

```bash
sustainability-publisher keygen --out /etc/sustainability/private.jwk > signing-key.jwk   # public half printed
# host signing-key.jwk at an ordinary path under your origin, e.g. <your-site>/keys/signing-key.jwk (application/jwk+json)
SUSTAINABILITY_SIGNING_KEY="$(cat /etc/sustainability/private.jwk)" sustainability-publisher --config config.json
# or in config:  "server": { "signingKeyFile": "/etc/sustainability/private.jwk" }
# in code:       createSustainabilityServer(publisher, { signingKey: await importSigningKey(jwkJson) })  (same option on the middlewares)
```

The document handler embeds a fresh `signed` member in each declaration object
it serves (every object of an array trend gets its own), and re-signs whenever
an object changes. The object must be stable between generation and serving:
keep the publisher's `cacheTtlMs` above 0 (the default is a day) — with `0`,
every request would regenerate, and the start-up refuses to sign.

**A static host** (a file on disk, no Node at runtime): sign the file you serve —
the tool embeds `signed` into each declaration object in the file and writes the
updated document back out; there is no companion file to publish alongside it.

```bash
# `sustainability-sign` is the same command under its own name: <in.json> <out.json> --key
sustainability-publisher sign /var/www/.well-known/sustainability-data \
  /var/www/.well-known/sustainability-data.signed.json --key /etc/sustainability/private.jwk
mv /var/www/.well-known/sustainability-data.signed.json /var/www/.well-known/sustainability-data
# serve unchanged, as: Content-Type: application/sustainability-data+json
```

Re-run `sign` every time the document file changes, in the same deployment step.
Any reformatting of the object after signing (key reordering, re-serialization)
breaks the embedded signature by design, since the payload is the exact object
bytes as signed.

## 2. Attester: issue a credential about someone's document

The attester is a second identity with its own key. The reference tool builds the
credential the gateway uses; any JOSE library producing `vc+jwt` works the same way
(the credential JSON is the payload; header `typ: "vc+jwt"`, `cty: "vc"`).

```bash
sustainability-publisher keygen --out ~/.config/sustainability-attester/private.jwk > attester.jwk
# host attester.jwk at https://<attester-site>/keys/sustainability-attester.jwk  (application/jwk+json)
node gateway/scripts/issue-attestation.mjs --key ~/.config/sustainability-attester/private.jwk \
  --issuer https://<attester-site> --attester-key-url https://<attester-site>/keys/sustainability-attester.jwk \
  --id https://<attester-site>/attestations/<name>.vc.jwt --gateway https://<publisher-origin> \
  --out <name>.vc.jwt
# host <name>.vc.jwt at the --id URL  (application/vc+jwt)
```

The tool's credential attests a reporting *model* (constants and formula) for five
years, which is what the reference gateway needs and the shape the draft's own
Appendix A worked example describes. An auditor attesting *figures*
for one reporting period embeds a copy of that declaration object (`signed`
omitted) in `credentialSubject` instead — the alternative Appendix A names — and issues a new credential per reporting period;
the consumer's checks are the same either way. The credential's structure is in
[internet-drafts/draft-verifiable-credential.md](internet-drafts/draft-verifiable-credential.md).

**The publisher then links it**: set `verifiable-attestation-uri` in the document
to the credential's URL (for the reference gateway: the `SELF_ATTESTATION_URI`
variable). If publisher and attester are the same person, say so where the
document is presented — the reference gateway does, on its index page.

## 3. Consumer: verify

```bash
sustainability-fetch https://<origin> --verify                                   # signature: verified | unsigned | unverified (<reason>)
sustainability-fetch https://<origin> --verify-attestation=https://<attester-site>/keys/sustainability-attester.jwk
sustainability-fetch https://<origin> --strict --verify-attestation             # battery (incl. the signature check) + credential
```

In code: `fetchSustainability(origin, { verifySignature: true, signaturePolicy: { trustedKeys } })`
and `verifyAttestation(uri, { trustedIssuerKeys })`. Neither is ever automatic.
Without a pinned key the result says the key was taken from the signature or
credential itself (`self-asserted`), which shows the mechanism, not the identity.

## The reference deployment

The gateway at `https://sustainability.up.railway.app` does all of the above for
its own report only: signing key in a Railway variable, public key and credential
hosted at `https://andreibesleaga.com`, attester and operator being the same person
(stated on the page). Relayed third-party documents are deliberately unsigned and
unattested. Operational detail, variables and rotation: [gateway/GUIDE-RAILWAY.md](gateway/GUIDE-RAILWAY.md#signing-and-attestation);
what the model attests: [gateway/METHODOLOGY.md](gateway/METHODOLOGY.md#5-signature-and-attestation).
