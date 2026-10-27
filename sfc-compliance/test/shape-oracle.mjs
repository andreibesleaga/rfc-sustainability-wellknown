/** Shape tests for the void act and the checkpoint, the two forms the checker does not shape-check itself; the schema tests compare them with the JSON schemas. */
import { isObject, isHex64, isDid, isHost, isInt, isInstant } from "../lib/forms.mjs";
import { collect, isSig } from "../lib/shapes.mjs";

export function voidShape(v) {
  const c = collect();
  c.need(isObject(v) && Object.keys(v).length === 3 && isInstant(v.commit) && isHex64(v.target) && isSig(v.sig), "void");
  return c.done();
}

export function checkpointShape(cp) {
  const c = collect();
  const allowed = ["network", "read-at", "chains", "registry-digest", "ledger-digest", "voids-digest", "sig"];
  const ok = isObject(cp) && Object.keys(cp).every((k) => allowed.includes(k)) && isHost(cp.network) && isInstant(cp["read-at"])
    && Array.isArray(cp.chains) && cp.chains.length <= 2000
    && cp.chains.every((x) => isObject(x) && isDid(x.operator) && (x.type === "EnergyAttested" || x.type === "CarbonAttested") && (x.tip === null || isHex64(x.tip)) && isInt(x.count, 0))
    && ["registry-digest", "ledger-digest", "voids-digest"].every((k) => cp[k] === undefined || isHex64(cp[k])) && isSig(cp.sig);
  c.need(ok, "checkpoint");
  return c.done();
}
