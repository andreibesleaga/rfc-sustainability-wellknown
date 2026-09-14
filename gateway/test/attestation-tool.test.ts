/**
 * The attester tool: builds the VC 2.0 credential of the gateway's model,
 * signs it as vc+jwt with a (test) attester key, and the consumer verifies it.
 */
import { exportPrivateJwk, generateSigningKey } from "sustainability-wellknown-publisher";
import { verifyCredentialJwt, VC_V2_CONTEXT } from "sustainability-wellknown-consumer";
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain ESM script, imported for its exported builder
import { buildCredential, DEFAULTS, issueCredential } from "../scripts/issue-attestation.mjs";

const NOW = "2026-09-15T10:00:00Z";

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

  it("refuses to issue with a public-only key", async () => {
    const attester = await generateSigningKey();
    await expect(issueCredential(JSON.stringify(attester.publicJwk), { now: NOW })).rejects.toThrow(/missing private member "d"/);
  });
});
