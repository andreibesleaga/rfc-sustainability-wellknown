# `sfc-compliance/`

The SFC profile of `/.well-known/sustainability-data`, and a checker for it.

| File | What it is |
|---|---|
| [`PROFILE.md`](PROFILE.md) | The normative profile. Four criteria, two declaration levels, three extension names, six rules a publisher can get wrong, and what a conformance statement may claim. |
| [`SFC.md`](SFC.md) | The older non normative note on how the framework and the specification fit together. Kept as written, with stale facts corrected. |
| [`examples/`](examples) | Two reference declarations, one network level and one operator level. Both validate against the JTD schema, the CDDL schema and the consumer library. |
| `sfc-check.mjs` | The checker. |
| [`test/`](test) | Eight fixtures and the test suite. |

The examples and fixtures use reserved `.example` names and every figure in them
is invented. They say so in their own `provider` member.

## Running the checker

It needs Node 22 or later and the published consumer library:

```
npm install
node sfc-check.mjs examples/sfc-network.example.json
node sfc-check.mjs examples/sfc-operator.example.json
node sfc-check.mjs https://ledger.example
node sfc-check.mjs examples/sfc-network.example.json --verify-attestation
npm test
```

Given a local file it reads the file. Given an https origin it fetches the
declaration from the well known URI and also runs the consumer library's
conformance battery against the origin, which is the HTTP half of criterion 4.
An `http` URL is refused, because the specification requires HTTPS.

Options: `--verify-attestation` fetches the statement at
`verifiable-attestation-uri` and checks it, and is off by default so that a run
needs no network; `--now=<RFC 3339>` sets the fixed clock; `--json` prints the
rows as JSON.

Exit status is 0 normally, 1 when the document does not conform to the
specification or when an annual network figure is at or above the 1 GWh cap, and
2 on a usage error. A missing extension, an absent attestation and a refused
criterion all leave the status at 0.

## What it can conclude

It can tell you that a document conforms to the specification, that a declared
annual network figure is below or above the cap, that the profile's extensions
are present and well formed, that the carbon figures hang together
arithmetically, and that an origin answers the way the specification requires.

## What it cannot conclude

It cannot tell you that any figure is true. Nothing it prints is verification of
anything. Hardware lifecycle and net zero are reported as **declared**, because a
document can only say what the publisher wrote. Criterion 1 is refused on an
operator level or a sub annual document rather than passed, because a single
operator is trivially under a whole system cap and a month is not a year. An
attestation that checks out is evidence about the statement and the issuer's key,
never about the figures.

Section 9 of `PROFILE.md` says this in full, in the form of what a conformance
statement may and may not claim.

## Dependencies

One: `sustainability-wellknown-consumer`, the published reference consumer in
[`../consumer`](../consumer). The profile deliberately keeps the domain specific
checking here rather than in that library, which stays general purpose.
