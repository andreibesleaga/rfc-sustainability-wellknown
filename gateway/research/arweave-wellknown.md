# Arweave gateways vs `/.well-known/sustainability-data`: dot-path handling & Content-Type evidence

Companion to [web3-hosting.md](./web3-hosting.md), which documents the live deployment
(`https://arweave.net/dOGjomM0KdV9AR7aRCd6gmNhjpRVJHrfsMwg3EABsgU/.well-known/sustainability-data`
→ 200 `application/json`). This file answers the narrower question: **is there any dot-path
restriction in Arweave manifests or in gateway implementations, and does the returned
Content-Type really come from the target transaction's tag?** Method: survey of 598 real
on-chain manifests + differential HTTP probes (dot path vs non-dot control, same manifest,
same gateway). All measurements 2026-07-28/29.

## Verdict

**Yes — an extensionless dot-directory path serves with exact `Content-Type: application/json`.**
No dot-path restriction exists in the manifest spec, in arweave.net, or in ar.io-node.
Every 404 observed on dot paths was reproduced identically on non-dot control paths in the
same manifest and traced to **target-data retrievability** on that gateway, not path shape.

## 1. Spec: paths are arbitrary strings, no leading-dot rule

- Path manifest schema ([ArweaveTeam/arweave/doc/path-manifest-schema.md](https://github.com/ArweaveTeam/arweave/blob/master/doc/path-manifest-schema.md)):
  `manifest: "arweave/paths"`, tx tag `Content-Type: application/x.arweave-manifest+json`,
  `paths` maps subpath strings → `{id: <txid>}`. **No restrictions on path naming are specified.**
- v0.2.0 ([docs.ar.io/build/upload/manifests](https://docs.ar.io/build/upload/manifests)) adds
  `fallback: {id}` (404 substitute) and `index: {path|id}`. Both versions live on-chain today:
  of 598 valid manifests sampled via GraphQL (newest first), **388 were v0.2.0, 210 v0.1.0; 135 declared a fallback**.
- Dot-prefixed segments occur in the wild: sampled manifests contain `.git/config`, `.gitattributes`,
  `.permaweb-deploy/transaction-cache.json`, `.last_build_id`, `assets/*/.gitkeep` — including
  **leading-dot extensionless** keys (`.last_build_id`). Real deploy tooling (permaweb-deploy) emits them.

## 2. arweave.net (legacy gateway, CDN77-fronted): dot paths PASS

`GET https://arweave.net/<manifest>/<path>` 302-redirects to a sandbox subdomain
(`<base32(txid)>.arweave.net/...`) then serves 200 — follow redirects. Measured final responses:

| Manifest / path | Result |
|---|---|
| `gv-nWQqq.../.permaweb-deploy/transaction-cache.json` | **200 `application/json`** (227 B) |
| `k5lFQFKI.../.git/config` | 200 `text/plain; charset=utf-8` |
| `hiMlJMKz.../.last_build_id` (leading-dot, extensionless) | 200 `application/octet-stream` |
| `OEzleaos.../DCMS_v3.22.1/.last_build_id` (nested) | 200 `application/octet-stream` |
| `gj_Sf6Le.../assets/backgrounds/.gitkeep` | 200 `application/octet-stream` (0 B) |
| control: nonexistent path on a fallback-manifest | fallback tx served (200) |
| **live deployment** `dOGjomM0.../.well-known/sustainability-data` | **200 `application/json`** (177 B) |

## 3. Content-Type provably comes from the TARGET transaction's tag

For the `.git/config` and `about` cases above, GraphQL
(`arweave.net/graphql`, `transactions(ids:[...]){tags}`) shows the target txs tagged
`Content-Type: text/plain; charset=utf-8` / `text/html; charset=utf-8` — byte-identical to the
HTTP header returned via the manifest path. Target tagged `application/octet-stream` → header
`application/octet-stream`. **The gateway echoes the target tx's own Content-Type tag; nothing is
inferred from the (extensionless) path.** This is the structural advantage over IPFS gateways
(which sniff/extension-guess; see web3-hosting.md §2).

## 4. ar.io-node gateways (ar-io.dev, permagate.io): no dot restriction — but retrieval is flaky

Differential probes on the *same* manifests:

- Initial result: dot paths 404 on ar-io.dev/permagate.io while arweave.net served them.
  **Control paths (non-dot: `LICENSE`, `config.json`, `index.html`, `assets/*.js`) 404'd
  identically on the same gateways** — so the failure is not dot-specific.
- Isolation on ar-io.dev, manifest `gv-nWQqq...` (manifest itself fetchable: `/raw/` → 200
  `application/x.arweave-manifest+json`):
  - direct `GET /<target-of-.permaweb-deploy-path>` → **200 `application/json`**
  - direct `GET /<target-of-index.html>` and `<target-of-assets/*.js>` → 404 (chunks not retrievable there)
  - via manifest: `/gv-.../.permaweb-deploy/transaction-cache.json` → **200 `application/json` (227 B)**,
    while `/gv-.../index.html` → 404.
  - i.e. **the dot path resolves and the non-dot path fails — 404s track target-data
    availability on that node, never path shape.**
- Live deployment cross-check: `/dOGjomM0.../.well-known/sustainability-data` →
  **permagate.io 200 `application/json`**, arweave.net 200, ar-io.dev 404 (same retrieval flakiness;
  the identical URL works on its peers).
- Practical caveat: community ar.io gateways showed frequent 404s/timeouts for recently-uploaded
  or thinly-replicated data. arweave.net was the most consistently able to serve everything tested.
  URL-encoding the dot (`%2Egitkeep`) is not treated specially (404 both ways when data missing) —
  use the literal dot.

## 5. Remaining confirmations (citations)

- **Content-Type tag honored on GET /<txid>**: verified empirically (§2/§3) and documented at
  [docs.ar.io/build/upload/manifests](https://docs.ar.io/build/upload/manifests) (tag on the upload tx, not in JSON).
  ([cookbook.arweave.dev](https://cookbook.arweave.dev/concepts/manifests.html) DNS-timed-out from this network — content mirrored by docs.ar.io. UNVERIFIED as a live URL today.)
- **Turbo free tier**: "Uploads under 100 KiB are completely free and do not require a prior top up"
  — [docs.ar.io/build/upload/turbo-credits](https://docs.ar.io/build/upload/turbo-credits); no payment
  method, no account, and (per [turbo-sdk README](https://github.com/ardriveapp/turbo-sdk)) no signature
  required under 100 KiB. Proven by the sibling's zero-balance-wallet deployment (web3-hosting.md §3).
  Turbo uploads manifests fine (our manifest went up through Turbo); CLI has folder+manifest support
  (`turbo upload-folder`, SDK `uploadFolder` generates the manifest). Exact CLI flag name UNVERIFIED here.
- **ArNS**: names resolve as a subdomain on *every* ar.io gateway (`<name>.arweave.net`,
  `<name>.ar.io`, `<name>.ar-io.dev`, `<name>.permagate.io` — all four verified 200 for `ardrive`,
  with `x-arns-name`/`x-arns-resolved-id` headers; undername limit header showed 100). Subpaths under
  a name route through the name's target manifest, so
  `https://<name>.<gateway>/.well-known/sustainability-data` works wherever §4's manifest resolution
  works — mechanism verified; not end-to-end tested on a name we own (no ArNS name purchased).
  Pricing in ARIO by name length, lease vs permabuy (web3-hosting.md §3: ~2,500 ARIO 5-char lease
  tier); UNVERIFIED beyond that figure here.
- **Custom domains**: ar.io gateway operators can serve ArNS under their own domain; for a
  single site, CNAME-to-gateway + `arweavetx` TXT record per web3-hosting.md — third-party TLS
  caveat applies. UNVERIFIED empirically.
- **arweave.net in 2026**: alive and the most reliable single endpoint tested (CDN77-fronted,
  302-sandbox behavior). The ar.io network is the decentralized successor and its docs are now the
  canonical spec host, but arweave.net remains the recommended default URL for a draft citation.

## Bottom line for the RFC

Cite the arweave.net form. An extensionless `/.well-known/sustainability-data` under a path
manifest is fully within spec, resolves on legacy and ar.io-node gateways alike, and returns the
uploader-controlled `Content-Type: application/json` header taken from the data transaction's tag.
The only operational risk is per-gateway data retrievability (mitigate: fetch once through the
target gateway to warm it, or pin to arweave.net).
