/**
 * Shared test options.
 *
 * Every fixture server in this suite is a plain `node:http` server on
 * `http://127.0.0.1:<ephemeral port>` — there is no TLS in the test rig, and
 * spinning one up would buy nothing the tests are actually about. Since -06
 * the client refuses a non-HTTPS retrieval by default (draft §Mandatory
 * Minimum Supported Service: clients MUST NOT accept a document retrieved
 * over unauthenticated HTTP), so the local-origin tests opt out explicitly.
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
 * Since the address check of draft -07 §Consumer Considerations landed, a fetch
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
