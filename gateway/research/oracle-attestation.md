# Oracle paths for attesting `/.well-known/sustainability-data` on-chain

Research for the `verifiable-attestation-uri` member of the IETF draft. All claims cited;
empirical checks run 2026-07-28 via curl/JSON-RPC unless marked UNVERIFIED.

## TL;DR

- **Chainlink Functions is past its announced sunset (2026-06-30) but empirically still fulfilling
  requests on mainnets as of 2026-07-28.** Do not build anything new on it; it is in zombie/wind-down
  state and its successor (CRE) gates deployment behind an "Early Access" approval.
- **Flare Data Connector `Web2Json` is the strongest live, permissionless path today**: it attests an
  *arbitrary* HTTPS JSON endpoint (testnets), applies a jq transform, ABI-encodes the result, and
  anchors it under a Merkle root on-chain with an on-chain-verifiable proof. Verified end-to-end
  reachable this week, including a working `prepareRequest` call against the public testnet verifier.
- On **mainnet** Flare, Web2Json sources require governance whitelisting (currently only one source is
  whitelisted), so a production RFC flow would need either a whitelist proposal or a testnet/Coston2
  framing. zkTLS options (TLSNotary, Reclaim) are the citable *research-grade* alternative.

---

## 1. Chainlink Functions status (resolved)

**Documented sunset.** Every Functions doc page carries the banner (extracted verbatim from the HTML of
https://docs.chain.link/chainlink-functions/resources/service-limits):

> "Chainlink Functions sunsets June 30, 2026 (testnet: June 15, 2026) — Migrate to the Chainlink
> Runtime Environment (CRE), which does everything and more. Migrate your existing subscriptions
> before these dates to avoid service disruption."

Same banner confirmed on https://docs.chain.link/chainlink-functions/getting-started and the CRE
migration guide https://docs.chain.link/cre/reference/clf-migration-ts (which maps
`FunctionsClient`→`IReceiver`, JS source→TS/Go-to-WASM, `Functions.makeHttpRequest()`→
`runtime.http.sendRequest()`, `fulfillRequest()`→`_onReport()`).

**Empirical on-chain reality (JSON-RPC `eth_getLogs` against the Functions Router contracts,
2026-07-28):**

| Network | Router | Last `RequestStart` | Last `RequestProcessed` |
|---|---|---|---|
| Ethereum mainnet | `0x65Dcc24F8ff9e51F10DCc7Ed1e4e2A61e6E14bd6` | 2026-07-23 23:47 UTC | **2026-07-23 23:47 UTC (fulfilled)** |
| Base mainnet | `0xf9B8fc078197181C841c296C876945aaa425B278` | 2026-07-27 23:47 UTC | **2026-07-27 23:47 UTC (fulfilled)** |
| Polygon mainnet | `0xdc2AAF042Aeff2E68B3e8E33F19e4B9fA7C73F10` | none in last ~400k blocks | none |
| Ethereum Sepolia | `0xb83E47C2bC239B3bf370bc41e1459A34b41238D0` | 2026-07-13 (unfulfilled) | **2026-06-17 10:29 UTC — nothing since** |

(Event topics resolved via openchain.xyz signature DB: `RequestStart` =
`0xf67aec45…`, `RequestProcessed` = `0x64778f26…`.)

**Plain statement:** the *testnet* DON stopped fulfilling around the announced 2026-06-15 date —
Sepolia shows a `RequestStart` on 2026-07-13 that was never processed, and `FundsRecovered`
(subscription wind-down) events after that. The *mainnet* DON was still fulfilling requests on
Ethereum and Base within the last five days, i.e. the mainnet shutdown is lagging its announced date.
**Conclusion: you cannot develop or test against Functions this week (testnet is dead), and mainnet is
on borrowed time. Treat Functions as decommissioned for the RFC.** Its service limits (256-byte
return, 5 HTTP calls, 10 s) remain relevant only as historical context.

## 2. Chainlink Runtime Environment (CRE)

Docs: https://docs.chain.link/cre (200 OK).

