# Examples of the SFC profile, version 2.0

Reference declarations on the draft -10 wire, with the methodology document and the parameters they refer to. Every figure is invented, every name is a reserved `.example` name, and each `provider` member says so.

| File | What it is |
|---|---|
| `sfc-network.example.json` | An array of two objects for the calendar year 2025 of the three-operator network of the test vectors: the market-based primary object with the extensions `hardware-lifecycle`, `carbon-neutrality`, `network-topology` and `ledger-evidence-2`, and the paired location-based object. |
| `sfc-operator.example.json` | One operator declaration for one month (January 2025), with `ledger-evidence-2` and `member-of-network`. |
| `sfc-parameters.example.json` | The methodology parameters object of 7.6 with every item, valid against `../schemas/sfc-parameters.json`. |
| `METHODOLOGY.md` | The synthetic network's methodology document, written as a template. Its `## SFC parameters` block is the parameters file. |

The figures come from the vectors, so they recompute: the ledger read behind both declarations is the excerpt of `../vectors/inputs/v05-sums-year.json` (scenarios `year-2025` and `operator-month`), and `python3 ../vectors/crosscheck.py` recomputes every sum, head, count and flag from it.

Each object is signed with the RFC 8032 section 7.1 test 1 key, whose private half is public. The signatures prove the format of `signed` only; they say nothing about who published the object. Never use that key for real data.

Check the examples with the published consumer library:

```
node -e 'import("sustainability-wellknown-consumer").then(({validateDocument}) => { for (const f of ["sfc-network", "sfc-operator"]) console.log(f, validateDocument(JSON.parse(require("fs").readFileSync(`examples/${f}.example.json`, "utf8"))).valid); })'
```

The 1.1.1 examples are kept as fixtures in `../test/fixtures/profile-1.1/`.
