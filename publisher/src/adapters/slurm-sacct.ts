/**
 * Slurm adapter — energy accounting from an HPC scheduler.
 *
 * Slurm records per-job energy when an energy plugin is configured
 * (acct_gather_energy: RAPL, IPMI, or a vendor plugin). `sacct` exports it as
 * joules in the `ConsumedEnergyRaw` field. This adapter reads a `sacct`
 * export and sums the energy of the jobs that ENDED inside each calendar
 * month into one declaration per month:
 *
 *   sacct --allusers --starttime 2026-01-01 --endtime 2026-02-01 \
 *         --parsable2 --noheader --format=JobID,Start,End,ConsumedEnergyRaw > jobs.psv
 *
 * Only top-level jobs are counted (steps such as `123.batch` and `123.0` are
 * part of their job and would double count). A job whose energy is empty or
 * zero contributes nothing; a job still running (`End` = `Unknown`) is left
 * out. Carbon is derived from a configured grid intensity, or omitted.
 *
 * ConsumedEnergyRaw is a job's real consumption only where nodes are allocated exclusively; a centre
 * that shares nodes between jobs should say so in its methodology document.
 *
 * The measurement method defaults to `hardware-estimated`: RAPL and IPMI
 * readings are counter- and sensor-based estimates attributed to jobs by the
 * plugin, not a meter at the wall. A centre with a metered PDU per node pool
 * may configure `hardware-metered` and should say so in its methodology.
 */
import { readFileSync } from "node:fs";
import { RawMetrics, ServiceQuery, SourceAdapter, TargetType } from "../types";
import { NotFoundError } from "../publisher";

export interface SlurmSacctConfig {
  /** `sacct --parsable2` text (a header in any column order, or none in the order JobID|Start|End|ConsumedEnergyRaw), or a file path. */
  text?: string;
  file?: string;
  provider: string;
  methodologyUri: string;
  /** The subject: the cluster or service name. */
  target?: string;
  targetType?: TargetType;
  /** gCO2e per kWh; when unset no carbon figure is published. */
  gridIntensity?: number;
  measurementMethod?: "hardware-estimated" | "hardware-metered";
  capabilities?: "basic" | "extended";
  /** Field separator of the export (`|` for --parsable2). */
  separator?: string;
}

export interface SacctJob {
  jobId: string;
  end: string;
  energyJoules: number;
}

/**
 * The top-level jobs of a `sacct --parsable2` export with their end time and energy. The export has a
 * header naming at least JobID, End and ConsumedEnergyRaw, in any column order, or no header and the fixed
 * order JobID|Start|End|ConsumedEnergyRaw. A header without one of those columns is a configuration error
 * (thrown, so the operator hears of it), never an empty result. Monthly exports may be concatenated: a job
 * that appears in two windows (it spans the boundary) is counted once, in the month it ended.
 */
export function parseSacct(text: string, separator = "|"): SacctJob[] {
  const jobs: SacctJob[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  let cols = { jobId: 0, end: 2, energy: 3 };
  for (const line of lines) {
    const f = line.split(separator).map((x) => x.trim());
    if (f.some((h) => /^JobID$/i.test(h))) {
      const idx = (n: string) => f.findIndex((h) => h.toLowerCase() === n.toLowerCase());
      cols = { jobId: idx("JobID"), end: idx("End"), energy: idx("ConsumedEnergyRaw") };
      const missing = Object.entries({ JobID: cols.jobId, End: cols.end, ConsumedEnergyRaw: cols.energy }).filter(([, i]) => i < 0).map(([n]) => n);
      if (missing.length) {
        throw new Error(`sacct export header lacks column(s) ${missing.join(", ")} (have: ${f.join(", ")}); export with --parsable2 --format=JobID,Start,End,ConsumedEnergyRaw (ConsumedEnergy carries a unit suffix and is not read)`);
      }
      continue;
    }
    const jobId = f[cols.jobId] ?? "";
    if (jobId === "" || jobId.includes(".")) continue; // a step (123.batch, 123.0), not a job; 123_4 and 123+1 are jobs
    const end = f[cols.end] ?? "";
    const energy = Number(f[cols.energy] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T/.test(end)) continue; // Unknown, None, or running
    if (!Number.isFinite(energy) || energy <= 0) continue;
    // Job ids wrap at MaxJobId, so the identity is the id together with its end time.
    const key = `${jobId}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ jobId, end, energyJoules: energy });
  }
  return jobs;
}

/** Joules per calendar month (key YYYY-MM), by job end time. */
export function energyByMonth(jobs: SacctJob[]): Map<string, number> {
  const months = new Map<string, number>();
  for (const j of jobs) {
    const month = j.end.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + j.energyJoules);
  }
  return new Map([...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** One declaration per month from a sacct export. */
export function slurmSacctAdapter(cfg: SlurmSacctConfig): SourceAdapter {
  const capabilities = cfg.capabilities ?? "extended";
  const entries = (): RawMetrics[] => {
    const text = cfg.text ?? readFileSync(cfg.file as string, "utf8");
    const months = energyByMonth(parseSacct(text, cfg.separator ?? "|"));
    return [...months.entries()].map(([month, joules]) => ({
      provider: cfg.provider,
      measurementMethod: cfg.measurementMethod ?? "hardware-estimated",
      methodologyUri: cfg.methodologyUri,
      reportingPeriod: month,
      capabilities,
      ...(cfg.target ? { target: cfg.target } : {}),
      ...(cfg.targetType ? { targetType: cfg.targetType } : {}),
      energyJoules: joules,
      ...(cfg.gridIntensity !== undefined ? { carbonIntensity: cfg.gridIntensity } : {}),
    }));
  };
  return {
    name: "slurm-sacct",
    capabilities,
    async fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]> {
      const all = entries();
      if (all.length === 0) throw new NotFoundError("no completed job with energy accounting");
      if (capabilities === "basic" || !query.period) return all[all.length - 1];
      const inside = all.filter((e) => e.reportingPeriod.startsWith(query.period as string));
      if (inside.length === 0) throw new NotFoundError();
      return inside;
    },
  };
}
