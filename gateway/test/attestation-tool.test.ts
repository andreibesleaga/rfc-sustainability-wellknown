/**
 * The attester tool: builds the VC 2.0 credential of the gateway's model,
 * signs it as vc+jwt with a (test) attester key, and the consumer verifies it.
 */
import { exportPrivateJwk, generateSigningKey } from "sustainability-wellknown-publisher";
import { checkBinding, declarationCopyOf, verifyCredentialJwt, VC_V2_CONTEXT } from "sustainability-wellknown-consumer";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM script, imported for its exported builder
import { buildCredential, declarationCopy, DEFAULTS, issueCredential } from "../scripts/issue-attestation.mjs";

const NOW = "2026-09-15T10:00:00Z";

/** One served declaration, signature and all, as the gateway would hand it over. */
const SERVED = {
  updated: "2026-09-01T00:00:00Z",
  capabilities: "extended",
  provider: "Andrei Besleaga, operator of this reference gateway",
  "measurement-method": "third-party-modeled",
  "methodology-uri": DEFAULTS.methodologyUri,
  "reporting-period": "2026-08",
  target: DEFAULTS.target,
  "energy-consumption": 2.232,
  "energy-unit": "kWh",
  "carbon-footprint": 832.5,
  "carbon-unit": "gCO2e",
  "target-type": "service",
  signed: "eyJ.payload.sig",
};

describe("issue-attestation", () => {
  it("builds a VC 2.0 credential of the model, valid five years, naming the same-person caveat", () => {
    const c = buildCredential({ now: NOW });
    expect(c["@context"]).toEqual([VC_V2_CONTEXT]);
    expect(c.type).toEqual(["VerifiableCredential", "SustainabilityDataModelAttestation"]);
    expect(c.issuer).toBe("https://andreibesleaga.com");
    expect(c.validFrom).toBe(NOW);
    expect(c.validUntil).toBe("2031-09-15T10:00:00Z");
    expect(c.credentialSubject.id).toBe(`${DEFAULTS.gateway}/.well-known/sustainability-data`);
    expect(c.credentialSubject.model["constant-draw-watts"]).toBe(3);
    expect(c.credentialSubject.model["grid-intensity-gCO2e-per-kWh"]).toBe(373);
    expect(c.credentialSubject["live-since"]).toBe("2026-07-30T00:00:00Z");
    expect(c.description).toContain("the same person");
  });

  it("signs it as vc+jwt with the attester key and the consumer verifies it, pinned or self-asserted", async () => {
    const attester = await generateSigningKey();
    const { jwt, publicJwk } = await issueCredential(JSON.stringify(await exportPrivateJwk(attester)), { now: NOW });
    const [h] = jwt.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    expect(header).toMatchObject({ alg: "EdDSA", typ: "vc+jwt", cty: "vc", kid: `${DEFAULTS.attesterKeyUrl}#${attester.kid}` });
    expect(publicJwk).toEqual(attester.publicJwk);

    const at = new Date("2028-01-01T00:00:00Z");
    const self = await verifyCredentialJwt(jwt, { now: at });
    expect(self).toMatchObject({ valid: true, issuer: DEFAULTS.issuer, assurance: "self-asserted-key", typOk: true });
    const pinned = await verifyCredentialJwt(jwt, { now: at, trustedIssuerKeys: [attester.publicJwk] });
    expect(pinned).toMatchObject({ valid: true, assurance: "issuer-key-pinned" });
    const other = await generateSigningKey();
    expect(await verifyCredentialJwt(jwt, { now: at, trustedIssuerKeys: [other.publicJwk] })).toMatchObject({ valid: false });
    // Outside the window it is invalid, exactly as VC 2.0 defines validity.
    expect(await verifyCredentialJwt(jwt, { now: new Date("2032-01-01T00:00:00Z") })).toMatchObject({ valid: false, reason: "expired" });
  });

  it("binds to a declaration by carrying a copy of it WITHOUT `signed` (-07)", async () => {
    const c = buildCredential({ now: NOW, declaration: SERVED });
    const copy = c.credentialSubject.declaration;
    expect(copy.signed).toBeUndefined();
    const { signed: _s, ...plain } = SERVED;
    expect(copy).toEqual(plain);
    // The consumer finds the copy where the draft says it is, and the binding
    // is a comparison of objects — there is no digest to trust.
    expect(declarationCopyOf(c)).toEqual(plain);
    expect(checkBinding(c, SERVED)).toEqual({ status: "match" });
    expect(checkBinding(c, { ...SERVED, "carbon-footprint": 1 })).toEqual({
      status: "mismatch",
      differences: ["carbon-footprint"],
    });
    expect(() => declarationCopy([SERVED])).toThrow(/ONE declaration object/);
  });

  it("carries NO copy by default, so the standing model attestation is not bound to one month", () => {
    const c = buildCredential({ now: NOW });
    expect(c.credentialSubject.declaration).toBeUndefined();
    // `no-copy`, not `mismatch`: the statement is about the model.
    expect(checkBinding(c, SERVED)).toEqual({ status: "no-copy" });
  });

  it("never lets the private key reach the credential, the JWT header or the reported output", async () => {
    const attester = await generateSigningKey();
    const privateJwk = JSON.stringify(await exportPrivateJwk(attester));
    const { jwt, credential, publicJwk } = await issueCredential(privateJwk, { now: NOW, declaration: SERVED });
    const secret = JSON.parse(privateJwk).d as string;
    expect(secret).toBeTruthy();
    const header = JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString());
    expect(header.jwk?.d).toBeUndefined();
    expect(publicJwk).not.toHaveProperty("d");
    for (const text of [jwt, JSON.stringify(credential), JSON.stringify(publicJwk)]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses to issue with a public-only key", async () => {
    const attester = await generateSigningKey();
    await expect(issueCredential(JSON.stringify(attester.publicJwk), { now: NOW })).rejects.toThrow(/missing private member "d"/);
  });
});
