/** Shared fixtures: the clock, the parameters and the three-operator vector network. */
import { World, retirement, REGISTRY } from "../build/world.mjs";
import { KEY1, jwkOf } from "../build/keys.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { buildContext } from "../../lib/ledger.mjs";
import { withLimits } from "../../lib/limits.mjs";

export const T0 = "2026-05-02T00:10:00Z";
export const UPDATED = "2026-02-10T09:00:00Z";
export const NETWORK_HOST = "ledger.example";
export const REGISTRAR_X = jwkOf(KEY1).x;
export const SERIALS = "https://serials.example";

export const PARAMS = {
  "registrar-keys": [{ jwk: jwkOf(KEY1), status: "current" }],
  "retirement-registries": [REGISTRY, SERIALS],
  "reference-forms": [
    { registry: REGISTRY, rules: ["upper-case", "no-surrounding-space"] },
    { registry: SERIALS, rules: ["range-first-last"] },
  ],
  platform: { "hot-path": "Example permissioned ledger", access: "permissioned", mechanism: "proof-of-authority", n: 30, "p-watts": 500, o: 1.5 },
};
/** Every item of 7.6, for the example parameters file and the case that uses them all. */
export const EXAMPLE_PARAMS = {
  ...PARAMS,
  takeovers: [{ operator: "did:web:op-a.example", type: "EnergyAttested", ledger: "old-ledger.example", tip: "0".repeat(64) }],
  "registry-1x-digests": [{ operator: "did:web:op-b.example", sha256: "1".repeat(64) }],
  beneficiaries: [{ beneficiary: "Operator A Example Ltd", operator: "did:web:op-a.example" }],
  "void-requesters": ["did:web:op-a.example"],
  "scope2-basis-1x": "market-based",
};
export const PINS = { methodology: true, registrar: { [NETWORK_HOST]: [REGISTRAR_X] } };

/** A scenario skeleton for a world. */
export function scenario(name, w, extra = {}) {
  return { name, T: T0, excerpt: w.excerpt(), parameters: PARAMS, pins: PINS, ...extra };
}

export const OPS = ["a", "b", "c"];
export const monthIndex = (i) => addMonths(monthBound(2025, 1), i);
const DID = (n) => `did:web:op-${n}.example`;

/** Figures of operator j in month i (i = 0 is January 2025). Every number is invented. */
export const figs = (j, i) => ({
  kWh: 18000 + 1500 * j + 37.25 * i,
  s2: 330.25 + 20 * j + 0.5 * i,
  s3: 215 + 5 * j,
  s1: j === 1 && i === 5 ? 12.75 : undefined,
  loc: 347.5,
  nodes: 3 + j,
});

/**
 * Three operators a, b, c, active from 2024-12, events for months 0..count-1 (from January 2025),
 * one retirement of one tonne per operator-month. `skip(j, i, type)` omits an event; `tweak` edits figures.
 */
export function baseNetwork({ count = 15, skip = () => false, tweak = (f) => f, readAt = T0, withLocation = true, from = "2024-12-01T00:00:00Z", names = OPS } = {}) {
  const w = new World({ readAt });
  const ops = names.map((n) => w.operator(n, { from }));
  const H = new Map();
  for (let i = 0; i < count; i++) {
    const m = monthIndex(i);
    ops.forEach((op, j) => {
      const f = tweak(figs(j, i), j, i);
      if (!skip(j, i, "EnergyAttested")) H.set(`${j}|EnergyAttested|${i}`, w.energy(op, m, { kWh: f.kWh, nodes: f.nodes, method: j === 2 ? "cloud-billing" : "hardware-metered" }));
      if (!skip(j, i, "CarbonAttested")) {
        const ref = `RET-${names[j].toUpperCase()}-${m.slice(0, 4)}${m.slice(5, 7)}`;
        H.set(`${j}|CarbonAttested|${i}`, w.carbon(op, m, { s1: f.s1, s2: f.s2, s3: f.s3, loc: withLocation ? f.loc : undefined, retirements: [retirement(ref, 1000, { at: addDays(addMonths(m, 1), 1) })] }));
      }
    });
  }
  return { w, ops, H };
}

/** A verifier context over a world, for building declarations from the same ledger. */
export function ctxOf(w, extra = {}) {
  const c = buildContext({ excerpt: w.excerpt(), parameters: PARAMS, pins: PINS, ...extra });
  c.limits = withLimits();
  return c;
}
