# GitHub Action: sustainability-data check

Validates a declaration in CI with the reference consumer, so a site cannot ship a broken file.

```yaml
# .github/workflows/sustainability-data.yml
on:
  push:
  schedule:
    - cron: "17 6 1 * *"   # monthly, after the file is refreshed; drop it if you only check on push
  workflow_dispatch: {}
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: andreibesleaga/sustainability-data-check@v1   # once published to the Marketplace
        with:
          file: public/.well-known/sustainability-data       # or:  origin: https://example.com
```

Inputs:
- `origin`: fetch and check a live origin with every MUST of the draft (`--strict`; a present `signed` member is verified). The document is read as served: a revision -08 or -09 file (a `reporting-period` label, a period of two dates) is reported invalid, not converted.
- `file`: validate a file in the repository with the consumer's validator, again without converting older revisions; errors and warnings appear as annotations on the file (a warning reads `code: message`). A `signed` member is verified: a signature that fails, or members changed after signing, is an error; `EdDSA` in the header is a warning (write `Ed25519`). To bring an older file to -10 first, run `sustainability-publisher upgrade`.
- `consumer-version`: the exact consumer version to use; defaults to the version this action was tested with (0.8.0, the first to implement revision -10). Earlier versions do not read -10 documents.

Output `status`: `valid` or `invalid`. The consumer is installed in the runner's temporary folder with install
scripts disabled; the action never touches the repository's own dependencies. Needs Node (present on GitHub's hosted runners).

Until it is on the Marketplace, use it from this repository at a fixed commit:
`uses: andreibesleaga/rfc-sustainability-wellknown/deploy/github-action@<commit-sha>`.

This repository runs the action on itself in `.github/workflows/self-check.yml`.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
