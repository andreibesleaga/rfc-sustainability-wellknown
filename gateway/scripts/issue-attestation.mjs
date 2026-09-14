#!/usr/bin/env node
/**
 * Issue the third-party attestation of the gateway's reporting MODEL: a W3C
 * Verifiable Credential (Data Model 2.0) secured as `vc+jwt` (VC-JOSE-COSE),
 * signed with the ATTESTER's key — a different key, and a different identity,
 * from the gateway's own signing key.
 *
 *   node scripts/issue-attestation.mjs --out attestation.vc.jwt
 *   node scripts/issue-attestation.mjs --key ~/.config/sustainability-attester/private.jwk \
 *        --issuer https://andreibesleaga.com --gateway https://sustainability.up.railway.app --out ...
 *
 * The credential attests the model (constants and formula), valid for five
 * years, so every monthly document derived from it is covered and nothing
 * needs re-issuing. It says, in its own description, that the issuer and the
 * gateway operator are the same person: the credential demonstrates the
 * mechanism of draft-besleaga-sustainability-wellknown and is not
 * independent assurance.
 *
 * The private key is read from a local file (default
 * `~/.config/sustainability-attester/private.jwk`, as written by
 * `sustainability-publisher keygen --out`), never from the repository or the
 * gateway's environment, and is never printed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { importSigningKey, signAttached, VC_JWT_MEDIA_TYPE } from "sustainability-wellknown-publisher";
import { verifyCredentialJwt } from "sustainability-wellknown-consumer";

export const DEFAULTS = {
  keyFile: join(homedir(), ".config", "sustainability-attester", "private.jwk"),
  issuer: "https://andreibesleaga.com",
  attesterKeyUrl: "https://andreibesleaga.com/.well-known/sustainability-attester.jwk",
  credentialId: "https://andreibesleaga.com/attestations/sustainability-data-gateway-2026.vc.jwt",
  gateway: "https://sustainability.up.railway.app",
  target: "sustainability-data-gateway",
  methodologyUri:
    "https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/gateway/METHODOLOGY.md",
  watts: 3,
  gridIntensity: 373,
  liveSince: "2026-07-30T00:00:00Z",
  validYears: 5,
};

/** RFC 3339 instant without milliseconds. */
const instant = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The credential JSON (VC Data Model 2.0), before signing. Pure. */
export function buildCredential(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = o.now ? new Date(o.now) : new Date();
  const until = new Date(now);
  until.setUTCFullYear(until.getUTCFullYear() + o.validYears);
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: o.credentialId,
    type: ["VerifiableCredential", "SustainabilityDataModelAttestation"],
    issuer: o.issuer,
    validFrom: instant(now),
    validUntil: instant(until),
    name: "Attestation of the reporting model of the Sustainability Data Reference Gateway",
    description:
      "The issuer attests that the gateway's own /.well-known/sustainability-data document is " +
      "derived by the model below, from the stated constants, for each reporting period since " +
      "the gateway went live. The issuer and the gateway operator are the same person; this " +
      "credential demonstrates the attestation mechanism of " +
      "draft-besleaga-sustainability-wellknown and is not independent assurance.",
    credentialSubject: {
      id: `${o.gateway.replace(/\/+$/, "")}/.well-known/sustainability-data`,
      target: o.target,
      "target-type": "service",
      "measurement-method": "third-party-modeled",
      "methodology-uri": o.methodologyUri,
      "live-since": o.liveSince,
      model: {
        "constant-draw-watts": o.watts,
        "grid-intensity-gCO2e-per-kWh": o.gridIntensity,
        "carbon-accounting": "location-based",
        "reporting-period": "the most recently completed calendar month (parameterless); any period since live-since on request",
        "hours": "hours of the period inside [live-since, now)",
        "energy-kWh": "constant-draw-watts × hours / 1000",
        "carbon-gCO2e": "energy-kWh × grid-intensity-gCO2e-per-kWh",
      },
    },
  };
}

/** Sign the credential as vc+jwt with the attester key. */
export async function issueCredential(privateJwkJson, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const key = await importSigningKey(privateJwkJson);
  const credential = buildCredential(o);
  const jwt = await signAttached(credential, key, {
    typ: "vc+jwt",
    cty: "vc",
    kid: `${o.attesterKeyUrl}#${key.kid}`,
  });
  // Self-check with the ecosystem's own verifier before anything is written.
  const check = await verifyCredentialJwt(jwt, { now: o.now ? new Date(o.now) : undefined });
  if (!check.valid) throw new Error(`issued credential does not verify: ${check.reason}`);
  return { jwt, credential, publicJwk: key.publicJwk };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      if (i + 1 >= argv.length) throw new Error(`"${a}" needs a value`);
      return argv[++i];
    };
    const takeNumber = () => {
      const n = Number(take());
      if (!Number.isFinite(n)) throw new Error(`"${a}" needs a number`);
      return n;
    };
    if (a === "--key") out.keyFile = take();
    else if (a === "--out") out.out = take();
    else if (a === "--issuer") out.issuer = take();
    else if (a === "--attester-key-url") out.attesterKeyUrl = take();
    else if (a === "--id") out.credentialId = take();
    else if (a === "--gateway") out.gateway = take();
    else if (a === "--target") out.target = take();
    else if (a === "--methodology-uri") out.methodologyUri = take();
    else if (a === "--watts") out.watts = takeNumber();
    else if (a === "--grid-intensity") out.gridIntensity = takeNumber();
    else if (a === "--live-since") out.liveSince = take();
    else if (a === "--valid-years") out.validYears = takeNumber();
    else if (a === "--now") out.now = take();
    else throw new Error(`unknown argument "${a}"`);
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const keyFile = opts.keyFile ?? DEFAULTS.keyFile;
  const privateJwk = readFileSync(keyFile, "utf8");
  const { jwt, credential, publicJwk } = await issueCredential(privateJwk, opts);
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, jwt + "\n");
  } else {
    process.stdout.write(jwt + "\n");
  }
  process.stderr.write(
    [
      `issued ${credential.id}`,
      `  issuer      ${credential.issuer}`,
      `  valid       ${credential.validFrom} .. ${credential.validUntil}`,
      `  subject     ${credential.credentialSubject.id}`,
      `  attester kid ${publicJwk.kid}`,
      opts.out ? `  written     ${opts.out}` : "",
      "",
      "Host it at the credential id above with:",
      `  Content-Type: ${VC_JWT_MEDIA_TYPE}`,
      "and host the attester PUBLIC key (printed by keygen) at:",
      `  ${(opts.attesterKeyUrl ?? DEFAULTS.attesterKeyUrl)}  (Content-Type: application/jwk+json)`,
      "",
    ]
      .filter((l) => l !== "")
      .join("\n") + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
