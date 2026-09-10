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
