/**
 * Adapter for the IETF GREEN working group's Power and Energy YANG module
 * (`ietf-power-and-energy`, draft-ietf-green-power-and-energy-yang-04,
 * revision 2026-07-02): from two readings of a device's energy counters to
 * one sustainability-data declaration about that device.
 *
 * The module exposes, per energy object, a cumulative counter
 * `energy/total-energy-consumed` ("since the last reset"). A reporting period
 * is therefore two snapshots of `/energy-objects` — one at the start of the
 * period, one at its end — and the energy of the period is the sum, over the
 * chosen objects, of end minus start. Snapshots are the RFC 7951 JSON a
 * RESTCONF server returns for
 * `GET /restconf/data/ietf-power-and-energy:energy-objects` (64-bit counters
 * arrive as JSON strings).
 *
 * Three things the module leaves to its user are explicit options here:
 *
 *  - WHICH OBJECTS TO SUM. Energy objects can contain one another (a chassis
 *    and its power supplies, a line card and its ports), so adding every
 *    counter would count the same energy more than once. The caller names the
 *    objects whose counters do not overlap (`objectIds`).
 *  - THE COUNTER'S UNIT. In revision 2026-07-02 the leaf's `units` statement
 *    says "Watt-hours" while its description says the value "is specified as
 *    milliwatt-hours (mWh)". The `units` statement is taken as the default;
 *    `counterUnit: "mWh"` selects the other reading.
 *  - METERED OR ESTIMATED. `measurement-method` is `hardware-metered` only
 *    when every summed object reports a `data-source-accuracy` derived from
 *    `accuracy-measured`; otherwise it is `hardware-estimated`.
 *
 * A counter that went DOWN between the two snapshots was reset inside the
 * period; the energy of the period is then unknown and the adapter refuses to
 * publish rather than guess.
 */
import type { RawMetrics, SourceAdapter } from "sustainability-wellknown-publisher";

export const YANG_MODULE = "ietf-power-and-energy";
export const YANG_REVISION = "2026-07-02";
export const YANG_SOURCE = "https://datatracker.ietf.org/doc/draft-ietf-green-power-and-energy-yang/";

export interface YangEnergyObject {
  id: string;
  energy?: {
    /** uint64: a JSON string under RFC 7951; a number is tolerated. */
    "total-energy-consumed"?: string | number;
    /** identityref, with or without the module prefix. */
    "data-source-accuracy"?: string;
    "measurement-local"?: boolean;
  };
}

/** `GET …/ietf-power-and-energy:energy-objects` as RFC 7951 JSON. */
export interface YangEnergySnapshot {
  "ietf-power-and-energy:energy-objects"?: { "energy-object"?: YangEnergyObject[] };
}

export interface YangPowerEnergyConfig {
  provider: string;
  methodologyUri: string;
  /** "YYYY", "YYYY-MM" or "YYYY-MM-DD": the period the two snapshots bound. */
  reportingPeriod: string;
  /** The reporting subject, e.g. the device's host name. */
  target: string;
  start: YangEnergySnapshot;
  end: YangEnergySnapshot;
  /** Ids of the energy objects to sum; their counters must not overlap. */
  objectIds: string[];
  /** Unit of `total-energy-consumed`. Default "Wh" (the leaf's `units` statement). */
  counterUnit?: "Wh" | "mWh";
  /** gCO2e/kWh applied to the metered energy; omit to publish energy only. */
  gridIntensity?: number;
  updated?: string;
}

function objectsOf(snapshot: YangEnergySnapshot, which: string): Map<string, YangEnergyObject> {
  const list = snapshot?.["ietf-power-and-energy:energy-objects"]?.["energy-object"];
  if (!Array.isArray(list)) {
    throw new Error(`yang-power-energy: the ${which} snapshot has no ietf-power-and-energy:energy-objects/energy-object list`);
  }
  return new Map(list.map((o) => [o.id, o]));
}

function counter(o: YangEnergyObject | undefined, id: string, which: string): bigint {
  const v = o?.energy?.["total-energy-consumed"];
  if (v === undefined) throw new Error(`yang-power-energy: energy object "${id}" has no total-energy-consumed in the ${which} snapshot`);
  if (typeof v === "number" ? !Number.isSafeInteger(v) || v < 0 : !/^\d+$/.test(v)) {
    throw new Error(`yang-power-energy: total-energy-consumed of "${id}" in the ${which} snapshot is not a non-negative integer`);
  }
  return BigInt(v);
}

/** True for `accuracy-measured` and every identity derived from it, prefixed or not. */
export function isMeasured(identity: string | undefined): boolean {
  if (!identity) return false;
  const name = identity.includes(":") ? identity.slice(identity.indexOf(":") + 1) : identity;
  return name === "accuracy-measured" || name.startsWith("accuracy-measured-");
}

