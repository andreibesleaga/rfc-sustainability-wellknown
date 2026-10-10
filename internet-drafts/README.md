# internet-drafts/

Source and rendered forms of the Internet-Draft, plus supplementary material.

## Current Internet-Draft

**`draft-besleaga-sustainability-wellknown`** — *The 'sustainability-data' Well-Known URI*
(retitled in `-04`; revisions through `-03` were titled *The 'sustainability'
Well-Known URI* — the Datatracker document name is unchanged).
Individual submission on the IETF **Independent Submission Stream** (Informational).

- **`-08`** is the **latest posted** revision (posted 2026-10-09, under ISE review; editorial: an RFC 7942 Implementation Status appendix, the worked example aligned with the live deployment, a mention of DIST, and the answers to the ART-area early review of `-07`: a Terminology section, one term *subject*, Section 2.2 citing RFC 9110 instead of restating it, the query-envelope ABNF removed, the unknown-member rule stated once, `target-type` first among the optional members, a shorter body; no change to the format). It is built and checked by CI like every revision.
- **`-07`** is the prior posted revision (posted 2026-09-17; sources in this
  directory: `draft-besleaga-sustainability-wellknown-07.{md,xml,txt}`); `-06` is an earlier posted
  revision. `-07` withdraws the companion
  `/.well-known/sustainability-data.jws` resource and the detached signature entirely (no legacy
  support, no redirect, no fallback) and replaces it with an OPTIONAL `signed` member embedded in
  each declaration object itself (a JWS Compact Serialization over the object minus `signed`,
  typed by `cty: sustainability-data+json`); removes the `version` member, leaving exactly seven
  mandatory members; closes the top-level member set and moves private extensions out of
  reverse-domain top-level names into an OPTIONAL `extensions` object whose keys are absolute
  URIs (RFC 3986) — an `https` URI under the definer's control, or `urn:uuid:` plus a lowercase
  hyphenated UUID (RFC 9562) — compared as strings and never dereferenced, with no registry;
  adds an OPTIONAL `upstream` member linking to the declarations of providers a
  subject's figures derive from, with a depth-3, no-revisit consumer-side walk; replaces the old
  free/unauthenticated-methodology conformance floor with a simpler rule (at least one numeric
  metric, `disclosure-uri`, or `verifiable-attestation-uri`); gives Extended Query Parameters an
  ABNF grammar and a numbered processing procedure with defined `400`/`404` cases; drops the
  server-side 366-object cap in favor of a consumer-side byte/object bound; and drops the
  `X-Content-Type-Options` recommendation from the specification text. See the draft's own
  "Since -06" changelog appendix, `internet-drafts/CHANGELOG.md`, and
  [`REVISION-07-RATIONALE.md`](REVISION-07-RATIONALE.md), which gives the reason for each
  change, what it costs an existing publisher or consumer, and what reversing it would involve.

