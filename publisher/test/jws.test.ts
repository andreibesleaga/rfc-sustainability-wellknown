/**
 * The embedded `signed` member (draft §Signing) — key handling, signature form,
 * the publisher's signing pipeline, what every entry point serves, and the
 * offline signing CLI. All keys are generated in-process; nothing touches the
 * network.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import * as jose from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computedAdapter, staticAdapter } from "../src/adapters";
import { runKeygen, runSign, loadSigningKey } from "../src/cli";
import {
  embeddedJwk,
  exportPrivateJwk,
  generateSigningKey,
  importSigningKey,
  pemToX5c,
  signDeclaration,
  signDocument,
  SIGNED_CTY,
  signAttached,
  SigningKey,
} from "../src/jws";
import { expressSustainability } from "../src/middleware/express";
import { fastifySustainability } from "../src/middleware/fastify";
import { periodFromReportingPeriod } from "../src/period";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer } from "../src/server";
import type { RawMetrics, SustainabilityMetrics } from "../src/types";
import { validateDocument } from "../src/validate";

function demoPublisher(signing?: { key: SigningKey; keyId?: string }, period = "2026-02") {
  return new Publisher(
    computedAdapter({
      provider: "Example Corp",
      methodologyUri: "https://example.com/m",
      period: period,
      energy: { value: 1250, unit: "kWh" },
      gridIntensity: 276,
    }),
    { cacheTtlMs: 60_000, normalize: { target: "example.com" }, ...(signing ? { signing } : {}) },
  );
}

const rawTrend = (period: string): RawMetrics => ({
  provider: "Trend Corp",
  measurementMethod: "cloud-billing",
  methodologyUri: "https://trend.example/m",
  period: period,
  energy: { value: 10, unit: "kWh" },
  carbon: { value: 100, unit: "gCO2e" },
  target: "trend.example",
  capabilities: "extended",
});

/** Verify a `signed` member with `jose` and return its header and payload. */
async function verifySigned(object: SustainabilityMetrics, key?: jose.CryptoKey | jose.JWK) {
  const jws = object.signed as string;
  const header = jose.decodeProtectedHeader(jws);
  const publicKey = await jose.importJWK((key ?? header.jwk) as jose.JWK, header.alg);
  const { payload } = await jose.compactVerify(jws, publicKey);
  return { header, payload: JSON.parse(new TextDecoder().decode(payload)) };
}

function listen(server: any) {
  return new Promise<{ base: string; close: () => Promise<void> }>((res) => {
    // `app.listen` (Express) returns the underlying http.Server; a plain
    // http.Server returns itself.
    const s = server.listen(0, () => {
      const { port } = s.address() as AddressInfo;
      res({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => s.close(() => r())),
      });
    });
  });
}

