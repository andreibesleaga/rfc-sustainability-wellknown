# Methodology document (template)

This is the methodology document of a synthetic network, `ledger.example`, written as a template that a real deployment copies and adapts. Every name is reserved (RFC 2606 `.example`) and every figure in the examples is invented. Replace each section with the facts of the deployment; keep the section names, because the declaration's `methodology-uri` points here and the checks read the parameters at the end.

It cites the Sustainability-First Consensus (SFC) profile, version 2.0, and the framework column: Besleaga, A. N. "'Sustainability-First Consensus' Ledgers for a Green Digital Future." *Communications of the ACM*, Opinion, in press, doi:10.1145/3809296 (404 until published).

## 1. Boundary

The energy boundary is field S.8 of Commission Delegated Regulation (EU) 2025/422, Annex, Table 2: energy used to validate transactions and maintain the ledger, per calendar year, over all nodes of the registered operators, data-centre overhead included and client devices excluded. Figures are gross. State what is outside: gateways, storage and backups run by the operators are inside; the foundation's web site is outside.

## 2. Measurement method

Each operator attests monthly. State, per operator, which of the four methods it uses and how: `hardware-metered` (a metered power feed per node), `hardware-estimated` (rated power times measured load), `cloud-billing` (the provider's billed energy), `third-party-modeled` (a model run by an outside party). State how `nodeCount` is counted: the greatest number of nodes running at any instant of the month. State which parts of the network are measured and which are modelled.

## 3. Scope 2

Scope 2 is market-based: contractual instruments where held, else supplier-specific or residual-mix factors, else the grid average where no residual mix exists. The location-based figure is attested beside it as `scope2LocationKgCO2e`. Name the factor sources and years (`gridIntensityRef` repeats them per event).

## 4. Scope 1

State whether any operator has Scope 1 emissions (a backup generator, for example). If none, say so; an absent `scope1KgCO2e` counts as 0.

## 5. Scope 3

List the categories counted: purchased services, capital goods (counted in the month of acquisition), fuel- and energy-related activities, waste. State any deviation, such as amortising capital goods over their service life. Removals are not counted.

## 6. Credits and registry

Credits are whole tonnes of CO2e retired in the registry named below. State the standard or label of the credits; "retired" does not mean "high quality". Give the one written form of each registry base URI and the canonical form of its references (the `reference-forms` item).

## 7. Platform statement

The hot path is a permissioned ledger run only by the registered operators. State the node count N the operators may run, the rated watts P of the worst hardware class in use, and the data-centre overhead factor O (at least 1, no default). The node bound is N x P x O x 8 784 h / 1 000 kWh. A public hot path states an assessment instead (publisher, URI, a 12-month period, figure, unit, method).

## 8. Registrar

The registrar signs every Registry entry. Its current key is listed below; a former key is listed with its retirement date until the next revision delists it. On a key rotation the registrar re-signs all entries under the new key in the same revision of this document, and publishes the reason and date of any retroactive change here.

## 9. Takeovers, void acts, ownership

List a takeover (operator, type, old ledger, tip) when a chain moves to a new ledger. List who may ask for a void act. State whether the ledger confirms at the registry that a retirement's beneficiary matches the citing operator before it accepts the first citation.

## SFC parameters

The checks read the items below from this document. Keep the heading and the fenced block.

<!-- sfc-parameters:begin -->

```json
{
  "registrar-keys": [
    {
      "jwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
      },
      "status": "current"
    }
  ],
  "retirement-registries": [
    "https://registry.example",
    "https://serials.example"
  ],
  "reference-forms": [
    {
      "registry": "https://registry.example",
      "rules": [
        "upper-case",
        "no-surrounding-space"
      ]
    },
    {
      "registry": "https://serials.example",
      "rules": [
        "range-first-last"
      ]
    }
  ],
  "platform": {
    "hot-path": "Example permissioned ledger",
    "access": "permissioned",
    "mechanism": "proof-of-authority",
    "n": 30,
    "p-watts": 500,
    "o": 1.5
  },
  "takeovers": [
    {
      "operator": "did:web:op-a.example",
      "type": "EnergyAttested",
      "ledger": "old-ledger.example",
      "tip": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "registry-1x-digests": [
    {
      "operator": "did:web:op-b.example",
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    }
  ],
  "beneficiaries": [
    {
      "beneficiary": "Operator A Example Ltd",
      "operator": "did:web:op-a.example"
    }
  ],
  "void-requesters": [
    "did:web:op-a.example"
  ],
  "scope2-basis-1x": "market-based"
}
```

<!-- sfc-parameters:end -->
