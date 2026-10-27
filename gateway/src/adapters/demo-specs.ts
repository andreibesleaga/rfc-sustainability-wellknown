/**
 * One demonstration subject per published `sustainability-wellknown-publisher`
 * adapter, so every adapter in the package runs end to end in this gateway.
 *
 * Modes, chosen per upstream on legal/ethical grounds (research 2026-07-30):
 *
 *  LIVE, keyless — upstreams whose licenses explicitly permit daily fetch +
 *    attributed republication:
 *      - NESO (GB) Carbon Intensity API: CC BY 4.0, keyless
 *        (https://terms.carbonintensity.org.uk/).
 *      - Green Web Foundation Greencheck: keyless; Green Domains dataset is
 *        ODbL (https://www.thegreenwebfoundation.org/tools/green-web-dataset/).
 *      - CO2.js runs locally (Apache-2.0); its bundled grid intensities are
 *        Ember annual averages (CC BY 4.0).
 *
 *  LIVE with a configured key — GWF carbon.txt validator API (free key,
 *    verified returning 401 without one).
 *
 *  REPLAY (recorded response through the real adapter code) — upstreams with
 *    no legal free path or redistribution-hostile terms:
 *      - Climatiq: 2026 pricing gates API access behind Enterprise and the ToS
 *        (§5.3) prohibits redistribution of factors; replay by default, live
 *        only when the operator sets CLIMATIQ_API_KEY and accepts those terms.
 *      - Salesforce Net Zero Cloud / Microsoft Sustainability / Watershed:
 *        commercial tenants only (NZC and Microsoft do offer 30-day trials;
 *        Watershed issues keys to customers only). Fixtures use the platforms'
 *        documented response shapes and field names.
 *      - Kepler/Prometheus: no publicly queryable Prometheus with Kepler
 *        metrics exists (verified against demo.promlabs.com) — the existing
 *        kepler-demo.example subject already replays a recorded response.
 *
 * Every number that is not real says so in band; every real number's origin
 * and license is attributed in band. All subjects sit under reserved .example
 * names because they demonstrate the FORMAT — they are not claims about any
 * real organization.
 */
import {
  carbonTxtApiAdapter,
  climatiqAdapter,
  co2jsAdapter,
  computedAdapter,
  msSustainabilityAdapter,
  salesforceNzcAdapter,
  watershedAdapter,
  type SourceAdapter,
} from "sustainability-wellknown-publisher";
import { compareDateTimes, lastFullMonthPeriod, monthPeriod, yearPeriod, type Period, type RawMetrics } from "sustainability-wellknown-publisher";
import { PUBLIC_BASE_URL, type GatewayConfig } from "../config";
import type { LiveDeps, LiveSpec } from "../live";
import { SFC_LEDGER_DEMO_2_DOMAIN, SFC_LEDGER_DEMO_DOMAIN, SFC_NETWORK_2_DOMAIN, SFC_OPERATOR_2_DOMAIN, deepCheck, sfcLedgerBridgeAdapter, shallowCheck, type CheckReport } from "./sfc-ledger-bridge";
import { toRawMetrics } from "./sfc-ledger-2/bridge";
import {
  SFC_LEDGER_2_DISCLOSURE_URI,
  SFC_LEDGER_2_FIXTURE,
  SFC_LEDGER_2_METHODOLOGY_URI,
  SFC_LEDGER_2_PARAMETERS,
  SFC_LEDGER_2_PERIOD,
  SFC_LEDGER_2_PINS,
  SFC_LEDGER_2_PROVIDER,
  SFC_LEDGER_2_UPDATED,
  SFC_LEDGER_FIXTURE,
  SFC_LEDGER_PROVIDER,
  SFC_LEDGER_TEST_PRIVATE_JWK,
  SFC_LEDGER_TEST_PUBLIC_JWK,
  SFC_NETWORK_2_EXAMPLE,
  SFC_OPERATOR_2_EXAMPLE,
} from "./sfc-ledger-fixture";
import { KEPLER_FIXTURE_2025, keplerReplayAdapter } from "./kepler-replay";
import { GWF_DIST_FIXTURE, GWF_DIST_URL, distLiveAdapter, distReplayAdapter, fetchGwfDist } from "./dist";
import {
  YANG_FIXTURE_END,
  YANG_FIXTURE_OBJECTS,
  YANG_FIXTURE_START,
  yangPowerEnergyReplayAdapter,
} from "./yang-power-energy";
import { dateTimeOf, periodHours, startOfDay } from "./self-report";

/**
 * Stamp a deterministic `updated` on whatever the adapter produces (the close
 * of its reporting period, like the gateway's self-report). Without this the
 * normalizer defaults `updated` to wall-clock time, which would make documents
 * and their `Last-Modified` non-reproducible.
 */
function withUpdated(adapter: SourceAdapter, updatedIso: string): SourceAdapter {
  return {
    ...adapter,
    async fetch(query) {
      const raw = await adapter.fetch(query);
      const stamp = (r: RawMetrics): RawMetrics => ({ ...r, updated: r.updated ?? updatedIso });
      return Array.isArray(raw) ? raw.map(stamp) : stamp(raw);
    },
  };
}

/** One gigabyte (10^9 octets), the quantity of the `per-gigabyte` functional unit. */
const GIGABYTE = 1e9;

/**
 * Publish an adapter's carbon (gCO2e for the bytes it was given) as a software
 * carbon intensity score for that quantity, and drop the energy and carbon
 * members: they would read as the totals of the period, which a figure for a
 * fixed quantity of traffic is not.
 */
