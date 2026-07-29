# Web3 hosting & attestation paths for `/.well-known/sustainability-data`

Research date: 2026-07-28/29. Method: primary docs plus **direct empirical verification with curl**
(every Content-Type verdict below was measured live, not inferred). The constraint under test:
the path is extensionless, so the serving layer must produce `Content-Type: application/json`
without a `.json` extension to lean on.

**Headline result: a live, working deployment was made on Arweave during this research (free, ~2 min):**

```
https://arweave.net/dOGjomM0KdV9AR7aRCd6gmNhjpRVJHrfsMwg3EABsgU/.well-known/sustainability-data
→ HTTP 200, Content-Type: application/json          (verified 2026-07-28)
```

Manifest tx `dOGjomM0KdV9AR7aRCd6gmNhjpRVJHrfsMwg3EABsgU`, data tx
`xWEIApGOWMcN5F416FmKk2MoO95gWcvyf4nxBZ2hSc0`, mined in L1 bundle
`iwxmpaMA4vCEnKNSxugI72n0-2SrdZUbEVFKPxPmxd8` at Arweave block 1,968,312.
Also verified serving on an independent ar.io gateway (`vilenarios.com`, 200 `application/json`).
Uploaded with a freshly generated zero-balance wallet via ArDrive Turbo's free <100 KiB tier —
total cost $0, no account, no faucet.

---

## 1. Ranked verdicts (time-to-live × IETF credibility)

| Rank | Path | Extensionless C-T verdict | Time to live | Cost |
|---|---|---|---|---|
| 1 | **Arweave manifest + Turbo** | **PASS — exact `Content-Type` tag honored** (proven live, above) | ~10 min (done) | Free <100 KiB |
| 2 | **IPFS (any pinning svc + gateway)** | **CONDITIONAL PASS — by content sniffing**, not metadata (see caveats) | ~30 min | Free tiers exist |
| 3 | **ENS + eth.limo over IPFS** | Same sniffing behavior as IPFS + name cost | days (name + contenthash) | ≥$5/yr + gas |
| 4 | ArNS name on ar.io gateways | PASS for content; **name costs real ARIO**; free `_arlink` undername route exists | hours | 2,500 ARIO for 5-char lease-tier name (see §3) |
| — | RPC providers / explorers | **FAIL — cannot serve static paths at all** (verified) | n/a | n/a |

Attestation (`verifiable-attestation-uri`): **EAS on Base / Base Sepolia** is the fastest credible
on-chain path (§5). **Chainlink Functions is sunset as of June 30, 2026 — do not cite it** (§6).
Flare FDC Web2Json is the live oracle-style option but mainnet requires URL whitelisting (§6).
W3C VC 2.0 became a full **W3C Recommendation on 15 May 2025** — the strongest standards citation (§7).

---

## 2. IPFS — works, but only via content sniffing (empirically verified)

**UnixFS does not store MIME types.** The IPFS Path Gateway spec says gateways *"SHOULD perform
content type sniffing based on file name (from url path, or optional `filename` parameter) and
magic bytes"* (https://specs.ipfs.tech/http-gateways/path-gateway/). There is no per-file
Content-Type metadata anywhere in UnixFS/IPLD.

Measured behavior (2026-07-28), extensionless files:

| Payload shape | ipfs.io | dweb.link | w3s.link | Pinata gw | Filebase gw |
|---|---|---|---|---|---|
| `{...}` JSON object (compact or pretty, incl. JSON-LD `@context`) | `application/json` | `application/json` | `application/json` | `application/json` | `application/json` |
| `[...]` top-level array | `application/json` | — | — | — | — |
| Leading whitespace/newline before `{` | `application/json` | — | — | — | — |
| **UTF-8 BOM then `{`** | **`text/plain`** | **`text/plain`** | **`text/plain`** | **`text/plain`** | **`text/plain`** |
| Bare number / bare string (valid JSON!) | `text/plain` | — | — | — | — |
| Plain-text control file | `text/plain` | — | — | — | — |

