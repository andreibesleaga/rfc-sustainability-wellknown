# documents/

Source and rendered forms of the Internet-Draft, plus supplementary material.

## Current Internet-Draft

**`draft-besleaga-sustainability-wellknown`** — *The 'sustainability' Well-Known URI*.
Individual submission on the IETF **Independent Submission Stream** (Informational).

Two revisions matter right now:

- **`-02`** is the **submitted** revision: posted to the Datatracker (2026-07-03) and with
  the Independent Submissions Editor (ISE) for review (state "Submission Received" since
  2026-07-08). It is frozen while under review.
- **`-03`** is the **prepared next revision** (not yet posted — the submission window is
  closed until after the IETF meeting). It is a **breaking data-model revision** (schema
  label `"2.0"`): the negative "not reported" sentinel is removed in favor of member
  omission, `energy-consumption`/`energy-unit`/`carbon-footprint`/`carbon-unit` become
  optional (with default units), a mandatory free-form `target` member identifies the
  reporting subject (replacing the optional `target-path`), and two carbon members are
  renamed to the CO2e convention. See the draft's own "Since -02" changelog appendix.

| File | Role |
|---|---|
| `draft-besleaga-sustainability-wellknown-03.md` | Markdown source of the prepared next revision. Edit this. |
| `draft-besleaga-sustainability-wellknown-03.xml` | xml2rfc v3 XML of `-03` — the authoritative form for the future submission. |
| `draft-besleaga-sustainability-wellknown-03.txt` | Rendered plain-text form of `-03`. |
| `draft-besleaga-sustainability-wellknown-02.*` | **Submitted** revision, under ISE review (frozen). |
| `draft-besleaga-sustainability-wellknown-01.*` | Previous revision (posted 2026-07-02). |
| `draft-besleaga-sustainability-wellknown-00.*` | Earlier revision. |

Datatracker: <https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/>

## Historical revisions (previous name)

`draft-besleaga-green-sustainability-wellknown-00` … `-05` (`.md`/`.xml`, plus `.txt` for -04/-05)
are the earlier revisions of this work under its **previous name**. The document was renamed
to drop the `green` token (which could imply a scope tied to the IETF GREEN Working Group);
the current draft **Replaces** that series. These files are retained for history only.

An earlier per-request HTTP-header approach to carbon transparency was discussed and set
aside in favor of this well-known URI's out-of-band design, which avoids the per-request
"rebound effect" (metadata increasing the footprint it reports). That discussion is
recorded on the GREEN working group mailing list; it was never filed as a separate
Internet-Draft, so there is no second formal "Replaces" relationship — only the rename
noted above.

## Supplementary

| File | Role |
|---|---|
| `draft-verifiable-credential.md` | Non-normative: an example W3C Verifiable Credential structure that a `verifiable-attestation-uri` may point to (anti-greenwashing). Not part of the normative draft. |
| `CHANGELOG.md` | Human-readable summary of changes across every version, from the initial `-00` to the current draft (including the rename). |

## Building the draft

Requires `kramdown-rfc` (Ruby gem `kramdown-rfc2629`) and `xml2rfc`:

```bash
cd documents
kramdown-rfc draft-besleaga-sustainability-wellknown-03.md \
  > draft-besleaga-sustainability-wellknown-03.xml
xml2rfc --strict --text draft-besleaga-sustainability-wellknown-03.xml \
  -o draft-besleaga-sustainability-wellknown-03.txt
```

`xml2rfc --strict` is expected to complete with no warnings. CI runs the same build (see
`../.github/workflows/draft.yml`), and the repo's example payloads are validated against the
draft's formal schemas (see `../schemas-validators/`).
