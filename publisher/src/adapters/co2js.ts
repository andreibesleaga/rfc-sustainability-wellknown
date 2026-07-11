/**
 * CO2.js adapter (Green Web Foundation).
 *
 * Estimates carbon from bytes transferred using CO2.js's Sustainable Web Design
 * (SWD) model, resolves grid carbon intensity from CO2.js's bundled datasets
 * (Ember average / UNFCCC marginal), and optionally checks green hosting via the
 * Greencheck API. Because CO2.js returns carbon (gCO2e) rather than energy, the
 * mandatory `energy-consumption` field is filled in one of two ways:
 *
 *   - measured mode: caller supplies `energy {value,unit}` (used verbatim);
 *   - derived mode:  energy_kWh = carbonGrams / gridIntensity  (the exact inverse
 *                    of CO2.js's operational step), labelled `third-party-modeled`.
 *
 * Fully offline-deterministic: `perByte` + the bundled grid data need no network;
 * green hosting can be supplied directly (`green`) or via a recorded
 * `greencheckFixture` for tests. Live Greencheck is used only when a
 * `greencheckDomain` is given with no fixture.
 *
 * Upstream: https://developers.thegreenwebfoundation.org/co2js/overview/
 */
import { averageIntensity, co2 as Co2, hosting, marginalIntensity } from "@tgwf/co2";
import { convertEnergy } from "../normalize";
import { EnergyUnit, RawMetrics, SourceAdapter } from "../types";
import { lastFullMonth } from "../util";

export interface GreencheckResponse {
  green?: boolean;
  /** Some payloads use `data: false` for not-green. */
  data?: unknown;
  hosted_by?: string;
  [key: string]: unknown;
}

export interface Co2jsConfig {
  provider: string;
  methodologyUri: string;
  reportingPeriod?: string;
  /** Bytes transferred over the reporting period. Required. */
  bytes: number;
  /** Use the SWD per-visit estimate instead of per-byte. */
  perVisit?: boolean;
  /** SWD (default) or OneByte model. */
  model?: "swd" | "1byte";
  /**
   * SWD model version. CO2.js >= 0.18 defaults to v4 (current methodology);
   * pass `3` to reproduce pre-0.18 numbers. Ignored for the "1byte" model.
   */
  swdVersion?: 3 | 4;

  /** Green hosting, explicit. Overrides Greencheck. */
  green?: boolean;
  /** Live Greencheck domain (used only when no fixture/explicit green). */
  greencheckDomain?: string;
  /** Replay mode: a recorded Greencheck response. */
  greencheckFixture?: GreencheckResponse;

  /** Explicit grid intensity gCO2e/kWh; overrides zone lookup. */
  gridIntensity?: number;
  /** ISO-3166 alpha-3 zone (e.g. "USA", "FRA") for the bundled dataset. */
  gridZone?: string;
  /** Use the marginal-intensity dataset instead of the average. */
  marginal?: boolean;

  /** Measured-energy mode: supply energy directly. Else energy is derived. */
  energy?: { value: number; unit: EnergyUnit };

  renewableEnergy?: number;
  disclosureUri?: string;
  measurementMethod?: string;
  capabilities?: "basic" | "extended";
}

/** Read a green boolean from a Greencheck-style payload. */
export function greencheckIsGreen(resp: GreencheckResponse): boolean {
  if (typeof resp.green === "boolean") return resp.green;
  return false;
}

async function resolveGreen(config: Co2jsConfig): Promise<boolean> {
  if (config.greencheckFixture !== undefined) return greencheckIsGreen(config.greencheckFixture);
  if (typeof config.green === "boolean") return config.green;
  if (config.greencheckDomain) {
    const r = await hosting.check(config.greencheckDomain);
    if (typeof r === "boolean") return r;
    if (Array.isArray(r)) return r.includes(config.greencheckDomain);
    if (r && typeof r === "object") return (r as GreencheckResponse).green === true;
  }
  return false;
}

/**
 * Resolve the grid intensity (gCO2e/kWh) to report and use for carbon:
 * explicit `gridIntensity` → zone dataset lookup → CO2.js model default.
 */
export function resolveGridIntensity(config: Co2jsConfig, modelDefault: number): number {
  if (typeof config.gridIntensity === "number") return config.gridIntensity;
  if (config.gridZone) {
    const ds = config.marginal ? marginalIntensity : averageIntensity;
    const v = ds.data[config.gridZone];
    if (typeof v === "number") return v;
    throw new Error(`co2jsAdapter: unknown gridZone "${config.gridZone}" in ${ds.type} dataset`);
  }
  return modelDefault;
}

export function co2jsAdapter(config: Co2jsConfig): SourceAdapter {
  if (typeof config.bytes !== "number" || config.bytes < 0) {
    throw new Error("co2jsAdapter: bytes (>= 0) is required");
  }
  return {
    name: "co2js",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics> {
      const estimator = new Co2({
        model: config.model ?? "swd",
        ...(config.swdVersion ? { version: config.swdVersion } : {}),
      });
      const green = await resolveGreen(config);

      // CO2.js returns carbon at its own (default) grid intensity, with the
      // green-hosting discount already applied INSIDE trace.co2 (the reported
      // gridIntensity stays the full grid value). Operational energy does not
      // depend on who supplies the electricity, so it MUST be derived from a
      // green:false trace; the green discount then applies to carbon only, and
      // the reported intensity is the effective one, keeping
      // energy × intensity === carbon exactly.
      const baseTrace = config.perVisit
        ? estimator.perVisitTrace(config.bytes, false)
        : estimator.perByteTrace(config.bytes, false);
      const greenTrace = config.perVisit
        ? estimator.perVisitTrace(config.bytes, green)
        : estimator.perByteTrace(config.bytes, green);
      const gi = baseTrace.variables.gridIntensity;
      const modelDefault = gi?.dataCenter?.value ?? gi?.device?.value ?? gi?.network?.value ?? 0;
      if (!(modelDefault > 0)) {
        throw new Error("co2jsAdapter: CO2.js did not expose a usable grid intensity");
      }
      const operationalEnergyKwh = baseTrace.co2 / modelDefault;
      // 1 when not green; < 1 when the host's renewable share discounts carbon.
      const greenRatio = baseTrace.co2 > 0 ? greenTrace.co2 / baseTrace.co2 : 1;

      const gridIntensity = resolveGridIntensity(config, modelDefault);
      const effectiveIntensity = gridIntensity * greenRatio;

      // Energy: measured if supplied, else the bytes-derived operational energy.
      const energy: { value: number; unit: EnergyUnit } = config.energy ?? {
        value: operationalEnergyKwh,
        unit: "kWh",
      };
      const energyKwh = convertEnergy(energy.value, energy.unit, "kWh");
      const carbonGrams = energyKwh * effectiveIntensity;

      const raw: RawMetrics = {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "third-party-modeled",
        methodologyUri: config.methodologyUri,
        reportingPeriod: config.reportingPeriod ?? lastFullMonth(),
        energy,
        carbon: { value: carbonGrams, unit: "gCO2e" },
        carbonIntensity: effectiveIntensity,
        capabilities: config.capabilities ?? "basic",
      };
      if (config.renewableEnergy !== undefined) raw.renewableEnergy = config.renewableEnergy;
      if (config.disclosureUri !== undefined) raw.disclosureUri = config.disclosureUri;
      return raw;
    },
  };
}
