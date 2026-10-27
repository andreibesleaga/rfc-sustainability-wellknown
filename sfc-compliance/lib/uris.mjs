/** URIs taken from untrusted data (section 10): relative references, userinfo. Rows only for problems. */
import { isObject } from "./forms.mjs";
import { extOf, labelOf } from "./declaration.mjs";
import { row, NE, INFO } from "./rows.mjs";

const hasScheme = (u) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(u);
const userinfo = (u) => /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(u);

/** Check one URI-valued member; `base` is the retrieval URI or null. */
function check(member, value, scope, base, rows, { reference = true } = {}) {
  if (typeof value !== "string") return;
  if (!hasScheme(value)) {
    if (!reference) { rows.push(row("URI", NE, `not an absolute URI: ${member}`, scope)); return; }
    if (!base) { rows.push(row("URI", NE, `relative reference, no base: ${member}`, scope)); return; }
    rows.push(row("URI", INFO, `${member} resolved to ${new URL(value, base).href}`, scope));
    return;
  }
  if (userinfo(value)) rows.push(row("URI", NE, `userinfo in URI: ${member}`, scope));
}

export function declarationUriRows(objs, base) {
  const rows = [];
  for (const o of objs) {
    const scope = labelOf(o);
    for (const m of ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"]) check(m, o[m], scope, base, rows);
    check("ledger-access-uri", extOf(o, "ledger-evidence-2")?.["ledger-access-uri"], scope, base, rows, { reference: false });
    check("offset-registry-uri", extOf(o, "carbon-neutrality")?.["offset-registry-uri"], scope, base, rows, { reference: false });
    check("network-declaration", extOf(o, "network-topology")?.["network-declaration"], scope, base, rows, { reference: false });
    check("reuse-and-recycling-policy-uri", extOf(o, "hardware-lifecycle")?.["reuse-and-recycling-policy-uri"], scope, base, rows, { reference: false });
  }
  return rows;
}

/** `evidence` of a 2.0 event must be absolute; a retirement `registry` must carry no userinfo. */
export function eventUriRows(ctx) {
  const rows = [];
  for (const ev of ctx.events) {
    if (ev.kind !== "2x" || !isObject(ev.event?.payload)) continue;
    const scope = `${ev.event.subject} ${ev.event.type === "EnergyAttested" ? "Energy" : "Carbon"} ${ev.commit}`;
    const p = ev.event.payload;
    check("evidence", p.evidence, scope, null, rows, { reference: false });
    for (const r of Array.isArray(p.retirements) ? p.retirements : []) check("registry", r?.registry, scope, null, rows, { reference: false });
  }
  return rows;
}
