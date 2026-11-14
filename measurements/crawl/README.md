# measurements/crawl: a survey of machine-readable sustainability declarations

A small, polite crawler and an analysis script. For a dated list of origins it records whether each one publishes

- a declaration at `/.well-known/sustainability-data` (the path of the Internet-Draft
  [draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/)),
- a `carbon.txt` at `/carbon.txt` or `/.well-known/carbon.txt` ([carbontxt.org](https://carbontxt.org/)),
- a `dist.json` at `/.well-known/dist.json` (Green Web Foundation, DIST),

and whether the origin answers **any** path with a web page (a "soft 404", typical of single-page applications), which
makes a plain "status 200" count meaningless. It measures what is published; it says nothing about whether the figures
in a declaration are true.

One dependency: [`robots-parser`](https://www.npmjs.com/package/robots-parser) (MIT, no dependencies of its own), which
reads `robots.txt`; fetching it and deciding what a 4xx, a 5xx or a redirect means stay in this crawler. It needs Node.js 22.13
or newer and the built `consumer/` of this repository, which is the one validator of a declaration:

```bash
(cd ../../consumer && npm ci && npm run build)
npm ci        # in measurements/crawl: installs robots-parser from the committed lockfile
```

## Run it

```bash
cd measurements/crawl
node crawl.mjs --list tranco-top10k.csv --list-date 2026-12-01 --out ./run-2026-12-01 --dry-run   # plan only
node crawl.mjs --list tranco-top10k.csv --list-date 2026-12-01 --out ./run-2026-12-01             # the crawl
node analyze.mjs --in ./run-2026-12-01 --interop-csv interop.csv                                  # summary.json, tables.md
```

`--list` is a text file with one host per line, or the [Tranco](https://tranco-list.eu/) format `rank,domain`; `#` lines and
blank lines are ignored. `--list-date` is the date of the list and is written into the manifest.

| Option | Default | Meaning |
|---|---|---|
| `--limit N` | all | only the first N origins of the list |
| `--max-requests N` | none | stop starting origins when the next one could pass N requests (an origin in flight finishes) |
| `--concurrency N` | 16 | origins in parallel; each origin gets one request at a time |
| `--gap-ms N` | 1000 | pause between two requests to one origin; below 1000 is refused |
| `--timeout-ms N` | 10000 | per request, body included |
| `--seed S` | `sustainability-data-survey-1` | seeds the random probe path |
| `--dry-run` | off | print the plan (origins, requests, time), make no request |

**Resume.** Run the same command again. `done.txt` lists the finished origins and they are skipped. Ctrl-C stops
starting new origins and lets the ones in flight finish. A different list in the same output folder is refused.
**Exit codes:** 0 finished, 3 stopped with work left (cap or Ctrl-C), 2 bad options.

The interoperability table (Table 6 of the analysis) comes from the repository's own checker, not from this crawler:

```bash
python3 ../../schemas-validators/check-live.py --csv interop.csv   # needs the jtd package, see CONTRIBUTING.md
```

## What it records

Per origin, in this order: `robots.txt`, the four paths, one random path
`/sustainability-survey-probe-<16 hex digits>` (derived from the seed and the host, so it is reproducible).

`results.jsonl` holds one line per probe: `origin`, `probe`, `path`, `requested_url`, `fetched_at`, `status`, `final_url`,
`redirects`, `media_type`, `content_length` (the header, if any), `bytes_read`, `truncated`, `sha256_first_bytes` (hash of
the first 2,048 bytes), `classification`, and where relevant `error`, `error_detail`, `validation_errors`, `stored`.
Origins are written in list order whatever finishes first, so the file is the same on every run of the same inputs
apart from `fetched_at` and what the sites answered.

| Classification | Meaning |
|---|---|
| `valid` | a declaration the consumer library accepts, with an accepted media type |
| `invalid` | JSON that parses but is not a valid declaration (kept) |
| `parseable` | a `carbon.txt` with an `[org]` or `[upstream]` table, or a JSON object at `dist.json` (kept; only the shape is checked, there is no schema validator for these two) |
| `unparseable` | status 200, not a web page, not the expected format |
| `wrong-media-type` | status 200 at the declaration path with a media type the draft rules out |
| `html-soft-404` | status 200 with a web page |
| `other-200` | the random path answered 200 with something that is not a web page |
| `not-found` | 404 or 410 |
| `denied` | 401, 403 or 451 |
| `blocked-by-robots` | not requested: `robots.txt` forbids it |
| `robots-unreachable` | not requested: `robots.txt` answered 5xx, failed, or redirected off site (RFC 9309 treats this as "disallow all") |
| `error` | timeout, network or TLS failure, 5xx, a redirect refused |

Bodies are stored under `documents/` only for `valid`, `invalid` and `parseable` answers. Nothing else is kept, only its
hash. `manifest.json` records the list file name, its date and sha-256, the tool version, the user agent and the settings
of every run.

## Politeness and ethics

- The user agent is `SustainabilityDataSurvey/0.1.0 (+https://github.com/andreibesleaga/rfc-sustainability-wellknown/tree/main/measurements/crawl)`:
  it names the project and carries no e-mail address. Questions and opt-out requests go to a public issue in this repository.
- `robots.txt` is fetched first (twice at most, if it fails) and obeyed for the product token `SustainabilityDataSurvey`,
  falling back to the `*` group (RFC 9309: longest match wins, Allow wins a tie; matching is done by `robots-parser`. Two small differences from the RFC are
  pinned in `test/robots.test.mjs`; neither affects the six fixed paths). A missing file allows everything; an
  unreadable one forbids everything. The rules are checked for the path asked for, not again for a redirect target.
- At most 7 requests per origin, plus the hops of any redirects (3 at most per request), strictly one at a time, at least one
  second apart. Only `GET`, only `https`, only the paths above; no cookies, no scripts, no links followed. Redirects are
  followed up to 3 hops and only inside the same site (the same host, with or without a leading `www.`); anything else is
  recorded, not followed.
- Bodies are capped at 1 MiB. Certificates are always verified.
- The documents kept are files their owners publish for machines to read. Check a deposit for personal data before you
  publish it (for example `grep -rE '[[:alnum:]._-]+@[[:alnum:].-]+' documents/`).

## Limits to state in any report

One vantage point and one date. A top list is biased towards large, popular sites. The unit is the host name given in the
list, not the organisation. A well-known path blocked by a firewall, a bot filter or a country block looks like `denied` or
`error`, not like "absent". A declaration or `carbon.txt` on another host (a redirect to a different site) is not followed.
`parseable` for `carbon.txt` and `dist.json` is a shape check only.

## Tests

```bash
npm test      # node --test test/*.test.mjs, 61 tests, no network
```

An in-process HTTP server plays many origins (`test/fixture-server.mjs`): valid document, invalid JSON, a document that
fails validation, wrong media type, web-page fallback, robots rules, an unreachable `robots.txt`, redirects (same site, a loop,
off site, too many), a timeout, an oversized body, resume after an interruption (also after a torn write), list order under
concurrency, `--limit`, `--dry-run`, `--max-requests`.

Layout: `src/probe.mjs` is the core (everything done to one origin, with HTTP, clock, sleep and storage passed in),
`src/http.mjs` the HTTP port and its one adapter, `src/classify.mjs`, `src/robots.mjs` (an adapter over `robots-parser`), `src/input.mjs` and
`src/analysis.mjs` are pure, `src/store.mjs` the output folder, `src/run.mjs` the scheduler.

## How to cite

Cite the dataset (its DOI is on the Zenodo record that accompanies each published crawl) and the software version in
`manifest.json`. Software: Besleaga, A. N., *rfc-sustainability-wellknown*, <https://github.com/andreibesleaga/rfc-sustainability-wellknown>
(see [`CITATION.cff`](../../CITATION.cff)). Licence of the code: BSD-3-Clause; the dependency `robots-parser` is MIT.
