# fitness — architecture fitness functions

Rules that span packages, documents and the draft, kept as tests so that they cannot drift. They run against the
built packages (`publisher/dist`, `consumer/dist`, `gateway/dist`) and read files; none uses the network or the wall
clock.

- `http-invariants.test.mjs` starts the built reference gateway in-process (fixed clock `2026-10-17T12:00:00Z`, no
  network, rate limit off) and sweeps **every** subject it serves: the full header set on 200, HEAD parity, 304
  without a body or Content-Length, and a query the gateway cannot read ignored (200, the same body, never 400).
  A range or target that selects nothing is `200` with an empty array. Every error class is JSON + nosniff + CORS +
  Content-Language, and an unknown subject and a withheld one answer with byte-identical `404`s.
- `corpus-invariants.test.mjs` holds the example corpus to its coverage gate: the manifest
  (`schemas-validators/examples/manifest.json`) and the two homes, `schemas-validators/examples/` and
  `example-responses/`, list exactly the same files; every served example is recorded as valid; every value of the
  eight closed token sets and every one of the 26 members occurs in a valid file; in the served set `updated` is not
  before the end of any period; every rule key of the manifest is cited by a scenario.
- `repository-invariants.test.mjs`: no public file points at the private folder; the author's e-mail only in the
  posted drafts; no "chapter n" wording; Node >= 22.13 for every package that loads the publisher or the consumer
  (the SFC checker keeps 22.12); the gateway and the initializer ask for the library versions in this repository;
  the consumer never imports the publisher and the gateway reaches both only by package name; every example and
  served data file validates with the shipped consumer; every signed served example names `Ed25519` or `ES256`, the
  media type in `cty` and a `jwk` with the public key only; the root README names the version of each package, the
  number of served examples and the draft revision the software implements; the two npm packages stay under 1 MB
  and ship no secret-looking file; tests and scenario steps inject their clocks.

Run after building publisher, consumer and gateway (the gateway against the source builds: `bash scripts/overlay-source-libs.sh`): `npm test`.
