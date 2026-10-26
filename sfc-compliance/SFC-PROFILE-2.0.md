# The Sustainability-First Consensus (SFC) profile, version 2.0

**Short name:** SFC 2. **Version:** 2.0 (semantic versioning, section 9). **Status:** normative profile; the
adoption date is set when the version is released.
**Replaces:** ledger profile 1.1 and 1.2, and disclosure profile 1.0, 1.1 and 1.1.1 (Appendix C maps every
1.x item; Appendix E gives where each stays reachable).
**Written against:** [draft-besleaga-sustainability-wellknown-10][Draft -10]
(the *draft*; Internet-Draft, work in progress, Independent Submission). Draft -11 changes text only, so a -10
document is a valid -11 document and this profile applies to both. Appendix D lists every member and token of
the draft that this profile relies on, so a later revision can be checked against one list.

| Reader | Start with |
|---|---|
| Implementer | Sections 3, 5, 6, 7 and Appendices A and B; terms are in 1.2 |
| Reviewer | Sections 2, 4 and 7 |
| Regulator or journalist | Sections 2, 4 ("What the rule claims") and 8 |
| Student | Sections 0, 2 and 4 |

## 0. Status, scope and citation

SFC 2 is the engineering profile of one framework. The framework is defined in [Column]:

> Besleaga, A. N. "'Sustainability-First Consensus' Ledgers for a Green Digital Future."
> *Communications of the ACM*, Opinion, in press, doi:10.1145/3809296.
> ORCID 0009-0001-3464-5283.

(The DOI returns "not found" until ACM publishes the column; year, volume, issue and pages are added then.)
Any deployment that claims SFC cites the column and this profile. This profile cites itself by its Zenodo
concept DOI, 10.5281/zenodo.22681204, which resolves to the latest version; the version DOI of 2.0 is assigned
at deposit.

The profile states the rules that make the framework's four criteria checkable: what a ledger records, how
the records are summed, how the sums are published at `/.well-known/sustainability-data`, and which checks a
reader can run. It does not repeat the column's argument. It changes nothing in the draft and adds no
top-level member to it. Everything the draft does not define is carried under extension names (section 6).

A figure published under this profile is a claim of the origin that served it, which is the draft's own
position. Nothing in this profile makes a figure true (section 8).

## 1. Conventions

### 1.1 Key words and structure

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be read as
in BCP 14 ([RFC 2119], [RFC 8174]) when, and only when, they appear in capitals. They constrain a ledger, a
publisher, an emitter and a checker that claims this profile. They never constrain the draft.

Each rule is stated once. Other sections point to it by number. "Table row" means a row of a member table
in this document; the JSON Schemas of Appendix A are generated from those tables.

### 1.2 Terms

| Term | Meaning |
|---|---|
| operator | A party that runs nodes of the ledger and has a Registry entry (section 3.1). Identified by a DID string ([DID Core]), compared as a string; any DID method. |
| Registry | The ledger's set of Registry entries. |
| network | The system whose energy criterion C1 is judged; its declaration is the network declaration. |
| hot path | The ledger that carries the system's operational events. |
| month | A calendar month in UTC. Its *bounds* are the first instant of the month and of the next month, each written `YYYY-MM-01T00:00:00Z`, the way the draft writes a `period`. |
| calendar year | Twelve consecutive months from 1 January, bounds written likewise. In a declaration with no ledger evidence the bounds may carry one numeric offset; the year is then the year in that offset, and it is used only by C-SFC-2 disclosure form. |
| instant | An [RFC 3339] `date-time` with upper-case `T` and, where no numeric offset is written, `Z`. A numeric offset (`+hh:mm`, `-hh:mm`) is allowed, as in the draft's `updated` and `period`; fractional seconds are allowed; second 60 is not. Instants compare as the moments they denote, whatever their offsets. |
| commit instant | The instant the ledger assigns to an event when it accepts it. Commit instants strictly increase along the ledger; *ledger order* is commit order. |
| check instant (T) | The instant at which a check is run. For a check that uses a ledger read and has no explicit T, T is the `read-at` of that read; it fixes the evaluation window and the cut-off, and the checker prints it. An explicit T later than `read-at` makes every check that needs that read NOT-EVALUABLE, because the read is older than the cut-off. For a check with no ledger read (C-SFC-3, the disclosure parts of C-SFC-6) and no explicit T, T is the checker's clock. |
| grace period (G) | 5 days of 24 hours. The *due instant* of a month is its end bound plus G. |
| evaluation window | The 12 months that ended at least G before T: the last is the latest month whose due instant is at or before T. |
| active | An operator is *active in a month* when one of its Registry `active` intervals overlaps the month: the interval's `from` is before the month's end and its `to` is null or after the month's start. An *operator-month* is a pair (operator, month) with the operator active in that month. The Registry is taken as the read supplies it (section 3.1). |
| counted operators | The operators active in at least one month of a declaration's `period` (section 5.4), or, for a check on a ledger read alone, of the evaluation window. |
| attestation | One signed event of type `EnergyAttested` or `CarbonAttested` (section 3). |
| chain | For one operator and one type, the attestations linked by `prev`, in ledger order. |
| tip | The hash of the last event of a chain at the moment the ledger judges a new event; null when the chain is empty. |
| cut-off | The instant after which events are ignored. For a check of a declaration it is the declaration's `updated`; for a check with no declaration it is T. |
| effective attestation | For one operator, type and month: the latest attestation in chain order whose period is that month, whose commit instant is at or before the cut-off, and that breaks no rule of section 3.5 (an attestation that does is skipped; section 3.5). Every sum and check uses effective attestations only, so each month counts once. |
| head | The hash of the last attestation, in chain order, of a chain that was committed at or before the cut-off and whose period ends at or before the end of the declared period; null when there is none. |
| silent | An operator-month with no effective attestation of a type is silent for that type. |
| retirement | The cancellation of whole carbon credits (one tonne of CO2e each) in a registry. |
| offset coverage | The condition of section 4. The column calls it "Net Zero". It is not net zero; section 2.1.2 says why. This profile uses the column's word only in names that were minted earlier. |
| network declaration | A declaration object about the whole network for one calendar year (section 5.1). |
| operator declaration | A declaration object about one operator (section 5.1). |
| claims SFC | A declaration object *claims SFC* when its `extensions` member carries any extension name of section 6.1 other than the superseded `ledger-evidence`. |
| shallow check, deep check | The procedures of section 7.3 and 7.4. |
| Scope 1, 2, 3 | Direct, purchased-energy and value-chain greenhouse-gas emissions as the GHG Protocol defines them ([GHG Corporate Standard], [GHG Scope 2], [GHG Scope 3]). |
| market-based, location-based | The two bases for Scope 2 in [GHG Scope 2]: with the buyer's contractual instruments, or with the regional grid average. |
| CSRD | The Corporate Sustainability Reporting Directive, Directive (EU) 2022/2464 ([CSRD]). |
| ESRS E1 | The climate standard of the European Sustainability Reporting Standards adopted under the CSRD. |
| ESG | Environmental, social and governance (reporting). |
| MiCA | The Markets in Crypto-Assets Regulation, Regulation (EU) 2023/1114 ([MiCA]). |
| WEEE | Waste electrical and electronic equipment, as Directive 2012/19/EU ([WEEE]) defines it. |
| CBECI, CCRI | The Cambridge Bitcoin Electricity Consumption Index and the Crypto Carbon Ratings Institute's method ([CBECI], [CCRI]). |
| CDDL | The Concise Data Definition Language ([RFC 8610]), in which the draft defines its members. |
| JWS | JSON Web Signature ([RFC 7515]). |

### 1.3 Arithmetic

1. Every number is read as the exact decimal value of its RFC 8785 text ([RFC 8259] number syntax). Every sum
   and comparison uses exact arithmetic: decimal for sums, rational where a division occurs. No binary floating
   point. The exact reading is safe because rule 2 limits the digits.
2. Every figure in an event is in kWh or kg, is finite, is not negative, and has at most 15 significant digits
   and at most 6 decimals. Such a number has no exponent in its RFC 8785 text and survives a round trip through
   an IEEE 754 double unchanged. `tonnesRetired` is an integer of at most 15 digits. A figure that breaks this
   rule fails L8.
3. A published sum, and a published intensity, is the exact value in the unit it is published in (kWh and kg
   in an `operators` entry), rounded half to even to 6 decimals. It is held to the limit of rule 2: a value
   that would need more than 15 significant digits is outside this profile, which at 6 decimals means a value
   of 10^9 or more unless its trailing decimals are zero. The limit is in digits, not in magnitude. A member
   that this profile requires to be rounded this way is compared by equality with that value; rule 4 does not
   apply to it.
4. **Tolerance rule.** A coherence comparison of a published value P (section 7.3 S6, section 7.4 D6) is made
   after converting every value and every tolerance to P's unit. Here k of a figure is the number of digits
   after the decimal point in its RFC 8785 text (0 for an integer, so an integer tolerates ±0.5 of its unit),
   except that k is 6 for the top-level figures of an object that carries `ledger-evidence-2`
   (`energy-consumption`, `scope-1`, `scope-2`, `scope-3`, `carbon-footprint`, `offsets-retired-tCO2e`,
   `carbon-intensity-gCO2e-per-kWh`, each in the unit it is published in) and for the figures of an
   `operators` entry. There are three forms.
   - **Against an exact value E** recomputed from the ledger: passes when |E − P| ≤ ½ × 10^−k(P).
   - **Against a sum of published terms** T1 … Tn: passes when |P − ΣTi| ≤ ½ × 10^−k(P) + Σ ½ × 10^−k(Ti).
   - **Against a quotient or product of published values:** section 7.3 S6 d gives the form.
   The members of an `operators` entry are compared with their exact sums by equality (rule 3), never by this
   rule.
5. A comparison between two published values, such as "at least" or "equal", is exact and has no tolerance.

### 1.4 Units

`tCO2e` is 1 000 kgCO2e; `kgCO2e` is 1 000 gCO2e. `GWh` is 1 000 000 kWh, `MWh` 1 000 kWh, `kWh` 1 000 Wh.
The cap of criterion C1 is written once, as **CAP = 1 000 000 kWh** (the column's 0.001 TWh), a parameter
with its source (section 9.2). The draft's `energy-unit` has no TWh value, so no declaration states TWh.

### 1.5 Value forms

| Form | Definition |
|---|---|
| `instant` | As in section 1.2. |
| `month-bound` | An `instant` that is the first instant of a month, written `YYYY-MM-01T00:00:00Z`, no fraction. Months and `month-bound` values are written with `Z` only. |
| `full-date` | An [RFC 3339] `full-date`, `YYYY-MM-DD`. |
| `hex64` | 64 lower-case hexadecimal characters. |
| `b64url` | base64url without padding ([RFC 7515], Section 2). An Ed25519 signature is 86 characters; a public key `x` is 43. Only the canonical encoding is valid: re-encoding the decoded bytes must reproduce the string. |
| `did` | A non-empty string starting `did:`. |
| `host` | A host name, an internationalised name in A-label form ([RFC 5890]), without scheme, port or path, written in lower case. Hosts are compared after ASCII lower-casing of both sides; a value written in upper case is accepted as input. |
| `https-uri` | An absolute URI with scheme `https`. No URI normalisation is applied when two of them are compared. |
| `uri` | A URI reference as the draft defines it for its URI-valued members. |
| `sha256` | SHA-256 over the RFC 8785 text of an object, as `hex64`. |

### 1.6 Hashing and signing

1. The hash of an event is `sha256` over the RFC 8785 ([RFC 8785]) serialisation of the whole event, `sig`
   included.
2. The signing input of an event or Registry entry is the RFC 8785 serialisation of the object without `sig`.
   `sig` is `{"alg": "Ed25519", "value": <b64url>}` ([RFC 8032], [RFC 9864]). The only algorithm for events and
   Registry entries is Ed25519; a verifier takes the algorithm from this rule, never from `sig.alg` alone.
3. A reader ignores members it does not know, in events, payloads, Registry entries and extension values.
   Such members still enter every hash and signature, because those cover the whole object.
4. The `signed` member of a declaration object is the draft's own (JWS Compact, `cty`
   `sustainability-data+json`). Unlike events (rule 2), `signed` is not limited to Ed25519: `alg` names an
   asymmetric signature algorithm (`Ed25519` and `ES256` are the draft's RECOMMENDED values; `none` and MAC
   algorithms are forbidden), and this profile adds no restriction. SFC 2 adds no rule to its format; section
   5.2 says when it is required.
5. Ed25519 verification rejects a signature whose scalar S is not below the group order L ([RFC 8032],
   Section 5.1.7) and a `sig.value` that is not canonical `b64url`. Either fails the row "encoding" of D3
   (7.4).
6. An event, a Registry entry and a ledger excerpt are I-JSON text ([RFC 7493]), which [RFC 8785] requires of
   its input: no duplicate member names and no unpaired surrogates. Input that is not I-JSON fails the row
   "encoding" of D3 (events) or D2 (Registry entries); a parser that cannot detect duplicate names reports that
   row NOT-EVALUABLE.

## 2. The four criteria, applied

### 2.1 Criteria table

Column 1 is the printed text of the column, verbatim. Column 2 says how SFC 2 applies it. Column 3 names every
narrowing or interpretation; sections 2.1.1 and 2.1.2 state each with its reason.

| Printed criterion | As SFC 2 applies it | Narrowing and reason |
|---|---|---|
| **C1 Energy Consumption.** "Total annualized network energy consumption to be < 0.001 TWh (1 GWh) systemwide." | The sum of the energy of all nodes is below CAP, over one calendar year (disclosure form) or over the evaluation window (ledger form). Checked in two forms: from the ledger (C-SFC-2 ledger form) and from a network declaration (C-SFC-2 disclosure form). | Three interpretations (boundary, annualised, measurement); see 2.1.1. |
| **C2 Hardware Lifecycle.** "Mandatory extended hardware utility to prevent e-waste (for example, using general-purpose hardware rather than single-use ASICs)." | Every active operator declares its node hardware in its Registry entry (section 3.1). The result is reported as declared, never as passed (C-SFC-3). | No document establishes what hardware exists, so the check tests that a complete declaration is present and in the closed list of classes. The column's example becomes the test (class list, `asicForbidden` true); "extended utility" is carried by the purchase date, the planned retirement date and the reuse policy. |
| **C3 Carbon Accountability.** "Native on-chain carbon transparency and regulatory-aligned thresholds requiring annual Net Zero status via direct renewables or verified offsets." | Every operator attests Scope 2 and Scope 3 emissions every month, Scope 1 too when it has any (omitted counts as 0), and its retired credits, on the ledger. The rule of section 4 (offset coverage) is tested per operator per month (C-SFC-4). | Six interpretations (stricter than annual, verified offsets, direct renewables, regulatory-aligned thresholds, real-time monitoring, audit trails); see 2.1.2. |
| **C4 Regulatory Readiness.** "Architecture must support auditability standards compatible with CSRD and ESG reporting (for example, accessible via APIs)." | The declaration at the well-known URI is the machine-readable, API-style access (C-SFC-5), and the ledger read of section 3.7 gives audit access. | SFC 2 applies the machine-readability part. The declaration maps onto quantities of ESRS E1 and onto the MiCA sustainability indicators; it is not a regulatory filing and does not replace one. For Scope 2, both bases are needed; see 5.3. |

