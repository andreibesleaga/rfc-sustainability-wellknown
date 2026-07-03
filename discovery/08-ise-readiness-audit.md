# 08 — ISE Readiness Audit (draft -02)

A pre-submission audit of `draft-besleaga-sustainability-wellknown-02` for the IETF
Independent Submission Stream (ISE, Informational) and the IANA "Well-Known URIs"
registration (Specification Required / Designated Expert review). Produced from five
parallel web-research streams; every external claim below is backed by an authoritative
source (rfc-editor.org, datatracker.ietf.org, iana.org, iso.org, w3.org,
thegreenwebfoundation.org, mnot.net). Decisions taken are marked **[APPLIED in -02]**.

## Bottom line

The well-known registration approach is sound and correctly executed. The RFC 8615 §3.1
template is complete and the Change Controller is correctly the author (not "IETF"), which
is right for an ISE document. No structural blocker was found. The draft is complementary
to — and does not duplicate or conflict with — carbon.txt, CO2.js, GSF SCI/ISO 21031,
W3C WSG, the IETF GREEN WG, the IRTF SUSTAIN RG, or the IAB e-impact work. RFC 5742
conflict-review risk is **low**: the GREEN charter explicitly excludes carbon accounting
and reporting, and SUSTAIN defers standardization to the IETF.

## Findings and decisions

### 1. IANA registry status — permanent vs provisional  **[APPLIED: provisional]**
security.txt (RFC 9116) earned "permanent" because it was IETF-stream *consensus* and in
use; the "permanent" bar is Standards-Track/open-standards or demonstrated broad use
(RFC 8615 §3.1). An ISE Informational doc meets neither on its face, so the Designated
Expert (Mark Nottingham) most likely registers new single-spec suffixes as *provisional*
(as with gpc.json, change-password, csaf). We now request **provisional**, notable as
promotable to permanent once in broad use.

### 2. Extensibility / the `version` field — foolproofing  **[APPLIED: redefine, no new registry]**
The prior normative `major.minor` bump rules are the IETF versioning anti-pattern
(RFC 6709 §4.4) and presuppose future revisions of the doc. Fixed by (a) redefining
`version` as an informational, non-negotiated label (clients MUST NOT reject or branch on
it) and (b) rewriting "Versioning and Extensibility" around the must-ignore rule. The open
CDDL/JTD schemas + "MUST ignore unknown fields" are the load-bearing extensibility
mechanism (cf. RFC 9110 §5.1; RFC 9457 problem-details precedent). A formal IANA field
registry was considered and **deliberately not added**, to keep the ISE/IANA process
simplest and lowest-risk; the wire format never breaks without it, and future standardized
fields can be introduced by a short companion document.

### 3. Missing HTTP reference  **[APPLIED: added RFC 9110 + RFC 9111]**
The draft specifies 200/400/404/405 + `Allow`, `ETag`, `Last-Modified`, `If-None-Match`,
and caching, but cited no HTTP RFC. Added **RFC 9110 (HTTP Semantics, STD 97)** and
**RFC 9111 (HTTP Caching)** as normative references (RFC 9110 obsoletes 7230-series;
status codes §15, `Allow` §10.2.1, `ETag`/`Last-Modified` §8.8.3/§8.8.2). This is the one
technical gap a reviewer is most certain to raise.

### 4. Ecosystem positioning  **[APPLIED]**
Sharpened "Relationship to Other Work" to (a) distinguish this application-layer,
origin-level HTTP disclosure surface from network-layer energy work (GREEN WG; EMAN,
RFC 7326) and IRTF research; (b) frame carbon.txt (a **TOML** disclosure index) as
complementary — this endpoint publishes the numeric metrics, carbon.txt indexes where
disclosures live, and they compose via `disclosure-uri`; (c) cite the IAB e-impact
workshop report (**RFC 9547**) as motivating context.

### 5. Acknowledgments  **[APPLIED: fully generic]**
Thanking "the GREEN WG and the SUSTAIN RG" implies review/endorsement not received — an
ISE objection trigger. Revised to thank "the Internet sustainability community" generally.

### 6. Response shape  **[APPLIED: MUST accept both]**
"object OR array" is a minor interop wrinkle. Clarified normatively: a single object is
equivalent to a one-element array; clients MUST accept both forms.

### 7. Reference precision  **[APPLIED]**
carbon.txt described as a TOML index; W3C WSG marked a Community Group Report (not a Rec);
SCI cited by its ISO/IEC 21031:2024 form. All 14 original references independently verified
correct (identifiers, titles, STD numbers, obsoletion status).

### 8. Naming  **[DECIDED: keep `sustainability` + justification]**
The suffix is a broad/generic term and the registry discourages "squatting on generic
terms"; the name was kept (heavy prior investment, whole implementation built on it) with
an added IANA-Considerations justification (precise site-wide disclosure surface; query
parameters follow WebFinger/host-meta precedent; registration not sought for legitimacy).

## Residual / optional (not blocking; noted for the author)

- **Greenwashing**: self-reported carbon data is a known greenwashing vector; the draft
  already has a greenwashing section, `verifiable-attestation-uri`, and a "MUST NOT treat
  as proof" clause. Keep these foregrounded; largely mitigated.
- **Stream choice**: if *permanent* registry status ever becomes important, the security.txt
  playbook was AD-sponsored **IETF-stream** review, not ISE. Staying on ISE (as chosen)
  means expecting provisional — a fine outcome.
- **Engage early**: the well-known-URIs registry intake is the GitHub repo
  `protocol-registries/well-known-uris`; engaging the expert before/at submission is
  recommended.

## Key sources

RFC 8615 (Well-Known URIs), RFC 9110/9111 (HTTP), RFC 6709 (Protocol Extensions),
RFC 9457 (Problem Details), RFC 8414 / RFC 7519 (JSON metadata + registries, precedent),
RFC 9116 (security.txt precedent), RFC 7033 (WebFinger, query-param precedent),
RFC 9547 (IAB e-impact report), RFC 7326 (EMAN); IANA Well-Known URIs registry;
IETF GREEN WG charter (datatracker); IRTF SUSTAIN RG (datatracker/irtf.org);
Green Web Foundation carbon.txt (v0.6) and CO2.js; GSF SCI / ISO/IEC 21031:2024;
W3C Sustainable Web Design CG (WSG 1.0); mnot.net "So You Want To Define a Well-Known URI".
