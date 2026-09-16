# The SFC profile of `/.well-known/sustainability-data`

**Status:** normative profile. **Applies to:** draft-besleaga-sustainability-wellknown-07
(the *draft* below). **Version:** profile 1.0, 2026-09-16.

## 1. Purpose

Sustainability-First Consensus (SFC) is an evaluation framework for distributed systems.
It asks four questions about a system: how much energy it uses, what happens to its
hardware, how it accounts for carbon, and whether an outside party can read the answers by
machine. The framework decides what a system must show. It does not say where the numbers
are published.

The draft answers that second question for any HTTP origin. One JSON document, at one fixed
path, validated by two formal schemas, readable with one GET.

This profile joins the two. It states, member by member, how an SFC declaration is
published so that a reader can evaluate the four criteria from the document alone. It uses
the draft as it stands. It changes nothing in the draft, adds no top level member, and
invents no new unit. Everything the draft does not define is carried under three extension
names, defined in section 5.

This document is self contained. It is written for two readers: a publisher deciding what
to serve, and a consumer deciding what may be concluded from what was served.

### 1.1 How to read this document

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be read as in BCP 14.
They constrain a publisher claiming this profile and a checker implementing it. They never
constrain the draft, which this profile cannot change.

A figure published under this profile is a self asserted claim by the origin that served
it. That is the draft's own position, and this profile keeps it. Nothing in this document
makes a published figure true.

## 2. The two declaration levels

The profile defines two levels. They answer different questions and they are checked
differently.

| | Network level | Operator level |
|---|---|---|
| What the declaration is about | the whole system, counting every participant | one participant, such as one validator or one node operator |
| `target` | the network's name, for example `ledger.example` | the operator's origin host, for example `validator.operator7.example` |
| `target-type` | `service` | `origin` |
| `reporting-period` | a whole calendar year, the `YYYY` form | any period the operator can stand behind |
| Who publishes it | the foundation, consortium or other body that can speak for the system | the operator |
| Criterion 1 evaluated on it | yes, this is the only level where it means anything | no, refused with a stated reason |
| `upstream` | usually absent | names the hosting, cloud and electricity providers the operator buys from |
| Membership | not applicable | declared in the `network-topology` extension, section 5.4 |

A network level declaration MUST carry `target-type: "service"`. The draft's `target-type`
enumeration has no `network` value, and a value outside the enumeration is disregarded by a
conforming consumer, which would leave the level undeclared.

A network is operated by many independent parties, and one body publishes for all of them.
The draft already covers this. A subject other than the origin is a claim made by the
origin's publisher about that subject, and nothing more. A figure for the whole subject may
rest on estimation for the parts not directly measured, provided the methodology document
says what is measured and what is estimated. A network level publisher MUST therefore state
in its methodology document which parts are measured and which are modelled.

The draft defines aggregation over time only, never across subjects. Summing the operators
of a network into one figure is a methodology question, not a protocol one, and the
methodology document carries the basis.

## 3. The four criteria

### 3.1 C1, energy consumption

**Criterion.** The annual energy consumption of the whole network is below 1 GWh.

| What is published | Draft member | Unit | Required by this profile |
|---|---|---|---|
| the quantity | `energy-consumption` | the unit named by `energy-unit` | MUST at network level |
| the unit | `energy-unit` | one of `Wh`, `kWh`, `MWh`, `GWh` | MUST when `energy-consumption` is present |
| the period | `reporting-period` | `YYYY` at network level | MUST |
| who measured and how | `measurement-method` | token | MUST |
| the method in prose | `methodology-uri` | https URI | MUST, the draft makes it mandatory anyway |

The cap in the draft's units:

| Spelling | Value |
|---|---|
| Wh | 1 000 000 000 |
| kWh | 1 000 000 |
| MWh | 1 000 |
| GWh | 1 |

1 GWh is 0.001 TWh. `TWh` is not a value of `energy-unit` and a document using it does not
validate, so the figure is restated in one of the four spellings above. The integer MWh
form is preferred, because it removes every question about how a fractional GWh value
rounds before it is compared with the cap.

`measurement-method` SHOULD be `third-party-modeled` where an outside index produced the
figure, and `hardware-estimated` where the publisher ran the bottom up hardware model
itself. `hardware-metered` is for figures read from meters, which is the ordinary operator
level case. The identity of the index or model belongs in the methodology document. A
publisher SHOULD NOT invent a token, because any value outside the draft's four is read as
a human readable description and stops being machine comparable.