export function yangPowerEnergyAdapter(config: YangPowerEnergyConfig): SourceAdapter {
  if (!Array.isArray(config.objectIds) || config.objectIds.length === 0) {
    throw new Error("yang-power-energy: objectIds is required (energy objects can contain one another; name the ones to sum)");
  }
  if (new Set(config.objectIds).size !== config.objectIds.length) {
    throw new Error("yang-power-energy: objectIds lists an object more than once");
  }
  return {
    name: "yang-power-energy",
    capabilities: "basic",
    async fetch(): Promise<RawMetrics> {
      const start = objectsOf(config.start, "start");
      const end = objectsOf(config.end, "end");
      let total = 0n;
      let allMeasured = true;
      for (const id of config.objectIds) {
        const a = counter(start.get(id), id, "start");
        const b = counter(end.get(id), id, "end");
        if (b < a) {
          throw new Error(`yang-power-energy: total-energy-consumed of "${id}" decreased between the snapshots (counter reset inside the period); the period's energy is unknown`);
        }
        total += b - a;
        if (!isMeasured(end.get(id)?.energy?.["data-source-accuracy"])) allMeasured = false;
      }
      const perKwh = config.counterUnit === "mWh" ? 1_000_000 : 1_000;
      // Exact integer part first, so a large counter never loses precision.
      const kwh = Number(total / BigInt(perKwh)) + Number(total % BigInt(perKwh)) / perKwh;
      const raw: RawMetrics = {
        provider: config.provider,
        measurementMethod: allMeasured ? "hardware-metered" : "hardware-estimated",
        methodologyUri: config.methodologyUri,
        reportingPeriod: config.reportingPeriod,
        energy: { value: kwh, unit: "kWh" },
        target: config.target,
        targetType: "device",
        capabilities: "basic",
      };
      if (typeof config.gridIntensity === "number") {
        raw.carbonIntensity = config.gridIntensity;
        raw.carbonAccounting = "location-based";
      }
      if (config.updated !== undefined) raw.updated = config.updated;
      return raw;
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Recorded demonstration snapshots (SYNTHETIC)
 * ------------------------------------------------------------------------- */

const snapshot = (psu1: string, psu2: string, chassis: string): YangEnergySnapshot => ({
  "ietf-power-and-energy:energy-objects": {
    "energy-object": [
      {
        id: "chassis",
        energy: { "total-energy-consumed": chassis, "data-source-accuracy": "ietf-power-and-energy:accuracy-like-parent" },
      },
      {
        id: "psu-1",
        energy: {
          "total-energy-consumed": psu1,
          "data-source-accuracy": "ietf-power-and-energy:accuracy-measured-gold-1",
          "measurement-local": true,
        },
      },
      {
        id: "psu-2",
        energy: {
          "total-energy-consumed": psu2,
          "data-source-accuracy": "ietf-power-and-energy:accuracy-measured-gold-1",
          "measurement-local": true,
        },
      },
    ],
  },
});

/**
 * Two invented snapshots of one router for calendar year 2025: two power
 * supplies sharing the load (438 kWh each over the year, about 100 W in all),
 * and a chassis object whose counter is the sum of the two and is therefore
 * deliberately NOT in `objectIds`.
 */
export const YANG_FIXTURE_START = snapshot("1250000", "1248500", "2498500");
export const YANG_FIXTURE_END = snapshot("1688000", "1686500", "3374500");
export const YANG_FIXTURE_OBJECTS = ["psu-1", "psu-2"];

export function yangPowerEnergyReplayAdapter(opts: { target: string; gridIntensity: number }): SourceAdapter {
  return yangPowerEnergyAdapter({
    provider:
      "SYNTHETIC EXAMPLE — not a real device. Demonstration by the gateway operator of an adapter " +
      `for the IETF GREEN working group's Power and Energy YANG module (${YANG_MODULE}, revision ` +
      `${YANG_REVISION}, a working-group draft): two recorded RFC 7951 snapshots of ` +
      "/energy-objects, replayed. Energy is the growth of total-energy-consumed over the period, " +
      "summed over the two power supplies named in the adapter's objectIds; the chassis object " +
      "is not added, because its counter already contains theirs. The counter is read in " +
      "watt-hours, the leaf's `units` statement (its description says milliwatt-hours). The " +
      "figures are invented and describe nothing real. Gateway operator: Andrei Besleaga",
    methodologyUri: YANG_SOURCE,
    reportingPeriod: "2025",
    target: opts.target,
    start: YANG_FIXTURE_START,
    end: YANG_FIXTURE_END,
    objectIds: YANG_FIXTURE_OBJECTS,
    gridIntensity: opts.gridIntensity,
    // Deterministic: the recorded snapshots never change.
    updated: "2026-01-15T00:00:00Z",
  });
}
