# Signing and attestation: how to deploy them

Draft -06 defines two OPTIONAL mechanisms next to the document itself. This page
is the short procedure for each, for the three kinds of party involved, using the
reference implementation (`sustainability-wellknown-publisher` and
`sustainability-wellknown-consumer`, 0.6.5 or later). It is non-normative; the
draft's "Document Integrity and Signing" section and the `verifiable-attestation-uri`
member definition are the rules.

| Mechanism | What it is | What it establishes | What it does not |
|---|---|---|---|
| **Detached signature** at `/.well-known/sustainability-data.jws` | A JWS (RFC 7515 Appendix F, empty payload part) over the **exact bytes** served for the parameterless document; `application/jose`; EdDSA or ES256 | Integrity after the fact and key continuity: the bytes a consumer holds are the bytes this key signed, and successive documents came from the same key | Who holds the key; whether the figures are right. A missing signature is not evidence of anything; a failing one makes the document *unverified*, never *false* |
| **Attestation** linked by `verifiable-attestation-uri` | A statement signed by a party **other than the publisher**. The reference shape is a W3C Verifiable Credential (Data Model 2.0) secured as `vc+jwt`; `application/vc+jwt` | Whatever the credential says, backed by the attester's key — about the figures, or about the method that produces them | Anything about the served bytes: editing the document does not invalidate the credential. A consumer fetches both and compares |

Keys: one Ed25519 key per role, generated with `sustainability-publisher keygen`.
The **private** half lives only where it is used (a secret store or a `0600` file);
the **public** half is hosted as a JWK so verifiers can pin it. Never commit a
private key. Rotation is a new key, a new hosted public key, a redeploy.

## 1. Publisher: sign your own document

**A served deployment** (the publisher library, Express, Fastify, the CLI server):

```bash
sustainability-publisher keygen --out /etc/sustainability/private.jwk > signing-key.jwk   # public half printed
# host signing-key.jwk somewhere under your origin, e.g. /.well-known/sustainability-signing-key.jwk (application/jwk+json)
SUSTAINABILITY_SIGNING_KEY="$(cat /etc/sustainability/private.jwk)" sustainability-publisher --config config.json
# or in config:  "server": { "signingKeyFile": "/etc/sustainability/private.jwk" }
# in code:       createSustainabilityServer(publisher, { signingKey: await importSigningKey(jwkJson) })  (same option on the middlewares)
```

The `.jws` route appears, signs the very string the document handler serves, and
re-signs whenever the document changes. The document must be stable between the
two requests: keep the publisher's `cacheTtlMs` above 0 (the default is a day) —
with `0`, every request would regenerate, and the start-up refuses to sign.

**A static host** (a file on disk, no Node at runtime): sign the file you serve and
serve the output next to it, unchanged.

```bash
sustainability-publisher sign /var/www/.well-known/sustainability-data --key /etc/sustainability/private.jwk \
  > /var/www/.well-known/sustainability-data.jws          # serve as: Content-Type: application/jose
```

Re-run `sign` every time the document file changes, in the same deployment step.
Any reformatting between signing and serving breaks the signature by design.

## 2. Attester: issue a credential about someone's document

The attester is a second identity with its own key. The reference tool builds the
credential the gateway uses; any JOSE library producing `vc+jwt` works the same way
(the credential JSON is the payload; header `typ: "vc+jwt"`, `cty: "vc"`).

```bash
sustainability-publisher keygen --out ~/.config/sustainability-attester/private.jwk > attester.jwk
# host attester.jwk at https://<attester-site>/.well-known/sustainability-attester.jwk  (application/jwk+json)
node gateway/scripts/issue-attestation.mjs --key ~/.config/sustainability-attester/private.jwk \
  --issuer https://<attester-site> --attester-key-url https://<attester-site>/.well-known/sustainability-attester.jwk \
  --id https://<attester-site>/attestations/<name>.vc.jwt --gateway https://<publisher-origin> \
  --out <name>.vc.jwt
# host <name>.vc.jwt at the --id URL  (application/vc+jwt)
```

The tool's credential attests a reporting *model* (constants and formula) for five
years, which is what the reference gateway needs. An auditor attesting *figures*
puts the figures in `credentialSubject` instead and issues per reporting period;
the consumer's checks are the same. The credential's structure is in
[internet-drafts/draft-verifiable-credential.md](internet-drafts/draft-verifiable-credential.md).

**The publisher then links it**: set `verifiable-attestation-uri` in the document
to the credential's URL (for the reference gateway: the `SELF_ATTESTATION_URI`
variable). If publisher and attester are the same person, say so where the
document is presented — the reference gateway does, on its index page.

## 3. Consumer: verify

```bash
sustainability-fetch https://<origin> --verify                                   # signature: verified | absent | unverified (<reason>)
sustainability-fetch https://<origin> --verify-attestation=https://<attester-site>/.well-known/sustainability-attester.jwk
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
