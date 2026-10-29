# Contributing

This repository holds an Internet-Draft and its reference implementations. The two are kept
deliberately in step, so which one you are changing determines how to proceed.

## Requirements

**Node.js 22.13 or newer** for all three packages and for everything that loads them, at runtime too. The publisher and consumer 0.8.0 declare 22.13 as their floor. Since 0.6.5 the publisher
and consumer load `jose` (an ES module) through `require()`, which Node supports unflagged
from 22.12, and the test runner (Vitest 5) requires 22.12 as well, so an older Node will install and build yet fail to
run the tests.

For the schema validators and the draft build you also need Python 3 and Ruby 3:

```bash
python3 -m pip install jtd xml2rfc
gem install cddl -v 0.12.14
gem install kramdown-rfc2629
```

Where the system Python refuses `pip install` (PEP 668, as on Ubuntu 24.04), install the two packages in a virtual
environment and put its `bin/` first on `PATH`; `scripts/test-everything.sh` and the validators use the `python3` they
find there.

## Building and testing

Each package is independent. From `publisher/`, `consumer/` or `gateway/`:

```bash
npm ci
npm run typecheck
npm run build
npm test
```

`consumer/`'s interop test runs against a real `Publisher` instance, so build `publisher/`
first if you are working on the consumer.

To validate the example corpus (every file listed in `schemas-validators/examples/manifest.json`, and the served examples
in `example-responses/`) against both formal schemas, and to check that the generated files equal a fresh run:

```bash
cd schemas-validators && bash validate-all.sh
node gen/pairwise.mjs --check && node gen/signed.mjs --check && node gen/served.mjs --check
```

`bdd/` (the behaviour scenarios) and `fitness/` (rules that span the packages) run against the source builds of the
publisher and the consumer. Build both, then let the gateway and the initializer use those builds instead of the
registry versions (neither lockfile is touched), and run the two suites:

```bash
bash scripts/overlay-source-libs.sh
bash scripts/overlay-source-publisher.sh tools/create-sustainability-data
(cd bdd && npm ci && npm test)
(cd fitness && npm test)
```

`sfc-compliance/` is the fourth area with a test suite. It holds the checker, schemas, test
vectors and examples of [SFC profile 2.0](https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md);
the profile text itself is not in this repository.

```bash
cd sfc-compliance
npm ci
npm test
npm run check
python3 vectors/crosscheck.py
```