function carbonAsScorePerGigabyte(adapter: SourceAdapter): SourceAdapter {
  return {
    ...adapter,
    async fetch(query) {
      const raw = await adapter.fetch(query);
      const toScore = (r: RawMetrics): RawMetrics => {
        const { energy, carbon, ...rest } = r;
        return carbon ? { ...rest, sciScore: carbon.value, functionalUnit: "per-gigabyte" } : rest;
      };
      return Array.isArray(raw) ? raw.map(toScore) : toScore(raw);
    },
  };
}

/* ------------------------------------------------------------------------- *
 * 1. computed — LIVE grid intensity (NESO, CC BY 4.0, keyless)
 * ------------------------------------------------------------------------- */

export const NESO_INTENSITY_URL = "https://api.carbonintensity.org.uk/intensity";

/**
 * Recorded NESO response, retrieved 2026-07-30 (actual 103 gCO2/kWh for the
 * 08:30Z half-hour). Used when the live API is unreachable.
 */
export const NESO_FIXTURE_INTENSITY = 103;
export const NESO_FIXTURE_RETRIEVED = "2026-07-30";

interface NesoIntensityResponse {
  data?: Array<{ intensity?: { actual?: number | null; forecast?: number | null } }>;
}

/** Fetch the current GB grid carbon intensity (gCO2/kWh) from NESO. */
export async function fetchGbIntensity(fetchImpl: typeof fetch): Promise<number> {
  const res = await fetchImpl(NESO_INTENSITY_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`NESO intensity API returned HTTP ${res.status}`);
  const parsed = (await res.json()) as NesoIntensityResponse;
  const block = parsed.data?.[0]?.intensity;
  const value = block?.actual ?? block?.forecast;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("NESO intensity API returned no usable intensity value");
  }
  return value;
}

function gridDemoAdapter(
  config: GatewayConfig,
  deps: LiveDeps,
  intensity: number,
  sourceNote: string,
  /** The instant the intensity was read (RFC 3339): the figure changes with it, so `updated` is not before it. */
  retrievedAt: string,
  wattsByMonth: Record<string, number> = {},
): SourceAdapter {
  const latest = gatewayLatestMonth(config, wattsByMonth, deps.now());
  if (!latest) return noEnteredMonth("grid-intensity demo");
  const { period, kwh } = latest;
  return withUpdated(
    computedAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `computed` adapter " +
      "(energy x grid intensity -> carbon). Energy is this gateway's own monthly consumption, " +
      "the same figure its self report states for the month (see methodology-uri). Grid intensity: " +
      sourceNote +
      " Applying the GB grid factor to a container that does not run in Great Britain is " +
      "deliberate and ILLUSTRATIVE: the subject demonstrates the computation, it does not " +
      "claim a real location-accurate footprint.",
    methodologyUri: config.self.methodologyUri,
    measurementMethod: "third-party-modeled",
    period,
      energy: { value: kwh, unit: "kWh" },
      gridIntensity: intensity,
      carbonAccounting: "location-based",
    }),
    compareDateTimes(retrievedAt, period.end) > 0 ? retrievedAt : period.end,
  );
}

/* ------------------------------------------------------------------------- *
 * 2. co2js — LIVE local computation over this gateway's own real bytes
 * ------------------------------------------------------------------------- */

function co2jsDemoAdapter(
  deps: LiveDeps,
  crawlBytes: number,
  greencheck: { domain?: string; green?: boolean },
): SourceAdapter {
  const period = lastFullMonthPeriod(deps.now());
  return withUpdated(
    carbonAsScorePerGigabyte(co2jsAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `co2js` adapter " +
      "(Green Web Foundation CO2.js, Apache-2.0, Sustainable Web Design model). The " +
      "score is the model's grams CO2e for one gigabyte (10^9 octets) transferred " +
      "(functional unit per-gigabyte): a rate, not this service's total footprint (see " +
      "the gateway's own report at the root well-known path for that). For scale, one " +
      `full crawl of every document this gateway serves is ${crawlBytes} bytes. ` +
      "Grid intensity: CO2.js bundled Ember annual " +
      "world average (CC BY 4.0, cite Ember). Green-hosting status via GWF Greencheck " +
      "(Green Domains dataset, ODbL). " +
      (greencheck.domain
        ? "Green-hosting status is checked LIVE against Greencheck daily."
        : "Green-hosting status: not claimed (no live Greencheck lookup in this mode; " +
          "recorded default false)."),
      methodologyUri: "https://developers.thegreenwebfoundation.org/co2js/overview/",
      period,
      bytes: GIGABYTE,
      model: "swd",
      ...(greencheck.domain
        ? { greencheckDomain: greencheck.domain }
        : { green: greencheck.green ?? false }),
      measurementMethod: "third-party-modeled",
    })),
    period.end,
  );
}

/* ------------------------------------------------------------------------- *
 * 3. carbontxt-api — LIVE with free GWF key; replay of the real carbon.txt else
 * ------------------------------------------------------------------------- */

/**
 * Fixture built from the REAL carbon.txt of thegreenwebfoundation.org
 * (retrieved and content-verified 2026-07-30: v0.4 TOML, last_updated
 * 2025-12-22, disclosures + upstream providers). The disclosure URLs are the
 * organization's own published links; the response envelope mirrors the
 * carbon.txt validator API's documented shape.
 */