The draft has no member for an energy figure extrapolated from a shorter period. A
publisher whose year is incomplete publishes the completed portion and waits, or publishes
the constituent months. It MUST NOT present a part of the year as the year.

**The draft never applies the cap.** It publishes figures and renders no verdict. The
comparison with 1 GWh is made by a reader, and section 8 says what such a reader may
conclude.

### 3.2 C2, hardware lifecycle

**Criterion.** Participation runs on general purpose hardware that has a use after this
system is done with it, rather than on single use devices that become waste.

The draft defines no hardware, lifecycle, embodied carbon or waste member, and its top
level member set is closed. This criterion is therefore carried entirely by the
`hardware-lifecycle` extension of section 5.2, with one figure in band:

| What is published | Draft member | Unit |
|---|---|---|
| emissions of making the hardware | `scope-3` | the unit named by `carbon-unit` |

Embodied and manufacturing emissions are value chain emissions, which is what `scope-3`
holds. A publisher that includes them says so, both in the methodology document and through
`embodied-carbon-in-scope-3` in the extension.

**A hardware lifecycle extension cannot travel alone.** The draft requires every
declaration object to carry at least one numeric metric member, or `disclosure-uri`, or
`verifiable-attestation-uri`. A document whose only payload is this extension is not
conformant. In practice the C2 data rides with the C1 figure, which is the intended shape.

### 3.3 C3, carbon accountability

**Criterion.** The system accounts for its carbon on a stated basis, reports value chain
emissions, and either reaches net zero for the year or says plainly that it has not.

| What is published | Draft member | Unit | Required by this profile |
|---|---|---|---|
| gross emissions | `carbon-footprint` | the unit named by `carbon-unit` | MUST at network level |
| the unit | `carbon-unit` | one of `gCO2e`, `kgCO2e`, `mtCO2e` | MUST when a carbon figure is present |
| the basis | `carbon-accounting` | `location-based` or `market-based` | MUST |
| purchased energy emissions | `scope-2` | the unit named by `carbon-unit` | MUST at network level |
| value chain emissions | `scope-3` | the unit named by `carbon-unit` | MUST at network level |
| direct emissions | `scope-1` | the unit named by `carbon-unit` | SHOULD |
| grid intensity of the energy used | `carbon-intensity-gCO2e-per-kWh` | gCO2e per kWh, weighted over the period | MUST at network level |
| renewable share | `renewable-energy` | percent, 0 to 100 | SHOULD |
| carbon per transaction | `sci-score` with `functional-unit` | gCO2e per functional unit | MAY |
| the net zero claim | `carbon-neutrality` extension, section 5.3 | see the table there | MUST where any net zero claim is made |
| an outside statement about the figures | `verifiable-attestation-uri` | https URI | SHOULD where a net zero claim is made |
| the index of filed reports | `disclosure-uri` | https URI | MUST, see C4 |

`carbon-footprint` is defined by the draft as **gross** emissions and MUST NOT be negative.
Rule 1 of section 6 says what follows from that.

`sci-score` carries carbon per functional unit and needs `functional-unit` beside it.
Energy per transaction has no member in the draft and is carried by the `network-topology`
extension instead.

A market based renewable claim is an ordinary market based `scope-2` figure. The basis
travels in band, in `carbon-accounting`, because figures computed on different bases are
not comparable and a consumer that compares them without the basis is comparing nothing.

### 3.4 C4, regulatory readiness

**Criterion.** The figures are readable by machine, without prior arrangement, by a party
the publisher has never met.

This is the criterion the draft satisfies by being implemented. Nothing else is needed:

| What the criterion asks for | How the draft answers it |
|---|---|
| one address that is known in advance | the path `/.well-known/sustainability-data` on the origin |
| transport | HTTPS, with the service identity checked on every hop |
| a declared format | the media type `application/sustainability-data+json` |
| a machine checkable format | the JTD schema and the CDDL schema in `schemas-validators/` |
| use from a browser | `Access-Control-Allow-Origin: *` on the response |
| polite retrieval | cache directives, `ETag` or `Last-Modified`, `HEAD`, and `405` with `Allow: GET, HEAD` |
| a trend for a reader who wants one | the extended query parameters `period` and `granularity`, with `capabilities: "extended"` |
| the filed reports themselves | `disclosure-uri`, pointing at a machine readable **index** of them |

`disclosure-uri` names an index, not a report. A publisher pointing it straight at one PDF
has misused the member. The index names the reports, and a carbon.txt file is one shape
such an index can take.

The draft defines no member for a reporting framework, a taxonomy or a report type. Where a
publisher needs to say which regime a report was filed under, the disclosure index says it.