The column says the thresholds are "an adaptable baseline, designed to evolve"; section 9.2 says how the
parameter changes.

The criteria and CAP are design constraints that a conforming system commits to meet. They are not a statement
that any system meets them. Published estimates for low-energy public ledgers range from well below to above
1 GWh a year, depending on boundary and data provider.

#### 2.1.1 C1: boundary, annualised, measurement

- **Boundary.** "Systemwide" has no definition in the column. SFC 2 uses the boundary of Commission Delegated
  Regulation (EU) 2025/422, Annex, Table 2, field S.8 ([Delegated Regulation 2025/422]): the energy used for
  validating transactions and for maintaining the integrity of the ledger, per calendar year. Recital 8 names
  both activities and says the integrity work is done by all DLT network nodes, so this profile counts all
  nodes. This profile also counts data-centre overhead inside the boundary. Article 6(5) calculates S.8 under
  the ESRS E1 calculation guidance; this profile does not apply that guidance. Article 6(6) excludes offsets,
  which is why the C1 and C3 figures here are gross. Anything inside the boundary is attested by an operator or
  is excluded and named as excluded in the methodology document (gateways, storage, backups, an anchor chain's
  share); a consortium that runs shared parts registers itself as an operator for them. Client and user devices
  are excluded.
- **"Annualized"** is read as one calendar year, because S.8 counts per calendar year. That is the reading for
  the disclosure form. The ledger form reads it as the 12 months of the evaluation window (section 1.2), a
  rolling year that need not be a calendar year. The two forms can disagree for a network that changes during
  the year; the report row of each names its period or window.
- **Measurement** follows the column: methods aligned with CBECI for proof-of-work or CCRI for proof-of-stake
  and hybrid platforms, "based on transparent hardware assumptions, energy grid mix data, and validated node
  counts"; the methodology document names the method. Published figures for one ledger differ by a factor of
  two or more with boundary and data provider, so figures are compared only on one boundary.

#### 2.1.2 C3: interpretations

- **Stricter than annual.** The column states the status annually; SFC 2 tests every month of the window, and
  an annual network result follows only when every operator-month holds.
- **"Verified offsets"** is read as credits retired in a registry, with a registry reference. SFC 2 does not
  judge the quality or the verification standard of credits; the methodology document names the standard.
- **"Direct renewables"** is admitted as any market-based contractual instrument, unbundled certificates
  included, through a market-based Scope 2 figure. This is wider than "direct" and is stated here as an
  interpretation.
- **"Regulatory-aligned thresholds"** is not implemented. SFC 2 sets no carbon threshold that is aligned to a
  regulation. The only carbon test is the offset-coverage rule of section 4, which is this profile's own rule.
  The Scope 2 and Scope 3 definitions are those of the GHG Protocol; they define quantities, not thresholds.
- **Real-time monitoring** of grid carbon intensity is not checked. SFC 2 carries a monthly attestation. The
  attestation names the intensity source in `gridIntensityRef` and the production method in
  `measurementMethod`, and the draft recommends against publishing finer than daily. This is narrower than the
  column.
- **"On-chain audit trails"** are the attestation chains.
- **Offset coverage is not net zero.** Under the GHG Protocol Corporate Standard credits stay outside the
  emissions inventory. The SBTi Corporate Net-Zero Standard v1.3.1 ([SBTi]) admits credits (criterion C12)
  only to neutralise residual emissions (C28) or to finance mitigation beyond a company's science-based targets
  (R12), and never as emission reductions toward those targets; C28 describes neutralisation as removing carbon
  and storing it permanently once the long-term target is reached. So offset coverage is not net zero in either
  sense.

### 2.2 Platform rule and migration

Section 2.2 is this profile's addition, not a printed criterion. Rule 1 bars proof-of-work from the hot path
regardless of measured energy. Rule 2 requires a public assessment of a 12-month period that ended at most 18
months before T.

1. A **proof-of-work** ledger MUST NOT be used for any event that SFC 2 relies on, nor as the network's hot
   path (section 1.2).
2. A **public** hot path (a platform whose nodes are not all registered operators of the deployment) MUST have
   a public assessment, on the boundary of C1, of a 12-month period that ended at most 18 months before T,
   with a figure below CAP (C-SFC-6, public case).
3. A **permissioned** hot path run only by registered operators is assessed by the deployment's own
   C-SFC-2. If every month of the evaluation window has at least one active operator, the case passes when
   C-SFC-2 (ledger form) passes. Otherwise it passes when the registered-node bound is below CAP (C-SFC-6,
   permissioned case). The bound is N × P × O × 8 784 h ÷ 1 000 < CAP, where N is the greatest number of nodes
   the registered operators may run; P is the rated power in watts of the worst hardware class in use, so that
   the product N × P × O × 8 784 h is in Wh and the division by 1 000 gives kWh, the unit of CAP (section
   1.4); O is the data-centre overhead factor (at least 1), stated in the methodology document with no
   default; and 8 784 h is a leap year's hours. For example, 100 nodes of 500 W with O = 1.5 give
   100 × 500 × 1.5 × 8 784 ÷ 1 000 = 658 800 kWh, below CAP.
4. A public chain that is not proof-of-work MAY serve as an anchor. The anchor is informative only (Appendix E);
   no normative rule or check depends on it, and no platform is named normatively; the notes in Appendix E are
   informative.
5. **Migration.** When C-SFC-6 places the hot path at or above CAP, or C-SFC-2 does so where the window is
   fully covered, the deployment moves to a qualifying ledger within 12 months and carries its chain tips
   over: the first event of a chain on the new ledger links by `prev` to the old tip. The methodology document
   lists, per subject and type, the old ledger and the old tip at takeover. The new ledger cannot check that
   hash itself, so it accepts the listed value (section 3.5 L4).

## 3. Ledger records

### 3.1 Registry entry

One Registry entry per operator. Its signing input is the entry without `sig`; its signer is the *registrar*.
The methodology document names the registrar's public key. A replacement registrar key is added only by that
document, and an entry signed under a former key listed there stays valid while the document still lists it.
A registrar re-signs an entry whenever it changes. A change MAY append an `active` interval, append a `keys`
element, close an open end (`to`, `validToCommit`), or replace `nodeProfile` as a whole; a past interval is
never altered. `operator` and `origin` never change; a different DID or host is a new entry. Key rotation is a
new `keys` element and the old one closed. An operator SHOULD NOT use one signing key in more than one network.

Closing `to` or `validToCommit` at an earlier value than the time of the change is a registrar act: it can
correct an operator's end date or revoke a compromised key. A verifier takes the entry as signed and applies it
to the whole window; the registrar is trusted for the Registry content, and the Registry is judged as read
(section 7.5). A registrar SHOULD publish the reason and the date of such a change in the methodology document.
The schema is `schemas/registry-entry.json`.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `operator` | `did` | yes | The operator's DID. Unique in the Registry. |
| `origin` | `host` | yes | The host of the operator declaration. Unique in the Registry. It is the `target` of that declaration. |
| `active` | array of `active` objects, at least 1 | yes | Intervals in which the operator is active. Sorted, not overlapping. |
| `keys` | array of `key` objects, at least 1 | yes | The operator's signing keys with their validity. |
| `nodeProfile` | object, table below | yes | The hardware declaration (criterion C2). |
| `sig` | `{alg, value}` | yes | The registrar's signature (section 1.6). |

`active` object:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `from` | `month-bound` | yes | Start of the interval, included. |
| `to` | `month-bound` or null | yes | End of the interval, excluded; null while the operator is still active. Later than `from`. |

`key` object:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `jwk` | object `{kty, crv, x}` | yes | `kty` is `"OKP"`, `crv` is `"Ed25519"`, `x` is `b64url` of 43 characters ([RFC 8037]). |
| `validFromCommit` | `instant` | yes | The key verifies events committed at or after this instant. |
| `validToCommit` | `instant` or null | yes | The key verifies events committed before this instant; null while valid. |

A key is *valid for an event* when `validFromCommit` ≤ the event's commit instant < `validToCommit` (null is
unbounded).

`nodeProfile` object:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `hardwareClass` | string, one of `general-purpose-x86`, `arm64-server`, `rpi-cluster`, `cloud-instance`, `accelerator-server` | yes | The class of the operator's node hardware. `cloud-instance` is a rented virtual machine; `accelerator-server` is a general-purpose server with accelerators. The list is closed for all 2.x; a new class is a 3.0 change. |
| `asicForbidden` | boolean, `true` | yes | The operator runs no single-use ASIC hardware. Key-custody hardware security modules are general-purpose security devices and are accepted. |
| `purchasedAt` | `full-date` | yes | When the node hardware was bought or the instance started. |
| `expectedRetireAt` | `full-date` | yes | Planned end of use; not before `purchasedAt`. |
| `reusePolicy` | string, one of `donate-to-education`, `resell-refurbished`, `recycle-WEEE-certified` | yes | What happens to the hardware afterwards. |
| `serviceLifeMonths` | integer, at least 1 | no | Planned service life in whole months, when the operator states it separately. |

### 3.2 Event envelope

Both event types use one envelope.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `type` | string, `"EnergyAttested"` or `"CarbonAttested"` | yes | The event type. |
| `network` | `host` | yes | The network's `target` (section 3.8). The ledger rejects an event whose `network` is not its own (L1), so a signed event cannot be replayed in another network's ledger. |
| `subject` | `did` | yes | The operator the event is about. |
| `actor` | `did` | yes | The operator that signed it. Equal to `subject`. |
| `prev` | `hex64` or null | yes | The hash of the previous event of the same type for the same subject (the tip); null only for the first, with the exception of L4. |
| `ts` | `instant` | yes | The operator's emission time. Informative beyond L3: no check compares it with the commit instant, and it is never used for keys or ordering. |
| `payload` | object | yes | Section 3.3 or 3.4. |
| `sig` | `{alg, value}` | yes | Section 1.6. |

### 3.3 `EnergyAttested` payload (criterion C1)

| Member | Type | Required | Meaning |
|---|---|---|---|
| `period` | `{start, end}` of `month-bound` | yes | One whole month: `end` is the next month's first instant. |
| `nodeCount` | integer, at least 0 | yes | Nodes the operator ran in the month. |
| `kWhConsumed` | number, kWh | yes | Energy consumed by those nodes in the month, on the boundary of section 2.1.1, including everything the operator attests for that boundary. |
| `measurementMethod` | string, one of `hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled` | yes | How the figure was produced, in the draft's four tokens, most to least direct. The list is closed for all 2.x. The methodology document defines the method. |
| `evidence` | `uri` | yes | Where the evidence (meter exports, model inputs) is kept. An `ipfs:` URI names content by identifier; an `https:` URI names a location. |
| `supersedes` | `hex64` | no | Present exactly as rule L6 says. |

### 3.4 `CarbonAttested` payload (criterion C3)

| Member | Type | Required | Meaning |
|---|---|---|---|
| `period` | `{start, end}` of `month-bound` | yes | The same month as the matching `EnergyAttested`. |
| `scope1KgCO2e` | number, kg | no | Direct emissions in the month (a backup generator is Scope 1). Absent means 0. |
| `scope2KgCO2e` | number, kg | yes | Purchased-electricity emissions, **market-based** (GHG Protocol Scope 2 Guidance): the operator's contractual instruments where it has them, otherwise supplier-specific or residual-mix factors, or grid-average factors where no residual mix exists. |
| `scope2LocationKgCO2e` | number, kg | no | The location-based figure for the same month, from regional grid data. Used for the optional second declaration object (section 5.3). |
| `scope3KgCO2e` | number, kg | yes | Value-chain emissions in the categories the methodology document lists. Capital goods are counted in the month of acquisition, as the GHG Protocol Scope 3 Standard recommends; amortising over service life (as ISO/IEC 21031:2024 does) is a stated deviation in the methodology document. Removals are not counted: the value is not negative. |
| `gridIntensityRef` | string | yes | The source, zone and period of the grid-intensity data used. |
| `retirements` | array of `retirement` objects, may be empty | yes | The credits counted for this month. |
| `offsetsKgCO2e` | number, kg | yes | The sum of `kg` over `retirements`; the signed total, kept under its 1.x name. |
| `netZero` | boolean | yes | The offset-coverage flag: equal to the comparison of section 4. The name is kept from 1.x; it is not a net-zero finding. |
| `evidence` | `uri` | yes | Where the retirement records and the emission calculation are kept. |
| `supersedes` | `hex64` | no | Present exactly as rule L6 says. |

`retirement` object:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `registry` | `https-uri` | yes | The registry's own published base URI, written in lower-case scheme and host, with no default port, no query, no fragment and no trailing slash, in the one form the methodology document names for that registry (L8b). |
| `reference` | string, non-empty | yes | The identifier of one retirement record, exactly as the registry shows it, with no trimming or case change. Where a registry identifies a record only by a serial-number range, `reference` is the whole range of that record, never part of it. |
| `tonnesRetired` | integer, at least 1 | yes | Whole tonnes of CO2e in that retirement record. |
| `retiredAt` | `instant` | yes | When the registry recorded the retirement. |
| `kg` | number, kg, at least 0 | yes | The part of that retirement counted in this attestation. |

The *retirement key* is the pair (`registry`, `reference`), compared as two exact strings with no
normalisation. The operator MUST use the same spelling in every attestation. Two citations that differ in
spelling are different keys, so L9 cannot detect that they cite one tonne; the part of the record counted in an
attestation is carried by `kg`, not by `reference`.

The operator MUST publish at the registry the beneficiary and the period of each retirement it counts. The
checks cannot read that publication (deep check D8, section 7.4, is optional). Because of this, a retirement
may be cited by an operator that does not own it: L9 gives the tonne to the first citation, and only D8 can
show who owns the record.

### 3.5 Ledger acceptance rules

The ledger MUST reject an attestation unless all of these hold. A verifier applies the same rules to the
attestations it reads. A rule is judged at the event's own commit instant, using only events committed before
it. An event that breaks a rule stays in the chain, because an attestation is never edited or deleted, but it
is not effective: it is skipped when the effective attestation is chosen, so the previous valid event stays
effective. A ledger that holds such an event is faulty, and D3 or D5 reports the event on its own row.

