import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

/**
 * Shared test options.
 *
 * Every fixture server in this suite is a plain `node:http` server on
 * `http://127.0.0.1:<ephemeral port>` — there is no TLS in the test rig, and
 * spinning one up would buy nothing the tests are actually about. Since -06
 * the client refuses a non-HTTPS retrieval by default (draft -10 §Location and
 * Transport: a declaration MUST be retrieved over HTTPS), so the local-origin tests opt out explicitly.
 *
 * It lives here, in ONE place, rather than as `{ allowInsecure: true }`
 * sprinkled across ~50 call sites: the refusal is the specified behaviour, and
 * the opt-out should be as visible and as easy to remove as a single import.
 * The tests that exercise the refusal itself deliberately do NOT use it.
 */
export const ALLOW_INSECURE = { allowInsecure: true } as const;

/**
 * A deterministic stand-in for the address lookup (`AddressLookup`).
 *
 * Since the address check of draft -10 §Security Considerations landed, a fetch
 * of a host name resolves it before the request. The fixtures in this suite use
 * names nobody owns (`asked.example`, `d.example`) with a stand-in `fetchImpl`,
 * so leaving the system resolver in place would make the suite depend on live
 * DNS — slow, offline-hostile and non-deterministic — to answer a question the
 * test is not about. This pins every name to one public address instead.
 *
 * Tests that ARE about the check inject their own (see the SSRF block in
 * transport.test.ts), and tests against `127.0.0.1` fixtures need none: they
 * pass ALLOW_INSECURE, which covers the loopback exemption too.
 */
export const PUBLIC_LOOKUP = { lookup: async () => ["93.184.216.34"] as const } as const;

/**
 * The test certificates of `fixtures/tls` (regenerate with `make-fixtures.sh`):
 * a test CA (`ca.pem`) that signs `good` (names good.test), `wrong-host`
 * (names other.test), `expired` (ended 2020-01-02), an intermediate and a leaf
 * `chained` below it; `untrusted` is signed by another CA, `self-signed` by
 * itself. Every private key is a test key kept beside its certificate.
 */
export const tlsFixture = (name: string): string => readFileSync(resolve(process.cwd(), "test", "fixtures", "tls", name), "utf8");

/** The test CA, as PEM: pass it as `ca` to trust the certificates it signed. */
export const TEST_CA = tlsFixture("ca.pem");

/** A TLS server on 127.0.0.1 presenting the fixture `name` (the leaf, and for `chained` the intermediate too). */
export async function listenTls(name: string, handler: RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const cert = name === "chained" ? tlsFixture("chained.pem") + tlsFixture("intermediate.pem") : tlsFixture(`${name}.pem`);
  const server = createHttpsServer({ key: tlsFixture(`${name}-key.pem`), cert }, handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
