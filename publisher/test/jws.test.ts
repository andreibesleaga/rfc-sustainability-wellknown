/**
 * Detached JWS (draft -06 §Document Signing) — key handling, signature form,
 * the signature resource handler, every framework route, and the CLI tools.
 * All keys are generated in-process; nothing touches the network.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import express from "express";
import * as jose from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computedAdapter } from "../src/adapters";
import { runKeygen, runSign, loadSigningKey } from "../src/cli";
import { handleRequest, handleSignatureRequest, signatureEtag } from "../src/handler";
import {
  exportPrivateJwk,
  generateSigningKey,
  importSigningKey,
  JOSE_MEDIA_TYPE,
  SIGNATURE_PATH,
  signAttached,
  signDetached,
  SigningKey,
} from "../src/jws";
import { expressSustainability } from "../src/middleware/express";
import { fastifySustainability } from "../src/middleware/fastify";
import { Publisher, NotFoundError } from "../src/publisher";

const base64url = (input: Uint8Array | string) => Buffer.from(input).toString("base64url");
import { createSustainabilityServer } from "../src/server";
import { RawMetrics, SourceAdapter } from "../src/types";

function demoPublisher(period = "2026-02") {
  return new Publisher(
    computedAdapter({
      provider: "Example Corp",
      methodologyUri: "https://example.com/m",
      reportingPeriod: period,
      energy: { value: 1250, unit: "kWh" },
      gridIntensity: 276,
    }),
    { cacheTtlMs: 60_000, normalize: { target: "example.com" } },
  );
}

/** Independent verification with node:crypto only — no code under test. */
function verifyWithNode(jws: string, payload: string | Uint8Array): { header: any; valid: boolean } {
  const [h, p, s] = jws.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const signingInput = Buffer.from(`${h}.${p === "" ? base64url(payload) : p}`, "ascii");
  const key = createPublicKey({ key: header.jwk, format: "jwk" });
  const sig = Buffer.from(s, "base64url");
  const valid =
    header.alg === "EdDSA"
      ? cryptoVerify(null, signingInput, key, sig)
      : cryptoVerify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, sig);
  return { header, valid };
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
  it("generates Ed25519 (EdDSA) by default and P-256 (ES256) on request", async () => {
    const ed = await generateSigningKey();
    expect(ed.alg).toBe("EdDSA");
    expect(ed.publicJwk).toMatchObject({ kty: "OKP", crv: "Ed25519", use: "sig", alg: "EdDSA" });
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
    for (const alg of ["EdDSA", "ES256"] as const) {
      const key = await generateSigningKey(alg);
      const json = JSON.stringify(await exportPrivateJwk(key));
      const back = await importSigningKey(json);
      expect(back.alg).toBe(alg);
      expect(back.kid).toBe(key.kid);
      expect(back.publicJwk).toEqual(key.publicJwk);
      // Signatures by the imported key verify against the original public key.
      const jws = await signDetached("payload", back);
      expect(verifyWithNode(jws, "payload").valid).toBe(true);
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

describe("detached JWS form", () => {
  it("has an empty payload part and verifies over the exact bytes (both algorithms)", async () => {
    const doc = '{\n  "version": "2.0"\n}';
    for (const alg of ["EdDSA", "ES256"] as const) {
      const key = await generateSigningKey(alg);
      const jws = await signDetached(doc, key);
      const parts = jws.split(".");
      expect(parts).toHaveLength(3);
      expect(parts[1]).toBe("");
      const { header, valid } = verifyWithNode(jws, doc);
      expect(valid).toBe(true);
      expect(header).toEqual({ alg, kid: key.kid, jwk: key.publicJwk });
      // Any change to the bytes invalidates it (no canonicalization).
      expect(verifyWithNode(jws, doc.replace("\n", " ")).valid).toBe(false);
      if (alg === "ES256") expect(Buffer.from(parts[2], "base64url")).toHaveLength(64);
    }
  });

  it("Ed25519 signatures are deterministic; includeJwk:false omits the key", async () => {
    const key = await generateSigningKey();
    expect(await signDetached("x", key)).toBe(await signDetached("x", key));
    const header = JSON.parse(
      Buffer.from((await signDetached("x", key, { includeJwk: false })).split(".")[0], "base64url").toString(),
    );
    expect(header).toEqual({ alg: "EdDSA", kid: key.kid });
  });

  it("signAttached carries typ/cty and the JSON payload (vc+jwt shape)", async () => {
    const key = await generateSigningKey();
    const credential = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential"] };
    const jwt = await signAttached(credential, key, { typ: "vc+jwt", cty: "vc", kid: "https://issuer.example/k#1" });
    const [h, p] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "EdDSA",
      kid: "https://issuer.example/k#1",
      typ: "vc+jwt",
      cty: "vc",
      jwk: key.publicJwk,
    });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual(credential);
    expect(verifyWithNode(jwt, "").valid).toBe(true);
  });
});

describe("handleSignatureRequest", () => {
  let key: SigningKey;
  beforeAll(async () => {
    key = await generateSigningKey();
  });

  it("404 application/json when the publisher has no key (draft: means only 'does not sign')", async () => {
    const r = await handleSignatureRequest(demoPublisher(), {});
    expect(r.status).toBe(404);
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual({ status: 404, error: "this publisher does not sign its document" });
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("200 application/jose over the identical bytes handleRequest serves, with correlated ETag", async () => {
    const publisher = demoPublisher();
    const opts = { signingKey: key, maxAge: 3600 };
    const doc = await handleRequest(publisher, {}, opts);
    const sig = await handleSignatureRequest(publisher, opts);
    expect(sig.status).toBe(200);
    expect(sig.headers["Content-Type"]).toBe(JOSE_MEDIA_TYPE);
    expect(sig.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(sig.headers["Cache-Control"]).toBe("public, max-age=3600");
    expect(sig.headers["Content-Length"]).toBe(String(Buffer.byteLength(sig.body)));
    expect(sig.headers.ETag).toBe(signatureEtag(doc.headers.ETag));
    expect(sig.headers.ETag).toMatch(/^"[0-9a-f]{40}\+jws"$/);
    expect(verifyWithNode(sig.body, doc.body).valid).toBe(true);
    // The signature is over the served string, not a re-serialization.
    expect(verifyWithNode(sig.body, JSON.stringify(JSON.parse(doc.body))).valid).toBe(false);
  });

  it("304 on a matching If-None-Match for the signature's own ETag", async () => {
    const publisher = demoPublisher();
    const first = await handleSignatureRequest(publisher, { signingKey: key });
    const second = await handleSignatureRequest(publisher, { signingKey: key }, first.headers.ETag);
    expect(second.status).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.ETag).toBe(first.headers.ETag);
    const weak = await handleSignatureRequest(publisher, { signingKey: key }, `W/${first.headers.ETag}`);
    expect(weak.status).toBe(304);
  });

  it("reuses one signature per document generation and re-signs when the document changes", async () => {
    let period = "2026-01";
    const adapter: SourceAdapter = {
      name: "mutable",
      capabilities: "basic",
      async fetch(): Promise<RawMetrics> {
        const inner = computedAdapter({
          provider: "Example Corp",
          methodologyUri: "https://example.com/m",
          reportingPeriod: period,
          energy: { value: 10, unit: "kWh" },
          gridIntensity: 100,
        });
        return (await inner.fetch({})) as RawMetrics;
      },
    };
    const publisher = new Publisher(adapter, { cacheTtlMs: 0, normalize: { target: "example.com" } });
    const es = await generateSigningKey("ES256"); // randomized signatures: cache reuse is observable
    const a = await handleSignatureRequest(publisher, { signingKey: es });
    const b = await handleSignatureRequest(publisher, { signingKey: es });
    expect(a.status).toBe(200);
    expect(a.body).toBe(b.body);
    period = "2026-02";
    const c = await handleSignatureRequest(publisher, { signingKey: es });
    expect(c.headers.ETag).not.toBe(a.headers.ETag);
    const doc = await handleRequest(publisher, {}, { signingKey: es });
    expect(verifyWithNode(c.body, doc.body).valid).toBe(true);
    expect(verifyWithNode(a.body, doc.body).valid).toBe(false);
  });

  it("maps no-data and upstream failure like the document handler (404 / 503)", async () => {
    const noData = new Publisher(
      { name: "none", capabilities: "basic", async fetch() { throw new NotFoundError(); } },
      { cacheTtlMs: 0 },
    );
    expect((await handleSignatureRequest(noData, { signingKey: key })).status).toBe(404);
    const broken = new Publisher(
      { name: "broken", capabilities: "basic", async fetch() { throw new Error("upstream down"); } },
      { cacheTtlMs: 0 },
    );
    const r = await handleSignatureRequest(broken, { signingKey: key, onError: () => {} });
    expect(r.status).toBe(503);
  });
});

describe("standalone server route", () => {
  let signed: { base: string; close: () => Promise<void> };
  let unsigned: { base: string; close: () => Promise<void> };

  beforeAll(async () => {
    const key = await generateSigningKey();
    signed = await listen(createSustainabilityServer(demoPublisher(), { signingKey: key }));
    unsigned = await listen(createSustainabilityServer(demoPublisher()));
  });
  afterAll(async () => {
    await signed.close();
    await unsigned.close();
  });

  it("serves GET/HEAD/304/405 on the signature path and verifies over the wire bytes", async () => {
    const doc = await fetch(`${signed.base}/.well-known/sustainability-data`);
    const bytes = new Uint8Array(await doc.arrayBuffer());
    const sig = await fetch(`${signed.base}${SIGNATURE_PATH}`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get("content-type")).toBe(JOSE_MEDIA_TYPE);
    const jws = await sig.text();
    expect(verifyWithNode(jws, bytes).valid).toBe(true);

    const head = await fetch(`${signed.base}${SIGNATURE_PATH}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(JOSE_MEDIA_TYPE);
    expect(await head.text()).toBe("");

    const cond = await fetch(`${signed.base}${SIGNATURE_PATH}`, {
      headers: { "if-none-match": sig.headers.get("etag")! },
    });
    expect(cond.status).toBe(304);

    const post = await fetch(`${signed.base}${SIGNATURE_PATH}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("is 404 (not 405) on a non-signing server, including for POST", async () => {
    const r = await fetch(`${unsigned.base}${SIGNATURE_PATH}`);
    expect(r.status).toBe(404);
    const post = await fetch(`${unsigned.base}${SIGNATURE_PATH}`, { method: "POST" });
    expect(post.status).toBe(404);
  });
});

describe("Express middleware route", () => {
  let srv: { base: string; close: () => Promise<void> };
  beforeAll(async () => {
    const key = await generateSigningKey("ES256");
    const app = express();
    app.use(expressSustainability(demoPublisher(), { signingKey: key }));
    srv = await listen(app);
  });
  afterAll(async () => srv.close());

  it("serves the detached JWS and 405s other methods", async () => {
    const doc = await (await fetch(`${srv.base}/.well-known/sustainability-data`)).arrayBuffer();
    const sig = await fetch(`${srv.base}${SIGNATURE_PATH}`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get("content-type")).toBe(JOSE_MEDIA_TYPE);
    const { header, valid } = verifyWithNode(await sig.text(), new Uint8Array(doc));
    expect(valid).toBe(true);
    expect(header.alg).toBe("ES256");
    expect((await fetch(`${srv.base}${SIGNATURE_PATH}`, { method: "PUT" })).status).toBe(405);
  });

  it("falls through (404) when no key is configured", async () => {
    const app = express();
    app.use(expressSustainability(demoPublisher()));
    const plain = await listen(app);
    try {
      expect((await fetch(`${plain.base}${SIGNATURE_PATH}`)).status).toBe(404);
    } finally {
      await plain.close();
    }
  });
});

describe("Fastify plugin route (route seam)", () => {
  const makeReply = () => {
    const r: any = {
      statusCode: 0,
      headerBag: {} as Record<string, string>,
      sentBody: "",
      code(c: number) {
        r.statusCode = c;
        return r;
      },
      headers(h: Record<string, string>) {
        Object.assign(r.headerBag, h);
        return r;
      },
      send(b?: string) {
        r.sentBody = b ?? "";
        return r;
      },
    };
    return r;
  };

  it("registers the signature route only with a key, and answers GET/HEAD/405", async () => {
    const key = await generateSigningKey();
    const routes = new Map<string, any>();
    const fake = {
      get(path: string, h: any) { routes.set(path, h); },
      route(o: { url: string; handler: any }) { routes.set(o.url, o.handler); },
    };
    const publisher = demoPublisher();
    await fastifySustainability(fake as any, { publisher, signingKey: key });
    expect(routes.has(SIGNATURE_PATH)).toBe(true);

    const docReply = makeReply();
    await routes.get("/.well-known/sustainability-data")({ headers: {}, query: {} }, docReply);
    const sigReply = makeReply();
    await routes.get(SIGNATURE_PATH)({ method: "GET", headers: {} }, sigReply);
    expect(sigReply.statusCode).toBe(200);
    expect(sigReply.headerBag["Content-Type"]).toBe(JOSE_MEDIA_TYPE);
    expect(verifyWithNode(sigReply.sentBody, docReply.sentBody).valid).toBe(true);

    const headReply = makeReply();
    await routes.get(SIGNATURE_PATH)({ method: "HEAD", headers: {} }, headReply);
    expect(headReply.statusCode).toBe(200);
    expect(headReply.sentBody).toBe("");

    const postReply = makeReply();
    await routes.get(SIGNATURE_PATH)({ method: "POST", headers: {} }, postReply);
    expect(postReply.statusCode).toBe(405);
    expect(postReply.headerBag.Allow).toBe("GET, HEAD");

    const noKey = new Map<string, any>();
    await fastifySustainability(
      { get(p: string, h: any) { noKey.set(p, h); } } as any,
      { publisher: demoPublisher() },
    );
    expect(noKey.has(SIGNATURE_PATH)).toBe(false);
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
    await expect(runKeygen(["--alg", "RS256"], capture().stream)).rejects.toThrow(/EdDSA or ES256/);
    await expect(runKeygen(["--bogus"], capture().stream)).rejects.toThrow(/unknown argument/);
  });

  it("sign produces a detached JWS over the file's exact bytes", async () => {
    const keyFile = join(dir, "sign.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const docFile = join(dir, "doc.json");
    const bytes = '{\r\n  "version": "2.0",  "target": "example.com"\r\n}\r\n';
    writeFileSync(docFile, bytes);
    const out = capture();
    await runSign([docFile, "--key", keyFile], out.stream);
    const jws = out.text().trim();
    expect(verifyWithNode(jws, bytes).valid).toBe(true);
    expect(verifyWithNode(jws, bytes.replace(/\r/g, "")).valid).toBe(false);

    const noJwk = capture();
    await runSign([docFile, "--key", keyFile, "--no-jwk"], noJwk.stream);
    const header = JSON.parse(Buffer.from(noJwk.text().split(".")[0], "base64url").toString());
    expect(header).not.toHaveProperty("jwk");
    await expect(runSign(["--key", keyFile], capture().stream)).rejects.toThrow(/document file is required/);
    await expect(runSign([docFile], capture().stream)).rejects.toThrow(/--key/);
  });

  it("loadSigningKey prefers the environment variable over the config file, and is undefined without either", async () => {
    const keyFile = join(dir, "load.jwk");
    await runKeygen(["--out", keyFile], capture().stream);
    const fileKid = JSON.parse(readFileSync(keyFile, "utf8")).kid;
    const envKey = await generateSigningKey();
    const config = { adapter: { type: "computed", options: {} }, server: { signingKeyFile: keyFile } };
    expect((await loadSigningKey(config, {}))!.kid).toBe(fileKid);
    const envJwk = JSON.stringify(await exportPrivateJwk(envKey));
    expect((await loadSigningKey(config, { SUSTAINABILITY_SIGNING_KEY: envJwk }))!.kid).toBe(envKey.kid);
    expect(await loadSigningKey({ adapter: { type: "computed", options: {} } }, {})).toBeUndefined();
    await expect(loadSigningKey(config, { SUSTAINABILITY_SIGNING_KEY: "{}" })).rejects.toThrow(/unsupported key type/);
  });
});
