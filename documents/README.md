# documents/

Source and rendered forms of the Internet-Draft, plus supplementary material.

## Current Internet-Draft

**`draft-besleaga-sustainability-wellknown-01`** — *The 'sustainability' Well-Known URI*.
Individual submission on the IETF **Independent Submission Stream** (Informational).
Revision `-00` is the version currently posted to the Datatracker; `-01` is the next revision.

| File | Role |
|---|---|
| `draft-besleaga-sustainability-wellknown-01.md` | Markdown source (kramdown-rfc front matter + body). Edit this. |
| `draft-besleaga-sustainability-wellknown-01.xml` | xml2rfc v3 XML — the **authoritative** form for submission. |
| `draft-besleaga-sustainability-wellknown-01.txt` | Rendered plain-text form. |
| `draft-besleaga-sustainability-wellknown-00.*` | Previous revision (posted to the Datatracker). |

Datatracker: <https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/>

## Historical revisions (previous name)

`draft-besleaga-green-sustainability-wellknown-00` … `-05` (`.md`/`.xml`/`.txt`/`.html`)
are the earlier revisions of this work under its **previous name**. The document was renamed
to drop the `green` token (which could imply a scope tied to the IETF GREEN Working Group);
the current draft **Replaces** that series. These files are retained for history only.

The current draft also **Replaces** an earlier companion draft,
`draft-besleaga-green-sustainability-header` (the per-request HTTP-header approach): the
well-known URI approach consolidates and supersedes that direction, avoiding the per-request
"rebound effect".

## Supplementary

| File | Role |
|---|---|
| `draft-verifiable-credential.md` | Non-normative: an example W3C Verifiable Credential structure that a `verifiable-attestation-uri` may point to (anti-greenwashing). Not part of the normative draft. |
| `CHANGELOG.md` | Human-readable summary of changes across every version, from the initial `-00` to the current draft (including the rename). |

## Building the draft

Requires `kramdown-rfc` (Ruby gem `kramdown-rfc2629`) and `xml2rfc`:

```bash
cd documents
kramdown-rfc draft-besleaga-sustainability-wellknown-00.md \
  > draft-besleaga-sustainability-wellknown-00.xml
xml2rfc --strict --text draft-besleaga-sustainability-wellknown-00.xml \
  -o draft-besleaga-sustainability-wellknown-00.txt
```

`xml2rfc --strict` is expected to complete with no warnings. CI runs the same build (see
`../.github/workflows/draft.yml`), and the repo's example payloads are validated against the
draft's formal schemas (see `../schemas-validators/`).