export const CARBONTXT_FIXTURE = {
  success: true,
  url: "https://www.thegreenwebfoundation.org/carbon.txt",
  data: {
    version: "0.4",
    last_updated: "2025-12-22",
    org: {
      disclosures: [
        {
          doc_type: "sustainability-page",
          url: "https://www.thegreenwebfoundation.org/publications/",
          domain: "thegreenwebfoundation.org",
        },
        {
          doc_type: "web-page",
          url: "https://www.thegreenwebfoundation.org/.well-known/tcs.json",
          domain: "thegreenwebfoundation.org",
        },
      ],
    },
    upstream: { services: [] },
  },
};

function carbontxtDemoAdapter(deps: LiveDeps, apiKey?: string): SourceAdapter {
  return withUpdated(
    carbonTxtApiAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `carbontxt-api` " +
      "adapter. The disclosure links are REAL: they come from the carbon.txt file that " +
      "The Green Web Foundation itself publishes at thegreenwebfoundation.org/carbon.txt " +
      "(a public, machine-readable disclosure format; carbontxt.org). The energy and " +
      "carbon figures are SYNTHETIC PLACEHOLDERS — carbon.txt carries links to evidence, " +
      "not metrics — and describe nothing real. Not published, reviewed, or endorsed by " +
      "The Green Web Foundation.",
      domain: "thegreenwebfoundation.org",
      period: yearPeriod(2025),
      ...(apiKey !== undefined ? { apiKey } : { fixture: CARBONTXT_FIXTURE }),
      // carbon.txt has no numbers; the demo supplies clearly-labelled synthetic
      // metrics so the document exercises the full field mapping.
      energy: { value: 120, unit: "kWh" },
      gridIntensity: 442,
      measurementMethod: "third-party-modeled",
    }),
    yearPeriod(2025).end,
  );
}

/* ------------------------------------------------------------------------- *
 * 4. climatiq — REPLAY by default (ToS/pricing, see module header)
 * ------------------------------------------------------------------------- */

/**
 * A realistic recorded /data/v1/estimate response (shape per Climatiq's public
 * API reference; the numbers are SYNTHETIC and stated as such in band).
 */
export const CLIMATIQ_FIXTURE = {
  co2e: 38.71,
  co2e_unit: "kg",
  emission_factor: {
    activity_id: "electricity-supply_grid-source_residual_mix",
    source: "recorded demonstration fixture (synthetic)",
  },
};

function climatiqDemoAdapter(config: GatewayConfig, deps: LiveDeps, wattsByMonth: Record<string, number>, apiKey?: string): SourceAdapter {
  const latest = gatewayLatestMonth(config, wattsByMonth, deps.now());
  if (!latest) return noEnteredMonth("climatiq demo");
  const { period, kwh } = latest;
  const live = apiKey !== undefined;
  return withUpdated(
    climatiqAdapter({
      provider: live
      ? "Demonstration by the gateway operator of the publisher package's `climatiq` " +
        "adapter, LIVE against the Climatiq estimate API under the operator's own key. " +
        "Emission factor source is attributed per estimate (Climatiq terms §5.7); raw " +
        "factors are not redistributed. Energy input is this gateway's modelled monthly " +
        "consumption."
      : "Demonstration by the gateway operator of the publisher package's `climatiq` " +
        "adapter in REPLAY mode: a recorded response shape with SYNTHETIC numbers, " +
        "describing nothing real. Replay is the default because Climatiq's 2026 free " +
        "tier does not include general API access and its terms restrict redistribution; " +
        "operators with a licensed key can set CLIMATIQ_API_KEY to run this live.",
      methodologyUri: "https://www.climatiq.io/docs/api-reference/estimate",
      period,
      activityId: "electricity-supply_grid-source_residual_mix",
      // Climatiq requires a data-version selector for live estimates (the
      // current major, 2026-09); replay fixtures ignore it.
      dataVersion: "^34",
      energy: { value: Number(kwh.toFixed(4)), unit: "kWh" },
      measurementMethod: "third-party-modeled",
      ...(apiKey !== undefined ? { apiKey } : { fixture: CLIMATIQ_FIXTURE }),
    }),
    period.end,
  );
}

/* ------------------------------------------------------------------------- *
 * 5-7. Enterprise adapters — REPLAY of documented response shapes
 * ------------------------------------------------------------------------- */

/**
 * Salesforce Net Zero Cloud: a standard REST/SOQL query envelope over the
 * `AnnualEmssnInventory` object, with field names verified against the NZC
 * developer guide (v67.0). Values are SYNTHETIC but internally consistent
 * (5120.4 + 9310.2 + 33783.1 = 48213.7 tCO2e).
 */
export const SALESFORCE_FIXTURE = {
  totalSize: 1,
  done: true,
  records: [
    {
      attributes: { type: "AnnualEmssnInventory" },
      Name: "FY2025 Emissions Inventory (synthetic demonstration)",
      Year: "2025",
      TotalEmissions: 48213.7,
      TotalScope1Emissions: 5120.4,
      TotScope2MarketBsdEmssn: 9310.2,
      TotalScope3Emissions: 33783.1,
      // The adapter's documented energy field; MWh, synthetic like the rest.
      ActualEnergyConsumption: 20140,
    },
  ],
};