## 4. The extension namespace

Names minted by this profile live under:

```
https://andreibesleaga.com/sfc/extensions/
```

Exactly three names are defined, and no others are minted by this version of the profile:

| Name | Level | Section |
|---|---|---|
| `https://andreibesleaga.com/sfc/extensions/hardware-lifecycle` | both | 5.2 |
| `https://andreibesleaga.com/sfc/extensions/carbon-neutrality` | network, and an operator that makes its own claim | 5.3 |
| `https://andreibesleaga.com/sfc/extensions/network-topology` | both, with different members at each level | 5.4 |

An extension name is an identifier, not a locator. It is compared as a string, octet for
octet, and it is never normalized and never fetched, not even though it is an https URI. It
is an https URI so that it cannot collide with anyone else's name and so that a human
reading a declaration can find the definition. A definer without a domain uses the draft's
other form, `urn:uuid:` followed by a lowercase hyphenated UUID.

A name, once minted, is never redefined. A later version of this profile that changes the
meaning of a member mints a new path, for example `.../sfc/extensions/v2/hardware-lifecycle`,
and leaves the existing names as they are. Documents already published keep their meaning.

A publisher using these names SHOULD list them in its methodology document, each with a
pointer to its definition, as the draft recommends.

A consumer that does not implement a name ignores the whole value under it. That is a rule
of the draft, and it is why an unknown extension never makes a document non conformant.

## 5. The extensions

### 5.1 Reading the tables

"Required" below is required **within the extension value**, for a publisher that carries
that extension at that level. No extension is ever required by the draft, and a document
carrying none of them is a perfectly good declaration.

Every member name is ASCII and is compared as written. A member not listed is not defined
by this profile. A value of the wrong JSON type is read as absent by a checker implementing
this profile.

### 5.2 `hardware-lifecycle`

What the hardware behind the subject is, and what happens to it afterwards.

| Member | JSON type | Unit | Meaning | Required |
|---|---|---|---|---|
| `general-purpose-hardware` | boolean | none | True when the work runs on commodity hardware that has other uses when this system no longer needs it. | yes |
| `single-use-asic-required` | boolean | none | True when taking part requires purpose built devices with no other use. | yes |
| `expected-service-life-years` | number, non negative | years | Planned in service life of the hardware behind the subject. | no |
| `embodied-carbon-in-scope-3` | boolean | none | True when the emissions of making that hardware are inside the `scope-3` figure of the same object. | no |
| `reuse-and-recycling-policy-uri` | string, absolute https URI | none | The published policy for reuse, resale and recycling at end of life. | no |

A publisher that cannot answer the first two members omits the extension rather than
guessing. The two booleans are the criterion; the rest is context.

### 5.3 `carbon-neutrality`

The net zero position for the period, and the evidence behind it.

| Member | JSON type | Unit | Meaning | Required |
|---|---|---|---|---|
| `net-zero-status` | string | none | One of `achieved`, `partial`, `not-achieved`. `partial` means some of the residual was addressed and some was not. | yes |
| `renewable-procurement` | string | none | How renewable energy was obtained. One of `on-site-generation`, `power-purchase-agreements`, `unbundled-certificates`, `supplier-tariff`, `grid-average`, `mixed`. | no |
| `residual-emissions-tCO2e` | number, non negative | metric tons CO2e | The emissions remaining for the period after reductions, which retirements are meant to address. | no |
| `offsets-retired-tCO2e` | number, non negative | metric tons CO2e | Carbon credits retired for this period, in the publisher's name. | no |
| `offset-registry-uri` | string, absolute https URI | none | The registry record of those retirements, where serial numbers can be read. | no |
| `offsets-attested-by` | string | none | The party that issued the statement at `verifiable-attestation-uri`, named so that a reader knows whose key to look for. | no |

A net zero claim is a claim. It is published beside the gross figures that support it, never
instead of them. See rules 1 and 6 of section 6.

### 5.4 `network-topology`

The shape of the network, and, at the operator level, which network the operator belongs to.
Both sets live under one name because they describe one thing, the network the subject sits
in, and because a name minted is a name kept forever. Two names for one subject would cost
more than the one member each level ignores.

**Network level members.**

