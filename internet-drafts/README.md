# internet-drafts/

Source and rendered forms of the Internet-Draft, plus supplementary material.

## Current Internet-Draft

**`draft-besleaga-sustainability-wellknown`** — *The 'sustainability-data' Well-Known URI*
(retitled in `-04`; revisions through `-03` were titled *The 'sustainability'
Well-Known URI* — the Datatracker document name is unchanged).
Individual submission on the IETF **Independent Submission Stream** (Informational).

- **`-07`** is **in preparation** in this directory (`draft-besleaga-sustainability-wellknown-07.{md,xml,txt}`)
  and has **not been posted** to the Datatracker — do not cite it as posted or published; `-06`
  remains the latest posted revision until `-07` is submitted. `-07` withdraws the companion
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

- **`-06`** is the **latest posted** revision — its sources live in this directory
  (`draft-besleaga-sustainability-wellknown-06.{md,xml,txt}`) and it is under the ISE's
  review. It carries the security package the ISE asked for ("security is not
  optional"): HTTPS raised from SHOULD to MUST, a dedicated
  `application/sustainability-data+json` media type (registration requested with the full RFC 6838
  Section 5.6 template and the Section 4.6 security analysis) required as the response
  type, `X-Content-Type-Options: nosniff`, an OPTIONAL but fully specified detached-JWS
  signature at a companion well-known resource, and a restructured threat-model section.
  It adds **no member** — the CDDL and JTD schemas remain byte-identical to `-05`. It was
  **posted to the Datatracker on 2026-09-10**; it is an Internet-Draft under ISE review,
  so do not cite it as a published RFC. (`-07`, described above, supersedes the detached-JWS
  and `nosniff` points of this paragraph; they are accurate as a record of what `-06` shipped.)

- **`-05`** is the **prior posted** revision — posted to the Datatracker 2026-07-28,
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
| `draft-besleaga-sustainability-wellknown-07.md` | Markdown source of the **in-preparation, unposted** revision. Edit this one for any further change. |
| `draft-besleaga-sustainability-wellknown-07.xml` | xml2rfc v3 XML of `-07`. |
| `draft-besleaga-sustainability-wellknown-07.txt` | Rendered plain-text form of `-07`. |
| `draft-besleaga-sustainability-wellknown-06.md` | Markdown source of the latest **posted** revision (2026-09-10). Do not edit — it is a posted artifact. |
| `draft-besleaga-sustainability-wellknown-06.xml` | xml2rfc v3 XML of `-06` — the submission form. |
| `draft-besleaga-sustainability-wellknown-06.txt` | Rendered plain-text form of `-06`. |
| `draft-besleaga-sustainability-wellknown-05.md` | Markdown source of the prior posted revision. Do not edit — it is a posted artifact. |
| `draft-besleaga-sustainability-wellknown-05.xml` | xml2rfc v3 XML of `-05` — the authoritative submission form. |
| `draft-besleaga-sustainability-wellknown-05.txt` | Rendered plain-text form of `-05`. |

`-05` and `-06` are posted revisions kept as files for reference; `-07` is the current
in-preparation revision, not yet posted. Once `-07` is posted, `-05` is expected to drop out of
this directory in favor of the two-posted-plus-one-in-prep convention this repository follows.
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