function salesforceDemoAdapter(): SourceAdapter {
  return withUpdated(
    salesforceNzcAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `salesforce-nzc` " +
      "adapter in REPLAY mode: a recorded SOQL response over the AnnualEmssnInventory " +
      "object (field names per the Net Zero Cloud developer guide), with SYNTHETIC " +
      "figures describing no real organization. Live use requires a Net Zero Cloud org " +
      "(Salesforce offers 30-day trial orgs). Not affiliated with Salesforce.",
    methodologyUri:
      "https://developer.salesforce.com/docs/atlas.en-us.netzero_cloud_dev_guide.meta/netzero_cloud_dev_guide/netzero_cloud_data_model.htm",
      fieldMap: { scope2: "TotScope2MarketBsdEmssn", period: "Year" },
      fixture: SALESFORCE_FIXTURE,
      measurementMethod: "third-party-modeled",
    }),
    yearPeriod(2025).end,
  );
}

/**
 * Microsoft Cloud for Sustainability: recorded OData pages in the shape of the
 * `m365/tenantemissions` endpoint this adapter targeted. That preview API was
 * retired on 2025-05-30 (successor: the Azure Carbon Optimization API), which
 * is itself a demonstration point: recorded fixtures keep an integration
 * testable after an upstream API sunsets.
 */
export const MS_FIXTURE_PAGES = [
  {
    value: [
      { dateKey: "2025-04", totalEmissions: 1.84 },
      { dateKey: "2025-05", totalEmissions: 1.79 },
    ],
  },
  { value: [{ dateKey: "2025-06", totalEmissions: 1.91 }] },
];

function msDemoAdapter(): SourceAdapter {
  return withUpdated(
    msSustainabilityAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `ms-sustainability` " +
      "adapter in REPLAY mode: recorded OData pages in the retired m365/tenantemissions " +
      "shape (the preview Cloud for Sustainability API was deprecated 2025-05-30; its " +
      "successor is the Azure Carbon Optimization REST API). Figures are SYNTHETIC and " +
      "describe no real tenant. Not affiliated with Microsoft.",
      methodologyUri: "https://learn.microsoft.com/en-us/industry/sustainability/",
      period: yearPeriod(2025),
      energyKwh: 5230,
      fixturePages: MS_FIXTURE_PAGES,
      measurementMethod: "third-party-modeled",
    }),
    yearPeriod(2025).end,
  );
}

/**
 * Watershed: a recorded footprint in the adapter's documented shape (Watershed
 * exposes footprints via api.watershedclimate.com to customer-issued keys
 * only; there is no public sandbox). Values are SYNTHETIC.
 */
export const WATERSHED_FIXTURE = {
  reportingPeriod: "2025",
  totalEmissionsKgCo2e: 512_400,
  scope1Kg: 48_200,
  scope2Kg: 131_700,
  scope3Kg: 332_500,
  energyKwh: 402_000,
  renewablePercent: 64,
  carbonAccounting: "market-based" as const,
};

function watershedDemoAdapter(): SourceAdapter {
  return withUpdated(
    watershedAdapter({
    provider:
      "Demonstration by the gateway operator of the publisher package's `watershed` " +
      "adapter in REPLAY mode: a recorded footprint in the adapter's documented shape " +
      "(Watershed's API serves customer-issued keys only; no public sandbox exists). " +
      "Figures are SYNTHETIC and describe no real organization. Not affiliated with " +
      "Watershed.",
      methodologyUri: "https://api-docs.watershed.com/",
      period: yearPeriod(2025),
      fixture: WATERSHED_FIXTURE,
      measurementMethod: "third-party-modeled",
    }),
    yearPeriod(2025).end,
  );
}

/* ------------------------------------------------------------------------- *
 * The spec list
 * ------------------------------------------------------------------------- */

export interface DemoSpecOptions {
  config: GatewayConfig;
  /** Measured byte size of one full crawl of every served document. */
  crawlBytes: number;
  /** Operator-entered average power per month (data/_self-measured.json), as the self report uses it. */
  wattsByMonth?: Record<string, number>;
  /** The boot instant: the demos that state the gateway's own energy are served only once a whole entered month exists. */
  now?: Date;
}

/**
 * This gateway's energy for the latest whole calendar month whose power the
 * operator entered, by the same rule as its self report; `undefined` before
 * the first entry.
 */
function gatewayLatestMonth(config: GatewayConfig, wattsByMonth: Record<string, number>, now: Date): { period: Period; kwh: number } | undefined {
  const complete = lastFullMonthPeriod(now).end;
  for (const month of Object.keys(wattsByMonth).sort().reverse()) {
    const [y, m] = month.split("-").map(Number);
    const period = monthPeriod(y, m);
    // A whole month that has ended and that the gateway was live for from its first day.
    if (period.end > complete || compareDateTimes(period.start, config.self.liveSince) < 0) continue;
    return { period, kwh: Number(((wattsByMonth[month] * periodHours(period)) / 1000).toPrecision(4)) };
  }
  return undefined;
}

/** A demo that needs the gateway's own monthly energy, reached without a whole entered month: it fails by name. */
function noEnteredMonth(demo: string): SourceAdapter {
  return {
    name: "no-entered-month",
    capabilities: "basic",
    async fetch() {
      throw new Error(`${demo}: the self report has no entered month yet (node scripts/self-watts.mjs <YYYY-MM> ...)`);
    },
  };
}

/**
 * The SFC demonstrations' shared parts. The ledger-access-uri of a bridged declaration must be an
 * https URI (spec 8.5): a local http BASE_URL would make the served document point at the reference
 * deployment instead.
 */
const sfcInputUri = (config: GatewayConfig, domain: string): string =>
  `${(/^https:/.test(config.baseUrl) ? config.baseUrl : PUBLIC_BASE_URL).replace(/\/+$/, "")}/${domain}/input`;