- **What**: orchestration layer; workflows in TypeScript or Go compiled to WASM, executed across a
  DON with BFT consensus; capabilities include HTTP fetch (`runtime.http.sendRequest()`), EVM
  read/write, Solana write, cron/log triggers, secrets vault
  (https://docs.chain.link/cre/capabilities/http, /cre/capabilities/evm-read-write).
- **Can it fetch an arbitrary HTTPS JSON endpoint and write on-chain?** Yes — that is its core
  use case per the capabilities docs.
- **Availability**: two-tier. Building and **local simulation** (`cre workflow simulate`) is
  "Generally Available … without any approval". **Deployment to a DON is gated**:
  https://docs.chain.link/cre/account/deploy-access — "Deploying workflows to a Chainlink DON
  requires Early Access approval"; you submit a use-case request via `cre account access` or the web
  portal and "the Chainlink team will follow up once your request has been reviewed". No pricing or
  eligibility criteria published; no stated free testnet deployment tier.
- **Usable by an individual developer this week?** For simulation, yes; for actually putting data
  on-chain, **no — not without passing a manual review of unknown latency/criteria**. Honest verdict:
  CRE is not a dependable citation target for a permissionless attestation path today.

## 3. Chainlink faucets

https://faucets.chain.link/ is live (HTTP 200) and lists 70+ testnets (Ethereum Sepolia, Base
Sepolia, Arbitrum Sepolia, Polygon Amoy, Avalanche Fuji, ZKsync Sepolia, Linea Sepolia, …) with drip
amounts shown per network ("Drips 0.5 ETH", "Drips 25 LINK", "Drips 0.5 AVAX" on Fuji). Exact
eligibility gates (mainnet-balance threshold, login, cooldowns) are only shown after wallet
connection and could not be extracted from the public page — **UNVERIFIED beyond the above**.
Historically the faucet required a wallet holding ≥0.001 mainnet ETH or GitHub auth; treat that
detail as UNVERIFIED for 2026. Note testnet LINK is now largely moot for this project since
Functions testnet is dead.

## 4. Chainlink Any API / Data Feeds / Data Streams

- **Any API / Direct Request**: legacy v1 oracle-job model; the docs sitemap still carries
  `chainlink-nodes/oracle-jobs` pages but Chainlink has steered all custom-HTTP use to
  Functions→CRE for years. Requires finding a node operator willing to run your job — not a
  permissionless path. Effectively deprecated for new integrations (banner-level deprecation
  UNVERIFIED; practical deprecation clear from the docs' migration framing).
- **Data Feeds / Data Streams**: publish node-operator-curated *price/market* data
  (https://docs.chain.link/data-feeds, /data-streams). They cannot attest an arbitrary JSON document
  you host; **not relevant** to `/.well-known/sustainability-data` except as prior art for the
  push-oracle pattern.

## 5. Flare Data Connector (FDC) — Web2Json: the strongest live option

Docs (all verified 200): overview https://dev.flare.network/fdc/overview · spec
https://dev.flare.network/fdc/attestation-types/web2-json (note: `web2-json`, not `web-2-json` —
that 404 was a wrong slug) · guide https://dev.flare.network/fdc/guides/hardhat/web2-json · custom-API
guide https://dev.flare.network/fdc/guides/foundry/web2-json-for-custom-api · Solidity interfaces
https://dev.flare.network/fdc/reference/IWeb2Json and /fdc/reference/IWeb2JsonVerification · URL
security notes https://dev.flare.network/fdc/guides/url-parsing-security.

**What it does** (per the spec page): "fetches JSON data from the given URL, applies a jq filter to
transform the returned result, and finally returns the structured data as ABI encoded data."
Request body fields: `url`, `httpMethod` (GET/POST/PUT/PATCH/DELETE), `headers`, `queryParams`,
`body` (all stringified JSON), **`postProcessJq`** (yes — a jq filter, confirming your recollection)
and **`abiSignature`** (primitive type or JSON tuple descriptor). Response: a single
`abiEncodedData` bytes field. Limits: jq must finish in 500 ms, `postProcessJq` ≤ 5000 chars, JSON
≤ 5000 keys and depth ≤ 10, whole HTTP round-trip ≤ 5 s.

**Consensus/proof model** (overview page): attestation providers independently fetch the data, build a
Merkle tree of confirmed attestations per 90-second voting round; when signatures ≥50 % weight are
collected the **Merkle root is stored on-chain via the Relay contract**; the user fetches the response
+ Merkle proof from the Data Availability layer and calls `FdcVerification.verifyWeb2Json(proof)`
on-chain, which checks the proof against the stored root. Fees of confirmed requests go to providers;
unconfirmed-request fees are burnt.

**Arbitrary endpoints — the critical caveat**: per the spec page and the verifier source code
(https://github.com/flare-foundation/verifier-indexer-api,
`src/config/web2/web2-json-sources.ts` / `web2-json-test-sources.ts`, fetched raw from GitHub):

- **Testnets (Coston, Coston2)**: source `PublicWeb2` — "Special source allowing access to any public
  Web2 JSON endpoint without restrictions. Only available on testnets." → an arbitrary
  `/.well-known/sustainability-data` URL works as-is.
- **Mainnet (Flare/Songbird)**: sources must be **whitelisted through governance**; the mainnet config
  currently contains exactly one source (`Ignite`, host `api-proxy.ignitemarket.xyz`). So mainnet
  Web2Json is live infrastructure but **not yet open to arbitrary URLs** — a production deployment
  would need a governance whitelist proposal. The spec page's note "(Currently only on Coston &
  Coston2)" on the overview reflects this.

