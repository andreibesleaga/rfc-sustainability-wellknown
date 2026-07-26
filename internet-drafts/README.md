# internet-drafts/

Source and rendered forms of the Internet-Draft, plus supplementary material.

## Current Internet-Draft

**`draft-besleaga-sustainability-wellknown`** — *The 'sustainability-data' Well-Known URI*
(retitled in `-04`; revisions through `-03` were titled *The 'sustainability'
Well-Known URI* — the Datatracker document name is unchanged).
Individual submission on the IETF **Independent Submission Stream** (Informational).

- **`-04`** is the **latest** revision — posted to the Datatracker and under Independent
  Submissions Editor (ISE) review. It renames the requested well-known URI suffix
  from `sustainability` to `sustainability-data` (following ISE feedback on the precision
  expectations of RFC 8615, Section 3), adds the OPTIONAL `target-type` member classifying
  the reporting subject, places the `version` value space under change control, replaces
  the vendor-extension naming advice with the normative reverse-domain "Extension members"
  rule, and corrects the CDDL root (`[+ ...]`); it also folds in a final correctness and
  editorial audit round. See the draft's own "Since -03" changelog appendix.
- **`-03`** (historical) was posted to the Datatracker 2026-07-23. It was a **breaking
  data-model revision** (schema label `"2.0"`, unchanged in `-04`): the negative "not
  reported" sentinel is removed in favor of member omission,
  `energy-consumption`/`energy-unit`/`carbon-footprint`/
  `carbon-unit` become optional (with default units), a mandatory free-form `target`
  member identifies the reporting subject (replacing the optional `target-path`), two
  carbon members are renamed to the CO2e convention, and `capabilities` is redefined to
  describe Extended query-parameter support only.

| File | Role |
|---|---|
| `draft-besleaga-sustainability-wellknown-04.md` | Markdown source of the current (latest) revision. Edit this. |
| `draft-besleaga-sustainability-wellknown-04.xml` | xml2rfc v3 XML of `-04` — the authoritative submission form. |
| `draft-besleaga-sustainability-wellknown-04.txt` | Rendered plain-text form of `-04`. |
| `draft-besleaga-sustainability-wellknown-03.*` | Previous revision (posted 2026-07-23). |
| `draft-besleaga-sustainability-wellknown-02.*` | Previous submitted revision (posted 2026-07-03). |
| `draft-besleaga-sustainability-wellknown-01.*` | Previous revision (posted 2026-07-02). |
| `draft-besleaga-sustainability-wellknown-00.*` | Earlier revision. |

Datatracker: <https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/>

## Historical revisions (previous name)

`draft-besleaga-green-sustainability-wellknown-00` … `-05` (`.md`/`.xml`, plus `.txt` for -04/-05)
are the earlier revisions of this work under its **previous name**. The document was renamed
to drop the `green` token (which could imply a scope tied to the IETF GREEN Working Group);
the current draft **Replaces** that series. These files are retained for history only.

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

## Building the draft

Requires `kramdown-rfc` (Ruby gem `kramdown-rfc2629`) and `xml2rfc`:

```bash
cd internet-drafts
kramdown-rfc draft-besleaga-sustainability-wellknown-04.md \
  > draft-besleaga-sustainability-wellknown-04.xml
xml2rfc --strict --text draft-besleaga-sustainability-wellknown-04.xml \
  -o draft-besleaga-sustainability-wellknown-04.txt
```

`xml2rfc --strict` is expected to complete with no warnings. CI runs the same build (see
`../.github/workflows/draft.yml`), and the repo's example payloads are validated against the
draft's formal schemas (see `../schemas-validators/`).