Each area has its own workflow (`publisher.yml`, `consumer.yml`, `gateway.yml`, `bdd.yml`, `draft.yml`, `deploy-kit.yml`,
`example-scripts.yml`, `sfc-compliance.yml`), run on every push and pull request that touches its paths.
`.github/workflows/full-verify.yml` runs the draft, tools, bdd-and-fitness, schemas, publisher, consumer, gateway and
example-scripts areas together weekly, by hand from the Actions tab, and on changes to the schema corpus or the
report-to-declaration tool, which no other workflow covers. It has no job for `sfc-compliance/` or the deploy kit: those run in their own workflows (`sfc-compliance.yml`,
`deploy-kit.yml`), and `scripts/test-everything.sh` also runs `sfc-compliance/`. The full-verify gateway job uses the source
builds of the two libraries, and `gateway.yml` runs the gateway against the registry versions on changes under `gateway/`.
The library jobs run on Node 22 and 24, which must pass, and on Node 26, which is reported and does not block.
The workflows a change triggers are the checks to satisfy before opening a PR; `full-verify.yml` can be run by hand.
All twelve workflows, the daily live-deployment check, the GitHub Action's self-check and the GitHub Packages
publishing included, are listed in [architecture/README.md § 8](architecture/README.md#8-ci--verification-architecture).

## The schema identity rule

The data model exists in four places, and they must stay identical (the embedded TypeScript copies are equal to the JSON schema as JSON values; the CDDL and JSON files are byte-identical):

1. the CDDL block in `internet-drafts/draft-besleaga-sustainability-wellknown-12.md` (the draft carries no JTD block since `-09`; `-12` was posted 2026-10-28 and must not be edited, nor the posted `-05` to `-11` files; further changes go to a future `-13` file)
2. `schemas-validators/response-schema.cddl` and `response-schema.json`
3. `publisher/src/schema.ts`
4. `consumer/src/schema.ts`

CI enforces this: the package test suites assert their embedded TypeScript schema equals the
repository JSON, and `internet-drafts/build.sh` checks the draft's blocks against
`schemas-validators/`. **A schema change is a specification change** — it means a new draft
revision, not just a code edit. Do not change one copy alone.

## Changing the draft

Edit the `.md` source only, then rebuild:

```bash
cd internet-drafts && ./build.sh
```

The script builds the XML and text, checks line length, ASCII, references and schema identity,
and runs idnits. **Do not commit a rebuild of a revision that is already posted** — rebuilding
rewrites the date and expiry lines, so the repository copy would stop matching the bytes on
the Datatracker. The script warns you and prints the command to restore it.

Only the revisions from `-05` on are kept as files; earlier ones live on the
Datatracker and in git history.

## Changing the reference gateway's data

`gateway/data/` holds documents about real organizations. These are transcriptions from those
organizations' own published reports. They are **not endorsed by their subjects**, and the
rules in [`gateway/data/README.md`](gateway/data/README.md) are not negotiable: every figure
must be traceable to a cited source and retrieval date, nothing may be estimated or
apportioned on a real organization's behalf, and a figure the source does not support is
omitted rather than guessed. Corrections from the organizations themselves are especially
welcome.

## Pull requests

- Keep the change focused, and say what you verified rather than what you intended.
- New behaviour needs a test. The suites avoid wall-clock and live-network dependence, so
  pin time and use fixtures.
- Documentation that states a requirement should cite the draft section it comes from, so
  the two cannot drift apart silently.

## Licence

Contributions are accepted under the Revised BSD License (see [LICENSE](LICENSE)). The
Internet-Draft text is subject to BCP 78 and the IETF Trust's Legal Provisions.

## Support and governance

**Getting help.** Ask questions in a GitHub issue (use the `question` label) or in the
repository's Discussions. Please ask in public rather than by private e-mail, so the answer
can help the next person and the history stays visible.

**Reporting a problem.** Open an issue with the package and version, what you ran, what you
expected and what happened. Security vulnerabilities are the one exception: report them
privately as described in [SECURITY.md](SECURITY.md). Comments on the Internet-Draft
**text** belong in the IETF process (see the draft's Datatracker page); comments on the code,
the schemas, the examples or the documentation belong here.

**Who decides.** The project has one maintainer, the draft's author, who reviews and merges
every change and decides what goes into a release. Decisions are made in the open: the
reasoning for a change is written in its issue or pull request, and changes to the
specification are recorded in [internet-drafts/CHANGELOG.md](internet-drafts/CHANGELOG.md).
The specification itself is not decided here: the Internet-Draft follows the IETF process,
and the code follows the draft (see "The schema identity rule" above).

**What to expect from a single maintainer.** This is maintained on a best-effort basis, with
no paid support. The aim is to acknowledge new issues and pull requests within **7 days** and
to give a decision or a next step within **30 days**. If a report has had no answer after 7
days, a short follow-up comment on it is welcome. Security reports follow the times in
[SECURITY.md](SECURITY.md).

**How outside contributions are reviewed.** Every pull request, including the maintainer's
own, must pass the workflows its paths trigger (`full-verify.yml` can be run by hand for a
whole-repository check). It is then read against the draft: a change that alters what a conforming
document or response looks like needs a draft revision first (see above). Review comments
are given on the pull request; if a contribution is declined, the reason is stated there.
Contributors are credited in the release notes unless they ask not to be. To run every
check on your machine before you open a pull request, use
`bash scripts/test-everything.sh` (it lists what it needs and what it runs).

**Conduct.** Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
