/**
 * The Fastify plugin on a real Fastify instance. Fastify adds `; charset=utf-8`
 * to a string payload's Content-Type on GET but not on HEAD; the registered
 * media type has no parameters, so GET and HEAD must carry the same header.
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { computedAdapter } from "../src/adapters";
import { MEDIA_TYPE } from "../src/media-type";
import { fastifySustainability } from "../src/middleware/fastify";
import { Publisher } from "../src/publisher";

const WELL_KNOWN = "/.well-known/sustainability-data";

function publisher() {
  return new Publisher(
    computedAdapter({
      provider: "Example Corp",
      methodologyUri: "https://example.com/m",
      period: "2026-02",
      energy: { value: 1250, unit: "kWh" },
      gridIntensity: 276,
      capabilities: "extended",
    }),
    { cacheTtlMs: 60_000, representation: "single", normalize: { target: "example.com" } },
  );
}

describe("Fastify plugin (real Fastify)", () => {
  it("serves GET and HEAD with the same Content-Type, without a charset, and the exact body bytes", async () => {
    const pub = publisher();
    const app = Fastify();
    await app.register(fastifySustainability, { publisher: pub });
    const get = await app.inject({ method: "GET", url: WELL_KNOWN });
    const head = await app.inject({ method: "HEAD", url: WELL_KNOWN });
    expect(get.statusCode).toBe(200);
    expect(head.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe(MEDIA_TYPE);
    expect(head.headers["content-type"]).toBe(MEDIA_TYPE);
    expect(get.rawPayload.equals(Buffer.from((await pub.getSerialized()).body, "utf8"))).toBe(true);
    await app.close();
  });

  it("answers 405 and carbon.txt without a charset on the JSON error body", async () => {
    const app = Fastify();
    await app.register(fastifySustainability, { publisher: publisher(), carbonTxt: { sustainabilityUrl: `https://example.com${WELL_KNOWN}` } });
    const post = await app.inject({ method: "POST", url: WELL_KNOWN });
    expect(post.statusCode).toBe(405);
    expect(post.headers["content-type"]).toBe("application/json");
    expect(post.headers.allow).toBe("GET, HEAD");
    const txt = await app.inject({ method: "GET", url: "/carbon.txt", headers: { host: "example.com" } });
    expect(txt.statusCode).toBe(200);
    await app.close();
  });
});