/** The failing rows of a report, as lines for a boot error. */
const failingRows = (...reports: CheckReport[]): string[] =>
  reports.flatMap((r) => r.rows).filter((r) => r.status === "FAIL").map((r) => `${r.id}${r.scope ? ` (${r.scope})` : ""}: ${r.detail}`);

/** A reference declaration of SFC profile 2.0, relayed unchanged: the adapter hands the publisher exactly its members. */
function sfcStaticExampleAdapter(document: Record<string, unknown>): SourceAdapter {
  const { signed: _signed, ...unsigned } = document;
  return { name: "sfc-reference-declaration", capabilities: "basic", fetch: async () => toRawMetrics(unsigned) };
}

/** Verdicts of the 2.0 self-check by document text: a gateway booted again in one process (the test suites do) checks each recorded document once. */
const SELF_CHECK_2_DONE = new Map<string, Promise<void>>();

/**
 * The 2.0 checks run on a served declaration at boot: the shallow check, and the deep check against the recorded read.
 * The guarantee is unchanged (a failing document stops every boot that serves it); only a repeat of a passed check is skipped.
 */
function sfcSelfCheck2(document: unknown): Promise<void> {
  const key = JSON.stringify(document);
  const known = SELF_CHECK_2_DONE.get(key);
  if (known) return known;
  const run = runSfcSelfCheck2(document);
  SELF_CHECK_2_DONE.set(key, run);
  run.catch(() => SELF_CHECK_2_DONE.delete(key));
  return run;
}

async function runSfcSelfCheck2(document: unknown): Promise<void> {
  const readAt = SFC_LEDGER_2_FIXTURE["read-at"];
  // the served text is what is checked, so the body is read as I-JSON (the gateway builds the object itself, so no duplicate can arise; the path is the real one)
  const declarationText = JSON.stringify(document);
  const shallow = await shallowCheck(document, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], T: readAt, declarationText });
  const deep = deepCheck(document, SFC_LEDGER_2_FIXTURE, { T: readAt, parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS, declarationText });
  const bad = failingRows(shallow, deep);
  if (bad.length > 0) throw new Error(`sfc-ledger-bridge (profile 2.0) self-check failed:\n  ${bad.join("\n  ")}`);
}