- **`-06`** is an earlier posted revision (posted 2026-09-10) — its sources live in this directory
  (`draft-besleaga-sustainability-wellknown-06.{md,xml,txt}`) and it was the revision under the ISE's
  review before `-07`. It carries the security package the ISE asked for ("security is not
  optional"): HTTPS raised from SHOULD to MUST, a dedicated
  `application/sustainability-data+json` media type (registration requested with the full RFC 6838
  Section 5.6 template and the Section 4.6 security analysis) required as the response
  type, `X-Content-Type-Options: nosniff`, an OPTIONAL but fully specified detached-JWS
  signature at a companion well-known resource, and a restructured threat-model section.
  It adds **no member** — the CDDL and JTD schemas remain byte-identical to `-05`. It was
  **posted to the Datatracker on 2026-09-10**; it is an Internet-Draft under ISE review,
  so do not cite it as a published RFC. (`-07`, described above, supersedes the detached-JWS
  and `nosniff` points of this paragraph; they are accurate as a record of what `-06` shipped.)

- **`-05`** is an earlier posted revision — posted to the Datatracker 2026-07-28,
  responding to the ISE's initial review of `-04`. It makes no change to the wire format: no member is added, removed,
  renamed, or retyped, the CDDL and JTD schemas are unchanged, and every document
  conformant to `-04` remains conformant to this revision. It removes the sentence in
  the `disclosure-uri` definition that named a Green Web Foundation carbon.txt file as
  the canonical example and cited the unregistered paths `/carbon.txt` and
  `/.well-known/carbon.txt` (at the reviewer's request not to encourage squatting on
  unregistered well-known names) — `disclosure-uri` is now format-agnostic and
  location-agnostic, and carbon.txt remains cited, without any path reference, as
  complementary work; adds an Internationalization Considerations section (BCP 18 /
  RFC 2277) classifying every member as a protocol element or as text; states the
  calendar-period rationale in-document and cross-references `reporting-period` to the
  `period` parameter; recognizes the calendar year as the common Basic-service
  reporting cycle; and folds the Caching subsection into Operational Considerations.
  See the draft's own "Since -04" changelog appendix.
- **`-04`** is a prior posted revision — posted to the Datatracker and previously under
  Independent Submissions Editor (ISE) review. It renames the requested well-known URI
  suffix from `sustainability` to `sustainability-data` (following ISE feedback on the
  precision expectations of RFC 8615, Section 3), adds the OPTIONAL `target-type` member
  classifying the reporting subject, places the `version` value space under change
  control, replaces the vendor-extension naming advice with the normative reverse-domain
  "Extension members" rule, and corrects the CDDL root (`[+ ...]`); it also folds in a
  final correctness and editorial audit round. See the draft's own "Since -03" changelog
  appendix.
- **`-03`** (historical) was posted to the Datatracker 2026-07-23. It was a **breaking
  data-model revision** (schema label `"2.0"`, unchanged in `-04`/`-05`): the negative "not
  reported" sentinel is removed in favor of member omission,
  `energy-consumption`/`energy-unit`/`carbon-footprint`/
  `carbon-unit` become optional (with default units), a mandatory `target` member — an
  opaque identifier compared octet-for-octet — identifies the reporting subject (replacing
  the optional `target-path`), two carbon members are renamed to the CO2e convention, and
  `capabilities` is redefined to describe Extended query-parameter support only.

| File | Role |
|---|---|
| `build.sh` | Build-and-check script for any revision (see "Building the draft" below). |
| `v3-postprocess.py` | Run by `build.sh` and CI on the generated XML: drops `<?line?>` PIs, un-nests the References sections, removes cited-reference abstracts and the BCP 14 no-break space, so idnits3 reports no nits in any mode. |
| `draft-besleaga-sustainability-wellknown-08.md` | Markdown source of the latest posted revision (posted 2026-10-09). Do not edit — it is a posted artifact; further changes go to a future `-09` file. |
| `draft-besleaga-sustainability-wellknown-08.xml` | xml2rfc v3 XML of `-08` — the submission form. |
| `draft-besleaga-sustainability-wellknown-08.txt` | Rendered plain-text form of `-08`. |
| `draft-besleaga-sustainability-wellknown-07.md` | Markdown source of the prior posted revision (posted 2026-09-17). Do not edit — it is a posted artifact; further changes go to a future `-09` file. |
| `draft-besleaga-sustainability-wellknown-07.xml` | xml2rfc v3 XML of `-07`. |
| `draft-besleaga-sustainability-wellknown-07.txt` | Rendered plain-text form of `-07`. |
| `draft-besleaga-sustainability-wellknown-06.md` | Markdown source of an earlier posted revision (2026-09-10). Do not edit — it is a posted artifact. |
| `draft-besleaga-sustainability-wellknown-06.xml` | xml2rfc v3 XML of `-06` — the submission form. |
| `draft-besleaga-sustainability-wellknown-06.txt` | Rendered plain-text form of `-06`. |
| `draft-besleaga-sustainability-wellknown-05.md` | Markdown source of an earlier posted revision. Do not edit — it is a posted artifact. |
| `draft-besleaga-sustainability-wellknown-05.xml` | xml2rfc v3 XML of `-05` — the authoritative submission form. |
| `draft-besleaga-sustainability-wellknown-05.txt` | Rendered plain-text form of `-05`. |

`-05`, `-06` and `-07` are posted revisions kept as files for reference; `-07` (posted
2026-09-17) is the prior posted revision; `-08` (posted 2026-10-09) is the latest. `-05` is kept in this directory for now.
Revisions `-00` through `-04` were removed once posted; they remain on the Datatracker and in
this repository's git history.

Datatracker: <https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/>

## Historical revisions (previous name)

`draft-besleaga-green-sustainability-wellknown-00` … `-05` (`.md`/`.xml`, plus `.txt` for -04/-05)
are the earlier revisions of this work under its **previous name**. The document was renamed
to drop the `green` token (which could imply a scope tied to the IETF GREEN Working Group);
the current draft **Replaces** that series. These files are no longer in this directory; see the
Datatracker and this repository's git history.

An earlier per-request HTTP-header approach to carbon transparency was explored first —
filed as `draft-besleaga-green-sustainability-header-00` (now expired) — and set aside in
favor of this well-known URI's out-of-band design, which avoids the per-request "rebound
effect" (metadata increasing the footprint it reports). The Datatracker records a formal
"Replaces" relationship for that header draft too, alongside the rename noted above; the
design discussion is also recorded on the GREEN working group mailing list.

## Supplementary

| File | Role |
|---|---|
| `draft-verifiable-credential.md` | Non-normative: an example W3C Verifiable Credential structure that a `verifiable-attestation-uri` may point to (anti-greenwashing). Not part of the normative draft. |
| `CHANGELOG.md` | Human-readable summary of changes across every version, from the initial `-00` to the current draft (including the rename). |
| `REVISION-07-RATIONALE.md` | Why `-07` changed what it changed: each substantive change mapped to the reviewer point or implementation-found defect that triggered it, its migration cost, and its reversal cost. |

## Building the draft

Requires `kramdown-rfc` (Ruby gem `kramdown-rfc2629`) and `xml2rfc` (Python), plus `python3`
and `curl`:

```bash
gem install kramdown-rfc2629
pip install xml2rfc

cd internet-drafts
./build.sh                 # build and check the highest-numbered revision
./build.sh -05             # build a specific revision
./build.sh --no-idnits     # skip the network idnits run
```

`build.sh` regenerates the `.xml` and `.txt` from the Markdown source and then verifies that
`xml2rfc --strict` completes without error, that no rendered line exceeds 72 characters and the
text is pure ASCII, that no Markdown code fences leaked into the output, that the schema
references resolve and the stale RFC 8949 reference is absent, that the draft's CDDL and JTD
blocks still match `../schemas-validators/`, and that idnits (run through the IETF author-tools
API) reports zero errors. It exits non-zero if any check fails.

One idnits **warning** is expected and cannot be fixed: the citation URLs for the GHG Protocol,
the UN 2030 Agenda and carbon.txt are real domains rather than RFC 2606 examples.

If the tools are installed in a user gem directory or a virtualenv rather than system-wide, the
script looks in `~/.local/share/gem/ruby/*/bin` and `~/.cache/sustain-venv/bin` before giving
up; pre-set `PATH` if yours differ. Before submitting a revision, bump the date in the Markdown
front matter and re-run the script. CI runs an equivalent build (see
`../.github/workflows/draft.yml`), and the repo's example payloads are validated against the
draft's formal schemas (see `../schemas-validators/`).

## Revision history and compatibility notes moved from the root README (2026-10-09)

The root README was shortened on 2026-10-09 and now names only the latest posted revision (`-07`) and the prepared `-08`. The passages below were carried there until then and are kept here verbatim.

### Discussion before the Independent Submission

Revisions v02/v03 were discussed on the IRTF SUSTAIN mailing list and presented in the [SUSTAIN RG session at IETF 126](https://datatracker.ietf.org/meeting/126/session/sustain/) (Vienna); the research group has taken no position on the draft.

Revision **-07** is the **latest posted** revision (posted 2026-09-17) and is **under ISE review** for publication as an Informational RFC; it does make substantive wire-format changes, whereas the prior posted revision **-06** (posted 2026-09-10) made no change to the wire format relative to -05.

### The revision table as the README listed it

| Revision (files kept: the prepared `-08`, and the posted `-07`, `-06`, `-05`; earlier ones on the Datatracker) | Description |
|---|---|
| `draft-besleaga-sustainability-wellknown-07.md` | **Latest posted revision** (posted 2026-09-17, under ISE review); follows the prior posted revision (`-06`). Withdraws the companion `sustainability-data.jws` resource and its detached signature in favor of an OPTIONAL `signed` member embedded in each declaration object (a JWS over the object itself, typed by `cty`); removes the `version` member entirely (seven mandatory members remain); moves private extension data out of top-level reverse-domain names into a top-level `extensions` object keyed by absolute URI (RFC 3986; an `https` URI the definer controls, or a `urn:uuid:` name) and closes the top-level member set; adds an OPTIONAL `upstream` member chaining to the declarations of providers a subject's figures derive from (bounded consumer-side walk, depth at most 3); replaces the old condition that a metric-less document's `methodology-uri` be openly retrievable with a plain rule that a declaration MUST carry at least one numeric metric or one of `disclosure-uri`/`verifiable-attestation-uri`; gives Extended Query Parameters a formal ABNF grammar and a 7-step numbered processing procedure; removes the server-side 366-object cap in favor of a consumer-side bound; removes the `X-Content-Type-Options: nosniff` recommendation; and adds a worked-deployment appendix in which the attestation's `credentialSubject` carries the derivation model behind the figures — its constants and formulas — rather than a byte hash, an issuer attesting one period's figures carrying a copy of that declaration instead (the draft constrains no credential format). See the draft's own Changelog appendix for the complete list |
| `draft-besleaga-sustainability-wellknown-07.xml` / `.txt` | xml2rfc v3 XML (authoritative submission form) and rendered text of `-07` as posted |
| `draft-besleaga-sustainability-wellknown-06.md` | **Prior posted revision** (posted 2026-09-10) — responds to the ISE's second round (security designed in from the start) and to the first commissioned review: requests registration of, and requires, the `application/sustainability-data+json` media type, makes HTTPS a MUST, adds an OPTIONAL detached-JWS signature mechanism and a threat-model table, adds "Roles and Processing Model" and "Partial Knowledge and Incremental Adoption", and fixes the `version` label as a single value. No change to the wire format |
| `draft-besleaga-sustainability-wellknown-06.xml` / `.txt` | xml2rfc v3 XML (authoritative submission form) and rendered text of `-06` |
| `draft-besleaga-sustainability-wellknown-05.md` | Prior posted revision (posted 2026-07-28) — responds to the ISE's initial review of `-04`: removes the carbon.txt-path reference from `disclosure-uri` (now format- and location-agnostic), adds an Internationalization Considerations section, states the calendar-period rationale in-document, and recognizes the calendar year as the common Basic-service reporting cycle. No change to the wire format |
| `draft-besleaga-sustainability-wellknown-05.xml` / `.txt` | xml2rfc v3 XML and rendered text of `-05` |
| `draft-besleaga-sustainability-wellknown-04.md` | Prior posted revision — renames the requested URI suffix to `sustainability-data` (answering the first round of naming feedback; see ADOPTION.md §14 for the open question), adds the optional `target-type` member, places the `version` value space under change control, and defines the reverse-domain extension-member naming rule |
| `draft-besleaga-sustainability-wellknown-04.xml` / `.txt` | xml2rfc v3 XML (authoritative submission form) and rendered text of `-04` |
| `draft-besleaga-sustainability-wellknown-03.*` | Previous revision — posted to the Datatracker 2026-07-23; breaking data-model revision, schema label `"2.0"` |
| `draft-besleaga-sustainability-wellknown-02.*` | Previous submitted revision (posted 2026-07-03) |
| `draft-besleaga-sustainability-wellknown-01.*` | Previous revision (posted 2026-07-02) |
| `draft-besleaga-sustainability-wellknown-00.*` | Earlier revision |
| `draft-besleaga-green-sustainability-wellknown-05/04/03/02/01/00.*` | Earlier revisions (previous name) |
| `draft-verifiable-credential.md` | Supplementary: W3C Verifiable Credential structure for anti-greenwashing attestations |

### Compatibility between draft revisions (moved from the root README, 2026-10-09)

- **`-04` to `-06`:** the wire document is unchanged. `-06` only added the requested media type
  `application/sustainability-data+json` (required for successful responses), HTTPS as a MUST, and an optional
  detached JWS.
- **`-07` (posted 2026-09-17) is not wire-compatible with earlier revisions:** no `version` member (seven mandatory
  members), an optional embedded `signed` member instead of the `.jws` resource, a URI-keyed `extensions` object and
  a closed member set, an optional `upstream` member, the rule "at least one metric or one evidence link", a formal
  grammar and procedure for Extended queries, and no `nosniff` recommendation. The schemas in `schemas-validators/`
  follow `-07`; the full list is in the draft's Changelog appendix
  ([`-07`](draft-besleaga-sustainability-wellknown-07.md)).
- **Libraries:** `0.7.x`, the current releases, implement `-07` (embedded `signed`, `upstream` walked to depth three,
  `extensions`). The consumer still accepts the generic `application/json` with a WARN until the media type is
  registered, and the publisher can emit it with `mediaType: "json"` (not conformant). The `-06` releases with
  detached signatures (`0.6.5`–`0.6.7`) are superseded.
- **Member counts:** the data model is 7 mandatory and 19 optional members (26 total) as of draft `-07`
  (posted 2026-09-17). It was 8 mandatory and 16 optional (24 total) from `-04`
  through `-06` (`-06` changed no member at all); `-07` removes the `version` member, adds
  `upstream` and `extensions`, and turns the signature into an OPTIONAL `signed` member
  embedded on the declaration object itself (previously a separate detached-JWS resource, not
  a payload member).
- **Extensions before `-07`:** through `-06`, extensions used top-level reverse-domain names such as `com.example.pue`,
  with undotted names reserved for the specification. As of `-07` the top-level member set is closed and private
  extension data lives inside the OPTIONAL top-level `extensions` object, keyed by an absolute URI.
- **Signatures before `-07`:** through `-06`, the draft's optional signature was a separate detached signature of the
  served bytes at `/.well-known/sustainability-data.jws`; as of `-07` it is the `signed` member embedded in each
  declaration object.