| Member | JSON type | Unit | Meaning | Required |
|---|---|---|---|---|
| `consensus-mechanism` | string | none | How the network agrees, for example `proof-of-stake`, `proof-of-work`, `proof-of-authority`, `dag`, `hybrid`. Any other value is a short human readable description. | yes |
| `validated-node-count` | number, non negative integer | count | Nodes counted as taking part over the reporting period, on the method below. | yes |
| `node-count-validation-method` | string | none | How that count was arrived at, in one sentence. The long form belongs in the methodology document. | yes when `validated-node-count` is present |
| `per-transaction-energy-Wh` | number, non negative | Wh per transaction | Energy per transaction over the period. The draft has no energy per functional unit member, which is why this is here. | no |
| `nakamoto-coefficient` | number, non negative integer | count | Smallest number of parties that together could control the network. | no |
| `geographic-regions` | number, non negative integer | count | Distinct regions the counted nodes ran in. | no |

**Operator level members.**

| Member | JSON type | Unit | Meaning | Required |
|---|---|---|---|---|
| `member-of-network` | string | none | The `target` value of the network this subject takes part in, written exactly as the network writes it. | yes at operator level |
| `network-declaration` | string, absolute https URI | none | Where the network's own declaration is published. | no |

An object carries the network level members or the operator level members, not both. A
checker reading `member-of-network` treats the declaration as operator level whatever else
it carries.

`upstream` is not membership. See rule 5 of section 6.

## 6. Six rules a publisher can get wrong

**Rule 1. `carbon-footprint` is gross, always.** The draft defines it as gross emissions
attributable to the subject, and it MUST NOT be negative. A publisher MUST NOT reduce it,
or drive it to zero, to show a position reached after offsets. The gross figure stays in
band and the net zero position lives in the `carbon-neutrality` extension. The scope members
MAY be negative, but only where the accounting genuinely conveys removals, and the basis
then goes in the methodology document.

**Rule 2. There is no `TWh`.** `energy-unit` is one of `Wh`, `kWh`, `MWh`, `GWh`. A
document carrying `TWh` fails both schemas. Restate the figure, as section 3.1 shows.

**Rule 3. A network is a `service`, not a `network`.** `target-type` is a closed
enumeration and `network` is not in it. Use `service` for the system, `origin` for a node
or a gateway, `organization` for the body that publishes, `device` for one machine, and
`tenant` for what a provider delivers to one customer.

**Rule 4. Hardware lifecycle data never travels alone.** A declaration object carries at
least one numeric metric member, or `disclosure-uri`, or `verifiable-attestation-uri`. An
object whose only payload is an extension is not a conformant declaration, whatever the
extension holds.

**Rule 5. `upstream` points at suppliers, not at the network.** `upstream` names the
declarations of providers whose output flows into the subject: hosting, cloud, content
delivery, network transit, electricity. A network is not a supplier to its operators, it is
the aggregate of them, so membership is declared in `network-topology` instead. Using
`upstream` for membership would also invite a comparison the draft defines only for a
tenant scoped declaration, and produce a false finding.

**Rule 6. Say attested, never verified.** The draft lets a consumer report a figure as
unverified, and forbids it from presenting one as verified. A profile statement, a checker's
output and a publisher's own prose therefore say that a statement is attested by a named
party, and verifiable against that party's key, once a reader has fetched it and checked it
against an issuer the reader trusts. The presence of `verifiable-attestation-uri` is
evidence of nothing on its own. A correctly signed figure that is false is still false.

## 7. Three boundaries

### 7.1 Real time measurement, periodic publication

Grid carbon intensity is measured continuously, and a publisher SHOULD feed its model from
a live regional grid source. Publication is another matter. The draft recommends against
reporting at a granularity finer than 24 hours, and says that real time telemetry is not
recommended, because fine grained energy data lets an observer correlate energy with what
individual users did.

So: real time is an input to the measurement, and the published document is periodic.
`carbon-intensity-gCO2e-per-kWh` is the intensity weighted over the whole reporting period,
which is the right form for an annual declaration. A publisher wanting to show movement
within the year publishes a monthly trend through the extended query parameters, never a
live feed.

### 7.2 The on ledger evidence trail stays outside the draft

Many systems keep their own evidence trail: attestation events, retirement records,
signed measurements written to the system itself. None of that is in the draft. The draft
names no ledger, no chain and no on chain artefact, and it is not going to, because it is a
disclosure format for any HTTP origin.

The trail is reachable from the declaration by exactly one route: `disclosure-uri`, which
names a machine readable index, and the index names the trail. A publisher MUST NOT invent
a top level member for it. A publisher MAY describe the trail in its methodology document.
That is the whole of the relationship, and it is enough: the reader who wants the trail
follows one link.

### 7.3 Bespoke endpoints are replaced, not documented