export function demoSpecs(opts: DemoSpecOptions): LiveSpec[] {
  const { config, crawlBytes } = opts;
  const wattsByMonth = opts.wattsByMonth ?? {};
  const greencheckDomain = config.baseUrl ? new URL(config.baseUrl).hostname : undefined;
  // The grid-intensity and Climatiq demos state this gateway's energy for its latest entered month:
  // without one they are not served (a month without an entry is not reported).
  const ownEnergy = gatewayLatestMonth(config, wattsByMonth, opts.now ?? new Date()) !== undefined;
  const needsOwnEnergy = new Set(["grid-intensity-demo.example", "climatiq-demo.example"]);

  const specs: LiveSpec[] = [
    {
      // The package's kepler-prometheus adapter against a recorded Prometheus
      // response. Replay-only: no publicly queryable Prometheus with Kepler
      // energy metrics exists (verified 2026-07-30 against demo.promlabs.com).
      domain: "kepler-demo.example",
      target: "kepler-demo.example",
      targetType: "service",
      fixture: () =>
        keplerReplayAdapter({
          target: "kepler-demo.example",
          methodologyUri: config.self.methodologyUri,
          gridIntensity: config.self.gridIntensity,
        }),
      labelFixture: "adapter:kepler-prometheus (recorded fixture, replay mode)",
      labelLive: "adapter:kepler-prometheus",
      upstream: "Kepler energy counters via Prometheus (no public instance; replay)",
      attribution: "synthetic figures; recorded Prometheus query response",
      input: {
        body: KEPLER_FIXTURE_2025,
        note:
          "A Prometheus instant-query response for Kepler's energy counters, in the shape the " +
          "Prometheus HTTP API returns. The figures are synthetic: no public Prometheus with " +
          "Kepler metrics exists to record from.",
      },
    },
    {
      domain: "grid-intensity-demo.example",
      target: "grid-intensity-demo.example",
      targetType: "service",
      live: async (deps) => {
        // tryLive() never invokes this builder with a null fetchImpl.
        const intensity = await fetchGbIntensity(deps.fetchImpl as typeof fetch);
        return gridDemoAdapter(
          config,
          deps,
          intensity,
          `LIVE from the National Energy System Operator (NESO) Carbon Intensity API, ` +
            `${intensity} gCO2/kWh for the current GB half-hour at refresh time, refreshed ` +
            "daily and cached. Data: NESO Carbon Intensity API, CC BY 4.0.",
          dateTimeOf(deps.now().getTime()),
          wattsByMonth,
        );
      },
      fixture: (deps) =>
        gridDemoAdapter(
          config,
          deps,
          NESO_FIXTURE_INTENSITY,
          `RECORDED from the National Energy System Operator (NESO) Carbon Intensity API ` +
            `(${NESO_FIXTURE_INTENSITY} gCO2/kWh, retrieved ${NESO_FIXTURE_RETRIEVED}); the ` +
            "live API was unavailable at the last refresh. Data: NESO Carbon Intensity API, " +
            "CC BY 4.0.",
          `${NESO_FIXTURE_RETRIEVED}T00:00:00Z`,
          wattsByMonth,
        ),
      labelLive: "adapter:computed (LIVE NESO grid intensity, daily)",
      labelFixture: "adapter:computed (recorded NESO grid intensity)",
      upstream: "NESO Carbon Intensity API (api.carbonintensity.org.uk)",
      attribution: "NESO Carbon Intensity API, CC BY 4.0",
      input: {
        body: {
          source: NESO_INTENSITY_URL,
          retrieved: NESO_FIXTURE_RETRIEVED,
          "data[0].intensity.actual": NESO_FIXTURE_INTENSITY,
          unit: "gCO2/kWh",
          attribution: "National Energy System Operator (NESO) Carbon Intensity API, CC BY 4.0",
        },
        note:
          "The one value this demonstration reads from the NESO response, as recorded on " +
          `${NESO_FIXTURE_RETRIEVED}. The full response is not stored; the live link returns the ` +
          "current one, which is what the live mode reads.",
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
        liveUrl: NESO_INTENSITY_URL,
      },
    },
    {
      domain: "co2js-demo.example",
      target: "co2js-demo.example",
      targetType: "service",
      // CO2.js computes locally; the only network call is the keyless
      // Greencheck lookup of this gateway's own host, and only when a public
      // base URL is configured.
      live: (deps) =>
        greencheckDomain
          ? co2jsDemoAdapter(deps, crawlBytes, { domain: greencheckDomain })
          : null,
      fixture: (deps) => co2jsDemoAdapter(deps, crawlBytes, { green: false }),
      labelLive: "adapter:co2js (local SWD model, live Greencheck, daily)",
      labelFixture: "adapter:co2js (local SWD model, no live Greencheck)",
      upstream: "CO2.js locally (Ember data) + GWF Greencheck",
      attribution: "CO2.js Apache-2.0; Ember CC BY 4.0; GWF Green Domains ODbL",
      input: {
        body: {
          "bytes-transferred": GIGABYTE,
          "crawl-bytes": crawlBytes,
          measured: "crawl-bytes is the serialized size of one crawl of every document this gateway serves, at start-up; the score is computed for one gigabyte",
          model: "Sustainable Web Design model, version 4, as implemented by CO2.js",
          "green-hosting": "looked up at start-up with the Green Web Foundation Greencheck API when a public base URL is set",
        },
        note:
          "The only input CO2.js needs is a byte count: one gigabyte, so the result is a score per " +
          "gigabyte. The size of one crawl of this gateway, measured by serializing every document " +
          "it serves when it starts, is given for scale.",
      },
    },
    {
      domain: "carbontxt-demo.example",
      target: "thegreenwebfoundation.org carbon.txt (disclosures relay)",
      targetType: "organization",
      live: (deps) => {
        const key = deps.env.GWF_API_KEY;
        return key ? carbontxtDemoAdapter(deps, key) : null;
      },
      fixture: (deps) => carbontxtDemoAdapter(deps),
      labelLive: "adapter:carbontxt-api (LIVE GWF validator API, daily)",
      labelFixture: "adapter:carbontxt-api (recorded real carbon.txt, replay)",
      upstream: "GWF carbon.txt validator API (free key) / recorded carbon.txt",
      attribution: "carbon.txt self-published by its organization; validator by GWF",
      input: {
        body: CARBONTXT_FIXTURE,
        note:
          "The Green Web Foundation carbon.txt validator API's response for the Foundation's own " +
          "carbon.txt, as recorded on 2026-07-30: the parsed file with its real disclosure links.",
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
        liveUrl: "https://www.thegreenwebfoundation.org/carbon.txt",
      },
    },
    {
      domain: "climatiq-demo.example",
      target: "climatiq-demo.example",
      targetType: "service",
      // Replay only, even when CLIMATIQ_API_KEY is set: Climatiq's terms restrict
      // redistribution, and this deployment publishes only what a licence lets
      // it republish. The adapter itself runs live for a licensed operator.
      fixture: (deps) => climatiqDemoAdapter(config, deps, wattsByMonth),
      labelLive: "adapter:climatiq",
      labelFixture: "adapter:climatiq (synthetic response in Climatiq's documented shape, replay)",
      upstream: "Climatiq estimate API (replay only here: its terms restrict redistribution)",
      attribution: "synthetic figures; no Climatiq data is relayed",
      input: {
        body: CLIMATIQ_FIXTURE,
        note:
          "An estimate response in the shape of Climatiq's published API reference. The numbers " +
          "are synthetic and none of it is Climatiq data: Climatiq's terms restrict redistribution, " +
          "so nothing it returns is relayed here.",
      },
    },
    {
      domain: "salesforce-nzc-demo.example",
      target: "salesforce-nzc-demo.example",
      targetType: "organization",
      fixture: () => salesforceDemoAdapter(),
      labelFixture: "adapter:salesforce-nzc (documented SOQL shape, replay)",
      labelLive: "adapter:salesforce-nzc",
      upstream: "Salesforce Net Zero Cloud (30-day trial orgs exist; replay here)",
      attribution: "synthetic figures; field names per NZC developer guide",
      input: {
        body: SALESFORCE_FIXTURE,
        note:
          "A SOQL query result over Net Zero Cloud's annual emissions inventory object, with the " +
          "field names of the Net Zero Cloud developer guide. The figures are synthetic.",
      },
    },
    {
      domain: "ms-sustainability-demo.example",
      target: "ms-sustainability-demo.example",
      targetType: "organization",
      fixture: () => msDemoAdapter(),
      labelFixture: "adapter:ms-sustainability (retired OData shape, replay)",
      labelLive: "adapter:ms-sustainability",
      upstream: "MS Cloud for Sustainability (preview API retired 2025-05-30; replay)",
      attribution: "synthetic figures; shape per the retired tenantemissions API",
      input: {
        body: MS_FIXTURE_PAGES,
        note:
          "Two pages of a Microsoft emissions API response, in the shape of the retired " +
          "tenantemissions endpoint. The figures are synthetic.",
      },
    },
    {
      domain: "watershed-demo.example",
      target: "watershed-demo.example",
      targetType: "organization",
      fixture: () => watershedDemoAdapter(),
      labelFixture: "adapter:watershed (documented footprint shape, replay)",
      labelLive: "adapter:watershed",
      upstream: "Watershed API (customer-only keys, no sandbox; replay)",
      attribution: "synthetic figures; shape per api-docs.watershed.com",
      input: {
        body: WATERSHED_FIXTURE,
        note:
          "A footprint summary in the shape of Watershed's API documentation, which is open to " +
          "customer keys only. The figures are synthetic.",
      },
    },
    {
      // Gateway-local adapter for the IETF GREEN working group's Power and
      // Energy YANG module. Replay-only: no publicly reachable RESTCONF server
      // implements the working-group draft, and a period needs two snapshots.
      domain: "yang-energy-demo.example",
      target: "edge-router-1.yang-energy-demo.example",
      targetType: "device",
      fixture: () =>
        yangPowerEnergyReplayAdapter({
          target: "edge-router-1.yang-energy-demo.example",
          gridIntensity: config.self.gridIntensity,
        }),
      labelFixture: "adapter:yang-power-energy (recorded RFC 7951 snapshots, replay)",
      labelLive: "adapter:yang-power-energy",
      upstream: "ietf-power-and-energy over RESTCONF (IETF GREEN WG draft; no public device; replay)",
      attribution: "synthetic figures; data model per draft-ietf-green-power-and-energy-yang-04",
      input: {
        body: {
          "object-ids": YANG_FIXTURE_OBJECTS,
          "period-start": YANG_FIXTURE_START,
          "period-end": YANG_FIXTURE_END,
        },
        note:
          "Two RFC 7951 JSON snapshots of the ietf-power-and-energy data model, read over RESTCONF " +
          "at the start and end of the period; the energy is the difference of the counters. The " +
          "figures are synthetic: no public device implements the working-group draft.",
      },
    },
    {
      // Gateway-local adapter for DIST. Live: the Green Web Foundation's own
      // published file, fetched daily (its website content is CC BY 4.0).
      domain: "dist-demo.example",
      target: "Green Web Foundation (digital estate, DIST relay)",
      targetType: "organization",
      live: async (deps) => {
        const doc = await fetchGwfDist(deps.fetchImpl as typeof fetch);
        return distLiveAdapter(doc, dateTimeOf(startOfDay(deps.now().getTime())));
      },
      fixture: () => distReplayAdapter(),
      labelLive: "adapter:dist (LIVE Green Web Foundation dist.json, daily)",
      labelFixture: "adapter:dist (recorded dist.json, replay)",
      upstream: "Green Web Foundation dist.json (DIST v0.0.1)",
      attribution: "Green Web Foundation, CC BY 4.0",
      input: {
        body: GWF_DIST_FIXTURE,
        note:
          "The Green Web Foundation's own dist.json, as recorded. In live mode the gateway reads " +
          "the current file daily; the live link shows it.",
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
        liveUrl: GWF_DIST_URL,
      },
    },
    {
      // EXPERIMENTAL. Gateway-local adapter for the SFC ledger bridge (SFC ledger
      // profile 1.2): a recorded, synthetic ledger excerpt signed with the
      // public RFC 8032 test key, turned into a signed operator declaration that
      // carries the ledger-evidence extension of disclosure profile 1.1. Replay only: no public
      // SFC ledger exists. The declaration is signed with the same test key,
      // never with the gateway's own, and both checks of the bridge run on the
      // served document at boot (a failure stops the boot, like a bad fixture).
      domain: SFC_LEDGER_DEMO_DOMAIN,
      target: SFC_LEDGER_FIXTURE.publication.target,
      targetType: "origin",
      fixture: () =>
        sfcLedgerBridgeAdapter({
          excerpt: SFC_LEDGER_FIXTURE,
          mode: "operator",
          provider: SFC_LEDGER_PROVIDER,
          methodologyUri: config.self.methodologyUri,
          ledgerAccessUri: sfcInputUri(config, SFC_LEDGER_DEMO_DOMAIN),
        }),
      signingJwk: SFC_LEDGER_TEST_PRIVATE_JWK,
      selfCheck: async (subject) => {
        const shallow = await shallowCheck(subject.document, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
        const deep = deepCheck(subject.document, SFC_LEDGER_FIXTURE);
        const bad = [...shallow.rows, ...deep.rows].filter((r) => r.status === "FAIL").map((r) => `${r.id}: ${r.detail}`);
        if (bad.length > 0) throw new Error(`sfc-ledger-bridge self-check failed:\n  ${bad.join("\n  ")}`);
      },
      labelFixture: "adapter:sfc-ledger-bridge (recorded ledger excerpt, replay, experimental)",
      labelLive: "adapter:sfc-ledger-bridge",
      upstream: "SFC ledger profile 1.2 attestation events (recorded synthetic excerpt; no public ledger; replay)",
      attribution: "synthetic figures; events and declaration signed with the public RFC 8032 test key",
      input: {
        body: SFC_LEDGER_FIXTURE,
        note:
          "A recorded excerpt of a synthetic ledger: one operator's signed monthly EnergyAttested and " +
          "CarbonAttested events for January to April 2026, its Registry key and its signed allocation of one " +
          "retired tonne. Every figure is invented; every signature uses the public RFC 8032 test key. The " +
          "declaration's ledger-evidence extension points here, so a reader can run the deep check.",
      },
    },
    {
      // SFC profile 2.0 (spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md).
      // The bridge turns a recorded three-operator ledger read (excerpt format 2, from the profile's
      // test vectors) into the signed market-based network declaration for 2025: ledger-evidence-2,
      // hardware-lifecycle, carbon-neutrality and network-topology (spec 7.4, 8). Replay only, signed with
      // the public RFC 8032 test key. Both depths of the checks run on the served document at boot.
      // The paired location-based object (spec 7.3) is left off: a gateway subject relays one object.
      domain: SFC_LEDGER_DEMO_2_DOMAIN,
      target: SFC_LEDGER_2_FIXTURE.network,
      targetType: "service",
      fixture: () =>
        sfcLedgerBridgeAdapter({
          excerpt: SFC_LEDGER_2_FIXTURE,
          mode: "network",
          provider: SFC_LEDGER_2_PROVIDER,
          methodologyUri: SFC_LEDGER_2_METHODOLOGY_URI,
          ledgerAccessUri: sfcInputUri(config, SFC_LEDGER_DEMO_2_DOMAIN),
          disclosureUri: SFC_LEDGER_2_DISCLOSURE_URI,
          period: SFC_LEDGER_2_PERIOD,
          updated: SFC_LEDGER_2_UPDATED,
          target: SFC_LEDGER_2_FIXTURE.network,
          energyUnit: "MWh",
          carbonUnit: "tCO2e",
          consensusMechanism: "proof-of-authority",
          renewableEnergy: 82,
          parameters: SFC_LEDGER_2_PARAMETERS,
          pins: SFC_LEDGER_2_PINS,
        }),
      signingJwk: SFC_LEDGER_TEST_PRIVATE_JWK,
      selfCheck: (subject) => sfcSelfCheck2(subject.document),
      labelFixture: "adapter:sfc-ledger-bridge (SFC profile 2.0, recorded ledger read, replay, experimental)",
      labelLive: "adapter:sfc-ledger-bridge",
      upstream: "SFC profile 2.0 attestation events of a three-operator network (recorded synthetic read; no public ledger; replay)",
      attribution: "synthetic figures; events, Registry and declaration signed with the public RFC 8032 test key",
      input: {
        body: SFC_LEDGER_2_FIXTURE,
        note:
          "A recorded ledger read (SFC profile 2.0 excerpt, format 2) of a synthetic network: three operators, fifteen months of " +
          "signed EnergyAttested and CarbonAttested events, their Registry entries and the registrar key. Every figure is invented; " +
          "every signature uses the public RFC 8032 test key. The declaration's ledger-evidence-2 extension points here, so a reader " +
          "can run the deep check.",
      },
    },
    {
      // The reference network declaration of SFC profile 2.0 (sfc-compliance/examples/sfc-network.example.json,
      // its first object, the market-based primary), relayed unchanged and signed with the public test key.
      domain: SFC_NETWORK_2_DOMAIN,
      target: SFC_NETWORK_2_EXAMPLE.target,
      targetType: "service",
      fixture: () => sfcStaticExampleAdapter(SFC_NETWORK_2_EXAMPLE),
      signingJwk: SFC_LEDGER_TEST_PRIVATE_JWK,
      selfCheck: (subject) => sfcSelfCheck2(subject.document),
      labelFixture: "adapter:sfc-reference-declaration (SFC profile 2.0 example, replay)",
      labelLive: "adapter:sfc-reference-declaration",
      upstream: "SFC profile 2.0 reference network declaration (sfc-compliance/examples; synthetic)",
      attribution: "synthetic figures; signed with the public RFC 8032 test key",
      input: {
        body: SFC_LEDGER_2_FIXTURE,
        note: "The recorded ledger read this reference declaration recomputes from (the three-operator network of the SFC 2.0 test vectors). Every figure is invented.",
      },
    },
    {
      // The reference operator declaration of SFC profile 2.0 (sfc-compliance/examples/sfc-operator.example.json): one operator, January 2025.
      domain: SFC_OPERATOR_2_DOMAIN,
      target: SFC_OPERATOR_2_EXAMPLE.target,
      targetType: "origin",
      fixture: () => sfcStaticExampleAdapter(SFC_OPERATOR_2_EXAMPLE),
      signingJwk: SFC_LEDGER_TEST_PRIVATE_JWK,
      selfCheck: (subject) => sfcSelfCheck2(subject.document),
      labelFixture: "adapter:sfc-reference-declaration (SFC profile 2.0 example, replay)",
      labelLive: "adapter:sfc-reference-declaration",
      upstream: "SFC profile 2.0 reference operator declaration (sfc-compliance/examples; synthetic)",
      attribution: "synthetic figures; signed with the public RFC 8032 test key",
      input: {
        body: SFC_LEDGER_2_FIXTURE,
        note: "The recorded ledger read this reference declaration recomputes from (the three-operator network of the SFC 2.0 test vectors). Every figure is invented.",
      },
    },
  ];
  return specs.filter((spec) => ownEnergy || !needsOwnEnergy.has(spec.domain));
}
