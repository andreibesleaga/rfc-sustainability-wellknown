# bdd — behaviour scenarios for every normative sentence of the draft

Gherkin scenarios, run with cucumber-js against the **built** publisher and consumer libraries
and the **built** reference gateway (started on a loopback port with a fixed clock, no network,
no wall clock). One feature file per draft section, plus one for the people the draft is written
for (static publisher, dynamic publisher, hosting provider, device, organisation, HPC centre,
aggregator, auditor, regulator reader, relay).

Every scenario is tagged with the ids of the normative sentences it cites (and is written to exercise) (`@req-xxxxxxxx`).
`traceability/requirements.json` is generated from the draft's markdown by `traceability/extract.mjs`
(every sentence carrying an RFC 2119 keyword, outside code blocks and the changelog; ids are a
hash of the sentence). `traceability/check.mjs` fails when:

- the committed requirements no longer match the draft (an edited sentence gets a new id, so the
  scenarios citing it must be re-pointed: run `npm run trace:extract`, then fix the tags);
- a normative sentence (BCP 14 keyword, or one of the keyword-less requirements listed by hand in `traceability/supplement.json`) has no scenario;
- a scenario cites an id that no longer exists.

## Which revision the suite tracks

The revision the suite tracks, named in `traceability/requirements.json` (`source`): the prepared `-08`
(`-07` is the latest posted revision). `npm run trace:next` compares the newest draft file in
`internet-drafts/` with the tracked one, report only, and lists the normative sentences it adds, removes or
rewords (nothing while both are `-08`). When a new revision is posted: `node traceability/extract.mjs --write
../internet-drafts/<draft>.md`, then re-point the tags `npm run trace` lists, and change the `trace:extract`
script to the new file.

## Run

```bash
# build the three things under test first
(cd ../publisher && npm ci && npm run build)
(cd ../consumer  && npm ci && npm run build)
(cd ../gateway   && npm ci && npm run build)
npm ci
npm run all          # traceability check, then the scenarios
```

## What a failure means

A scenario states what the draft says. When one fails, either the library or gateway departs from
the draft (fix the code), or the scenario misread the draft (fix the scenario and say why in the
commit). Never bend a scenario to match code without re-reading the sentence it cites.

Findings made while writing the suite, 2026-10-03: the publisher did not normalize human-readable
text to NFC (draft §Internationalization, a SHOULD; fixed in 0.7.3); the gateway's error bodies
carried no `Content-Language` (fixed); the draft's tolerance rules are applied by the consumer's
retrieval path (`fetchSustainability` → `disregarded`), not by `validateDocument`, so scenarios
about defective optional members go through a local server.