describe("key material", () => {
  it("generates Ed25519 by default and P-256 (ES256) on request", async () => {
    const ed = await generateSigningKey();
    expect(ed.alg).toBe("Ed25519");
    expect(ed.publicJwk).toMatchObject({ kty: "OKP", crv: "Ed25519", use: "sig", alg: "Ed25519" });
    expect(ed.publicJwk).not.toHaveProperty("d");
    const es = await generateSigningKey("ES256");
    expect(es.alg).toBe("ES256");
    expect(es.publicJwk).toMatchObject({ kty: "EC", crv: "P-256", use: "sig", alg: "ES256" });
    expect(typeof es.publicJwk.y).toBe("string");
  });

  it("kid is the RFC 7638 thumbprint of the public key", async () => {
    const key = await generateSigningKey();
    const { kid: _k, alg: _a, use: _u, ...material } = key.publicJwk;
    expect(key.kid).toBe(await jose.calculateJwkThumbprint(material));
    expect(key.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("round-trips through a private JWK export/import, preserving kid", async () => {
    for (const alg of ["Ed25519", "ES256"] as const) {
      const key = await generateSigningKey(alg);
      const json = JSON.stringify(await exportPrivateJwk(key));
      const back = await importSigningKey(json);
      expect(back.alg).toBe(alg);
      expect(back.kid).toBe(key.kid);
      expect(back.publicJwk).toEqual(key.publicJwk);
      // Signatures by the imported key verify against the original public key.
      const object = (await demoPublisher({ key: back }).getDocument()) as SustainabilityMetrics;
      const { payload } = await verifySigned(object, key.publicJwk);
      expect(payload.target).toBe("example.com");
    }
  });

  it("honours a caller-supplied kid in the imported JWK", async () => {
    const key = await generateSigningKey();
    const jwk = { ...(await exportPrivateJwk(key)), kid: "https://example.com/key#1" };
    expect((await importSigningKey(jwk)).kid).toBe("https://example.com/key#1");
  });

  it("rejects invalid key material with messages that name the member and never echo it", async () => {
    const key = await generateSigningKey();
    const priv = (await exportPrivateJwk(key)) as Record<string, unknown>;
    const cases: Array<[unknown, RegExp]> = [
      ["not json", /not valid JSON/],
      ["[1]", /JSON object/],
      [JSON.stringify({ ...priv, kty: "RSA" }), /unsupported key type/],
      [JSON.stringify({ ...priv, crv: "P-384" }), /unsupported key type/],
      [JSON.stringify(key.publicJwk), /missing private member "d"/],
      [JSON.stringify({ ...priv, x: undefined }), /could not be imported/],
      [JSON.stringify({ ...priv, d: "AAAA" }), /could not be imported/],
    ];
    for (const [input, re] of cases) {
      let message = "";
      try {
        await importSigningKey(input as string);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(re);
      expect(message).not.toContain(priv.d as string);
    }
  });
});

describe("the signed member (draft §Signing)", () => {
  const declaration = (): SustainabilityMetrics => ({
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Example Corp (sustain@example.org)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://example.com/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "example.com",
    "energy-consumption": 15000,
    "energy-unit": "kWh",
  });

  it("is a compact JWS over the object minus `signed`, typed by cty, for both algorithms", async () => {
    for (const alg of ["Ed25519", "ES256"] as const) {
      const key = await generateSigningKey(alg);
      const object = declaration();
      const signed = await signDeclaration(object, key);

      expect(signed.signed!.split(".")).toHaveLength(3);
      const { header, payload } = await verifySigned(signed);
      expect(header).toEqual({ alg, cty: SIGNED_CTY, jwk: embeddedJwk(key) });
      // The embedded key has the RFC 7517 members of the key and nothing else: no kid, alg or use.
      expect(Object.keys(header.jwk!)).toEqual(alg === "Ed25519" ? ["kty", "crv", "x"] : ["kty", "crv", "x", "y"]);
      // The payload is exactly this object without the signature.
      expect(payload).toEqual(object);
      expect(payload).not.toHaveProperty("signed");
      // …and the rest of the object is untouched, with `signed` last.
      const keys = Object.keys(signed);
      expect(keys[keys.length - 1]).toBe("signed");
      expect({ ...signed, signed: undefined }).toEqual({ ...object, signed: undefined });
      expect(validateDocument(signed).valid).toBe(true);
    }
  });

  it("verifies with the embedded jwk and fails once a member is edited", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(declaration(), key);
    await expect(verifySigned(signed)).resolves.toBeTruthy();

    const tampered = { ...signed, "energy-consumption": 1 };
    const { payload } = await verifySigned(tampered);
    // The signature still verifies (it covers the payload it carries), and the
    // payload is what the consumer uses — the difference is the evidence of the
    // edit (draft §Verification).
    expect(payload["energy-consumption"]).toBe(15000);
    expect(tampered["energy-consumption"]).toBe(1);

    // A signature whose own bytes were altered does not verify at all.
    const broken = { ...signed, signed: signed.signed!.slice(0, -4) + "AAAA" };
    await expect(verifySigned(broken)).rejects.toThrow();
  });

  it("names an out-of-band key with kid instead of embedding jwk", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(declaration(), key, { keyId: "https://example.com/keys/2026#1" });
    const header = jose.decodeProtectedHeader(signed.signed!);
    expect(header).toEqual({ alg: "Ed25519", cty: SIGNED_CTY, kid: "https://example.com/keys/2026#1" });
    expect(header).not.toHaveProperty("jwk");
    // Verification then needs the key the publisher distributes separately.
    const { payload } = await verifySigned(signed, key.publicJwk);
    expect(payload.target).toBe("example.com");
  });

  it("re-signs rather than nesting when the object already carries a signature", async () => {
    const key = await generateSigningKey();
    const once = await signDeclaration(declaration(), key);
    const twice = await signDeclaration(once, key);
    expect(twice.signed).toBe(once.signed); // Ed25519 is deterministic
    const { payload } = await verifySigned(twice);
    expect(payload).not.toHaveProperty("signed");
  });

  it("signs every object of an array individually", async () => {
    const key = await generateSigningKey();
    const months = ["2026-01", "2026-02"].map((p) => ({ ...declaration(), "reporting-period": p }));
    const signed = (await signDocument(months, key)) as SustainabilityMetrics[];
    expect(signed).toHaveLength(2);
    for (const [i, entry] of signed.entries()) {
      const { header, payload } = await verifySigned(entry);
      expect(header.cty).toBe(SIGNED_CTY);
      expect(payload).toEqual(months[i]);
    }
    expect(signed[0].signed).not.toBe(signed[1].signed);
  });

  it("signAttached still carries typ/cty and a JSON payload (vc+jwt shape)", async () => {
    const key = await generateSigningKey();
    const credential = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential"] };
    const jwt = await signAttached(credential, key, { typ: "vc+jwt", cty: "vc", kid: "https://issuer.example/k#1" });
    const [h, p] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "Ed25519",
      kid: "https://issuer.example/k#1",
      typ: "vc+jwt",
      cty: "vc",
      jwk: embeddedJwk(key),
    });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual(credential);
  });
});

