# fitness — architecture fitness functions

Rules that span packages, documents and the draft, kept as tests so that they cannot drift:

- `http-invariants.test.mjs` starts the built reference gateway in-process (fixed clock, no network)
  and sweeps **every** subject it serves: the full header set on 200, HEAD parity, 304 without a body
  or Content-Length, every error class JSON + nosniff + CORS + Content-Language, and the two 404s a
  privacy rule wants byte-identical.
- `repository-invariants.test.mjs`: no public file points at the private folder; the author's e-mail
  only in the posted drafts; no "chapter n" wording; Node ≥ 22.12 everywhere; the consumer never
  imports the publisher and the gateway reaches both only by package name; every example and served
  data file validates with the shipped consumer; the root README names the publisher's version; the
  two npm packages stay under 1 MB and ship no secret-looking file; unit tests inject their clocks.

Run after building publisher, consumer and gateway: `npm test`.