| # | Rule |
|---|---|
| L1 | `type` is one of the two types, `network` is the ledger's network, and `subject` = `actor` = the DID of a Registry operator active in the attested month. |
| L2 | `payload.period` is one whole month (section 1.2). |
| L3 | `ts` and the commit instant are both at or after `period.end`. |
| L4 | `prev` equals the tip of that subject's chain of that type. It is null only when the chain is empty, except for the first event of a chain on a ledger that took over under section 2.2 rule 5: there `prev` equals the old ledger's tip for that subject and type, as the methodology document records it. |
| L5 | `sig` verifies (section 1.6) under a Registry key of the operator valid for the event. The ledger judges the key at the commit instant it assigns; verifiers use the same instant. `ts` is never used for keys. |
| L6 | `supersedes` is absent when the chain holds no earlier event for the same subject, type and month. Otherwise it is present and equals the hash of the current effective attestation of that subject, type and month. |
| L7 | For a `CarbonAttested`, `netZero` equals the comparison of section 4, computed on the figures in the event. |
| L8 | Every figure meets section 1.3 rule 2 and the member tables; `offsetsKgCO2e` equals the exact sum of `kg` over `retirements`; each retirement's `kg` is at most `tonnesRetired` × 1 000. |
| L8b | **Retirement key form.** Each retirement's `registry` is in the one form the methodology document names for that registry. A citation in any other form is rejected. |
| L9 | **Single use of each tonne.** Take the effective attestations of every operator, with this event in place of the one it supersedes. For each retirement key, every citation states the same `tonnesRetired` and `retiredAt`, and the sum of `kg` over all citations is at most `tonnesRetired` × 1 000. L9 detects only citations whose keys are identical (section 3.4). |
| L10 | **No late credits.** Each retirement's `retiredAt` is at or before the due instant of the attested month (section 1.2). A correction committed later cannot buy coverage after that instant. No lower bound on `retiredAt` is checked: a credit retired earlier than the month may be counted if L9 holds. The period the operator publishes at the registry (D8) is the only link between a retirement and a month. |
| L11 | **No return to 1.x forms.** An event whose `period` has `from` and `to` (a 1.x form, section 9.1) is accepted only if no 2.0-form event precedes it in the same subject and type chain. Once a chain holds a 2.0 event, every later event is 2.0 form. |

An attestation is *late-filed* when its commit instant is after the due instant of its month. L10 for a
late-filed attestation rests only on the operator's assertion of `retiredAt` (D5 reports it, D8 confirms it).

A correction is a new attestation chained in the usual way, with `supersedes` set by L6. The effective
attestation of a month is therefore the latest valid one for it.

### 3.6 Corrections after publication

A declaration for a period (section 5) fixes its cut-off at its `updated`, which is the publisher's own
assertion; its age is judged by `updated` against `read-at`. A correction committed after `updated` does not
make the declaration wrong. The deep check reports it as "superseded since publication" (D7) and never as a
failure.

### 3.7 What a ledger read must yield

A ledger read is the input of every ledger check. For each counted operator it MUST yield:

1. every attestation of both types, each with its commit instant and its hash, in ledger order, from the
   first event (`prev` null) to the last committed at or before the read;
2. the Registry entry of the operator, signed;
3. the instant of the read (`read-at`). A read supports only cut-offs at or before `read-at`; a check whose
   cut-off is later is NOT-EVALUABLE. A checker that takes T from `read-at` SHOULD print `read-at` and MAY
   refuse a read older than a maximum age that it also prints.

For every other Registry operator that has an attestation citing a retirement, the read MUST yield those
events with their commit instants and hashes, so that L9 can run.

How a ledger exports these is its own matter. Section 3.8 defines an optional interchange format. The
registrar key is not part of a read; D2 says where it comes from. The schema of a ledger excerpt is
`schemas/ledger-excerpt.json`.

### 3.8 Ledger excerpt (optional interchange format)

A ledger excerpt is a JSON document holding one ledger read. It is OPTIONAL; any other form that yields
section 3.7 is as good. `application/json`.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `excerpt-version` | integer, `2` | yes | The format version. |
| `profile-version` | string matching `2.<digits>` | yes | The profile version; `"2.0"` for this version. |
| `network` | `host` | yes | The network's `target`. |
| `read-at` | `instant` | yes | Section 3.7. |
| `registrar` | object `{jwk}`, where `jwk` has the form of the `key` object's `jwk` (section 3.1) | yes | The registrar key the excerpt claims; not a trust anchor. It is used only when it equals the independently obtained registrar key (section 7.4 D2). |
| `registry` | array of Registry entries | yes | Section 3.1. |
| `ledger` | array of `entry` objects, commit instants strictly increasing | yes | The events in ledger order. |
| `checkpoint` | object `{read-at, heads, sig}` | no | A statement signed by the registrar of the tip and event count of every chain at `read-at`: `heads` is an array of `{operator, type, head, count}`, `read-at` equals the excerpt's, and `sig` is the registrar's signature under section 1.6 rule 2 over the object without `sig`. Optional to produce; section 7.4 D4 says what a checker does with it. |
| `notice` | string | no | Free text, such as "every figure is invented". |

`entry` object:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `commit` | `instant` | yes | The commit instant. |
| `hash` | `hex64` | yes | The hash of `event` (section 1.6). |
| `event` | event of section 3.2 | yes | The attestation. |

## 4. The offset-coverage rule

For operator o and month m, write S1, S2 and S3 for `scope1KgCO2e` (0 when absent), `scope2KgCO2e` and
`scope3KgCO2e`, R for `offsetsKgCO2e`, and z for `netZero`, all of the effective `CarbonAttested`.

- **Consistency (L7).** z = [ S1 + S2 + S3 ≤ R ], exact. A mismatch fails the attestation whatever the flag says.
- **Compliance.** z is true for every operator-month of the evaluated period or window, on effective
  attestations. A month with no effective `CarbonAttested` is silent and fails coverage.
- **Network consequence.** If the rule holds for every operator-month of a year, the inequalities add:
  Σ(S1 + S2 + S3) ≤ ΣR over the year. ΣR is at most the sum of `tonnesRetired` × 1 000 over the distinct
  retirement keys, because L9 forbids using a tonne twice (for citations with identical keys, section 3.4),
  so Σ(S1 + S2 + S3) ≤ ΣR ≤ the kilograms in those retirements. Whether those tonnes were retired in a registry
  is established only by D8. The converse does not hold: a network can meet the annual sum while one operator
  misses a month.

In words: every month, each operator's gross emissions must not exceed the credits counted for that month,
and the flag it signs must be the true answer to that comparison, so that nobody has to believe the flag.

**What the rule claims.** It tests whether retired credits at least equal gross emissions. It does not ask for
reductions and does not judge the credits (section 2.1). A conforming system MUST NOT present its result as a
consumer-facing claim of climate neutrality. Directive (EU) 2024/825 ([Directive 2024/825]) requires Member
States to prohibit, in business-to-consumer commercial practices, claims that a product has a neutral, reduced
or positive greenhouse-gas impact on the basis of offsetting (Annex I, point 4c). The national measures
transposing it apply from 27 September 2026. Offset claims about an organisation fall under the general rules
on misleading practices.

## 5. Publication under the draft

### 5.1 Levels

