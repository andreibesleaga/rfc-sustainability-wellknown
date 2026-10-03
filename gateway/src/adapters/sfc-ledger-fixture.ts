/**
 * The recorded excerpt the `sfc-ledger-demo.example` subject replays, the
 * public test key every signature in it uses, and the demonstration's
 * `provider` text.
 *
 * SYNTHETIC. Every figure, identifier and date is invented. April 2026
 * reproduces the worked example of the SFC ledger-bridge paper (operator 7,
 * April 2026); January to March exist only so that each chain starts at the
 * operator's first active month and can be walked (the paper gives no figures
 * for them). Every month meets the offset-coverage rule and Scope 2 is
 * kWh x 0.380 throughout. The excerpt is served verbatim at
 * `/sfc-ledger-demo.example/input`, which is also the declaration's
 * `ledger-access-uri`.
 *
 * Heads at the end of April: energy
 * a109985eef85105750328a8296b8d1038dc7ca530493fb9150e5e0a29066e761, carbon
 * 78bd7dc7250feca3a7a93bf456d5df00e537ed59bd149c3c1eeda9ccbcc980ce.
 *
 * To extend it (a correction, a failed month, a second operator): append an
 * event, sign it with the test key over the RFC 8785 form without `sig`, hash
 * the whole event, and keep `commit` strictly increasing; the tests in
 * `test/adapters-sfc-ledger.test.ts` show the helper.
 */
import type { LedgerExcerpt } from "./sfc-ledger-bridge";

/**
 * RFC 8032, Section 7.1, TEST 1. A PUBLISHED test vector: its private half is
 * printed in the RFC, so anyone can sign with it. It signs this synthetic
 * demonstration only, never anything the gateway operator vouches for, and the
 * gateway's own key (`SUSTAINABILITY_SIGNING_KEY`) is never used for this
 * subject. It is not a secret and no scanner needs to treat it as one.
 */
export const SFC_LEDGER_TEST_PRIVATE_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", // d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", // 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60
} as const;

/** The public half, in the form a verifier pins (`trustedKeys`). */
export const SFC_LEDGER_TEST_PUBLIC_JWK = {
  kty: "OKP",
  crv: "Ed25519",
  x: SFC_LEDGER_TEST_PRIVATE_JWK.x,
  alg: "EdDSA",
  use: "sig",
} as const;

/** The declaration's `provider`: what this is, in band, before any figure. */
export const SFC_LEDGER_PROVIDER =
  "SYNTHETIC EXAMPLE — not a real operator, ledger or measurement; every figure is invented. " +
  "EXPERIMENTAL: the SFC ledger bridge (SFC ledger profile 1.2) replaying a recorded ledger " +
  "excerpt, the worked example of operator 7 for April 2026. net-zero-status is the SFC framework's " +
  "term for retired credits covering the gross emissions (an offset-coverage position), not a claim of " +
  "climate neutrality. The ledger-evidence extension is defined by the SFC disclosure profile 1.1. " +
  "Every signature here, this declaration's included, is made with the RFC 8032 test " +
  "key, whose private half is public: it shows how the checks work and nothing about who signed. " +
  "Gateway operator: Andrei Besleaga";

