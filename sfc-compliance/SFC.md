# SFC ↔ `/.well-known/sustainability` Compliance Matrix

*How this Internet-Draft and its publisher/gateway relate to the **Sustainability-First Consensus (SFC)** framework. Non-normative; the IETF draft does not depend on SFC. This is just an informational appendix.*

## 0. Citation

SFC is defined in the accepted article to be published in Communications of Association for Computing Machinery:

> Besleaga, A. N. (2026). *"Sustainability-First Consensus" Ledgers for a Green Digital
> Future.* Association for Computing Machinery. DOI: 10.1145/3809296 ·
> ORCID [0009-0001-3464-5283](https://orcid.org/0009-0001-3464-5283)

Any deployment claiming SFC alignment MUST cite the paper. This document covers only the
engineering relationship; for rationale and argumentation, read the paper. The
SFC engineering profile applied here is `SFC-PROFILE v1.1`
(`awesome/awesome-blockchain-greentech/Innovative Projects/SFC_COMPLIANCE.md`).

## 1. What SFC is (one paragraph)

SFC operationalizes sustainability for blockchain/DLT systems as four verifiable criteria:
**C1** annualized network energy < 1 GWh; **C2** general-purpose hardware, no single-use
ASICs; **C3** native on-chain carbon transparency with annual Net Zero, GHG Protocol
Scope 2 & 3; **C4** regulatory readiness via CSRD/ESRS-E1 machine-readable APIs. Operators
should emit `EnergyAttested` and `CarbonAttested` events and expose a
`/v1/sustainability/*` API. Conformance checks **C-SFC-1..6** gate compliance.

## 2. The holistic relationship

SFC and the IETF draft solve the **same disclosure problem at two layers**, sharing the
GHG Protocol vocabulary:

```
   on-chain truth                 public HTTP discovery surface
  ┌───────────────┐   gateway    ┌────────────────────────────┐   one GET   ┌───────────┐
  │ SFC operator  │  (publisher) │ /.well-known/sustainability│  ─────────▶│ aggregator│
  │ Energy/Carbon │ ───────────▶│  (IETF draft -01)          │             │ regulator │
  │ Attested      │              │  JTD/CDDL-validated JSON   │             │ client    │
  └───────────────┘              └────────────────────────────┘             └───────────┘
        C1–C4                         energy/carbon/scope fields
```

- **SFC** is the *production and attestation* layer (signed, on-chain, blockchain-specific).
- **The IETF draft** is the *public, vendor-neutral HTTP discovery* layer (general-purpose).
- **The publisher/gateway** is the bridge: an SFC operator's `CarbonAttested` /
  `EnergyAttested` data becomes a conformant `/.well-known/sustainability` document — the
  HTTP analog of the SFC `/v1/sustainability/*` API. This is why the argument is holistic
  and hard to ignore: the same numbers, signed on-chain for SFC, are republished at a
  standard web location for everyone else, with the same scope semantics.

## 3. Field-level compliance matrix

| SFC concept (profile v1.1) | SFC field / API | `/.well-known/sustainability` field | Gateway support |
|---|---|---|---|
| Period | `payload.period {from,to}` | `reporting-period` (YYYY[-MM[-DD]]) | `normalize()` period shaping |
| Energy (C1) | `EnergyAttested.kWhConsumed` | `energy-consumption` + `energy-unit` | computed/kepler/enterprise adapters |
| Scope 2 carbon (C3) | `CarbonAttested.scope2KgCO2e` | `scope-2` (+ `carbon-footprint`) | normalize scopes |
| Scope 3 carbon (C3) | `CarbonAttested.scope3KgCO2e` | `scope-3` | normalize scopes |
| Grid intensity | `gridIntensityRef` | `carbon-intensity-gCO2-per-kWh` | `carbonFromEnergy`, intensity field |
| Net-Zero offsets (C3) | `offsetsKgCO2e`, `netZero` | (link via) `verifiable-attestation-uri`; `renewable-energy` | attestation link |
| Measurement method | `measurementMethod` (e.g. ccri-hybrid) | `measurement-method` | passthrough |
| Provenance / offsets proof | `evidenceCid` (IPFS) | `methodology-uri` / `verifiable-attestation-uri` | passthrough |
| Provider identity | operator DID | `provider` | passthrough |
| Regulatory (C4) | `/v1/sustainability/csrd` (ESRS-E1) | optional fields + `methodology-uri` | scope + accounting fields |
| Disclosure index | links to evidence (reports, certificates) | `disclosure-uri` (e.g. a carbon.txt) | `carbontxt-api` adapter + carbon.txt emit/parse |
| Self-report | `/v1/sustainability/sfc` | the well-known document itself | gateway output |

Unit bridge: SFC reports kg/kWh at operator scale; the draft and gateway carry the same
quantities and convert units (`kgCO2e`↔`gCO2e`↔`mtCO2e`, `Wh`↔`kWh`↔`MWh`↔`GWh`) in
`normalize()`.

## 4. Conformance-check correspondence

| SFC check | Meaning | Reflected in the well-known document |
|---|---|---|
| C-SFC-1 / C-SFC-2 (energy, C1) | recent attestation; <1 GWh trailing 12-mo | `energy-consumption`/`-unit` + `reporting-period`; `updated` recency |
| C-SFC-4 (Net Zero, C3) | scope2+scope3 ≤ offsets | `scope-2`,`scope-3` + `verifiable-attestation-uri` to the offset proof |
| C-SFC-5 (CSRD, C4) | ESRS-E1 schema-valid | `carbon-accounting`, scopes, `methodology-uri` |
| C-SFC-6 (platform) | platform within C1 | `measurement-method` + `methodology-uri` |

C2 (hardware lifecycle) and the cryptographic signing of attestations remain SFC-side
concerns; the draft deliberately links to attestations rather than defining them
(matching its own non-goals).

## 5. Boundary (what stays separate)

- The **IETF draft does not cite or depend on SFC** — it is a general-purpose mechanism.
  SFC is one *consumer/producer* of the well-known surface, documented here only.
- The gateway does not perform on-chain signing or offset retirement; it republishes
  already-attested numbers and links to their proofs.

## 6. One-line summary

> SFC produces signed, on-chain energy/carbon attestations; the IETF
> `/.well-known/sustainability` draft standardizes their **public HTTP disclosure**; the
> publisher/gateway is the bridge — so an SFC-compliant system, an enterprise suite, or a
> plain web server all expose the **same validated fields at the same URL**.