**Empirical verification (2026-07-28):**

- Testnet verifier `https://fdc-verifiers-testnet.flare.network/verifier/web2/api-doc-json` → 200,
  OpenAPI with `prepareRequest`, `prepareResponse`, `verifyFDC`, `mic` endpoints. Mainnet verifier
  `https://fdc-verifiers-mainnet.flare.network/verifier/web2/api-doc-json` → 200 as well.
- **A real `POST /verifier/web2/Web2Json/prepareRequest` with the documented all-zero placeholder API
  key (`X-API-KEY: 00000000-0000-0000-0000-000000000000`), attesting an arbitrary public URL
  (api.github.com repo JSON) with jq `{stars: .stargazers_count}` returned
  `{"status":"VALID","abiEncodedRequest":"0x576562324a736f6e…"}`.** The pipeline is live and
  permissionless on testnet this week.
- Coston2 RPC `https://coston2-api.flare.network/ext/C/rpc` and Flare mainnet RPC both answer;
  the FlareContractRegistry at `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` has code on both.
- Coston2 faucet https://faucet.flare.network/coston2 → 200 (page live; drip mechanics UNVERIFIED
  beyond that — it is a standard captcha faucet for C2FLR).
- DA layer https://ctn2-data-availability.flare.network/api-doc → 200.

**Concrete end-to-end flow (from the hardhat guide, all identifiers verbatim):**

1. `POST {VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest` with
   `attestationType=toUtf8HexString("Web2Json")`, `sourceId=toUtf8HexString("PublicWeb2")`, and the
   request body `{url, httpMethod, headers, queryParams, body, postProcessJq, abiSignature}` →
   `abiEncodedRequest` (includes the message-integrity code).
