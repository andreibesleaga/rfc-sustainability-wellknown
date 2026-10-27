/** Hand-written network objects for the checks that read a declaration alone. */
import { EXT } from "../../lib/declaration.mjs";
import { signDeclaration } from "../build/declare.mjs";

// ---- stub declarations for the tolerance rule ------------------------------------------------

export const ENTRY = (n, o = {}) => ({ operator: `did:web:op-${n}.example`, origin: `node.op-${n}.example`, "energy-head": null, "carbon-head": null, "energy-events": 0, "carbon-events": 0, kwh: 0, "scope1-kgco2e": 0, "scope2-kgco2e": 0, "scope3-kgco2e": 0, "offsets-kgco2e": 0, "offset-coverage-every-period": true, ...o });
/** A network object with the members S6 reads; `top` overrides, `entries` fill ledger-evidence-2, `evidence` false drops it. */
export function stub(target, { entries, top = {}, evidence = true, status = "achieved" }) {
  const o = {
    updated: "2026-02-10T09:00:00Z", capabilities: "basic", provider: "SYNTHETIC EXAMPLE, not a real network. Role contact: sustainability@tolerance.example.",
    "measurement-method": "hardware-metered", "methodology-uri": "https://tolerance.example/methodology.md",
    period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" }, target, "target-type": "service",
    "energy-unit": "kWh", "carbon-unit": "tCO2e", "carbon-accounting": "market-based", "disclosure-uri": "https://tolerance.example/disclosures.json",
    ...top,
    extensions: {
      [`${EXT}carbon-neutrality`]: { "net-zero-status": status },
      [`${EXT}network-topology`]: { "consensus-mechanism": "proof-of-authority", "validated-node-count": 3, "node-count-validation-method": "synthetic" },
      ...(evidence ? { [`${EXT}ledger-evidence-2`]: { "profile-version": "2.0", "ledger-access-uri": "https://tolerance.example/read", operators: entries, "network-offset-coverage": entries.every((e) => e["offset-coverage-every-period"]) } } : {}),
    },
  };
  if (!evidence) o.extensions[`${EXT}hardware-lifecycle`] = { "general-purpose-hardware": true, "single-use-asic-required": false };
  return o;
}
export const sign = (o) => signDeclaration(o);

