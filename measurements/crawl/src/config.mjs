/**
 * Constants of the survey: the identity the crawler announces, the paths it
 * asks for, and the defaults of its politeness limits.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const ROBOTS_TOKEN = "SustainabilityDataSurvey";
export const REPOSITORY_URL = "https://github.com/andreibesleaga/rfc-sustainability-wellknown";
export const USER_AGENT = `${ROBOTS_TOKEN}/${VERSION} (+${REPOSITORY_URL}/tree/main/measurements/crawl)`;

export const DEFAULTS = Object.freeze({
  concurrency: 16,
  timeoutMs: 10_000,
  gapMs: 1_000,
  maxRedirects: 3,
  maxBytes: 1_048_576,
  hashBytes: 2_048,
  maxRequests: Infinity,
  seed: "sustainability-data-survey-1",
  scheme: "https",
});

/** The consumer library is the one validator of a declaration; it must be built. */
export function loadConsumer() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, "..", "..", "..", "consumer", "dist", "index.js");
  if (!existsSync(dist)) {
    throw new Error("consumer/ is not built: run `npm ci && npm run build` in consumer/ first");
  }
  return createRequire(import.meta.url)(dist);
}

/**
 * The probes of one origin, in the order they are made. `kind` selects how a
 * 200 answer is judged (see classify.mjs). The declaration path is the
 * consumer's own constant, which is the draft's path.
 */
export function probeList(wellKnownPath, randomPath) {
  return [
    { id: "declaration", path: wellKnownPath, kind: "declaration" },
    { id: "carbon-txt", path: "/carbon.txt", kind: "carbon-txt" },
    { id: "carbon-txt-well-known", path: "/.well-known/carbon.txt", kind: "carbon-txt" },
    { id: "dist-json", path: "/.well-known/dist.json", kind: "json-object" },
    { id: "random", path: randomPath, kind: "random" },
  ];
}