| | Network declaration | Operator declaration |
|---|---|---|
| About | The whole network. | One operator. |
| `target-type` | `service` | `origin` |
| `target` | The network's host. | The operator's Registry `origin`. |
| `period` | One calendar year. | One month or one calendar year when it carries `ledger-evidence-2`; otherwise any period the draft allows (the draft's SHOULD of a day or longer), and C-SFC-7 does not apply to it. |
| `updated` | For a ledger-backed object, the cut-off instant (section 1.2): every ledger event of the period committed at or before it is counted and none committed after it. It MUST NOT be earlier than the commit instant of the last counted event, and MUST NOT be later than publication. | Likewise. |
| `capabilities` | As the draft defines it: `basic` when the server supports no query parameter, `extended` otherwise; this profile adds no requirement. | Likewise. |
| `provider` | As the draft defines it: a human-readable identification of the publisher; a role contact address is preferred to a personal one. | Likewise. |
| `measurement-method` | The least direct token among the counted operators' `measurementMethod` for the period. | Likewise for the operator. |
| `methodology-uri` | A URI reference to the deployment's methodology document, which cites this profile (the draft allows one URI per object). | Likewise. |
| Publisher | The body that speaks for the network. | The operator. |

The draft's seven mandatory members are `updated`, `capabilities`, `provider`, `measurement-method`,
`methodology-uri`, `period` and `target` (Appendix D); every object carries them.

C1 is evaluated only on a network declaration. An object whose `network-topology` value carries
`member-of-network` is an operator declaration whatever its `target-type` says.

### 5.2 Claims, signing, units, noise

1. An object that claims SFC MUST carry `energy-unit` when it carries `energy-consumption`, and `carbon-unit`
   when it carries a carbon figure. The draft's defaults (kWh, gCO2e) are never relied on.
2. It MUST carry `signed` when it carries `ledger-evidence-2`, and SHOULD carry it otherwise. For an object
   that claims SFC, `signed` MUST decode to a payload equal to the served object without `signed`, by JSON
   value equality; this is stricter than the draft, which only calls a mismatch unverified, and any difference
   is a FAIL of C-SFC-5. A signature is worth only what the key's source is worth (draft, "Verifying a
   Signature"): the publisher's key is named in the Registry (the registrar's record of the operator) or in the
   methodology document, and a verifier pins it out of band.
3. A network-level object that claims SFC, and any object that carries `ledger-evidence-2`, MUST NOT apply the
   perturbation the draft allows: the figures must equal the ledger sums rounded as section 1.3 rule 3 says, in
   the published unit, and a coarser rounding is a perturbation. A figure within 1% of CAP could change the C1
   result.
4. A network declaration MUST carry `disclosure-uri`, naming a machine-readable index of the filed reports (not
   a single report).
5. A network declaration's period MUST NOT be a part of a year presented as a year (draft, "Partial Answers").
6. An object that carries `ledger-evidence-2` MUST write both `period` bounds as `month-bound` values (offset
   `Z`), so that its period is a whole number of the months of section 1.2. A network declaration whose
   calendar year is written in a local offset MAY claim SFC through the disclosure form (C-SFC-2) only; it
   carries no `ledger-evidence-2`, and the ledger-dependent checks are NOT-EVALUABLE on it.
7. A network declaration's methodology document MUST state which parts of the network are measured and which
   are modelled.

### 5.3 Two objects for Scope 2

GHG Protocol Scope 2 Guidance asks for Scope 2 on both bases where contractual instruments exist. The draft
publishes the two as two objects for the same `target` and `period`.

- The **primary** object has `carbon-accounting` `market-based`, and carries the extensions of section 6.
- The optional **second** object, the *paired location object*, has `carbon-accounting` `location-based`; the
  same `target`, `target-type`, `period`, `energy-consumption` (equal after unit conversion), `energy-unit`,
  `carbon-unit` and `disclosure-uri` as the primary; `scope-2` = Σ `scope2LocationKgCO2e`; its own
  `carbon-footprint` (Σ scope 1 + its `scope-2` + Σ scope 3) and `carbon-intensity-gCO2e-per-kWh` (section
  5.4); no extensions; and its own `signed`, since the draft binds `carbon-accounting` into the signature. It
  carries the draft's mandatory members (section 5.1). Section 5.2 rules 1, 3 and 4 apply to it as to the
  primary: it MUST carry `energy-unit`, `carbon-unit` and `disclosure-uri`, and the perturbation is not
  applied to it. It is published only when every counted effective `CarbonAttested` carries
  `scope2LocationKgCO2e`.
- A checker pairs the objects by the same `target`, the same `period` and a different `carbon-accounting`. A
  location-based object with no market-based object of that target and period that claims SFC is not paired:
  the checker reports INFO and checks it as a plain draft object (S2 only). S6 i and D6 check a paired
  object.
- Two annual network objects that differ only in `carbon-accounting` yield one C1 result (C-SFC-2).
- A declaration without the second object gives Scope 2 on the market-based basis only. It supplies part of
  what dual reporting under the GHG Protocol Scope 2 Guidance needs. A publisher that wants to meet that
  guidance SHOULD publish the second object.

### 5.4 Mapping from ledger sums to the primary object

All sums run over the effective attestations of the counted operators for the months of `period`. The
*counted operators* are defined in section 1.2.

A network declaration MUST carry every top-level member in this table, except `scope-1` (SHOULD; MUST when any
counted attestation carries `scope1KgCO2e`), `carbon-intensity-gCO2e-per-kWh` (absent when energy is 0) and the
members that section 5.5 omits from an incomplete object (those objects are reported INCOMPLETE, not failed).
`renewable-energy` and `verifiable-attestation-uri` SHOULD be present where a net zero claim is made. The
extensions in the table are carried as section 6 says.

| Ledger | Declaration member (primary object) |
|---|---|
| Σ `kWhConsumed` | `energy-consumption`, with `energy-unit`, in the unit the publisher chose. |
| Σ `scope1KgCO2e` | `scope-1`, present when any counted attestation carries `scope1KgCO2e`. |
| Σ `scope2KgCO2e` | `scope-2`, with `carbon-accounting` `market-based`. |
| Σ `scope3KgCO2e` | `scope-3`. |
| S1 + S2 + S3 summed | `carbon-footprint`, gross, never reduced by credits; with `carbon-unit`. |
| Σ `kWhConsumed` and Σ `scope2KgCO2e` | `carbon-intensity-gCO2e-per-kWh` = (Σ `scope2KgCO2e` × 1 000) ÷ Σ `kWhConsumed`, from the exact ledger sums in kg and kWh, rounded as section 1.3 rule 3 says; an average on the object's own basis, not a grid intensity. Absent when energy is 0, and MUST be absent then. The identity energy × intensity = scope-2 holds for the exact sums, and for the published figures only within rounding. |
| `measurementMethod` | `measurement-method`: the least direct token among the counted events. |
| `nodeProfile` | The `hardware-lifecycle` extension (section 6.2). |
| Σ `offsetsKgCO2e` ÷ 1 000 | `offsets-retired-tCO2e` in `carbon-neutrality`. |
| The rule's results | `net-zero-status` in `carbon-neutrality`. Test in this order and take the first match: `achieved` when every counted operator met the rule in every active month of the period and no month is silent for `CarbonAttested` (this includes zero emissions with zero offsets, reported with INFO "no emissions to cover"); `not-achieved` when Σ `offsetsKgCO2e` is 0; otherwise `partial`, meaning offsets exist but the rule fails in at least one operator-month or a month is silent. |
| Σ `nodeCount` | `validated-node-count` in `network-topology`: the maximum over the period's months of the monthly Σ `nodeCount`; `node-count-validation-method` says so. |
| The above, per operator | `ledger-evidence-2` (section 6.5). |

The object that carries `ledger-evidence-2` writes its `period` bounds as `month-bound` values (section 5.2
rule 6); a month of the period in which no operator is active makes the object incomplete (section 5.5).
`renewable-energy` is stated by the publisher as the market-based share and is not derived from the ledger; the
checks do not recompute it. The paired location object (section 5.3) takes the same energy, Scope 1 and Scope 3
sums, its own `scope-2`, and its own footprint and intensity by the same formulas.

### 5.5 Silent months and incomplete objects

When an active operator-month is silent for a type, or a month of the period has no active operator, the
network object is **incomplete**:

1. The members derived from that type are omitted: for energy, `energy-consumption`, `energy-unit` and
   `validated-node-count` with `node-count-validation-method` (inside `network-topology`); for carbon,
   `scope-1`, `scope-2`, `scope-3`, `carbon-footprint`, `carbon-accounting` and `offsets-retired-tCO2e`; and
   `carbon-intensity-gCO2e-per-kWh` when either type is silent. A month with no active operator is silent for
   both types.
2. The object still carries the extensions of section 6 with the sums that exist. When the silent month is
   silent for carbon, the operator's `offset-coverage-every-period` is false and `network-offset-coverage` is
   false (section 6.5); an energy-silent month leaves both flags to the carbon attestations, and the object is
   still incomplete through rules 1 and 3.
3. A checker reports the object `INCOMPLETE (silent: operator, month, type)`, or `INCOMPLETE (no operator:
   month)`. C-SFC-2 (disclosure form) is NOT-EVALUABLE on it. INCOMPLETE is an object verdict, not a FAIL.

The reason is the draft's rule that figures covering part of a period are not presented as covering the whole.

## 6. Extensions

### 6.1 Names

Names minted by this profile live under `https://andreibesleaga.com/sfc/extensions/`. An extension name is an
identifier compared as a string and never fetched. Each value is an object.

| Name suffix | Level | Meaning | Defined in |
|---|---|---|---|
| `hardware-lifecycle` | both | What the hardware is and what happens to it. Names and members unchanged from 1.0. The `accelerator-server` hardware class is a Registry value only (section 3.1); this extension has no class member. | 6.2 |
| `carbon-neutrality` | network, and an operator that makes its own claim | The offset-coverage position. Names and members unchanged from 1.0; 2.0 adds derivations for ledger-backed objects (section 5.4). | 6.3 |
| `network-topology` | both, different members | The network's shape; at operator level, membership. Names and members unchanged from 1.0; 2.0 adds derivations for ledger-backed objects (section 5.4). | 6.4 |
| `ledger-evidence-2` | network, and an operator that publishes its own trail | The pointer to the ledger evidence, new in 2.0. | 6.5 |
| `ledger-evidence` | — | **Superseded.** The 1.1 name keeps its published meaning; a 2.0 emitter does not use it; a 2.0 checker reads it as "profile 1.1 evidence" (section 9.1 rule 3). | Appendix C |

A name once minted is never redefined. A change of meaning is a 3.0 change and mints a new name; a new optional
member does not; a new extension for a new subject takes its own name (section 9.2). A consumer that does not
know a name ignores its value.

"Required" in the tables below means required within the extension value, for a publisher that carries that
extension at that level. A value of the wrong JSON type is read as absent; a required member read as absent is
reported by S6 a (section 7.3), and the extension is not treated as conforming.

### 6.2 `hardware-lifecycle`

| Member | Type | Required | Meaning |
|---|---|---|---|
| `general-purpose-hardware` | boolean | yes | True when the work runs on commodity hardware with other uses afterwards. |
| `single-use-asic-required` | boolean | yes | True when taking part needs purpose-built devices with no other use. |
| `expected-service-life-years` | number, at least 0 | no | Planned in-service life, in years. Stated by the publisher; not recomputed. |
| `embodied-carbon-in-scope-3` | boolean | no | True when the emissions of making the hardware are inside `scope-3` of the same object. |
| `reuse-and-recycling-policy-uri` | `https-uri` | no | The published policy for reuse, resale and recycling. |

From the ledger: the publisher applies the C-SFC-3 test to every counted operator of the object's period
(section 5.4), not only to operators active in the evaluation window. When every counted operator passes,
`general-purpose-hardware` is true and `single-use-asic-required` is false. All five `hardwareClass` values,
including `cloud-instance` and `accelerator-server`, count as general-purpose. When any counted operator would
give NOT-DECLARED, or there is no Registry, the publisher cannot answer the first two members and omits the
extension. The publisher never publishes `general-purpose-hardware` false on this basis. The extension cannot
travel alone: the object also carries a numeric metric, `disclosure-uri` or `verifiable-attestation-uri`, as
the draft requires. The schema is `schemas/ext-hardware-lifecycle.json`.

### 6.3 `carbon-neutrality`

| Member | Type | Required | Meaning |
|---|---|---|---|
| `net-zero-status` | string, one of `achieved`, `partial`, `not-achieved` | yes | The offset-coverage position. For ledger-backed objects, derived as section 5.4 says. For a publisher with no ledger, test in this order and take the first match: `achieved` when `offsets-retired-tCO2e` × 1 000 is at least the object's gross `carbon-footprint` in kg (exact comparison; zero with zero counts as achieved, reported with INFO "no emissions to cover"); `not-achieved` when `offsets-retired-tCO2e` is absent or 0; otherwise `partial` (offsets above 0 but below the footprint). |
| `renewable-procurement` | string, one of `on-site-generation`, `power-purchase-agreements`, `unbundled-certificates`, `supplier-tariff`, `grid-average`, `mixed` | no | How renewable energy was obtained. |
| `residual-emissions-tCO2e` | number, at least 0 | no | Emissions remaining after reductions, in tCO2e. Stated by the publisher; not recomputed. A ledger-backed object SHOULD omit it. |
| `offsets-retired-tCO2e` | number, at least 0 | no | Credits retired and counted for the period, in tCO2e: for a ledger-backed object, Σ `offsetsKgCO2e` ÷ 1 000. |
| `offset-registry-uri` | `https-uri` | no | The registry record of those retirements. |
| `offsets-attested-by` | string | no | The party that issued the statement at `verifiable-attestation-uri`. |

The member name is kept from 1.0. Its value means offset coverage of gross emissions only. A consumer or
aggregator that displays `net-zero-status` or `netZero` MUST label it "offset coverage" and MUST NOT display it
as net zero, carbon neutral or climate neutral. It is shown beside gross `carbon-footprint`, which is gross and
not negative, always. The derivation without a ledger is the 2.0 emitter rule for new declarations; it is not a
judgement on 1.x declarations (section 9.1 rule 3). The schema is `schemas/ext-carbon-neutrality.json`.

### 6.4 `network-topology`

An object carries the network-level members or the operator-level members, not both.

Network level:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `consensus-mechanism` | string | yes | How the network agrees: for example `proof-of-stake`, `proof-of-work`, `proof-of-authority`, `dag`, `hybrid`; any other value is a short description. C-SFC-6 uses it only as a cross-check of the platform statement. |
| `validated-node-count` | integer, at least 0 | yes, except in an incomplete object (section 5.5), where it is omitted | Nodes counted over the period (section 5.4 for ledger-backed objects). |
| `node-count-validation-method` | string | yes, when `validated-node-count` is present | How the count was arrived at, in one sentence. |
| `per-transaction-energy-Wh` | number, at least 0 | no | Energy per transaction over the period, in Wh. |
| `nakamoto-coefficient` | integer, at least 0 | no | Smallest number of parties that together could control the network. |
| `geographic-regions` | integer, at least 0 | no | Distinct regions the counted nodes ran in. |

Operator level:

| Member | Type | Required | Meaning |
|---|---|---|---|
| `member-of-network` | `host` | yes | The `target` of the network this operator takes part in; compared as a host (section 1.5). |
| `network-declaration` | `https-uri` | no | Where the network's declaration is published. |

`upstream` is not membership: it names suppliers whose output flows into the subject. The schema is
`schemas/ext-network-topology.json`; it makes `validated-node-count` optional and requires it for a complete
object.

### 6.5 `ledger-evidence-2`

A pointer from the declaration to the signed evidence trail, with the figures recomputable from it. The value
sits inside the object, so `signed` covers it for a verifier that pinned the key. `verifiable-attestation-uri`
is for a statement signed by a party other than the publisher; it never carries the ledger pointer, which
belongs in this value. The schema is `schemas/ext-ledger-evidence-2.json`; the vectors hold a minimal valid
instance.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `profile-version` | string matching `2.<digits>` | yes | `"2.0"` for this version. |
| `ledger-access-uri` | `https-uri` | yes | Where a verifier obtains a ledger read (section 3.7). Access MAY be limited to consortium members and auditors. |
| `operators` | array of `operators` entries, at least 1 | yes | One entry per counted operator (exactly one in an operator declaration), in no required order. |
| `network-offset-coverage` | boolean | yes at network level; absent at operator level | True when every counted operator's `offset-coverage-every-period` is true. False when any counted operator-month is silent for `CarbonAttested`. |

`operators` entry. Every figure is the sum over the operator's effective attestations for the months of the
object's `period`, committed at or before `updated`, rounded as section 1.3 rule 3 says.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `operator` | `did` | yes | The operator's DID. |
| `origin` | `host` | yes | The operator's Registry `origin`, so that operator declarations can be found. |
| `energy-head` | `hex64` or null | yes | The head of the operator's `EnergyAttested` chain (section 1.2); null when the chain has none. |
| `carbon-head` | `hex64` or null | yes | The same for `CarbonAttested`. |
| `energy-events` | integer, at least 0 | yes | Number of `EnergyAttested` events, corrections included, whose period lies in the object's `period` and that were committed at or before `updated`. |
| `carbon-events` | integer, at least 0 | yes | The same for `CarbonAttested`. |
| `kwh` | number, at least 0 | yes | Σ `kWhConsumed`. |
| `scope1-kgco2e` | number, at least 0 | yes | Σ `scope1KgCO2e` (absent counts as 0). |
| `scope2-kgco2e` | number, at least 0 | yes | Σ `scope2KgCO2e`. |
| `scope3-kgco2e` | number, at least 0 | yes | Σ `scope3KgCO2e`. |
| `offsets-kgco2e` | number, at least 0 | yes | Σ `offsetsKgCO2e`. |
| `offset-coverage-every-period` | boolean | yes | True when every month of the period in which the operator was active has an effective `CarbonAttested` whose flag equals the comparison of section 4 and is true (a month silent only for energy does not change it). |

The object's `period` is the period of the evidence; there are no separate period members. The members for
the rule are named for what they test, so they do not carry the column's "Net Zero" label.

## 7. Checks

### 7.1 Result words

| Word | Meaning |
|---|---|
| PASS | The pass condition in section 7.2 holds. |
| FAIL | It does not hold. |
| NOT-EVALUABLE | A named input is missing, incomplete or out of reach, so the check is neither passed nor failed. The row states which input and why: a silent month (C-SFC-2 only; C-SFC-1 and C-SFC-4 return FAIL for it), a ledger read that is refused or older than the cut-off, a missing unit, an object that is not annual or not network-level, a missing platform statement, a period not in UTC months, a limit of section 7.6. Never a pass. |
| DECLARED, NOT-DECLARED | For C-SFC-3, and for the members listed in 7.3 step S6 g: the declaration is complete and in the list, or not. Never "C2 passed". |
| INFO | Context that is not a verdict. It is a note on a report row, not a result. |

Object verdicts are COMPLETE, INCOMPLETE (section 5.5) and NOT-APPLICABLE (the object is not an SFC object).
A refused ledger read (HTTP 401 or 403) means the deep check was not run; it is NOT-EVALUABLE, never FAIL. A
repeated NOT-EVALUABLE is not escalated to FAIL.

Each row names the period or window it covers. A report ends with one line that counts the rows by word. That
line, and any summary of the report, is not worded as a pass or as "conforms" while any row of C-SFC-1, 2, 4, 5
or 7 that applies to the object is FAIL or NOT-EVALUABLE. A NOT-EVALUABLE row names its cause; where the cause
is a refused read, a `read-at` before the cut-off, or a silent month, the row says so.

### 7.2 The checks

The evaluation window and the cut-off (section 1.2) apply as stated; T is defined there. "Active
operator-month" is taken from the Registry of the ledger read, as read. Months of the window with no active
operator are not counted. When the window has no active operator-month, C-SFC-1, C-SFC-2 (ledger form) and
C-SFC-4 are NOT-EVALUABLE (no operator active in the window). When only some months have none, a PASS of
C-SFC-1 or C-SFC-4 carries INFO "window not fully covered", and C-SFC-2 (ledger form) is NOT-EVALUABLE (see
its row). C-SFC-4 takes two parameters, a set of months and a cut-off. Run on its own, it uses the evaluation
window and T, as the table shows. Inside the deep check (7.4 D5) it uses the months of the declaration's
`period` and the declaration's `updated`.

| ID | Input | Window and cut-off | Pass condition | Result words |
|---|---|---|---|---|
| C-SFC-1 coverage | Ledger read | Evaluation window; cut-off T | Every active operator-month of the window has an effective `EnergyAttested`. | PASS, FAIL, NOT-EVALUABLE (no ledger read; `read-at` before T) |
| C-SFC-2 ledger form | Ledger read | Evaluation window; cut-off T | Σ `kWhConsumed` over the effective `EnergyAttested` of all active operator-months is below CAP. Evaluate in this order. FAIL when the sum of what exists is already at or above CAP: a partial sum at or above CAP is a certain failure. NOT-EVALUABLE when there is no ledger read, when `read-at` is before T, when any active operator-month is silent for energy, or when the Registry has no operator active in some month of the window (the window is not fully covered). PASS otherwise. | PASS, FAIL, NOT-EVALUABLE (no ledger read; `read-at` before T; an active operator-month silent for energy; window not fully covered) |
| C-SFC-2 disclosure form | A network declaration | The object's `period`; no ledger | The object is a calendar-year network object (section 5.1; both bounds on 1 January 00:00, written `Z`, or in one offset when the object has no `ledger-evidence-2`, the year then being read in that offset: a disclosure-only year in a local offset is judged as the draft defines it, and a gateway MUST NOT mix it with the UTC months of a ledger read), `energy-consumption` and `energy-unit` are present, and the figure converted to kWh is below CAP. Two annual objects for one `target` and `period` that differ only in `carbon-accounting` carry identical `energy-consumption` (equal after conversion) and give one result. INFO when the figure converted to kWh satisfies \|figure − CAP\| ≤ 0.01 × CAP, whether below or above CAP; it is reported next to the PASS or FAIL result, not instead of it, and the methodology document must state that no perturbation was applied. | PASS, FAIL, NOT-EVALUABLE (object not annual or not network-level; no `energy-consumption` or no `energy-unit`; two annual network objects with different targets; two objects of one target and period disagree; incomplete object) |
| C-SFC-3 hardware declared | Registry | Operators active in any month of the window | Every such operator's `nodeProfile` is complete, `hardwareClass` is in the list, `asicForbidden` is true, the two dates are full dates in order, and `reusePolicy` is in the list. The check reads the `nodeProfile` in the entry as read, so a replacement applies to every month of the window. An entry with no `nodeProfile` (a 1.x entry, section 9.1 rule 6) is NOT-DECLARED, with the entry named. | DECLARED, NOT-DECLARED, NOT-EVALUABLE (no Registry) |
| C-SFC-4 coverage rule | Ledger read | Evaluation window; cut-off T | Every active operator-month of the window has an effective `CarbonAttested`, its `netZero` equals the comparison of section 4, and the comparison holds. A non-compliant month fails the check while it lies in the window. The result row lists each late-filed effective attestation with its commit instant (section 3.5). | PASS, FAIL, NOT-EVALUABLE (no ledger read; `read-at` before T) |
| C-SFC-5 declaration | A declaration | None | The declaration conforms to the draft (decided by the published consumer library `sustainability-wellknown-consumer`, which validates the draft's CDDL and prose rules); a network declaration carries every member that section 5.4 requires, or is INCOMPLETE under section 5.5; a network declaration carries `disclosure-uri`; units are explicit (section 5.2 rule 1); `signed` is present when `ledger-evidence-2` is and decodes to the served object (section 5.2 rule 2); `period` bounds are `month-bound` values when `ledger-evidence-2` is present (section 5.2 rule 6); a paired location object carries the members of section 5.3; `ledger-evidence` is not used with `ledger-evidence-2` as a way to avoid it (section 9.1 rule 3). | PASS, FAIL |
| C-SFC-6 platform | The methodology document's platform statement, and `consensus-mechanism` of the declaration | T (the T of the C-SFC-2 run it uses) | **Not proof-of-work**, decided from the mechanism the platform statement names: FAIL when the statement names proof-of-work, or when `consensus-mechanism` equals `proof-of-work` (also when the two disagree); NOT-EVALUABLE when no statement names the mechanism; otherwise PASS, and any `consensus-mechanism` text other than the five listed values is reported as INFO and not used for the decision. **Public case:** an assessment on the boundary of C1 of a 12-month period that ended at most 18 months before T places the platform below CAP; it may run without a ledger read. **Permissioned case:** if every month of the window has at least one active operator, the case passes when C-SFC-2 (ledger form) passes; otherwise it passes when the registered-node bound of section 2.2 rule 3 is below CAP. A C-SFC-2 that is NOT-EVALUABLE for the second reason does not make C-SFC-6 NOT-EVALUABLE. | PASS, FAIL, NOT-EVALUABLE (an item the case needs is missing from the statement, including N, P or O) |
| C-SFC-7 bridge consistency | A declaration and a ledger read | The object's `period`; cut-off the object's `updated` | The excerpt's `network` equals the declaration's `target` (for an operator declaration, its `member-of-network`), compared as hosts; the `ledger-evidence-2` entry lists exactly the counted operators; for each, the heads, counts and sums recompute from the events committed at or before `updated`; the offset-coverage flags and `network-offset-coverage` recompute; the top-level figures that section 5.4 derives from ledger sums (`energy-consumption`, `scope-1`, `scope-2`, `scope-3`, `carbon-footprint`, `offsets-retired-tCO2e`, `carbon-intensity-gCO2e-per-kWh`, `net-zero-status`, `validated-node-count`) agree with the recomputed values by the tolerance rule; the paired location object, where present, agrees likewise; and for an operator declaration the Registry entry's `origin` equals `target` and the operator is active in the period. | PASS, FAIL, NOT-EVALUABLE (ledger read missing; `read-at` before `updated`; object without `ledger-evidence-2`; period not in UTC months; a limit of section 7.6; L9 not evaluable, section 7.4 D5) |

A platform statement in the methodology document names: the hot-path ledger and whether it is public or
permissioned; its consensus mechanism; for the public case the assessment (publisher, URI, period, figure and
unit, method); for the permissioned case N, P and O of section 2.2.

### 7.3 Shallow check (HTTPS only)

Input: an origin or a document. Steps, each with a row in the report:

1. **S1 fetch.** Fetch `https://<origin>/.well-known/sustainability-data` over HTTPS. The media type
   `application/sustainability-data+json` gives PASS; `application/json` is read as the draft allows and
   reported as INFO "generic media type"; any other type is FAIL. Record the URL and the type. A plain `http`
   URL is refused.
2. **S2 conformance.** Validate against the draft with `sustainability-wellknown-consumer` (npm, 0.8.1 or a
   later 0.8 release). FAIL on any violation; this is the conformance part of C-SFC-5. In another language,
   implement the draft's CDDL and its MUST rules; the consumer library is the reference for what counts as a
   violation.
3. **S3 signature.** Verify each `signed` under a key obtained out of band or pinned. With no such key: INFO
   "signed, not verified against a pinned key"; a key taken from the object's own header is trusted no
   further than the object. An `alg` other than `Ed25519` and `ES256` is verified if the checker supports it;
   otherwise report INFO "algorithm not supported", not FAIL, because the declaration is draft-valid. If the
   payload differs from the served object (section 5.2 rule 2), the object is FAIL and S4 to S7 stop for it.
   With a pinned key and equal payload, S4 to S6 run on the served object, now known to equal the payload;
   with no pinned key they run on the served members, as in the draft. **Attestation (optional).** If
   `verifiable-attestation-uri` is present, fetching it over HTTPS and verifying the statement's signature
   under a key obtained out of band is OPTIONAL. Verified: INFO "attested by <party>", where <party> is the
   signer, not the unchecked `offsets-attested-by` text. Fetch or verification failed, or no pinned key: INFO
   "attestation not verified". Never PASS or FAIL; sections 7.5 and 8 limit what this shows.
4. **S4 selection and C-SFC-2.** Take the network objects of the target; objects that carry
   `member-of-network` are excluded. Group them by `period`. A period that is not a whole calendar year is
   excluded from selection and reported INFO. Among the whole calendar years, select the one with the latest
   `end` at or before T; a year whose `end` is after T is reported INFO "period not yet ended at T". Within
   the selected period the primary object is the one with `carbon-accounting` `market-based`; if none has it,
   the one that carries `ledger-evidence-2`; if that is still unresolved, C-SFC-2 is NOT-EVALUABLE, naming the
   missing input. Every other year is reported INFO. Run C-SFC-2 disclosure form on the selected period only.
   S6 and C-SFC-7 run on the selected primary object and its paired location object only.
5. **S5 C-SFC-5.** Run the remaining parts of C-SFC-5.
6. **S6 coherence.** On an object that carries `ledger-evidence-2` or any other SFC extension. Steps b to f
   are PASS or FAIL only for an object that carries `ledger-evidence-2`; for any other object a disagreement
   on b to f is INFO "not derivable", and f applies the section 6.3 derivation without a ledger as INFO only.
   Steps a, g and h apply to every such object.
   a. every required member is present, of the right type and form, except the members that section 5.5
      omits from an incomplete object; heads are `hex64`;
   b. each top-level figure that has a counterpart in `operators` agrees with the sum of the entries, by the
      tolerance rule against a sum of published terms: `energy-consumption`, `scope-1`, `scope-2`, `scope-3`,
      `offsets-retired-tCO2e`;
   c. when `carbon-footprint` is present, it equals scope-1 + scope-2 + scope-3 by the tolerance rule against a
      sum of published terms, with `scope-1` taken as 0 when absent; when `scope-2` or `scope-3` is absent,
      this row is NOT-EVALUABLE, naming the missing member;
   d. `carbon-intensity-gCO2e-per-kWh` is checked against the quotient q = (published `scope-2` in kg × 1 000)
      ÷ (published `energy-consumption` in kWh): it passes when |q − P| ≤ ½ × 10^−k(P) + 1 000 × δS ÷ E +
      q × δE ÷ E, where P is the published intensity, E the energy in kWh, and δS and δE the half-units
      ½ × 10^−k of the published scope-2 and energy, converted to kg and kWh. When energy is 0 the member
      must be absent, and a present member is FAIL;
   e. `network-offset-coverage` equals the conjunction of the entries' `offset-coverage-every-period`;
   f. `net-zero-status` agrees with section 5.4 or, with no ledger, with section 6.3;
   g. `hardware-lifecycle`, `net-zero-status`, `validated-node-count` and `renewable-energy` (when present) are
      reported as DECLARED, never PASS;
   h. an object with the old name `ledger-evidence` is handled by section 9.1 rule 3;
   i. on a paired location object (section 5.3): `energy-consumption` equals the primary's after unit
      conversion; `carbon-footprint` equals the primary's `scope-1` + its own `scope-2` + the primary's
      `scope-3` by the tolerance rule against a sum of published terms; its intensity passes step d on its
      own `scope-2`. A paired object that fails any of these is FAIL.
7. **S7 record.** State: attributed to the origin; integrity verified or not (never "verified" without a
   pinned key); figures self-asserted; accuracy unknown. Print the check instant T, `read-at` when a read was
   used, and the profile version.

### 7.4 Deep check (needs a ledger read)

Input: a declaration that carries `ledger-evidence-2`, and a ledger read of section 3.7.

1. **D1 access.** Obtain the read through `ledger-access-uri`, or from a given excerpt. Refused: NOT-EVALUABLE.
   Apply the limits of section 7.6. The cut-off is the object's `updated`; `read-at` must not be earlier. A
   declaration that carries `ledger-evidence-2` needs `excerpt-version` 2; a version 1 excerpt is
   NOT-EVALUABLE here.
2. **D2 operator set and Registry.** Network level: the `operators` list equals the set of operators active in
   any month of `period`. Operator level: one entry, and the Registry entry of that DID has `origin` equal to
   `target` and is active in the period. The excerpt's `network` equals the declaration's `target` (for an
   operator declaration, its `member-of-network`), both compared as hosts; otherwise FAIL. Verify every
   Registry entry's `sig`. The registrar key comes from the methodology document the checker has itself
   pinned, or from a key the caller pins out of band, as S3 does. An excerpt's `registrar.jwk` is a
   convenience copy: if it differs from that key the row is FAIL; if it is the only source the row is
   NOT-EVALUABLE with INFO "registrar key not pinned", and no authenticated PASS is printed (the hash, link,
   fork and sum rows still run, and are reported as consistent but not authenticated). A 1.x entry with no
   `sig` (section 9.1 rule 6) is reported INFO "Registry unsigned (profile 1.x)"; a 2.0 entry with a missing
   or invalid `sig` stays NOT-EVALUABLE.
3. **D3 events.** For each counted operator and type, take the whole chain from the first event (`prev` null)
   up to the last committed at or before `updated`. For each event: its hash recomputes and equals the
   ledger's; the row "encoding" holds (section 1.6 rules 5 and 6); rules L1 to L3 and L5 hold. A failure is
   FAIL on that event's row. For every other operator the read yields, hash and L5 are checked on the events
   that cite a retirement key that an effective attestation of a counted operator also cites.
4. **D4 chains.** Every event of a counted operator links to the one before it, ending at an event with `prev`
   null or at a takeover link whose `prev` equals the tip listed in the methodology document (section 2.2
   rule 5). A verifier then follows the old ledger's chain to `prev` null under the same rules, or marks the
   part before the takeover NOT-EVALUABLE if the old ledger is unreachable. No two fetched events share a
   `prev` (a fork); every in-period event committed at or before `updated` is on the walk; the declared head
   equals the head of section 1.2; the declared count equals the number of in-period events. **Checkpoint:**
   when the excerpt carries a `checkpoint`, verify its `sig` under the registrar key of D2, require its
   `read-at` to equal the read's, and compare its heads and counts with the walk to `read-at`; the row is
   "checkpoint: verified", "absent" or "mismatch". Mismatch is FAIL; absent is INFO "ledger read not
   authenticated: commit instants and completeness are the source's claim".
5. **D5 effective attestations, rule and retirements.** Select the effective attestations; run C-SFC-4 on the
   months of `period` with cut-off `updated`, in place of the window and T; check L4 and L6 to L11 over the
   counted operators' chains up to the cut-off, and L9 over the effective attestations at the cut-off of every
   operator the read yields. A read known to omit the retirement-citing events of a Registry operator makes the
   L9 row NOT-EVALUABLE, never PASS. A FAIL in D3 or D5 makes the deep check FAIL overall (C-SFC-7), since the
   ledger cannot be trusted. Report each late-filed effective attestation as INFO "late-filed, retirement dates
   asserted only".
   - **D5b window checks.** Run C-SFC-1 and C-SFC-2 (ledger form), one report row each. They use the
     evaluation window and T as window anchor and cut-off, not `updated`. T is the check instant of section
     1.2: with no explicit T it is `read-at`; an explicit T later than `read-at` makes both NOT-EVALUABLE.
   - **D5c hardware.** Run C-SFC-3 on the Registry, one row; it needs no ledger events.
   - **D5d platform.** Run C-SFC-6, one row. The public case needs only the methodology document and may run
     without a ledger read; without the platform statement the row is NOT-EVALUABLE. The permissioned case uses
     the C-SFC-2 result of D5b, with the same T.
6. **D6 sums and declaration.** Recompute every entry member and compare for equality with the exact value
   rounded half to even to 6 decimals (section 1.3 rule 3); recompute `offset-coverage-every-period` and
   `network-offset-coverage`; recompute the top-level figures of section 5.4 and compare them by the tolerance
   rule against the exact value (section 1.3 rule 4). For a paired location object, recompute `scope-2` = Σ
   `scope2LocationKgCO2e` over the effective attestations, and its footprint, intensity and energy as in
   section 5.4; if any counted effective `CarbonAttested` lacks `scope2LocationKgCO2e`, report FAIL. This is
   C-SFC-7.
7. **D7 later corrections.** Events committed after `updated` and at or before `read-at` that supersede an
   in-period event, or that add or remove an in-period month: INFO "superseded since publication", never
   FAIL. In that row re-run C-SFC-2 and C-SFC-4 with cut-off `read-at` and state both results, for example
   "as of updated: PASS; as of read-at: FAIL". A differing result is still INFO.
8. **D8 registry records (optional).** Follow `evidence` and each retirement reference to the registry; confirm
   the credits are retired, in the operator's name, with beneficiary and period published. Confirm first the
   retirements of late-filed months. Where the registry publishes serial ranges, confirm that no two
   `reference` values of that registry overlap. Not machine-checkable in general; NOT-EVALUABLE unless
   performed.
9. **D9 record.** State: the `updated` and `read-at` instants; the declaration agrees (or not) with the ledger
   as committed at `updated`, and the as-of-read result when D7 reports one that differs; with no verified
   checkpoint, that it agrees with "the read obtained from <uri>" and not with the ledger itself; whether D8
   was performed; whether the registrar key was pinned; who ran the check and when; any raised limit of
   section 7.6; that the operator set is the Registry's and completeness against the real network is not
   established; that the readings themselves are not established.

### 7.5 What the checks establish

The shallow check establishes that the origin published these figures and, with a pinned key, that they were
not altered after signing. The deep check establishes that the declaration agrees with the ledger read it was
given; the read source is trusted for order, commit instants and completeness, and two verifiers can be shown
different histories unless they exchange registrar-signed checkpoints (section 3.8). A declaration that
misstates the read is detectable by anyone with that read. The checks take the operator set and the `active`
intervals from the Registry as read, signed by the registrar. They show that the declared figures are the sums
over the registered operator-months. They do not show that no other operator or node ran, or that an `active`
interval was not shortened, or that earlier Registry versions were not different; a ledger-backed
`validated-node-count` is the sum of the registered operators' declared `nodeCount`, so it has the same limit,
and in a shallow check it is reported DECLARED. The deep check without D8 does not establish that a cited
retirement belongs to the operator that cites it, or that it is not also cited in another ledger. Neither
check establishes that an operator's readings were true: a correctly signed false reading is still false.
Independent assurance comes only from a third party's signed statement at `verifiable-attestation-uri`.

### 7.6 Verifier limits

A checker that fetches `ledger-access-uri`, `evidence`, a retirement `registry` or `disclosure-uri` takes the
URI from untrusted data. For a checker that claims SFC 2, the draft's Security Considerations SHOULD becomes
MUST: bound the time, size and redirects of every fetch, dereference only `https` references, and refuse a
loopback, private or link-local address at every connection, redirects included. A checker MAY be configured
with an explicit allowlist of hosts or networks, such as a consortium's own ledger; it prints that setting in
the D9 record. At most 3 redirects are followed, `https` only; a redirect to another origin is allowed only if
the target host passes the same address rule.

The numbers below are this profile's defaults, not derived from the draft.

| Limit | Default |
|---|---|
| Seconds per fetch | 30 |
| Bytes per declaration | 1 048 576 |
| Bytes per ledger read | 67 108 864 |
| JSON nesting depth | 32 |
| Operators in one read | 1 000 |
| Events per chain | 10 000 |
| Retirements per event | 100 |

Exceeding a limit gives NOT-EVALUABLE with the limit named, never FAIL and never PASS. A checker that raises a
limit prints the raised value in the D9 record.

## 8. Claims

A publisher, an aggregator or a checker writing about a declaration under this profile:

**MAY say**

- that the declaration conforms to the draft, having validated it;
- that the annual network figure for the named network is below, at or above CAP, with the figure, the unit
  and the boundary, only when C-SFC-2 is PASS or FAIL, not NOT-EVALUABLE;
- that the declaration **declares** general-purpose hardware, an offset-coverage position or a node count,
  naming the extension it read;
- that the declaration agrees with the ledger read as of its `updated`, after a deep check with C-SFC-7 PASS,
  naming who ran it and when and giving the `updated` and `read-at` instants, and adding the as-of-read result
  when D7 reports one that differs; with no verified checkpoint the statement says "agrees with the read
  obtained from <uri>", not "agrees with the ledger";
- that the operators' retired credits covered their emissions under the offset-coverage rule, naming the rule;
- that a named party attested to the figures, once the checker has fetched the statement and verified its
  signature under a key obtained out of band (7.3 S3);
- that a figure is a claim of the publisher (the draft's wording), not verified.

**MUST NOT say**

- that a figure is verified, true or accurate;
- that the system is compliant, sustainable, green, carbon neutral or net zero as a finding of its own;
- that the rule's result supports a consumer-facing claim of climate neutrality (section 4);
- that `net-zero-status` or `netZero` means net zero, carbon neutral or climate neutral; and MUST NOT display
  either under such a label, or without the words "offset coverage";
- that C2 passed (no document establishes what hardware exists);
- that C1 passed on an operator or sub-annual declaration;
- that the network's energy, carbon or node count covers all nodes or operators of the network; it covers the
  registered operator-months;
- that a coverage result confirms the retirement dates, unless D8 was performed for the late-filed months;
- that a declaration's as-of-`updated` agreement is the current state, when D7 reports a different
  as-of-read result;
- that figures from two publishers are comparable without checking that `carbon-accounting`,
  `measurement-method` and the period agree and that both methodology documents state the same boundary;
- that a valid `signed` member, or the presence of `verifiable-attestation-uri`, is evidence about a figure.
  A signature gives integrity and, with pinning, continuity of authorship.

A conformance statement has this shape: *this declaration conforms to the draft, and under SFC profile 2.0 it
declares X, Y and Z, of which the annual energy figure was checked against the 1 GWh cap on the date shown.*

## 9. Compatibility

### 9.1 Backward: reading 1.x

1. **1.x events.** A 2.0 verifier MUST read 1.x events. A 1.x event is recognised by `payload.period` with
   members `from` and `to` (full dates); when they are the first and the last day of one calendar month in
   UTC, they map to that month, and the month's bounds are the 2.0 period. Absent `scope1KgCO2e` is 0.
   The Scope 2 basis of a 1.x `CarbonAttested` is its `scope2Method`, else the method the methodology document
   states. A figure on the market basis enters the 2.0 sums as it is. A figure on the location basis is not a
   `scope2KgCO2e` of 2.0: the month is silent for the primary object (section 5.5), and the figure is
   `scope2LocationKgCO2e` for the paired location object (section 5.3). Where no basis can be determined the
   month is silent likewise. The checker reports each of these as INFO naming the event; the operator can
   repair it with a 2.0 correction event under L6. A 1.x `EnergyAttested` with no `measurementMethod` counts as
   `third-party-modeled`, with INFO. `evidenceCid` is read as `evidence` for display only and the event is not
   rewritten: a bare content identifier is displayed as `ipfs://<evidenceCid>`, any other value unchanged.
   `netZero` and `offsetsKgCO2e` keep their names. A 1.x `period` that does not span exactly one calendar
   month cannot be mapped to a 2.0 month. The checker reports the event as "profile 1.x event, period not a
   month" (INFO); it is not used for any month's effective attestation, and the report states that sums and
   coverage are incomplete for the months the period touches. A coverage or sum check that depends on those
   months is NOT-EVALUABLE, not PASS.
2. **Judging.** The checker reports such a chain as "profile 1.x events". A 1.x event that no 2.0 event
   precedes in its chain is judged by the 1.x rules (Appendix C) and is not failed for lacking a 2.0 rule; a
   1.x event after a 2.0 event in its chain FAILS L11. 1.x figures enter the 2.0 sums as they are, except as
   rule 1 says. A 1.x event has no `retirements` list and no signed allocation document is read, so the
   `retirements` clause of L8, L9 and L10 does not apply to it and D8 stays NOT-EVALUABLE for it; L7 applies.
   A 1.x event whose `sig.alg` is not `Ed25519` has a signature this profile cannot verify; the checker
   reports NOT-EVALUABLE for that event, naming its `alg`, and the event still counts in the sums.
3. **Declarations.**
   a. Only declarations on the -10 wire are checked as conforming. A declaration written for an earlier draft
      (for example with `reporting-period`, `mtCO2e` or a free-text `measurement-method`) FAILS S2 and its
      energy check is NOT-EVALUABLE for lack of `period`. This covers every 1.0 declaration as published and a
      declaration made to the 1.1 text at rfc commit `2d4822a`, which is the -07 wire. Convert it to the -10
      wire before checking. Reading such a declaration means recognising and reporting it, not passing it: the
      report also carries the row "profile 1.1 evidence, pre-10 wire", the checks that need a valid -10
      object (S4, S5, S6) are not run, and the `ledger-evidence` members are still read and summed against
      the top-level figures as INFO. A 1.1.1 declaration is on the -10 wire and goes through S2 like any
      other.
   b. An object that carries `ledger-evidence` and not `ledger-evidence-2` is a profile 1.1 object. It is
      reported "profile 1.1 evidence, not an SFC 2.0 declaration", and no 2.0 check can PASS on it. It is
      judged only by the 1.1 rules of disclosure profile 1.1 (section 5.5 there): the members are present and
      well formed, the four sums match the top-level figures by the tolerance rule where both are present,
      and `network-offset-coverage` is read as 1.1 defines it (Σ(S2 + S3) ≤ ΣR), not as the 2.0
      conjunction. A failure of those rules is FAIL, as 1.1 judged it; its units and `signed` are INFO, never
      FAIL. C-SFC-7 and section 7.4 apply only to `ledger-evidence-2` and are not run here, and S6 b to f are
      INFO "not derivable" for it. A 1.0 or 1.1 declaration is never failed by a rule that did not exist then.
   c. An object that carries both `ledger-evidence` and `ledger-evidence-2` is a 2.0 object; the old name is
      reported INFO "superseded name present".
   d. An object with only the three 1.0 names is judged as a 2.0 object without a ledger (section 6.3). The
      profile records no adoption date, so such an object that omits `energy-unit` or `carbon-unit` FAILS
      section 5.2 rule 1.
   e. An operator object without `ledger-evidence-2` keeps the draft's rules for `period`, and C-SFC-7 does
      not apply to it.
4. An emitter MUST NOT emit 1.x forms after it adopts 2.0. The adoption commit of a chain is its first 2.0
   event. One chain MAY hold both: 1.x before the adoption commit and 2.0 after it (L11); the shape of
   `period` tells them apart, and events carry no version member. A 1.x event has no `network` member and is
   read under the ledger's own network.
5. The pinned 1.x locations stay reachable and unchanged (Appendix E).
6. **1.x Registry.** A 1.x Registry entry is recognised by `keys[].public-jwk` and `valid-from-commit` and the
   absence of `sig`; its members read as `jwk`, `validFromCommit` and `validToCommit`. Its `active` intervals
   are full dates with an inclusive `to`: an operator is active in a month when `from` ≤ the last day of the
   month and (`to` is null or `to` ≥ the first day of the month). The registrar appends 2.0-form intervals and
   keys after adoption; 1.x intervals stay readable by this rule until then, and a past interval is never
   altered (section 3.1). D2 and C-SFC-3 say what is reported for such an entry.

### 9.2 Forward

1. **Draft.** SFC 2 relies only on the members and tokens of Appendix D. A later draft revision that keeps them
   needs no change here. The checker takes the draft revision from the consumer library it is built on, so a
   library upgrade carries SFC 2 to later revisions with no profile edit. Appendix D is the diff target.
2. **Versions.** 2.x adds and never changes meaning; a change of meaning is 3.0. Additions are new optional
   members in events, the Registry entry or the extensions. A reader ignores unknown members and never fails on
   them. Closed lists (`hardwareClass`, `reusePolicy`, `measurementMethod`) do not grow in 2.x; a new value is
   3.0. `profile-version` `"2.1"` and so on marks an additive change. A new extension for a new purpose takes
   a new name; an existing name gains only new optional members; a change of meaning mints a new name in 3.0.
   A `profile-version` that does not match `2.<digits>` is a profile this checker does not read: the checker
   reports INFO "profile X not read" and runs no coherence or deep check on it.
3. **Platforms.** No platform is named normatively; section 2.2 has the two cases.
4. **Thresholds.** CAP is the column's figure. If a later column revises it, 2.x carries the new figure as a
   parameter with its source, and nothing else changes.
5. **Papers.** A later paper cites "SFC profile 2.x" and the Zenodo concept DOI.

## 10. References

Normative

- [RFC 2119] Bradner, S. Key words for use in RFCs to indicate requirement levels. BCP 14. 1997.
- [RFC 8174] Leiba, B. Ambiguity of uppercase vs lowercase in RFC 2119 key words. BCP 14. 2017.
- [RFC 3339] Klyne, G., Newman, C. Date and time on the Internet: timestamps. 2002.
- [RFC 8785] Rundgren, A., Jordan, B., Erdtman, S. JSON Canonicalization Scheme (JCS). 2020.
- [RFC 7493] Bray, T., Ed. The I-JSON message format. 2015.
- [RFC 8032] Josefsson, S., Liusvaara, I. Edwards-curve digital signature algorithm (EdDSA). 2017.
- [RFC 9864] Jones, M. B., Steele, O. Fully-specified algorithms for JOSE and COSE (registers `Ed25519`). 2025.
- [RFC 7515] Jones, M., Bradley, J., Sakimura, N. JSON Web Signature (JWS). 2015.
- [RFC 8037] Liusvaara, I. CFRG Elliptic Curve Diffie-Hellman (ECDH) and signatures in JOSE (OKP keys). 2017.
- [RFC 8259] Bray, T., Ed. The JavaScript Object Notation (JSON) data interchange format. 2017.
- [RFC 8610] Birkholz, H., Vigano, C., Bormann, C. Concise Data Definition Language (CDDL). 2019.
- [RFC 5890] Klensin, J. Internationalized domain names for applications (IDNA): definitions and document framework. 2010.
- [JSON Schema] JSON Schema: a media type for describing JSON documents, draft 2020-12 (the dialect of Appendix A).
- [Draft -10] Besleaga, A. N. The "sustainability-data" well-known URI. draft-besleaga-sustainability-wellknown-10, work in progress. 2026.
- [Column] Besleaga, A. N. "'Sustainability-First Consensus' Ledgers for a Green Digital Future." Communications of the ACM, Opinion, in press (returns "not found" until published).

Informative

- [GHG Corporate Standard] WRI, WBCSD. The Greenhouse Gas Protocol: a corporate accounting and reporting standard, revised edition. 2004.
- [GHG Scope 2] Sotos, M. GHG Protocol Scope 2 Guidance. WRI. 2015.
- [GHG Scope 3] WRI, WBCSD. Corporate Value Chain (Scope 3) Accounting and Reporting Standard. 2011.
- [SBTi] Science Based Targets initiative. SBTi Corporate Net-Zero Standard, version 1.3.1, April 2026, criteria C12, C28 and recommendation R12.
- [Directive 2024/825] Directive (EU) 2024/825 of 28 February 2024 (empowering consumers for the green transition).
- [Delegated Regulation 2025/422] Commission Delegated Regulation (EU) 2025/422 (sustainability indicators under Regulation (EU) 2023/1114, MiCA), Annex, Table 2, field S.8, recital 8.
- [CSRD] Directive (EU) 2022/2464 (corporate sustainability reporting).
- [MiCA] Regulation (EU) 2023/1114 (markets in crypto-assets).
- [WEEE] Directive 2012/19/EU (waste electrical and electronic equipment).
- [ISO/IEC 21031] ISO/IEC 21031:2024, Software Carbon Intensity (SCI) specification.
- [DID Core] W3C. Decentralized Identifiers (DIDs) v1.0.
- [CBECI] Cambridge Centre for Alternative Finance. Cambridge Bitcoin Electricity Consumption Index.
- [CCRI] Crypto Carbon Ratings Institute.
- [CCAF] Cambridge Centre for Alternative Finance. Cambridge Blockchain Network Sustainability Index.

[RFC 2119]: https://www.rfc-editor.org/info/rfc2119
[RFC 8174]: https://www.rfc-editor.org/info/rfc8174
[RFC 3339]: https://www.rfc-editor.org/info/rfc3339
[RFC 8785]: https://www.rfc-editor.org/info/rfc8785
[RFC 7493]: https://www.rfc-editor.org/info/rfc7493
[RFC 8032]: https://www.rfc-editor.org/info/rfc8032
[RFC 9864]: https://www.rfc-editor.org/info/rfc9864
[RFC 7515]: https://www.rfc-editor.org/info/rfc7515
[RFC 8037]: https://www.rfc-editor.org/info/rfc8037
[RFC 8259]: https://www.rfc-editor.org/info/rfc8259
[RFC 8610]: https://www.rfc-editor.org/info/rfc8610
[RFC 5890]: https://www.rfc-editor.org/info/rfc5890
[JSON Schema]: https://json-schema.org/draft/2020-12/json-schema-core
[Draft -10]: https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/10/
[Column]: https://doi.org/10.1145/3809296
[GHG Corporate Standard]: https://ghgprotocol.org/corporate-standard
[GHG Scope 2]: https://ghgprotocol.org/scope-2-guidance
[GHG Scope 3]: https://ghgprotocol.org/corporate-value-chain-scope-3-standard
[SBTi]: https://files.sciencebasedtargets.org/production/files/Net-Zero-Standard.pdf
[Directive 2024/825]: http://data.europa.eu/eli/dir/2024/825/oj
[Delegated Regulation 2025/422]: http://data.europa.eu/eli/reg_del/2025/422/oj
[CSRD]: http://data.europa.eu/eli/dir/2022/2464/oj
[MiCA]: http://data.europa.eu/eli/reg/2023/1114/oj
[WEEE]: http://data.europa.eu/eli/dir/2012/19/oj
[ISO/IEC 21031]: https://www.iso.org/standard/86612.html
[DID Core]: https://www.w3.org/TR/did-core/
[CBECI]: https://ccaf.io/cbnsi/cbeci
[CCRI]: https://carbon-ratings.com
[CCAF]: https://ccaf.io/cbnsi

## Appendix A. JSON Schemas (normative)

JSON Schema ([JSON Schema]) draft 2020-12, in `schemas/`, generated from the tables of this document. A
document is valid when it validates against the schema and meets every rule of the text that a schema cannot
state (for example L4 to L11 and the Registry's uniqueness rules). Unknown members are allowed everywhere
(section 1.6 rule 3).

Not yet published: the files of `schemas/` are planned for the release and are not in the folder today. The
schemas cannot be audited until they exist; the audit of this appendix is to be repeated on them.

| File | Validates | Section |
|---|---|---|
| `schemas/registry-entry.json` | A Registry entry. | 3.1 |
| `schemas/event-energy.json` | An `EnergyAttested` event. | 3.2, 3.3 |
| `schemas/event-carbon.json` | A `CarbonAttested` event. | 3.2, 3.4 |
| `schemas/ledger-excerpt.json` | A ledger excerpt; `profile-version` matches `^2\.[0-9]+$`. | 3.8 |
| `schemas/ext-hardware-lifecycle.json` | The value of `hardware-lifecycle`. | 6.2 |
| `schemas/ext-carbon-neutrality.json` | The value of `carbon-neutrality`. | 6.3 |
| `schemas/ext-network-topology.json` | The value of `network-topology` (both levels); `validated-node-count` optional, required for a complete object. | 6.4 |
| `schemas/ext-ledger-evidence-2.json` | The value of `ledger-evidence-2`. | 6.5 |

The declaration itself is validated by the draft's CDDL and rules, through the consumer library.

## Appendix B. Test vectors (normative for implementers, informative for readers)

`vectors/` holds one generator, one independent cross-check, the inputs and the expected outputs.

Not yet published: the files of `vectors/` are planned for the release and are not in the folder today. The
vectors cannot be audited until they exist; the audit of this appendix is to be repeated on them.

| File | Purpose |
|---|---|
| `vectors/make-vectors.mjs` | Generates every input and expected output from fixed values: the clock 2026-05-02T00:10:00Z, given as an explicit T (so the evaluation window is April 2025 to March 2026; each excerpt's `read-at` is at or after it), and the RFC 8032 section 7.1 test 1 key. |
| `vectors/crosscheck.py` | Python, standard library only. Recomputes hashes, sums and rule results from the inputs and compares them with the expected outputs. It is the cross-check gate. |
| `vectors/inputs/<id>.json` | One input per case: an excerpt and, where needed, a declaration. |
| `vectors/expected/<id>.json` | The expected rows per case, in the result words of section 7.1. |
| `vectors/worked/` | One worked case, generated and signed with the test key: three operators, twelve months, one correction, one silent month, 1 500 kg of a 2 t retirement in January and the remaining 500 kg in February, and one rounding case. Every figure is invented. |

| Case | What it proves | Spec sections |
|---|---|---|
| `v01-canonical` | The RFC 8785 bytes of one event. | 1.6 |
| `v02-hash` | The event hash and the signature (test key). | 1.6 |
| `v03-effective` | Effective attestation selection with one correction; a rule-breaking event is skipped. | 1.2, 3.5 |
| `v04-sums-month` | Sums for one month of a three-operator network. | 5.4, 6.5 |
| `v05-sums-year` | Sums for one calendar year, heads and counts. | 6.5 |
| `v06-two-objects` | The market-based and the location-based object, and a location scope-2 off by more than the tolerance: FAIL. | 5.3, 7.3 S6 i |
| `v07-silent` | A silent month: incomplete object (`validated-node-count` omitted), C-SFC-2 not evaluable. | 5.5 |
| `v08-fork` | Two events sharing a `prev`. | 7.4 D4 |
| `v09-bad-signature` | A signature that does not verify. | 3.5 L5 |
| `v10-duplicate-retirement` | One tonne used twice; a registry written with a trailing slash is rejected by L8b. | 3.5 L8b, L9 |
| `v11-late-retirement` | `retiredAt` after the due instant. | 3.5 L10 |
| `v12-wrong-flag` | `netZero` that contradicts its figures. | 3.5 L7 |
| `v13-late-correction` | A correction after `updated`: INFO, not FAIL; a case where the as-of-read result is FAIL. | 3.6, 7.4 D7 |
| `v14-tolerance` | The tolerance rule at its edges (integer, 6-decimal, a three-operator sum off by 1.5 × 10^-6 that passes, coarse rounding of 1 for 0.6 that fails); the half-even tie 1.2345675 published as 1.234568; a non-terminating intensity quotient; the digit limit (999999999.999999 accepted, 1000000000.000001 rejected, a 16-digit integer rejected). | 1.3, 7.3 S6 |
| `v15-profile-1x` | 1.x events (one on the location basis, one with a period that is not a month) and a 1.1 declaration read without 2.0 failures. | 9.1 |
| `v16-noncanonical-signature` | A signature with non-zero trailing bits or S not below L: the row "encoding" fails. | 1.6 rule 5 |
| `v17-limits` | One case per limit of section 7.6, each NOT-EVALUABLE with the limit named. | 7.6 |
| `v18-registry-1x` | A 1.x Registry entry (inclusive full-date `active`, no `sig`): INFO, and NOT-DECLARED for a missing `nodeProfile`. | 9.1 rule 6 |
| `v19-window` | An empty Registry; a late `active.from` (young network: C-SFC-2 NOT-EVALUABLE, C-SFC-1 and C-SFC-4 PASS with INFO, C-SFC-6 permissioned case by the node bound); a check clock later than `read-at`; C-SFC-4 run over the window and over a declaration's period. | 7.2, 7.4 D5 |
| `v20-selection` | Objects for 2024 and 2025 (2025 selected, 2024 INFO); a 2025 object ending after T (2024 selected, INFO); two 2025 objects with no market-based one (NOT-EVALUABLE). | 7.3 S4 |
| `v21-net-zero-order` | All-zero emissions and offsets (`achieved`); a silent month with offsets above 0 (`partial`) and with offsets 0 (`not-achieved`); the no-ledger zero footprint. | 5.4, 6.3 |
| `v22-period-offset` | A calendar year with `+02:00` bounds: C-SFC-2 PASS or FAIL on a disclosure-only object; C-SFC-5 FAIL and C-SFC-7 NOT-EVALUABLE on one that carries `ledger-evidence-2`. | 1.2, 5.2 rule 6 |
| `v23-wrong-network` | An event replayed from another network. | 3.5 L1 |
| `v24-1x-after-2x` | A 1.x-form event after a 2.0 event in its chain. | 3.5 L11 |

## Appendix C. Mapping from 1.x

This appendix maps every rule, field, check row and file of the 1.x texts that SFC 2 reads or replaces.
"Dropped (reason)" means the item has no 2.0 form. Rules L1 to L11 are in section 3.5. The 1.x rules a 1.x
event is judged by (section 9.1) are those of ledger profile 1.2, section 3.1 rules 1 to 8 and the comparison
of section 4 (the allocation paragraph of section 4 has no 2.0 form; see C.1).

### C.1 Events and Registry (ledger profile 1.1 and 1.2)

| 1.x item | 2.0 form |
|---|---|
| Envelope `type`, `subject`, `actor`, `prev`, `ts`, `payload`, `sig` | Unchanged (3.2), plus `network` (1.x events have none and are read under the ledger's own network). `sig.alg` is `Ed25519` only. |
| `sig` "unless the Registry records another algorithm" | Dropped for 2.0 events (one algorithm, simpler to verify). A 1.x event that used another algorithm is handled by 9.1 rule 2. |
| `sig.value` encoding | `b64url` without padding, canonical only, stated (1.5, 1.6). |
| Rule "one attestation per period; correction only by rule 5" | L6. |
| Rule `subject` = `actor` | L1. |
| Rule `prev` null only first | L4. |
| Rule "reject if `prev` is not the head" | L4 (the tip). |
| Rule "key current when submitted; verifiers use commit time" | L5 (one instant, the commit). |
| Rule `ts` not earlier than the day after `period.to` | L3 (`period.end`; also the commit). |
| Rule "reader ignores unknown members" | 1.6 rule 3. |
| `EnergyAttested.period {from, to}` full dates | `{start, end}` of month bounds (3.3); 1.x read by 9.1. |
| `nodeCount`, `kWhConsumed` | Unchanged. |
| `measurementMethod` (SHOULD be a token) | Required, closed set of four. A 1.x event without one counts as `third-party-modeled`, with INFO (9.1 rule 1). |
| `evidenceCid` | `evidence` (`uri`): no dependence on content-identifier versions. A 1.x value is read as `evidence` for display only (9.1 rule 1). |
| `supersedes` (optional) | Unchanged, now with L6 constraints. |
| `CarbonAttested.period {from, to}` | `{start, end}`. |
| `scope2KgCO2e` (method per operator or per methodology) | Market-based, one basis for all operators (3.4). A 1.x figure on the location basis is not counted as market-based (9.1 rule 1). |
| `scope2Method` (optional) | Read by 9.1 rule 1; a location-based value moves the figure to `scope2LocationKgCO2e`. In 2.0 the market basis is fixed in-band. |
| `scope3KgCO2e` | Unchanged name; not negative; 1.1's amortised reading is a stated deviation (3.4). |
| (none) Scope 1 | `scope1KgCO2e`, optional. |
| `gridIntensityRef` | Unchanged; it no longer feeds a published number (intensity is derived, 5.4). |
| `offsetsKgCO2e` | Kept, equal to Σ `retirements.kg`. |
| `netZero` | Kept; the offset-coverage flag, now including Scope 1. |
| (none) `retirements` | New list inside the attestation. |
| Signed allocation document (`type`, `operator`, `registry-uri`, `retired-in`, `tonnes-retired`, `beneficiary`, `parts[{period, kg}]`, `sig`) | Dropped (the `retirements` list under the normal key rule replaces it; no key exception, no separate format). `registry-uri` → `retirement.registry`; `tonnes-retired` → `tonnesRetired`; `parts[].kg` → `retirement.kg`; `retired-in` → `retiredAt` (an instant); `beneficiary` → still published at the registry (3.4). |
| "Known gap: double allocation" | Closed for identical keys by L9. |
| Registry: `operator`, `origin`, `active` (full dates), `keys[public-jwk, valid-from-commit, valid-to-commit]`, `nodeProfile` | `operator`, `origin`, `active` (month bounds), `keys[jwk, validFromCommit, validToCommit]`, `nodeProfile` (3.1); plus registrar `sig`. A 1.x entry is read by 9.1 rule 6 (inclusive full-date `active`, no `sig`, `nodeProfile` optional): D2 reports INFO, C-SFC-3 NOT-DECLARED when `nodeProfile` is absent; test `v18-registry-1x`. |
| `nodeProfile.hardwareClass` four values | Five: adds `accelerator-server`. The class is a Registry value only; the `hardware-lifecycle` extension has no class member (6.1). |
| `nodeProfile.purchasedAt`, `expectedRetireAt`, `reusePolicy`, `asicForbidden` | Unchanged; `asicForbidden` now `true` and tested in C-SFC-3. |
| Ledger excerpt v1: `fixture`, `fixture-version`, `notice`, `profile-version`, `hash-algorithm`, `event-encoding`, `network`, `registry`, `retirements`, `ledger`, `publication` | Excerpt 2 (3.8): `excerpt-version` (was `fixture-version`), `profile-version`, `network`, `read-at`, `registrar`, `registry`, `ledger`, `checkpoint` (optional), `notice`. Dropped: `fixture` (test-only label), `hash-algorithm`, `event-encoding` (fixed by 1.6), `retirements` (inside events), `publication` (the declaration states period and `updated`). A version 1 excerpt is NOT-EVALUABLE for the deep check (7.4 D1). |
| Excerpt `ledger[].commit`, `hash`, `event` | Unchanged. |
| v1.1 endpoints `/v1/sustainability/operator/{did}`, `/network`, `/csrd`, `/sfc` and `application/jose+json` | Dropped (replaced by the declaration, `disclosure-uri`, `methodology-uri` and `signed`; unchanged from 1.2). |

### C.2 Checks and report rows

| 1.x item | 2.0 form |
|---|---|
| C-SFC-1 (latest energy event at most 35 days old) | C-SFC-1 coverage over the window. Dropped: the 35-day test (it passed on late filing and failed new or departed operators). |
| C-SFC-2 ledger form (trailing 12 months) | C-SFC-2 ledger form (window anchored; silent months and a window not fully covered are not evaluable, and a partial sum at or above CAP is FAIL). |
| C-SFC-2 disclosure form (`reporting-period` `YYYY`) | C-SFC-2 disclosure form on `period`. |
| C-SFC-3 (`asicForbidden` and class) | C-SFC-3, result DECLARED or NOT-DECLARED. Narrowed: 1.x tested every operator in the Registry; 2.0 tests the operators active in a month of the window. |
| C-SFC-4 | C-SFC-4 over the window, or over the declaration's period inside the deep check. The window test replaces the 1.x rule "a non-compliant period flags the operator until its next compliant attestation": a non-compliant month fails the check while it lies in the window. |
| C-SFC-5 (conforms to -07) | C-SFC-5 (conforms to -10, units, `signed`). |
| C-SFC-6, "current" | C-SFC-6, two cases (2.2); "current" is the 18-month rule. The clause that the hot-path deployment names any other current assessment placing the platform above C1 is dropped (2.2 rule 2; Appendix E). In the permissioned case, a window that is not fully covered is judged by the registered-node bound instead of C-SFC-2, and a NOT-EVALUABLE C-SFC-2 for that reason does not make C-SFC-6 NOT-EVALUABLE. |
| Migration "within one reporting period" (ledger profile 1.2, section 2.2) | 12 months, hot path only; the anchor is informative (2.2 rule 5). |
| C-SFC-7 | C-SFC-7, with the cut-off `updated`. |
| Shallow check 1.2 steps 1 to 6 (§9.3) | S1 to S7 (7.3). |
| Deep check 1.2 steps 1 to 8 (§9.4) | D1 to D9 (7.4). Step 7 (anchor) dropped (informative only, Appendix E). Step 8 → D8 (optional). |
| Checker 1.1.1 rows `draft-conformance`, `draft-warning`, `M-methodology`, `ext-name` | S2. |
| `C1-energy`, `subject` | S4 and C-SFC-2. |
| `C2-hardware-lifecycle`, `C2-embodied-carbon` | S6 (declared members) and C-SFC-3. |
| `C3-gross-figure` | S6 c. |
| `C3-gross-coherence`, `C3-scopes-2-3`, `C3-carbon-accounting`, `C3-carbon-intensity` | S6 b to d. |
| `C3-renewable-energy` | S6 a and the DECLARED rule (S6 g). |
| `C3-net-zero`, `C3-net-zero-evidence` | S6 f. |
| `C3-attestation` | S3 (attestation step): fetching `verifiable-attestation-uri` is optional and reported as INFO. |
| `C4-document`, `C4-origin` | S1. |
| `C4-disclosure-index` | S5. |
| `M-topology`, `M-membership` | S6 g and 6.4. |
| `ledger-evidence` | 9.1 rule 3. |
| Verdict words PASS, FAIL, DECLARED, ABSENT, REFUSED, WARN, INFO | PASS, FAIL, NOT-EVALUABLE (was REFUSED and ABSENT where an input was missing), DECLARED, NOT-DECLARED, INFO. A missing extension is NOT-DECLARED for C-SFC-3 and INFO "not declared" for the other members (C2 declared members, net zero, topology). WARN dropped (a finding is FAIL or INFO). |
| Gateway shallow rows S1 fetch, S2 draft-conformance, S3 signature, S4a C-SFC-2-disclosure, S4b C-SFC-5, S5a shape, S5b coherence-energy, S5d coherence-offsets, S5e coherence-status, S6 record | S1, S2, S3, S4, S5, S6 (a to f), S7. `S0 internal` dropped (implementation). |
| Gateway deep rows D1 ledger-access, D2 operator-set, D3 signatures, D4 chains, D5 C-SFC-4, D6 sums, D6b declaration, D7 C-SFC-3, D8 anchor, D9 retirements, D10 record | D1, D2, D3, D4, D5, D6, D6, D5c (C-SFC-3), dropped (anchor informative), D5 and D8, D9. `D0 internal` dropped. |
| Gateway refusal codes E-SHAPE, E-ORDER | Excerpt schema (3.8). |
| E-PERIOD, E-OPERATOR, E-INACTIVE, E-TYPE, E-ACTOR | L1, L2, D2. |
| E-HASH, E-SIG, E-KEY | D3, L5. |
| E-TS | L3. |
| E-PAYLOAD, E-NUMBER | L8 and the tables. |
| E-PREV, E-FORK, E-NOHEAD | L4, D4 (a null declared head is allowed when a chain has no events). |
| E-DUPLICATE, E-SUPERSEDES | L6. |
| E-FLAG | L7. |
| E-METHOD | Dropped as a refusal: the in-band basis is market-based and the method token is the least direct (5.1). |
| E-EMPTY | Silent months, incomplete object (5.5). |
| E-ALLOCATION | L8b, L9, L10, L11. |
| E-DISCLOSURE, E-CONFIG | Dropped (gateway-local). |
| Exit statuses and `--now` default clock | Implementation of the checker; the check instant T is printed (7.3 step 7). |

### C.3 Disclosure profile 1.0, 1.1 and 1.1.1

| 1.x item | 2.0 form |
|---|---|
| Section 1 purpose, 1.1 reading | 0, 1.1. |
| Two declaration levels (network `service`, operator `origin`) | Levels unchanged (5.1). 1.1 let an operator declare "any period the operator can stand behind"; 2.0 limits an operator object that carries `ledger-evidence-2` to a month or a calendar year, and an operator object without it keeps the draft's rules for `period` (5.1). The 1.1 network-level MUST list now sits in 5.4, and the measured and modelled rule in 5.2 rule 7. |
| Network `period` a whole calendar year; `reporting-period` `YYYY` (-07) | `period` of one calendar year (draft -10). A declaration that still uses `reporting-period` FAILS S2 (9.1 rule 3). |
| C1 boundary, cap table in four units | 2.1 and 1.4 (CAP in kWh). The four-unit table is dropped; 1.3 rule 1 and 1.4 cover conversion. |
| `measurement-method` SHOULD guidance | Replaced by the least-direct rule (5.1) and the required token set (3.3). Compatibility reading of non-token values: dropped (not valid under -10). |
| Incomplete year: publish the completed portion or the months | 5.2 rule 5. |
| C2, C3, C4 tables | 2.1, 5.4, 6.2, 6.3. The 1.1 MUST list for a network declaration sits in 5.4; the measured and modelled rule in 5.2 rule 7. |
| In-band `scope-2` market-based, location-based in the methodology document | In-band market-based; location-based as an optional second object (5.3). |
| Scope 3 categories and capital goods | 3.4. |
| Extension namespace and names `hardware-lifecycle`, `carbon-neutrality`, `network-topology` | 6.1 to 6.4: names and members unchanged. |
| `ledger-evidence` and members `profile-version`, `ledger-access-uri`, `hash-algorithm`, `event-encoding`, `period-start`, `period-end`, `operators`, `network-offset-coverage`, `anchor` | `ledger-evidence-2` (6.5): `profile-version` (`"2.0"`), `ledger-access-uri`, `operators`, `network-offset-coverage` (now the conjunction of the entries' flags); `hash-algorithm`, `event-encoding` dropped (fixed by 1.6); `period-start`, `period-end` dropped (the object's `period` is the period); `anchor` dropped (informative). The old name is superseded and read by 9.1 rule 3. |
| `operators` entry members `operator`, `energy-head`, `carbon-head`, `energy-events`, `carbon-events`, `kwh`, `scope2-kgco2e`, `scope3-kgco2e`, `offsets-kgco2e`, `offset-coverage-every-period` | Kept (heads may be null). Added: `origin`, `scope1-kgco2e`. |
| `hardware-lifecycle` members `general-purpose-hardware`, `single-use-asic-required`, `expected-service-life-years`, `embodied-carbon-in-scope-3`, `reuse-and-recycling-policy-uri` | Unchanged (6.2). The `accelerator-server` class is a Registry value only (3.1). |
| `carbon-neutrality` members `net-zero-status`, `renewable-procurement`, `residual-emissions-tCO2e`, `offsets-retired-tCO2e`, `offset-registry-uri`, `offsets-attested-by` | Names and members unchanged; 2.0 adds derivations for ledger-backed objects (6.3, 5.4); `offsets-retired-tCO2e` is Σ `offsetsKgCO2e` ÷ 1 000. |
| `network-topology` members (network: `consensus-mechanism`, `validated-node-count`, `node-count-validation-method`, `per-transaction-energy-Wh`, `nakamoto-coefficient`, `geographic-regions`; operator: `member-of-network`, `network-declaration`) | Names and members unchanged (6.4); `validated-node-count` gets a derivation for ledger-backed objects. |
| Rule 1 `carbon-footprint` is gross | 6.3, 5.4. |
| Rule 2 there is no TWh | 1.4. |
| Rule 3 a network is a `service` | 5.1. |
| Rule 4 hardware data never travels alone | 6.2. |
| Rule 5 `upstream` is not membership | 6.4. |
| Rule 6 say attested, never verified | 8. |
| 7.1 real-time measurement, periodic publication | 2.1.2 (real-time monitoring). |
| 7.2 two routes to the evidence trail | `ledger-evidence-2` inside the signed object (5.2 rule 2); the `disclosure-uri` route stays available but is not covered by `signed`. |
| 7.3 bespoke endpoints | Dropped (history only, C.1). |
| 8 how to check | 7. |
| 9 what a conformance statement may claim | 8 (the two 1.x lists merged). |
| 10 examples | `examples/` (below). |
| 11 changes from 1.0 | Appendix E. |
| Perturbation (ledger profile 1.2 only) | 5.2 rule 3, for every network-level SFC object. |
| `signed` MUST (ledger profile) / SHOULD (disclosure) | 5.2 rule 2. |

### C.4 Files

| 1.x file | 2.0 form |
|---|---|
| `sfc-compliance/PROFILE.md` (disclosure 1.1) | Replaced later by a short pointer to this document; stays reachable at rfc commit `2d4822a`. |
| `sfc-compliance/PROFILE-1.0.md` | Replaced later by a short pointer; stays reachable at rfc commit `c787378`. |
| `sfc-compliance/SFC.md` | Replaced later by a short pointer; stays reachable at rfc commit `b6d1df0`. |
| greentech `SFC_COMPLIANCE.md` (ledger profile 1.2) | Becomes a short page that points here; stays reachable at greentech commit `edb7e71` and on Zenodo. |
| `sfc-compliance/sfc-check.mjs` 1.1.1 | `sfc-check.mjs` 2.0.0. |
| `sfc-compliance/README.md` | Rewritten; the 1.x text stays reachable at rfc commit `4eb26cf`. |
| `examples/sfc-network.example.json`, `examples/sfc-operator.example.json` (1.1.1) | Regenerated for 2.0 (the network example is an array of two objects); the 1.1.1 versions are kept as fixtures under `test/fixtures/profile-1.1/`. |
| Fixtures `attestation-absent`, `bad-uri`, `http-uri`, `invalid-method`, `ledger-evidence`, `legacy-08`, `missing-extension`, `non-conformant`, `operator-level`, `over-cap`, `pass`, `sub-annual` | Kept under `test/fixtures/profile-1.1/` as backward-reading fixtures; 2.0 fixtures are added beside them. `legacy-08` expects S2 FAIL and the energy check NOT-EVALUABLE (9.1 rule 3). |
| `test/sfc-check.test.mjs` | Rewritten for 2.0 plus backward-reading tests. |
| `gateway/src/adapters/sfc-ledger-bridge.ts`, `gateway/scripts/sfc-ledger-check.mjs` | Reimplemented against this document (outside this profile's files). |

## Appendix D. Draft members relied on

All from the [Draft -10]. A later revision is checked against this list.

| Item | Where used |
|---|---|
| Well-known path `/.well-known/sustainability-data`; media type `application/sustainability-data+json`; `application/json` readable; HTTPS only | S1 |
| One object or an array of objects; the same `target` and `period` may repeat when `carbon-accounting` differs | 5.3 |
| Totals across objects are formed only over non-overlapping periods of one `target` with the same `carbon-accounting` value or none, after unit conversion; periods that meet do not overlap | 5.3, 7.2 |
| Mandatory: `updated` (the cut-off), `capabilities`, `provider`, `measurement-method`, `methodology-uri`, `period`, `target` | 5.1 |
| `period` = `{start, end}`, RFC 3339 date-times, half-open, `start` before `end`, compared as instants; whole calendar year and month defined by the bounds in their own offsets. SFC 2 reads a disclosure-only year in its own offset (1.2, 7.2) and requires UTC months, bounds written `Z`, for an object that carries `ledger-evidence-2` (1.2, 5.2 rule 6) | 1.2, 5.1, 7.2 |
| `measurement-method` tokens `hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled`, most to least direct; combined figures carry the least direct | 3.3, 5.1 |
| `target-type` values `service` and `origin` (nine exist; two used) | 5.1 |
| `energy-consumption`, `energy-unit` (`Wh`, `kWh`, `MWh`, `GWh`; default `kWh` never relied on) | 5.4, 7.2 |
| `carbon-footprint` (gross), `carbon-unit` (`gCO2e`, `kgCO2e`, `tCO2e`; default `gCO2e` never relied on), `carbon-accounting` (`location-based`, `market-based`), `scope-1`, `scope-2`, `scope-3` | 5.3, 5.4 |
| `carbon-intensity-gCO2e-per-kWh`, `renewable-energy` | 5.4 |
| `disclosure-uri`, `verifiable-attestation-uri` (at most one, signed by another party), `upstream` | 5.2 (`disclosure-uri`), 6.4 (`upstream` is not membership), 8 |
| At least one numeric metric or one of the two evidence URIs per object | 6.2 |
| `extensions`: names are URIs compared as strings and never fetched; values are objects; unknown names ignored | 6.1 |
| `signed`: JWS Compact, `alg` an asymmetric signature algorithm, `Ed25519` (RFC 9864) and `ES256` RECOMMENDED, `none` and MAC algorithms forbidden; `cty` `sustainability-data+json`; verifier compares payload `target`, `period.start`, `period.end`, `carbon-accounting`, `functional-unit` as strings; key trust rules | 1.6, 5.2, 7.3 |
| Top-level members not defined by the draft are not added; the draft defines no version member | 0 |
| Strings are equal after JSON escapes are decoded, with no case folding; a host-name `target` is written in A-label form and the draft compares it case-insensitively (this profile writes `host` in lower case and compares hosts after lower-casing both sides) | 1.5, 7.4 |
| Numeric members MUST NOT be negative unless stated (`scope-1` MAY be negative); no number beyond IEEE 754 binary64 magnitude or precision ([RFC 7493], 2.2) | 1.3, 5.4 |
| Partial answers: figures for part of a period are not presented as the whole | 5.2, 5.5 |
| Optional perturbation within 1% (forbidden here by 5.2 rule 3) | 5.2 |
| Periods SHOULD be a day or longer | 5.1 |

## Appendix E. Informative notes and history

### E.1 Platform notes

These notes were carried from ledger profile 1.2 (2026-10-03). Naming a platform is not a qualification, and
none of these notes is an energy assessment. Each deployment cites the assessment it relies on (C-SFC-6).
The earlier annual energy figures in these notes were not re-confirmed from their sources for this version,
so none is quoted here; read the current estimate at the source before citing one.

| Platform | Note |
|---|---|
| Hyperledger Fabric | Permissioned BFT; energy bounded by node count × node power. |
| NEAR Protocol | Sharded proof of stake. Holds a climate-neutral product label (2021) that rests on purchased offsets and is not an energy measurement. Annual energy figures appear in MiCA sustainability-indicator disclosures of crypto-asset service providers; use the current disclosure and its boundary. |
| Hedera | aBFT (hashgraph). The vendor states it is carbon-negative through purchased offsets; not an energy measurement. |
| VeChainThor | Authority masternodes (proof of authority); footprint to be confirmed from an independent source. |
| Any proof-of-work chain | Barred from any hot path (2.2); see [CBECI] for current estimates. |
| Ethereum L1 | Proof of stake. Estimates are published by [CCRI] and [CCAF]; compare them with CAP on one boundary before choosing a role for it. |

### E.2 The anchor option

A deployment MAY publish periodic fingerprints (Merkle roots) of its hot-path events on a public chain that is
not proof-of-work. If it does, the methodology document defines the construction (leaf encoding and hash, leaf
order, odd-node rule, day boundary in UTC), the chain's finality and its continued availability. SFC 2 has no
check for it and no rule for an anchor chain that stops producing blocks, because the anchor is informative
only; the methodology document states what the deployment does in that case. Polygon zkEVM, used as an example
anchor in 1.1, stopped producing blocks on 3 July 2026 (as recorded in ledger profile 1.2).

### E.3 History and pinned locations

| Version | Date | Pinned location |
|---|---|---|
| Ledger profile 1.1 | 2026-05-23 | Zenodo 10.5281/zenodo.22681205. |
| Ledger profile 1.2 | 2026-10-03 | Zenodo 10.5281/zenodo.23122082; greentech repository commit `edb7e71`. |
| Disclosure profile 1.0 | 2026-09-16 | rfc-sustainability-wellknown commit `c787378`. |
| Disclosure profile 1.1 | 2026-10-03 | rfc-sustainability-wellknown commit `2d4822a` (`PROFILE.md`). |
| Disclosure profile 1.1.1 (checker and examples on the -10 wire) | — | rfc-sustainability-wellknown, `sfc-compliance/` at tag `v0.8.0-draft-10-schema-2.0` (first tag with checker 1.1.1). |
| `sfc-compliance/SFC.md` | — | rfc-sustainability-wellknown commit `b6d1df0`. |
| `sfc-compliance/README.md` (1.x text) | — | rfc-sustainability-wellknown commit `4eb26cf`. |
| Gateway ledger bridge (excerpt format 1) | — | rfc-sustainability-wellknown commit `50a8d4b`. |
| SFC profile 2.0 | set at release | Zenodo concept DOI 10.5281/zenodo.22681204 (latest version). |

The IET paper under review pins ledger profile v1.2 (greentech commit `edb7e71`), disclosure profile 1.1 (rfc
commit `2d4822a`), the gateway bridge commit `50a8d4b` and draft -07. Those pins stay valid and unchanged.
SFC 2 does not alter any of them; later papers cite SFC profile 2.x and the concept DOI.

### E.4 What changed in 2.0, in one list

- One document replaces two version lines; one version number everywhere.
- Wire: `period` is a pair of RFC 3339 date-times; Ed25519 only; `tCO2e` named by the draft.
- A defined Registry entry, one list of acceptance rules, one evaluation window and one grace period.
- Retirements inside the signed attestation, single use of each tonne, no late credits; optional Scope 1.
- Market-based Scope 2 in-band, location-based as an optional second object.
- A cut-off at the declaration's `updated`; heads null when a chain is empty; a conjunction rule for the
  network flag; incomplete objects stated.
- Platform rule split into public and permissioned cases; anchor informative only.
- Test vectors, JSON Schemas and a quickstart.