2. Resolve `FdcHub` via `IFlareContractRegistry` (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`),
   fee via `FdcRequestFeeConfigurations.getRequestFee(abiEncodedRequest)`, then
   `fdcHub.requestAttestation{value: fee}(abiEncodedRequest)`.
3. Compute the voting round from `FlareSystemsManager` (`firstVotingRoundStartTs`, 90-s epochs);
   wait for `Relay.isFinalized(fdcProtocolId, roundId)` — "takes no more than 180 seconds".
4. `POST {DA_LAYER}/api/v1/fdc/proof-by-request-round-raw` with `{votingRoundId, requestBytes}` →
   ABI-encoded `IWeb2Json.Response` + Merkle `proof` array.
5. On-chain: `FdcVerification.verifyWeb2Json(proof)` → true, then `abi.decode` the
   `abiEncodedData` into your struct (e.g. the sustainability-data fields you selected with jq).

**Cost**: request fee is small and denominated in the native token (C2FLR on Coston2 — free from the
faucet; FLR on mainnet). Exact fee comes from `FdcRequestFeeConfigurations.getRequestFee()`;
a specific number is deployment-dependent — UNVERIFIED as a fixed figure.

**Fit for the draft**: Web2Json maps almost one-to-one onto `verifiable-attestation-uri`: the
attested tuple can be `(url, jq-selected fields, voting-round timestamp)` with the Merkle root as the
on-chain anchor. The 5-second fetch and 5000-key JSON limits comfortably fit a well-known document.

## 6. Other oracle networks (brief)

- **API3 (Airnode/dAPIs)** — https://docs.api3.org/ (200). First-party-oracle model: the *API
  provider themselves* runs an Airnode; dAPIs are curated price feeds. It could attest your JSON only
  if the publisher of the sustainability document operates an Airnode — architecturally interesting
  for the draft (first-party attestation), but there is no permissionless "point at any URL" path and
  no general free testnet service for third-party URLs. UNVERIFIED beyond the docs' model description.
- **UMA Optimistic Oracle (OOv3)** — https://docs.uma.xyz/developers/optimistic-oracle-v3 (200).
  Relevant: it attests **arbitrary human-readable assertions** ("the document at URL X had SHA-256 Y
  at time T") secured by bond + dispute window rather than by fetching the URL itself. Works on
  testnets (Sepolia) with faucet ETH and mock bonds; liveness delay (hours) makes it a
  complement, not a fetch oracle. Good citable pattern for optimistic attestation of a well-known URI.
- **Chronicle** — https://docs.chroniclelabs.org/ (429 on check; UNVERIFIED). Validator-network
  price oracles; no arbitrary-JSON attestation product.
- **RedStone** — https://docs.redstone.finance/ (200). Pull/push *price* feeds with signed data
  packages; data set is curated by RedStone nodes — not arbitrary user URLs.
- **Supra** — https://supra.com/docs returned 404 on check; docs live elsewhere (UNVERIFIED). DORA
  price feeds + "Automation"; no verified arbitrary-JSON path.
- **Acurast** — https://docs.acurast.com/ (200). Decentralized compute on secure phone hardware
  (TEE); *can* run a script fetching any HTTPS URL and pushing on-chain, with a free testnet/canary
  (cANJO) tier historically. Credible emerging option but TEE-trust-based; details for 2026
  UNVERIFIED beyond docs availability.
- **Pyth** — https://docs.pyth.network/ (200). First-party financial market data (publishers sign
  prices); cannot attest arbitrary JSON documents. Not relevant.

## 7. zkTLS / TLSNotary options

These prove *what a TLS server actually sent*, which is philosophically the best match for
"verifiable attestation of a well-known URI" — but all inherit the TLS-session caveat that a notary
or MPC co-signer is part of the trust model.

- **TLSNotary** — https://tlsnotary.org/ (200). Open-source MPC-TLS protocol (Rust, originally a
  PSE/Ethereum Foundation project): a Prover and a Notary jointly run the TLS session so the Prover
  can produce a transcript proof with selective redaction. It is a *protocol + library*, not a hosted
  service; posting on-chain requires you to build a verifier. **Most credible citation for an IETF
  draft** (open spec, no token, academic lineage). Free to run yourself.
- **Reclaim Protocol** — https://docs.reclaimprotocol.org/ (200). Productized zkTLS ("proofs of
  provenance" via attestor nodes); SDKs produce proofs verifiable on-chain (Solidity verifier) with a
  free developer tier historically. Usable, but the attestor set is Reclaim-operated; commercial
  project — cite as an example implementation, not as normative. Details for 2026 UNVERIFIED beyond
  docs availability.
- **Opacity** — zkTLS network on EigenLayer AVS; status/free tier UNVERIFIED (not probed).
- **Primus (ex-PADO)** — https://docs.primuslabs.xyz/ (200). MPC-TLS/zkTLS SDK, browser-extension
  attestations; on-chain verification supported per docs. 2026 specifics UNVERIFIED.
- **zkPass** — https://docs.zkpass.org/ (200). TransGate-based zkTLS attestations with on-chain
  verifiers; token-incentivized network. 2026 specifics UNVERIFIED.

**IETF-citation credibility ranking**: TLSNotary (open protocol) > Flare FDC Web2Json (live, specified,
open-source verifier) > UMA OOv3 (well-documented optimistic pattern) > Reclaim/Primus/zkPass
(commercial zkTLS) > Chainlink CRE (gated Early Access) > Chainlink Functions (sunset).

## Recommendation for the draft

1. Keep `verifiable-attestation-uri` mechanism-neutral, but use **Flare Web2Json** as the worked
   example: it is live today, permissionless on Coston2, uses an explicit `(url, jq, abiSignature)`
   request that maps cleanly to a well-known URI, and yields an on-chain Merkle-proof verification —
   every step above was reachable/verified on 2026-07-28.
2. Mention **TLSNotary** as the transport-level alternative that proves the HTTPS response itself.
3. Do **not** cite Chainlink Functions except as a deprecated prior art (sunset 2026-06-30; testnet
   DON empirically dead since ~2026-06-17). CRE may be cited as its successor with the caveat that
   DON deployment requires Early Access approval.
