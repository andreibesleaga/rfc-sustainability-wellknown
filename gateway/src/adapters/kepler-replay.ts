/**
 * Worked adapter example #2: Kepler/Prometheus in REPLAY mode.
 *
 * This is the concrete answer to "how would a real organization actually
 * generate one of these documents?". In production an operator points
 * `keplerPrometheusAdapter` at a live Prometheus that scrapes Kepler's energy
 * counters; the adapter sums the joules, the normalizer converts J -> kWh and
 * multiplies by a grid carbon intensity factor, and the publisher validates and
 * serves the result. Nothing else changes.
 *
 * Here the same adapter runs against a RECORDED Prometheus `/api/v1/query`
 * response (the adapter's `fixture` option), so the gateway needs no
 * credentials, no network, and no cluster — and the numbers it produces are, by
 * construction, SYNTHETIC. The subject is therefore a reserved `.example`
 * domain and the `provider` string says so in band.
 *
 * The other adapters shipped by `sustainability-wellknown-publisher` slot into
 * exactly this place: `static`, `computed`, `kepler-prometheus`, `climatiq`,
 * `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`, `watershed`.
 * See GUIDE.md, "Wiring an adapter".
 */
import {
  keplerPrometheusAdapter,
  type PromQueryResponse,
  type RawMetrics,
  type SourceAdapter,
} from "sustainability-wellknown-publisher";

/**
 * A recorded Prometheus response for
 * `sum by (instance) (kepler_node_platform_joules_total)`, as a Kepler-scraped
 * Prometheus would return it. Values are SYNTHETIC: two nodes, roughly 125 W
 * average each over the 2025 calendar year (2 x 125 W x 8760 h ~ 2190 kWh).
 */
export const KEPLER_FIXTURE_2025: PromQueryResponse = {
  status: "success",
  data: {
    resultType: "vector",
    result: [
      {
        metric: { __name__: "kepler_node_platform_joules_total", instance: "node-a:9102" },
        value: [1_735_689_600, "3942000000"],
      },
      {
        metric: { __name__: "kepler_node_platform_joules_total", instance: "node-b:9102" },
        value: [1_735_689_600, "3942000000"],
      },
    ],
  },
};

export interface KeplerReplayConfig {
  target: string;
  methodologyUri: string;
  /** gCO2e/kWh applied to the metered energy. */
  gridIntensity: number;
  reportingPeriod?: string;
  fixture?: PromQueryResponse;
}

const SYNTHETIC_PROVIDER =
  "SYNTHETIC EXAMPLE — not a real organization. Produced by the sustainability-wellknown-publisher " +
  "kepler-prometheus adapter replaying a recorded Prometheus response, to demonstrate " +
  "adapter-generated publication. The figures are invented and describe nothing real. " +
  "Gateway operator: Andrei Nicolae Besleaga (andrei.besleaga@ieee.org)";

export function keplerReplayAdapter(config: KeplerReplayConfig): SourceAdapter {
  const period = config.reportingPeriod ?? "2025";
  const inner = keplerPrometheusAdapter({
    provider: SYNTHETIC_PROVIDER,
    methodologyUri: config.methodologyUri,
    reportingPeriod: period,
    gridIntensity: config.gridIntensity,
    // Replay: no network call is made. Swap `fixture` for `prometheusUrl` to
    // run this against a live Prometheus instead.
    fixture: config.fixture ?? KEPLER_FIXTURE_2025,
    capabilities: "basic",
  });

  return {
    name: "kepler-prometheus-replay",
    capabilities: "basic",
    async fetch(query): Promise<RawMetrics> {
      const raw = (await inner.fetch(query)) as RawMetrics;
      return {
        ...raw,
        // Deterministic: the recorded fixture never changes, so neither does
        // the document, its ETag, or its Last-Modified.
        updated: "2026-01-15T00:00:00Z",
        target: config.target,
        targetType: "service",
      };
    },
  };
}
