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
- `origin`: fetch and check a live origin with every MUST of the draft (`--strict`; a present `signed` member is verified).
- `file`: validate a file in the repository with the consumer's validator; errors and warnings appear as annotations on the file.
- `consumer-version`: the exact consumer version to use; defaults to the version this action was tested with. Any published version works.

Output `status`: `valid` or `invalid`. The consumer is installed in the runner's temporary folder with install
scripts disabled; the action never touches the repository's own dependencies. Needs Node (present on GitHub's hosted runners).

Until it is on the Marketplace, use it from this repository at a fixed commit:
`uses: andreibesleaga/rfc-sustainability-wellknown/deploy/github-action@<commit-sha>`.

Marketplace publishing (owner step): create the repository `sustainability-data-check` with `action.yml` and this
README at its root, tag `v1`, and publish from its Releases page. This repository runs the action on itself in
`.github/workflows/self-check.yml`.
