/**
 * Kepler / Prometheus adapter.
 *
 * Scrapes Kepler energy counters (joules) from a Prometheus HTTP API, converts
 * J→kWh, and derives carbon via a grid intensity factor. Works against a live
 * Prometheus, or in replay mode against a recorded query response (`fixture`).
 *
 * Kepler metrics: kepler_node_platform_joules_total, kepler_container_joules_total.
 * These are Kepler's pre-0.10 (legacy) metric names; Kepler >= 0.10 (the
 * "re-architected" release) replaces the joules counters with the
 * kepler_platform_watts gauge and per-domain kepler_node_{cpu,gpu}_joules_total
 * counters. Point `query` at whichever metric set your Kepler deployment
 * exports; this adapter only sums whatever the query returns.
 */
import { monthPeriod, PeriodInput, toPeriod } from "../period";
import { FunctionalUnit, MeasurementMethod } from "../tokens";
import { Extensions, RawMetrics, SourceAdapter } from "../types";
import { fetchJson, lastFullMonthPeriod } from "../util";

export interface KeplerPrometheusConfig {
  provider: string;
  methodologyUri: string;
  /**
   * A `{ start, end }` object, or "YYYY", "YYYY-MM" or "YYYY-MM-DD" for the whole calendar unit (in `zone`).
   * Defaults to the last full month.
   */
  period?: PeriodInput;
  /**
   * The time zone of the machines, "Z" (the default), a fixed offset such as "+01:00", or an IANA name such
   * as "Europe/Berlin". A calendar label, and the default month, then start and end at midnight there, each
   * bound written in the offset in force at that instant (a March month in Berlin runs from +01:00 to +02:00).
   */
  zone?: string;
  /** gCO2e per kWh used to convert energy to carbon. */
  gridIntensity: number;
  /** Base URL of the Prometheus server, e.g. http://localhost:9090 */
  prometheusUrl?: string;
  /** PromQL returning a joules counter/value. Default sums node platform joules. */
  query?: string;
  measurementMethod?: MeasurementMethod;
  /** One of the twelve functional units of the draft. */
  functionalUnit?: FunctionalUnit;
  /** Data of the operator's own, keyed by extension name (a URI); see the draft, Extensions. */
  extensions?: Extensions;
  capabilities?: "basic" | "extended";
  /**
   * Replay mode: a recorded Prometheus `/api/v1/query` JSON response. When set,
   * no network call is made (used by tests and offline runs).
   */
  fixture?: PromQueryResponse;
}

export interface PromQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{ metric: Record<string, string>; value: [number, string] }>;
  };
}

/**
 * Sum the scalar/vector values in a Prometheus query response.
 *
 * Throws on an empty result set: a wrong label selector, a scrape gap, or the
 * Kepler >= 0.10 metric rename (see the file header) all yield zero series, and
 * reducing them returns 0 — publishing a fabricated measured 0. Every other
 * adapter fails loud here, so this one does too. The optional `query` label is
 * included in the error to point at the likely misconfiguration.
 */
export function sumPromValues(resp: PromQueryResponse, query?: string): number {
  if (resp.status !== "success") throw new Error(`Prometheus query failed: ${resp.status}`);
  if (resp.data.result.length === 0) {
    throw new Error(
      `sumPromValues: Prometheus query returned no series${query ? ` for "${query}"` : ""} ` +
        `— refusing to publish a fabricated 0 (check the label selector / metric name / scrape window)`,
    );
  }
  return resp.data.result.reduce((acc, r) => acc + Number(r.value[1]), 0);
}

// The configured period, or the last full month; a label or the default month is read in `zone`.
function resolvePeriod(config: KeplerPrometheusConfig): PeriodInput {
  const zone = config.zone ?? "Z";
  if (config.period !== undefined) return toPeriod(config.period, zone);
  const { start } = lastFullMonthPeriod();
  return monthPeriod(Number(start.slice(0, 4)), Number(start.slice(5, 7)), zone);
}

export function keplerPrometheusAdapter(config: KeplerPrometheusConfig): SourceAdapter {
  const query = config.query ?? "sum(kepler_node_platform_joules_total)";
  return {
    name: "kepler-prometheus",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics> {
      let resp: PromQueryResponse;
      if (config.fixture) {
        resp = config.fixture;
      } else {
        if (!config.prometheusUrl) {
          throw new Error("keplerPrometheusAdapter: prometheusUrl or fixture is required");
        }
        const url = `${config.prometheusUrl.replace(/\/$/, "")}/api/v1/query?query=${encodeURIComponent(query)}`;
        resp = (await fetchJson(url)) as PromQueryResponse;
      }

      const joules = sumPromValues(resp, query);
      return {
        provider: config.provider,
        // Kepler attributes energy from RAPL and models, which cover only part of a
        // machine; a figure built from its counters is an estimate, not a reading
        // of a meter in the power path, so `hardware-estimated` is the honest default.
        measurementMethod: config.measurementMethod ?? "hardware-estimated",
        methodologyUri: config.methodologyUri,
        period: resolvePeriod(config),
        energyJoules: joules,
        carbonIntensity: config.gridIntensity,
        functionalUnit: config.functionalUnit,
        extensions: config.extensions,
        capabilities: config.capabilities ?? "basic",
      };
    },
  };
}
