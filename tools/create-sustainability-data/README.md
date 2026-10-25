# create-sustainability-data

A few questions, one conformant `/.well-known/sustainability-data` file (draft -10), plus the configuration
for your host (Cloudflare Pages, Netlify, Vercel, nginx, Apache, Caddy, or just the file). Sign the file with an
Ed25519 key if you have one.

Not yet published to npm (it is published with `npm publish --access public` from this folder, after
`sustainability-wellknown-publisher` 0.8.0 is published, because this tool depends on it); until then run it from a
clone after `npm install` in this folder with the publisher built from `publisher/` (see Development).

```bash
npx create-sustainability-data            # interactive (after it is published)

# An organization's yearly file, signed, from the annual report
npx create-sustainability-data --target "Acme Retail plc" --target-type organization \
  --provider "Acme Retail plc (sustainability@acme.example)" --methodology-uri /esg/methodology \
  --period 2025 --carbon-footprint 610 --carbon-unit tCO2e --carbon-accounting market-based \
  --scope-1 90 --scope-2 220 --scope-3 300 --disclosure-uri https://acme.example/esg/disclosures \
  --host netlify --out ./site --key ./private.jwk
```

`npx create-sustainability-data --help` lists every option with the one-line meaning of each choice.

## The period

The period is two RFC 3339 date-times, `start` included and `end` excluded. Give it in one of three ways:

| You give | The file says |
| --- | --- |
| `--period 2025` (or `2025-03`, `2025-03-14`) | the whole calendar year (month, day) from midnight to the next midnight, in the offset of `--offset` (default `Z`) |
| `--first-day 2025-04-01 --last-day 2026-03-31` | inclusive dates: from the first day's start to the start of the day after the last, here `2025-04-01T00:00:00Z` to `2026-04-01T00:00:00Z` |
| `--period-start ... --period-end ...` | the two date-times as written, `start` before `end` as instants |

With none of them the period is last year. A label that is not a real date (`2025-02-30`), a bound that is not a
date-time, and a `start` that is not before `end` are refused with the reason.

## The choices

- **Measurement method** (`--measurement-method`), from the most to the least direct: `hardware-metered`,
  `hardware-estimated`, `cloud-billing`, `third-party-modeled` (the default, and the token for anything no other
  describes). For figures that combine methods use the least direct one. There is no free text.
- **Target type** (`--target-type`): `origin` (default), `path`, `organization`, `facility`, `service`, `product`,
  `device`, `tenant`, `data-source`. Anything else is refused.
- **Units**: energy `Wh`, `kWh`, `MWh`, `GWh`; carbon `gCO2e`, `kgCO2e`, `tCO2e`; score unit `per-request`,
  `per-transaction`, `per-page-view`, `per-session`, `per-user`, `per-job`, `per-token`, `per-inference`,
  `per-gigabyte`, `per-gigabyte-hour`, `per-vcpu-hour`, `per-device`. A score in another unit goes in an extension.
- **Roles** of an upstream provider (`--upstream cloud:https://provider.example/tenants/you.json`): `hosting`,
  `colocation`, `cloud`, `cdn`, `network`, `electricity`; a link without a role is allowed.
- **Extensions**: `--extension 'https://example.com/ext/water={"water-m3": 5}'`.

The sets come from the publisher library, so they cannot drift from the draft.

## Checks and warnings

Nothing is estimated: a figure you do not have is left out, and a file with no figure needs a link to evidence
(`--disclosure-uri` or `--verifiable-attestation-uri`). Before anything is written the file is validated as the
strict reader validates it; if it does not pass, nothing is written. The tool warns about the four things a
declaration can disclose (capacity and load, precise hardware, which parts exist, contact strings), about a
personal-looking address in `--provider`, and says when the file is unsigned.

## Signing

`--key private.jwk` signs with an Ed25519 private key; make one with `sustainability-publisher keygen`. Other
algorithms, HS256 included, are refused. Without a key the file is unsigned.

## Methodology page

`--methodology-stub` also writes `methodology.md`, with the five headings the draft asks for (what is measured and
what is estimated, allocation to a part of the target, what counts as one unit, extension names, perturbation) and
the unit, the extension names and the `--noise` bound already filled in. `--noise N` records that you perturbed the
figures yourself within N percent; the tool does not change them. Fill in the rest and publish it at your
`methodology-uri`.

Then deploy and check: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.com --strict`.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

## Development

The only dependency is `sustainability-wellknown-publisher` (0.8.0 or later). Until 0.8.0 is on npm, test against
the local build:

```bash
(cd ../../publisher && npm run build && npm pack --pack-destination /tmp/csd-pack)
npm install --no-save --package-lock=false /tmp/csd-pack/sustainability-wellknown-publisher-0.8.0.tgz
npm test
```

After 0.8.0 is published, `npm install` and `npm test` are enough.