Earlier profile material described service specific endpoints under paths such as
`/v1/sustainability/...` for figures, disclosures and conformance. Under this profile they
are gone, and each is replaced by something a stranger can find:

| Old bespoke endpoint | What replaces it |
|---|---|
| a figures endpoint | the network level declaration at `/.well-known/sustainability-data` |
| a per operator figures endpoint | the operator level declaration at the operator's own origin |
| a disclosures endpoint | `disclosure-uri`, naming a machine readable index |
| an attestation endpoint | `verifiable-attestation-uri`, naming a signed statement by another party |
| a trend or history endpoint | the extended query parameters `period` and `granularity` on the same URI |

A bespoke endpoint has to be documented, discovered and agreed before anyone can read it,
which is the problem the well known URI removes. Keeping one beside the declaration would
undo C4 rather than satisfy it. A publisher MAY keep private endpoints for its own use, but
they are not part of this profile and a checker will not look for them.

## 8. How to check a declaration

`sfc-check.mjs` in this directory reads a declaration, from a local file or from an origin,
and reports the four criteria as this profile defines them. See `README.md` for how to run
it.

What it does:

* validates the document against the draft, schema and prose rules alike;
* evaluates C1 only on an annual object whose `target-type` is `service`, converting the
  figure to GWh and comparing it with 1 GWh, and refuses with a stated reason on anything
  else;
* reports C2 and the net zero position as **declared**, never as passed;
* checks C3 for presence and coherence, which is as far as a reader can get from a
  document;
* treats C4 as a mechanism: the document validates, and, when an origin was given, the
  origin answers as the draft requires;
* fetches and checks an attestation only when asked, with `--verify-attestation`.

It exits non zero on two things only: the document does not conform to the draft, or the
annual network figure is at or above the cap. Everything else is reported and the exit
status stays zero, because a missing extension is a gap in disclosure, not a broken
document.

## 9. What a conformance statement may claim

A publisher, an aggregator or a checker writing about a declaration under this profile:

**MAY say**

* that the document conforms to the draft, having validated it;
* that the declared annual figure for the named subject is below, at, or above 1 GWh, with
  the figure and the unit quoted;
* that the declaration **declares** general purpose hardware, or a net zero position, or a
  node count, naming the extension it read;
* that a named party has attested to the figures, and that the statement verifies against
  that party's key, once the statement has been fetched and checked;
* that the origin answers as the draft requires, naming the checks that were run;
* that a figure is unverified, which is the draft's own word for every figure by default.

**MUST NOT say**

* that a figure is verified, or true, or accurate;
* that the system is compliant, sustainable, green or net zero as a finding of its own. The
  document declares; the reader concludes, and says on what;
* that C2 passed. Nothing a reader can do with a document establishes what hardware exists;
* that C1 passed on an operator level or a sub annual document. The criterion is a whole
  system annual figure, and a single validator is trivially under any system wide cap;
* that figures from two publishers are comparable without checking that
  `carbon-accounting`, `measurement-method` and the period agree, and that both methodology
  documents describe the same boundary;
* that the presence of `verifiable-attestation-uri`, or of a valid `signed` member, is
  evidence about a figure. The first is evidence once fetched and checked, and even then
  about the statement, not the figure. The second establishes integrity and continuity of
  authorship, and nothing else.

A statement of profile conformance is therefore always of this shape: *this declaration
conforms to the draft, and under the SFC profile version 1.0 it declares X, Y and Z, of
which the annual energy figure was checked against the 1 GWh cap on the date shown.*

## 10. Examples

Two reference declarations live in `examples/`. Both validate against the JTD schema, the
CDDL schema and the consumer library's prose rules. Both use reserved `.example` names, and
both say in band, in `provider`, that every figure in them is invented.

| File | Level | What it shows |
|---|---|---|
| `examples/sfc-network.example.json` | network | the full member set, an annual period, 800 MWh against the 1 GWh cap, gross carbon with the scopes, and all three extensions |
| `examples/sfc-operator.example.json` | operator | one validator operator, `upstream` naming its cloud and electricity providers, and membership declared in `network-topology` |

The network example is internally coherent, which a reader can check by hand: 800 MWh is
800 000 kWh, times 41.4 gCO2e per kWh is 33.1 mtCO2e, the declared `scope-2`; the three
scopes sum to 95.5, the declared `carbon-footprint`; and 95.5 mtCO2e is 95 500 kg, the
declared `estimated-annual-emissions-kgCO2e`. A publisher SHOULD make its own figures
reconcile the same way, and a reader SHOULD check.