describe("a signing publisher", () => {
  let key: SigningKey;
  beforeAll(async () => {
    key = await generateSigningKey();
  });

  it("emits no signed member when no key is configured", async () => {
    const doc = (await demoPublisher().getDocument()) as SustainabilityMetrics;
    expect(doc).not.toHaveProperty("signed");
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("signs the built document, and the payload is the served object minus `signed`", async () => {
    const publisher = demoPublisher({ key });
    const { body } = await publisher.getSerialized();
    const served = JSON.parse(body) as SustainabilityMetrics;
    const { header, payload } = await verifySigned(served);
    expect(header.cty).toBe(SIGNED_CTY);
    const { signed: _s, ...withoutSignature } = served;
    expect(payload).toEqual(withoutSignature);
    expect(validateDocument(served).valid).toBe(true);
  });

  it("signs once per generation, not per request (ES256 signatures are randomized)", async () => {
    const es = await generateSigningKey("ES256");
    const publisher = demoPublisher({ key: es });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => publisher.getSerialized()));
    expect(a.body).toBe(b.body);
    expect(b.body).toBe(c.body);
    expect(a.etag).toBe(c.etag);
    const again = await publisher.getSerialized();
    expect(again.body).toBe(a.body); // warm cache: the same signature
  });

  it("signs every entry of an Extended array response", async () => {
    const publisher = new Publisher(
      staticAdapter({ data: ["2026-01", "2026-02", "2026-03"].map(rawTrend), capabilities: "extended" }),
      { cacheTtlMs: 0, signing: { key } },
    );
    const doc = (await publisher.getDocument({ granularity: "monthly" })) as SustainabilityMetrics[];
    expect(doc).toHaveLength(3);
    for (const entry of doc) {
      const { header, payload } = await verifySigned(entry);
      expect(header.alg).toBe("Ed25519");
      expect(payload.period).toEqual(entry.period);
    }
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("signs the objects a selection returns, each over its own members, and computes no aggregate", async () => {
    const publisher = new Publisher(
      staticAdapter({ data: ["2026-01", "2026-02", "2026-03"].map(rawTrend), capabilities: "extended" }),
      { cacheTtlMs: 0, signing: { key } },
    );
    const selected = (await publisher.getDocument({
      start: "2026-01-01T00:00:00Z",
      end: "2026-03-01T00:00:00Z",
    })) as SustainabilityMetrics[];
    expect(selected).toHaveLength(2);
    for (const entry of selected) {
      const { payload } = await verifySigned(entry);
      expect(payload["energy-consumption"]).toBe(10); // the month's own figure, not a sum
    }
  });
});

describe("what the entry points serve", () => {
  let key: SigningKey;
  let srv: { base: string; close: () => Promise<void> };
  beforeAll(async () => {
    key = await generateSigningKey();
    srv = await listen(createSustainabilityServer(demoPublisher({ key })));
  });
  afterAll(async () => srv.close());

  it("standalone server: the signature travels inside the body, GET and HEAD alike", async () => {
    const r = await fetch(`${srv.base}/.well-known/sustainability-data`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/sustainability-data+json");
    const served = (await r.json()) as SustainabilityMetrics;
    const { payload } = await verifySigned(served);
    expect(payload.target).toBe("example.com");

    const head = await fetch(`${srv.base}/.well-known/sustainability-data`, { method: "HEAD" });
    expect(head.headers.get("content-length")).toBe(r.headers.get("content-length"));
    expect(await head.text()).toBe("");
  });

  it("Express middleware serves the same signed document", async () => {
    const app = express();
    app.use(expressSustainability(demoPublisher({ key: await generateSigningKey("ES256") })));
    const plain = await listen(app);
    try {
      const served = (await (
        await fetch(`${plain.base}/.well-known/sustainability-data`)
      ).json()) as SustainabilityMetrics;
      const { header } = await verifySigned(served);
      expect(header.alg).toBe("ES256");
    } finally {
      await plain.close();
    }
  });

  it("Fastify plugin serves the same signed document and registers one route", async () => {
    const routes = new Map<string, any>();
    const fake = {
      get(path: string, h: any) {
        routes.set(path, h);
      },
      route(o: { url: string; handler: any }) {
        routes.set(o.url, o.handler);
      },
    };
    await fastifySustainability(fake as any, { publisher: demoPublisher({ key }) });
    // One registration, one resource: the signature lives inside the body.
    expect([...routes.keys()]).toEqual(["/.well-known/sustainability-data"]);

    const reply: any = {
      statusCode: 0,
      sentBody: "",
      code(c: number) {
        reply.statusCode = c;
        return reply;
      },
      headers() {
        return reply;
      },
      send(b: string) {
        reply.sentBody = b ?? "";
        return reply;
      },
    };
    await routes.get("/.well-known/sustainability-data")({ method: "GET", headers: {}, query: {} }, reply);
    expect(reply.statusCode).toBe(200);
    const { payload } = await verifySigned(JSON.parse(reply.sentBody));
    expect(payload.provider).toBe("Example Corp");
  });
});

describe("CLI keygen / sign / key loading", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sust-jws-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const capture = () => {
    const chunks: string[] = [];
    return { stream: { write: (c: string) => (chunks.push(c), true) } as any, text: () => chunks.join("") };
  };

  const DECLARATION = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Static Host (sustain@static.example)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://static.example/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "static.example",
    "energy-consumption": 15000,
    "energy-unit": "kWh",
  };

  it("keygen writes the private JWK 0600 and prints only the public JWK", async () => {
    const file = join(dir, "nested", "private.jwk");
    const out = capture();
    await runKeygen(["--alg", "ES256", "--out", file], out.stream);
    const printed = JSON.parse(out.text());
    expect(printed).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(printed).not.toHaveProperty("d");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const priv = JSON.parse(readFileSync(file, "utf8"));
    expect(priv.d).toEqual(expect.any(String));
    expect(priv.kid).toBe(printed.kid);
    // Never overwrite an existing key file.
    await expect(runKeygen(["--out", file], capture().stream)).rejects.toThrow(/EEXIST/);
    await expect(runKeygen(["--alg", "RS256"], capture().stream)).rejects.toThrow(/Ed25519 or ES256/);
    await expect(runKeygen(["--bogus"], capture().stream)).rejects.toThrow(/unknown argument/);
  });

  it("sign writes a signed copy of a single declaration file", async () => {
    const keyFile = join(dir, "sign.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const inFile = join(dir, "declaration.json");
    const outFile = join(dir, "out", "declaration.json");
    writeFileSync(inFile, JSON.stringify(DECLARATION, null, 2) + "\n");

    await runSign([inFile, outFile, "--key", keyFile], capture().stream);
    const signed = JSON.parse(readFileSync(outFile, "utf8")) as SustainabilityMetrics;
    const { header, payload } = await verifySigned(signed);
    expect(header.cty).toBe(SIGNED_CTY);
    expect(payload).toEqual(DECLARATION);
    expect(Object.keys(signed).pop()).toBe("signed");
    expect(validateDocument(signed).valid).toBe(true);
  });

  it("sign signs every object of an array, and --kid replaces the embedded jwk", async () => {
    const keyFile = join(dir, "sign2.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const inFile = join(dir, "trend.json");
    const outFile = join(dir, "trend.signed.json");
    const trend = ["2024", "2025"].map((p) => ({ ...DECLARATION, period: periodFromReportingPeriod(p) }));
    writeFileSync(inFile, JSON.stringify(trend, null, 2) + "\n");

    await runSign([inFile, outFile, "--key", keyFile, "--kid", "https://static.example/keys#1"], capture().stream);
    const signed = JSON.parse(readFileSync(outFile, "utf8")) as SustainabilityMetrics[];
    expect(signed).toHaveLength(2);
    const publicJwk = JSON.parse(readFileSync(keyFile, "utf8"));
    delete publicJwk.d;
    for (const [i, entry] of signed.entries()) {
      const header = jose.decodeProtectedHeader(entry.signed!);
      expect(header.kid).toBe("https://static.example/keys#1");
      expect(header).not.toHaveProperty("jwk");
      const { payload } = await verifySigned(entry, publicJwk);
      expect(payload).toEqual(trend[i]);
    }
  });

  it("rejects missing arguments, unknown flags and a non-conformant input", async () => {
    const keyFile = join(dir, "sign3.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const inFile = join(dir, "declaration.json");
    const outFile = join(dir, "never-written.json");

    await expect(runSign(["--key", keyFile], capture().stream)).rejects.toThrow(/input declaration file/);
    await expect(runSign([inFile, "--key", keyFile], capture().stream)).rejects.toThrow(/output file/);
    await expect(runSign([inFile, outFile], capture().stream)).rejects.toThrow(/--key/);
    await expect(runSign([inFile, outFile, "--bogus"], capture().stream)).rejects.toThrow(/unknown argument/);
    await expect(runSign([inFile, outFile, "--key"], capture().stream)).rejects.toThrow(/needs a value/);

    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ ...DECLARATION, target: "" }));
    await expect(runSign([bad, outFile, "--key", keyFile], capture().stream)).rejects.toThrow(/target/);
    writeFileSync(bad, "{not json");
    await expect(runSign([bad, outFile, "--key", keyFile], capture().stream)).rejects.toThrow(/not valid I-JSON/);
    // A duplicate member name is refused as well: the signature would cover an ambiguous object.
    writeFileSync(bad, '{"target":"a","target":"b"}');
    await expect(runSign([bad, outFile, "--key", keyFile], capture().stream)).rejects.toThrow(/not valid I-JSON/);
  });

  // Draft §URI-Valued Members: these members are URI references, so a relative one
  // is signed as it stands; one that is not a reference at all is signed with a warning.
  it("signs a declaration whose URI members are URI references, and warns about one that is not", async () => {
    const keyFile = join(dir, "sign4.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const input = join(dir, "uris.json");
    const outFile = join(dir, "uris.signed.json");
    const written: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      writeFileSync(input, JSON.stringify({ ...DECLARATION, "methodology-uri": "/methodology", "disclosure-uri": "../disclosures" }));
      await runSign([input, outFile, "--key", keyFile], capture().stream);
      expect(existsSync(outFile)).toBe(true);
      expect(written).toEqual([]);

      writeFileSync(input, JSON.stringify({ ...DECLARATION, "disclosure-uri": "not a uri" }));
      await runSign([input, outFile, "--key", keyFile], capture().stream);
      expect(written.join("")).toMatch(/warning: .*disclosure-uri is not a URI reference/);
    } finally {
      stderr.mockRestore();
    }
  });

  it("keygen refuses the polymorphic EdDSA name and names Ed25519; a key file written for it still signs as Ed25519", async () => {
    await expect(runKeygen(["--alg", "EdDSA"], capture().stream)).rejects.toThrow(/Ed25519/);
    await expect(generateSigningKey("EdDSA" as never)).rejects.toThrow(/Ed25519/);
    const key = await generateSigningKey();
    const file = { ...(await exportPrivateJwk(key)), alg: "EdDSA" };
    const imported = await importSigningKey(file);
    expect(imported.alg).toBe("Ed25519");
    expect(imported.kid).toBe(key.kid);
    const signed = await signDeclaration(
      { updated: "2026-03-01T12:00:00Z", capabilities: "basic", provider: "p", "measurement-method": "cloud-billing", "methodology-uri": "https://x.example/m", period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" }, target: "x.example" },
      imported,
    );
    expect(jose.decodeProtectedHeader(signed.signed!)).toMatchObject({ alg: "Ed25519", cty: SIGNED_CTY });
    // A verifier restricted to the fully-specified name accepts it.
    await expect(jose.compactVerify(signed.signed!, await jose.importJWK(key.publicJwk, "Ed25519"), { algorithms: ["Ed25519"] })).resolves.toBeTruthy();
  });

  it("loadSigningKey prefers the environment variable over the config file, and is undefined without either", async () => {
    const keyFile = join(dir, "load.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const fileKid = JSON.parse(readFileSync(keyFile, "utf8")).kid;
    const envKey = await generateSigningKey();
    const config = { adapter: { type: "computed", options: {} }, signing: { keyFile } };
    expect((await loadSigningKey(config, {}))!.kid).toBe(fileKid);
    const envJwk = JSON.stringify(await exportPrivateJwk(envKey));
    expect((await loadSigningKey(config, { SUSTAINABILITY_SIGNING_KEY: envJwk }))!.kid).toBe(envKey.kid);
    expect(await loadSigningKey({ adapter: { type: "computed", options: {} } }, {})).toBeUndefined();
    await expect(loadSigningKey(config, { SUSTAINABILITY_SIGNING_KEY: "{}" })).rejects.toThrow(/unsupported key type/);
  });
});

// The certificate in test/fixtures/rfc8032-test-key-1.cert.pem is self-signed for the public test key 1 of
// RFC 8032 Section 7.1 (the private seed is published and protects nothing). It was made once with OpenSSL 3:
//   (printf '302e020100300506032b657004220420'; echo -n 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60) | xxd -r -p > key.der
//   openssl pkey -inform DER -in key.der -out key.pem
//   openssl req -new -x509 -key key.pem -subj "/CN=RFC 8032 test key 1" -days 36500 -out rfc8032-test-key-1.cert.pem
// No test reads the clock, so the validity dates play no part.
describe("a certificate chain in the header", () => {
  const CERTIFICATE = readFileSync(join(__dirname, "fixtures", "rfc8032-test-key-1.cert.pem"), "utf8");
  const RFC8032_KEY = {
    kty: "OKP",
    crv: "Ed25519",
    x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
  };
  const DECLARATION: SustainabilityMetrics = {
    updated: "2026-03-01T12:00:00Z",
    capabilities: "basic",
    provider: "Static Host (sustain@static.example)",
    "measurement-method": "cloud-billing",
    "methodology-uri": "https://static.example/methodology",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
    target: "static.example",
    "energy-consumption": 15000,
    "energy-unit": "kWh",
  };
  const object = () => ({ ...DECLARATION });

  it("pemToX5c reads the base64 DER of each certificate, in order", () => {
    const [leaf, ...rest] = pemToX5c(CERTIFICATE + CERTIFICATE);
    expect(rest).toHaveLength(1);
    expect(leaf).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(leaf, "base64")[0]).toBe(0x30); // a DER SEQUENCE
    expect(() => pemToX5c("no certificate here")).toThrow(/no CERTIFICATE block/);
  });

  it("carries x5c instead of jwk when the leaf holds the signing key", async () => {
    const key = await importSigningKey(RFC8032_KEY);
    const x5c = pemToX5c(CERTIFICATE);
    const signed = await signDeclaration(object(), key, { x5c });
    const header = jose.decodeProtectedHeader(signed.signed!);
    expect(header).toEqual({ alg: "Ed25519", cty: SIGNED_CTY, x5c });
    // The verification key is the one in the certificate.
    const { payload } = await verifySigned(signed, key.publicJwk);
    expect(payload).toEqual(object());
  });

  it("adds kid next to x5c when keyId is also given", async () => {
    const key = await importSigningKey(RFC8032_KEY);
    const signed = await signDeclaration(object(), key, { x5c: pemToX5c(CERTIFICATE), keyId: "test-key-1" });
    const header = jose.decodeProtectedHeader(signed.signed!);
    expect(header).toMatchObject({ kid: "test-key-1" });
    expect(header).toHaveProperty("x5c");
    expect(header).not.toHaveProperty("jwk");
  });

  it("refuses a chain whose leaf is another key, and a chain that is not certificates", async () => {
    const other = await generateSigningKey();
    await expect(signDeclaration(object(), other, { x5c: pemToX5c(CERTIFICATE) })).rejects.toThrow(/not the signing key/);
    const key = await importSigningKey(RFC8032_KEY);
    await expect(signDeclaration(object(), key, { x5c: [] })).rejects.toThrow(/non-empty array/);
    await expect(signDeclaration(object(), key, { x5c: ["not base64!"] })).rejects.toThrow(/non-empty array/);
    await expect(signDeclaration(object(), key, { x5c: ["AAAA"] })).rejects.toThrow(/could not be read/);
  });

  it("keeps the default and the kid-only header as they were", async () => {
    const key = await importSigningKey(RFC8032_KEY);
    expect(jose.decodeProtectedHeader((await signDeclaration(object(), key)).signed!)).toEqual({ alg: "Ed25519", cty: SIGNED_CTY, jwk: embeddedJwk(key) });
    expect(jose.decodeProtectedHeader((await signDeclaration(object(), key, { keyId: "k" })).signed!)).toEqual({ alg: "Ed25519", cty: SIGNED_CTY, kid: "k" });
  });

  it("sign --x5c takes the chain from a PEM file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sust-x5c-"));
    try {
      const keyFile = join(dir, "key.jwk");
      const inFile = join(dir, "in.json");
      const outFile = join(dir, "out.json");
      writeFileSync(keyFile, JSON.stringify(RFC8032_KEY));
      writeFileSync(inFile, JSON.stringify(DECLARATION, null, 2) + "\n");
      await runSign([inFile, outFile, "--key", keyFile, "--x5c", join(__dirname, "fixtures", "rfc8032-test-key-1.cert.pem")], { write: () => true } as unknown as NodeJS.WritableStream);
      const header = jose.decodeProtectedHeader((JSON.parse(readFileSync(outFile, "utf8")) as SustainabilityMetrics).signed!);
      expect(header.x5c).toEqual(pemToX5c(CERTIFICATE));
      expect(header).not.toHaveProperty("jwk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