/** The excerpt, exactly as served at `/sfc-ledger-demo.example/input` (member order preserved). */
export const SFC_LEDGER_FIXTURE: LedgerExcerpt = {
  "fixture": "sfc-ledger-demo.example",
  "fixture-version": 1,
  "notice": "SYNTHETIC EXAMPLE. Every figure, identifier and date is invented and describes nothing real. April 2026 reproduces the worked example of the SFC ledger bridge (operator 7, April 2026); the January to March events and every commit time exist only so that the chains are complete from the operator's first month and can be walked, and that worked example gives no figures for them. Every signature is made with the RFC 8032 Section 7.1 TEST 1 key, whose private half is printed in RFC 8032, so a valid signature here shows how the checks work and nothing about who signed.",
  "profile-version": "1.2",
  "hash-algorithm": "sha-256",
  "event-encoding": "rfc8785",
  "network": "ledger.example",
  "registry": [
    {
      "operator": "did:example:operator7",
      "origin": "validator.operator7.example",
      "active": [
        {
          "from": "2026-01-01",
          "to": null
        }
      ],
      "keys": [
        {
          "public-jwk": {
            "kty": "OKP",
            "crv": "Ed25519",
            "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
          },
          "valid-from-commit": "2026-01-01T00:00:00Z",
          "valid-to-commit": null
        }
      ],
      "nodeProfile": {
        "hardwareClass": "general-purpose-x86",
        "asicForbidden": true
      }
    }
  ],
  "retirements": [
    {
      "type": "RetirementAllocation",
      "operator": "did:example:operator7",
      "registry-uri": "https://registry.example/retirements/operator7/2026-01",
      "retired-in": "2026-01",
      "tonnes-retired": 1,
      "beneficiary": "did:example:operator7",
      "parts": [
        {
          "period": "2026-01",
          "kg": 250
        },
        {
          "period": "2026-02",
          "kg": 250
        },
        {
          "period": "2026-03",
          "kg": 250
        },
        {
          "period": "2026-04",
          "kg": 250
        }
      ],
      "sig": {
        "alg": "Ed25519",
        "value": "VdguZbr_hfCwt9EwxGPmAqpve3N8DZNqVPcweto1DgNHYwLxszMZBdkfzTAtl5HBrFoqPE_ji5Da2_epIR5fCg"
      }
    }
  ],
  "ledger": [
    {
      "commit": "2026-02-01T00:00:06Z",
      "hash": "e4ffdd56097f0457ad99043c382abdecf64035f3831151cf599d82e3214a4cd4",
      "event": {
        "type": "EnergyAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": null,
        "ts": "2026-02-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-01-01",
            "to": "2026-01-31"
          },
          "nodeCount": 7,
          "kWhConsumed": 405,
          "measurementMethod": "hardware-metered",
          "evidenceCid": "example-cid:operator7/2026-01/meter-export"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "_Mt84v-Jx8fOeDS-BeGSQ-gILM0RWN8cjkN8jbkXO4Cy2d2H9ShfksTIw3FsHJwu_HJhThpByo3MrkiDAiwZAQ"
        }
      }
    },
    {
      "commit": "2026-02-01T00:00:07Z",
      "hash": "c82021cbfbc78ede4c2bc4db7340057ff0ce93cb35fe50fcc702a28c435d87af",
      "event": {
        "type": "CarbonAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": null,
        "ts": "2026-02-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-01-01",
            "to": "2026-01-31"
          },
          "scope2KgCO2e": 153.9,
          "scope2Method": "location-based",
          "scope3KgCO2e": 60,
          "gridIntensityRef": "grid.example:zone-a:2026-01-avg",
          "offsetsKgCO2e": 250,
          "netZero": true,
          "evidenceCid": "example-cid:operator7/2026-01/retirement-and-allocation"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "vjX4utKtQFq8KLwVw0y3yvqx9D3PldUeNNnsYHdHtN6iboj_x1p1Du6b1AqaAkbQHxTpEcyc-ZxkrfFePlG3Dw"
        }
      }
    },
    {
      "commit": "2026-03-01T00:00:06Z",
      "hash": "b76fa7c9978a45b60900c3c2cfc1a2f249c81af0fce314a812f02b65652a2089",
      "event": {
        "type": "EnergyAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "e4ffdd56097f0457ad99043c382abdecf64035f3831151cf599d82e3214a4cd4",
        "ts": "2026-03-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-02-01",
            "to": "2026-02-28"
          },
          "nodeCount": 7,
          "kWhConsumed": 366,
          "measurementMethod": "hardware-metered",
          "evidenceCid": "example-cid:operator7/2026-02/meter-export"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "biaqAjjApxOa1h6podd5xHcuTL6oSYrugU4-2IqRefcm7wEjl7lgXaTY607H0d2DrZY-UNc8ry1ACL_YusvHDw"
        }
      }
    },
    {
      "commit": "2026-03-01T00:00:07Z",
      "hash": "f0758e40e62a6d682b884e75f2ea60aafa4c1c783232baa5e9d24c90d19e2cda",
      "event": {
        "type": "CarbonAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "c82021cbfbc78ede4c2bc4db7340057ff0ce93cb35fe50fcc702a28c435d87af",
        "ts": "2026-03-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-02-01",
            "to": "2026-02-28"
          },
          "scope2KgCO2e": 139.08,
          "scope2Method": "location-based",
          "scope3KgCO2e": 60,
          "gridIntensityRef": "grid.example:zone-a:2026-02-avg",
          "offsetsKgCO2e": 250,
          "netZero": true,
          "evidenceCid": "example-cid:operator7/2026-01/retirement-and-allocation"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "t6SY0m7A8nrr_dVYUlRQqyU2JRVJ4vZlhIJO7SLk3WsFQeKRg5BIsIbgHLW9XrUFrgxemmNkmp_-6pZ3cP5EDQ"
        }
      }
    },
    {
      "commit": "2026-04-01T00:00:06Z",
      "hash": "37e890758063811359418c4114d090956252dfc2eaae3a45ee42cb58d688bc26",
      "event": {
        "type": "EnergyAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "b76fa7c9978a45b60900c3c2cfc1a2f249c81af0fce314a812f02b65652a2089",
        "ts": "2026-04-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-03-01",
            "to": "2026-03-31"
          },
          "nodeCount": 7,
          "kWhConsumed": 398,
          "measurementMethod": "hardware-metered",
          "evidenceCid": "example-cid:operator7/2026-03/meter-export"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "PnsmqVv0Us-hkcxe8roYgg6HmOWdrpL62jOR23iiexPK8WNjq6XD1mmJE_tpNGoX3XE4QP0C4hAxI_LeuCi6AQ"
        }
      }
    },
    {
      "commit": "2026-04-01T00:00:07Z",
      "hash": "bff7cdbc35819fea3603557ab76519cb5f685b8fcfe904ae67a12980cbd618b8",
      "event": {
        "type": "CarbonAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "f0758e40e62a6d682b884e75f2ea60aafa4c1c783232baa5e9d24c90d19e2cda",
        "ts": "2026-04-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-03-01",
            "to": "2026-03-31"
          },
          "scope2KgCO2e": 151.24,
          "scope2Method": "location-based",
          "scope3KgCO2e": 60,
          "gridIntensityRef": "grid.example:zone-a:2026-03-avg",
          "offsetsKgCO2e": 250,
          "netZero": true,
          "evidenceCid": "example-cid:operator7/2026-01/retirement-and-allocation"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "vUbek_aUIX0b0MfXDqrlP-qH-GzOJMwFegauv4YOv5DvyL6iBwstuHvklf8LCcqb7_X88nvQvsfTw8SipJFABg"
        }
      }
    },
    {
      "commit": "2026-05-01T00:00:06Z",
      "hash": "a109985eef85105750328a8296b8d1038dc7ca530493fb9150e5e0a29066e761",
      "event": {
        "type": "EnergyAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "37e890758063811359418c4114d090956252dfc2eaae3a45ee42cb58d688bc26",
        "ts": "2026-05-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-04-01",
            "to": "2026-04-30"
          },
          "nodeCount": 7,
          "kWhConsumed": 412.5,
          "measurementMethod": "hardware-metered",
          "evidenceCid": "example-cid:operator7/2026-04/meter-export"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "UNl4kyhdzg_t3EKXSLozf-SfKSTQ_24RGpyTaaXQZu_XJ_89oILz395FwZWeORmd-Nb2QTohRM1FHcINE5jlAw"
        }
      }
    },
    {
      "commit": "2026-05-01T00:00:07Z",
      "hash": "78bd7dc7250feca3a7a93bf456d5df00e537ed59bd149c3c1eeda9ccbcc980ce",
      "event": {
        "type": "CarbonAttested",
        "subject": "did:example:operator7",
        "actor": "did:example:operator7",
        "prev": "bff7cdbc35819fea3603557ab76519cb5f685b8fcfe904ae67a12980cbd618b8",
        "ts": "2026-05-01T00:00:00Z",
        "payload": {
          "period": {
            "from": "2026-04-01",
            "to": "2026-04-30"
          },
          "scope2KgCO2e": 156.75,
          "scope2Method": "location-based",
          "scope3KgCO2e": 60,
          "gridIntensityRef": "grid.example:zone-a:2026-04-avg",
          "offsetsKgCO2e": 250,
          "netZero": true,
          "evidenceCid": "example-cid:operator7/2026-01/retirement-and-allocation"
        },
        "sig": {
          "alg": "Ed25519",
          "value": "H7f3reos-E5CvspeRptTTv6IvE6LpHCPETdMsM2d-rtt3XkXtw0marccx9QlbVp0fGlGV8WE-nbnugk1RpmJBg"
        }
      }
    }
  ],
  "publication": {
    "reporting-period": "2026-04",
    "period-start": "2026-04-01",
    "period-end": "2026-04-30",
    "updated": "2026-05-02T00:10:00Z",
    "target": "validator.operator7.example",
    "target-type": "origin"
  }
};