So: a sustainability-data document whose body starts with `{` **will** be served as
`application/json` by every major gateway tested — the sniffer all these gateways share
(Kubo/rainbow's `mimetype` detection) recognizes object/array JSON. But this is
**emergent behavior, not a contract**: the spec only says "SHOULD sniff", a BOM breaks it, and a
top-level scalar (legal JSON) breaks it. For the draft, IPFS should be described as *workable in
practice but not guaranteed by specification* — exactly the kind of honest caveat an ISE reviewer
will respect.

Escape hatch (verified): appending `?filename=x.json` forces
`Content-Type: application/json` + a `Content-Disposition` on ipfs.io — but that changes the URL,
so it can't rescue the bare well-known path.

Other verified facts:
- Dot-directories are fine: DAG traversal is literal; `/ipfs/<cid>/.well-known/...` resolves
  (the 404 on vitalik.eth's CID was "no link named .well-known", i.e. traversal works, entry absent).
- `?format=json` means DAG-JSON codec re-encoding (`application/vnd.ipld.raw` seen for
  `?format=raw`), **not** a Content-Type override — per the same path-gateway spec.
- ipfs.io / dweb.link: operating (200s throughout). dweb.link 301s to subdomain-style
  `<cid>.ipfs.dweb.link` (CIDs >63 chars fail DNS label limits there — irrelevant for normal CIDv1).
- Cloudflare's cloudflare-ipfs.com gateway was deprecated/shut down (announced sunset Aug 2024);
  it no longer serves content. UNVERIFIED beyond community reports — do not cite Cloudflare as a gateway.
- Free pinning tiers (from provider pages, mid-2026 — re-check before publishing exact numbers):
  Pinata free ~1 GB / 500 files + gateway bandwidth caps (custom domains are paid);
  Filebase free 5 GB (S3-compatible API — but its IPFS gateway still sniffs; S3 metadata does
  **not** carry through to `/ipfs/` paths, verified above); 4EVERLAND free tier with
  hosting; Storacha (web3.storage successor) free ~5 GB; Fleek free hosting tier. Infura IPFS is
  restricted to pre-qualified customers (public gateway deprecated 2022). QuickNode IPFS: free
  tier with 1 dedicated gateway (https://www.quicknode.com/ipfs).
  Treat all these numbers as UNVERIFIED-precise; the Content-Type behavior is what was tested.

## 3. Arweave — the clean pass (live deployment)

Why it's structurally better: **Arweave transactions carry an explicit `Content-Type` tag and
gateways return it verbatim** — verified both on third-party txs (a tx tagged `application/json`
served as `application/json` by arweave.net) and on our own deployment. MIME type is *data*, not
inference.

Path manifests (`application/x.arweave-manifest+json`, spec version 0.2.0) map arbitrary path
strings → txids. **Dot-prefixed nested paths work**: our manifest's single entry is literally
`".well-known/sustainability-data"` and the gateway resolves
`/<manifest-txid>/.well-known/sustainability-data`, returning the *target tx's* Content-Type tag.
Also set as manifest `index`, so the bare manifest URL serves the same document.

Deploy recipe (reproduced end-to-end, ~10 min, $0):
1. `npm install @ardrive/turbo-sdk arweave`
2. Generate a throwaway JWK (`arweave.wallets.generate()`) — no funds needed.
3. `turbo.uploadFile()` the JSON with tag `Content-Type: application/json`.
4. Upload a 0.2.0 path manifest with tag `Content-Type: application/x.arweave-manifest+json`
   pointing `.well-known/sustainability-data` at the data txid.
5. Wait ~1–3 min for bundling/indexing; permanent thereafter (pay-once model; here, free).

Free tier: Turbo SDK README — "For free uploads under 100 KiB … does not require a signature"
(https://github.com/ardriveapp/turbo-sdk, §"free upload"); ar.io docs "Files under 100 KiB upload
free" (https://docs.ar.io/SKILL.md). A sustainability-data doc is ~1–10 KB → permanently free.

Names & domains (https://docs.ar.io/SKILL.md, docs.ar.io/llms-full.txt):
- ArNS names resolve as subdomains on **every** ar.io gateway: `https://<name>.ar.io`,
  `<name>.arweave.net`, `<name>.turbo-gateway.com` (verified: `ardrive.ar.io` etc. serve 200, and
  arbitrary subpaths under a name resolve through the name's manifest — our txid-path form
  verified on turbo-gateway.com). Undernames use `_` (`docs_name.ar.io`), 10 free per name.
- Pricing (genesis base fees, ARIO token on Solana): 5-char 2,500 ARIO, 6-char 1,500 ARIO,
  cheaper for longer; lease (1–5 yr) or permabuy. Not free.
- **Free named option**: Arlink (https://arlink.ar.io) gives free `yourname_arlink.ar.io`
  undernames with GitHub-connected deploys (10 MB cap) — verified the `arlink` ArNS name resolves.
- Custom domain: CNAME to a gateway + `arweavetx` TXT record naming the txid
  (docs.ar.io "Browser Sandboxing"/gateway docs) — supported, but depends on the gateway operator's
  TLS; simplest credible story remains the arweave.net URL.
- Caveat for the draft: `arweave.net/<txid>` 302-redirects to a sandbox subdomain
  (`<base32>.arweave.net`) before serving 200 — fine for fetchers that follow redirects, worth a
  sentence if cited.

## 4. ENS + eth.limo / eth.link

- eth.limo is operating (verified: `vitalik.eth.limo` 200, `server: eth.limo`, resolves ENS
  contenthash → IPFS and **does resolve arbitrary subpaths** against the CID — our
  `.well-known/...` probe reached UnixFS traversal). eth.link also currently serves (200) —
  operated by the eth.limo team since 2022. Content-Type behavior is inherited from the IPFS
  layer → same sniffing verdict as §2 (JSON object body ⇒ `application/json`, UNVERIFIED for
  eth.limo specifically since no test name with a JSON payload was available; the proxy passes
  gateway headers through).
- Costs: .eth registration $5/yr (5+ chars), $160/yr (4), $640/yr (3) — ENS docs; plus L1 gas for
  registration + `setContenthash` (~$5–30 depending on gas). ENSv2/Namechain (ENS L2) was still
  pre-mainnet as of research cutoff — UNVERIFIED status mid-2026; don't cite it as live.
  Offchain/CCIP-Read subnames (NameStone etc.) are free but eth.limo contenthash resolution for
  them is UNVERIFIED.
- Verdict: works, credible (ENS is well-known to reviewers), but slowest and the only path with
  unavoidable real cost; it adds nothing over §2/§3 for the Content-Type story.

## 5. RPC providers & explorers — plain FAIL (as expected, verified)

None can serve arbitrary static HTTP paths. Measured:
`mainnet.base.org/.well-known/...` → 405; `base-rpc.publicnode.com` → 404 (JSON-RPC error body);
`cloudflare-eth.com` → 404; `rpc.ankr.com/eth/...` → 404; `etherscan.io/.well-known/...` → 302 to
their app; `eth.blockscout.com/...` → 404 SPA shell. Infura/Alchemy/QuickNode sell JSON-RPC and
adjacent APIs only (docs.infura.io product list; Alchemy has no hosting product — its site refers
storage to Pinata). **Do not** present RPC infrastructure as a hosting option in the draft.

## 6. Attestation: EAS (recommended) and oracles

**EAS** — live and healthy across Ethereum, Optimism, Base, Arbitrum One/Nova, Polygon, Scroll,
zkSync, Celo, Blast, Linea + Sepolia/OP Sepolia/Base Sepolia/Polygon Amoy/Scroll Sepolia
(contracts doc: github.com/ethereum-attestation-service/eas-docs-site, canonical docs
docs.attest.org). Key addresses: mainnet EAS `0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587`;
Base & Base Sepolia EAS at the OP-stack predeploy `0x4200000000000000000000000000000000000021`;
Sepolia `0xC2679fBD37d54388Ce493F1DB75320D236e1815e`. All ten EASScan explorers probed return 200
(easscan.org + base/optimism/arbitrum/sepolia/base-sepolia/optimism-sepolia/linea/celo/scroll
subdomains); Sepolia registry holds 4,396 schemas (GraphQL, live).

Concrete path for the draft:
1. On `base-sepolia.easscan.org` → "Create Schema": e.g.
   `bytes32 documentHash, string documentURI, uint64 periodStart, uint64 periodEnd`.
2. "Make Attestation" against that schema (docHash = SHA-256 of the sustainability-data doc,
   docURI = the well-known URL or Arweave URL).
3. Resulting stable URI: `https://base-sepolia.easscan.org/attestation/view/0x<uid>` — format
   confirmed against live attestations pulled from base.easscan.org GraphQL (e.g. UID
   `0xb1f1c55e702ef5b83335aeeaa36fd9286447ddacd6542f2bbb610c22a3219939` on Base).
4. Offchain variant: EIP-712-signed, gasless; storable on IPFS or as URL-fragment payloads, with
   the attestation UID optionally **timestamped on-chain** for verifiability (docs
   onchain-vs-offchain page, fetched from the eas-docs-site repo). Offchain fragment URLs are
   long and explorer-dependent — for a `verifiable-attestation-uri` example, prefer the onchain
   `/attestation/view/` form.
Cost: Base Sepolia free (faucets: Coinbase CDP, Alchemy, QuickNode, Google Cloud, pk910 — most
now gate on sign-in and/or small mainnet balance; exact 2026 gating per-faucet UNVERIFIED). Base
mainnet attestation ≈ cents. Production credibility: Coinbase Verifications and Optimism/Gitcoin
ecosystems use EAS (widely documented; specific 2026 citations UNVERIFIED at depth).

**Chainlink Functions — DEAD for new work.** docs.chain.link states verbatim: *"Chainlink
Functions sunsets June 30, 2026 (testnet: June 15, 2026)"* — both dates have **passed**.
Successor is the Chainlink Runtime Environment (CRE), which is login-gated (cre.chain.link
redirects to auth). Historical limits for reference only: 256-byte max on-chain return, 5 HTTP
calls, 10 s compute, 2 MB response, 300k callback gas
(https://docs.chain.link/chainlink-functions/resources/service-limits). Do not cite Functions as
a live path in the draft; mention CRE as its successor, availability UNVERIFIED (gated).

**Flare Data Connector, Web2Json** (https://dev.flare.network/fdc/attestation-types/web2-json):
fetches an HTTPS JSON endpoint, applies a restricted jq transform (≤5,000 chars, 500 ms), ABI-encodes
the result, and commits it under an on-chain Merkle root with user-verifiable proofs. Live on
mainnet and testnets, **but on mainnets the source URL must be governance-whitelisted; arbitrary
URLs only on testnets (Coston2)** — the honest framing is "testnet-demonstrable today,
mainnet requires whitelisting." Limits: ≤5,000 JSON keys, nesting ≤10, 5 s HTTP timeout.
UMA's Optimistic Oracle can assert arbitrary claims (dispute-window model) and zkTLS systems
(Reclaim, TLSNotary lineage) can prove HTTPS response contents — both plausible mentions,
maturity for an IETF citation: marginal (details UNVERIFIED at depth this pass).

## 7. W3C Verifiable Credentials — strongest standards citations

Verified directly from w3.org (exact dated URLs — cite these):

| Spec | Status | This-version URL |
|---|---|---|
| VC Data Model 2.0 | **W3C Recommendation, 15 May 2025** | https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/ |
| VC Data Integrity 1.0 | **W3C Recommendation, 15 May 2025** | https://www.w3.org/TR/2025/REC-vc-data-integrity-20250515/ |
| Securing VCs w/ JOSE & COSE | **W3C Recommendation, 15 May 2025** | https://www.w3.org/TR/2025/REC-vc-jose-cose-20250515/ |
| Bitstring Status List 1.0 | **W3C Recommendation, 15 May 2025** | https://www.w3.org/TR/2025/REC-vc-bitstring-status-list-20250515/ |

(EdDSA/ECDSA cryptosuites and CID 1.0 reached Recommendation in the same 2025 cycle —
UNVERIFIED-this-pass for exact dates; check headers before citing.)

So `verifiable-attestation-uri` can point at a VC 2.0 credential with full REC-status backing.
Free issuance this week: self-issue with open-source stacks — walt.id community edition, Veramo,
SpruceID's DIDKit, or Digital Bazaar's libraries — then host the signed VC JSON on the same
Arweave/IPFS surface as the main document (Arweave gives it a permanent URI with correct
Content-Type, per §3). Hosted "free tier" VC platforms are enterprise-gated in practice
(Trinsic pivoted to IDV; Dock rebranded toward Truvera; Entra Verified ID is tenant-bound) —
statuses UNVERIFIED at depth; the self-issue + permaweb-host route avoids all of them.

**EU angle:** ESPR (Regulation (EU) 2024/1781) mandates Digital Product Passports; the Battery
Regulation (2023/1542) battery passport lands Feb 2027. The **UN Transparency Protocol (UNTP,
UN/CEFACT)** explicitly builds its Digital Product Passport / Digital Conformity Credential on
W3C VCs for sustainability claims — a strong informative citation. Note: the UNTP repo moved from
GitHub Pages to UN GitLab (https://opensource.unicc.org/un/unece/uncefact/spec-untp, verified
live; old uncefact.github.io/spec-untp URLs now 404). Reference implementation:
https://untp.showthething.com/. Cite the GitLab URL, not the dead GitHub Pages one.

---

## 8. Recommended this-week plan

1. **Ship the endpoint on Arweave now** — the deployment above already satisfies the draft's
   requirements (extensionless well-known path, exact `application/json`, immutable, multi-gateway).
   Re-run the same 5-step recipe with the real document.
2. **Mirror on IPFS** (Pinata or Storacha free tier) as the "second independent infrastructure"
   data point, documenting the sniffing caveat honestly.
3. **Attest on EAS Base Sepolia** (free) → put the `/attestation/view/0x…` URL in
   `verifiable-attestation-uri`; optionally repeat on Base mainnet for ~cents to show a
   production-network URI.
4. **Cite** VC 2.0 (REC 2025-05-15) and UNTP/ESPR as the standards context; mention Flare
   Web2Json as the oracle-verification direction with its whitelisting caveat; do **not**
   cite Chainlink Functions (sunset 2026-06-30).
