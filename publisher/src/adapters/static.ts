/**
 * Static / file adapters — zero external credentials.
 *
 * Lets *any* web server publish a conformant document immediately, either from
 * inline values, a gateway-native JSON file (RawMetrics), or an existing
 * wire-shaped `/.well-known/sustainability` file.
 */
import { RawMetrics, ServiceQuery, SourceAdapter, SustainabilityMetrics } from "../types";
import { fromWire, readJson } from "../util";

export interface StaticAdapterConfig {
  /** Inline metrics (camelCase RawMetrics), single or array. */
  data: RawMetrics | RawMetrics[];
  capabilities?: "basic" | "extended";
}

/** Serve fixed, inline metrics. */
export function staticAdapter(config: StaticAdapterConfig): SourceAdapter {
  return {
    name: "static",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics | RawMetrics[]> {
      return config.data;
    },
  };
}

export interface StaticFileAdapterConfig {
  /** Path to a JSON file. */
  file: string;
  /** "raw" = gateway-native RawMetrics; "wire" = a /.well-known/sustainability payload. */
  format?: "raw" | "wire";
  capabilities?: "basic" | "extended";
}

/** Serve metrics read from a JSON file on disk (re-read per request; cache in the Publisher). */
export function staticFileAdapter(config: StaticFileAdapterConfig): SourceAdapter {
  const format = config.format ?? "raw";
  return {
    name: "static-file",
    capabilities: config.capabilities ?? "basic",
    async fetch(_query: ServiceQuery): Promise<RawMetrics | RawMetrics[]> {
      const parsed = readJson(config.file);
      if (format === "wire") {
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const raws = (items as SustainabilityMetrics[]).map(fromWire);
        return raws.length === 1 ? raws[0] : raws;
      }
      return parsed as RawMetrics | RawMetrics[];
    },
  };
}
