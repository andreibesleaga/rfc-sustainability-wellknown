/**
 * Live-source management: adapters that talk to real upstreams, refreshed
 * daily, with an always-available deterministic fixture fallback.
 *
 * The contract every managed subject obeys:
 *
 *  - LIVE mode is attempted only when its prerequisites hold (e.g. an API key
 *    is configured). A live build that fails at BOOT falls back — loudly,
 *    recorded — to the fixture; the gateway never refuses to boot because
 *    someone else's API is down.
 *  - A failed REFRESH keeps the last good subject (live data from yesterday
 *    beats a fixture) and records the error for the index.
 *  - FIXTURE mode runs the very same adapter code against a recorded upstream
 *    response, so the demonstrated code path is identical; only the transport
 *    is replayed. The document's `provider` member says which mode produced it.
 *
 * Nothing here bypasses the publisher pipeline: every mode ends in
 * `subjectFromAdapter`, i.e. the published validation gate.
 */
import type { SourceAdapter, SustainabilityMetrics } from "sustainability-wellknown-publisher";
import { subjectFromAdapter, type Subject } from "./registry";

/** Dependencies injected into adapter builders (all overridable in tests). */
export interface LiveDeps {
  /**
   * Fetch used by live upstream calls; `null` disables live mode entirely
   * (deterministic runs — tests, CI — boot every demo from its fixture).
   */
  fetchImpl: typeof fetch | null;
  env: Record<string, string | undefined>;
  /** Injectable clock: reporting periods derive from it deterministically. */
  now: () => Date;
}

export interface LiveSpec {
  domain: string;
  target: string;
  targetType?: SustainabilityMetrics["target-type"];
  /**
   * Build the live adapter, or return null when prerequisites (an API key,
   * live fetching enabled) are missing. May do network I/O when the returned
   * adapter is later invoked. Absent entirely for replay-only subjects.
   */
  live?: (deps: LiveDeps) => Promise<SourceAdapter | null> | SourceAdapter | null;
  /** Deterministic replay adapter — always available, never does I/O. */
  fixture: (deps: LiveDeps) => SourceAdapter;
  /** `source` labels recorded on the Subject, by mode. */
  labelLive: string;
  labelFixture: string;
  /** Short upstream description for the index ("NESO Carbon Intensity API"). */
  upstream: string;
  /** Attribution line surfaced on the index for the upstream data license. */
  attribution: string;
}

export type LiveMode = "live" | "replay";

export interface ManagedSubject {
  spec: LiveSpec;
  subject: Subject;
  mode: LiveMode;
  /** ISO timestamp of the last successful (re)build. */
  refreshedAt: string;
  /** Last live failure, when the served subject predates the failed attempt. */
  upstreamError?: string;
}

/** Bound one upstream call; a hung API must not hold boot or refresh. */
const LIVE_BUILD_TIMEOUT_MS = 15_000;

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what}: timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Attempt the live build alone. Returns null when prerequisites are missing. */
async function tryLive(spec: LiveSpec, deps: LiveDeps): Promise<Subject | null> {
  if (!spec.live || deps.fetchImpl === null) return null;
  const adapter = await spec.live(deps);
  if (!adapter) return null;
  return withTimeout(
    subjectFromAdapter({
      domain: spec.domain,
      adapter,
      target: spec.target,
      targetType: spec.targetType,
      label: spec.labelLive,
    }),
    LIVE_BUILD_TIMEOUT_MS,
    `live:${spec.domain}`,
  );
}

async function buildFixture(spec: LiveSpec, deps: LiveDeps): Promise<Subject> {
  return subjectFromAdapter({
    domain: spec.domain,
    adapter: spec.fixture(deps),
    target: spec.target,
    targetType: spec.targetType,
    label: spec.labelFixture,
  });
}

export class LiveRegistry {
  readonly managed = new Map<string, ManagedSubject>();

  constructor(private readonly deps: LiveDeps) {}

  /** Build every spec (live where possible, fixture otherwise). Live failures never throw. */
  async init(specs: LiveSpec[]): Promise<void> {
    for (const spec of specs) {
      let subject: Subject | null = null;
      let mode: LiveMode = "replay";
      let upstreamError: string | undefined;
      try {
        subject = await tryLive(spec, this.deps);
        if (subject) mode = "live";
      } catch (err) {
        upstreamError = err instanceof Error ? err.message : String(err);
      }
      // A fixture failure is a bug in this repository, not an upstream event —
      // let it crash the boot exactly like a broken curated data file would.
      if (!subject) subject = await buildFixture(spec, this.deps);
      this.managed.set(spec.domain, {
        spec,
        subject,
        mode,
        refreshedAt: this.deps.now().toISOString(),
        upstreamError,
      });
    }
  }

  /**
   * Re-run every live-capable build. Success replaces the subject; a live
   * failure keeps the last good subject and records the error; prerequisites
   * disappearing (key removed) rebuilds the fixture. Returns the domains whose
   * served subject changed, so the caller can rebuild the index.
   */
  async refreshAll(): Promise<string[]> {
    const changed: string[] = [];
    for (const m of this.managed.values()) {
      if (!m.spec.live) continue;
      try {
        const liveSubject = await tryLive(m.spec, this.deps);
        if (liveSubject) {
          // Compare the documents themselves: a fresh upstream value changes
          // the body even when the period-derived Last-Modified does not.
          const isChange =
            m.mode !== "live" ||
            JSON.stringify(liveSubject.document) !== JSON.stringify(m.subject.document);
          m.subject = liveSubject;
          m.mode = "live";
          m.refreshedAt = this.deps.now().toISOString();
          m.upstreamError = undefined;
          if (isChange) changed.push(m.spec.domain);
        } else if (m.mode === "live") {
          // Prerequisites gone: fall back to the deterministic fixture.
          m.subject = await buildFixture(m.spec, this.deps);
          m.mode = "replay";
          m.refreshedAt = this.deps.now().toISOString();
          changed.push(m.spec.domain);
        }
      } catch (err) {
        m.upstreamError = err instanceof Error ? err.message : String(err);
      }
    }
    return changed;
  }
}
