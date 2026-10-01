#!/usr/bin/env node
// Enter one month's average power for the gateway's own report, from the hosting
// platform's metrics, into data/_self-measured.json. Redeploy afterwards.
//
//   node scripts/self-watts.mjs 2026-09 --watts 2.4 --source "how it was obtained"
//   node scripts/self-watts.mjs 2026-09 --vcpu 0.02 --memory-gb 0.15 [--egress-gb 0.4] [--vcpu-allocated 1] [--pue 1.1]
//   node scripts/self-watts.mjs 2026-09 --vcpu-minutes 0.83 --memory-gb-minutes 1486.7 --egress-gb 0.01
//     (the totals in Railway's "Project Cost" view, accumulated per minute; divided by the month's
//      minutes, or by --minutes when the billing period is not exactly the month)
//
// Railway: project -> service -> Metrics, range = the month: read the AVERAGE of
// "CPU" (vCPU), "Memory" (GB) and, optionally, the total "Network egress" (GB).
//
// The second form uses the Cloud Carbon Footprint coefficients
// (https://www.cloudcarbonfootprint.org/docs/methodology):
//   compute  W = vCPU-allocated x (min + utilisation x (max - min)), GCP median min 0.71 W, max 4.26 W per vCPU
//            (utilisation = vCPU used / vCPU allocated; without --vcpu-allocated the used vCPU are taken
//             as fully used, i.e. W = vCPU used x 4.26)
//   memory   0.392 W per GB (0.000392 kWh per GB-hour)
//   network  0.001 kWh per GB of egress, spread over the month's hours
//   x PUE    1.1 (CCF's GCP figure) unless --pue is given
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "_self-measured.json");
const CCF = { minW: 0.71, maxW: 4.26, memWPerGB: 0.392, netKWhPerGB: 0.001, pue: 1.1 };

const die = (m) => { process.stderr.write(m + "\n"); process.exit(1); };
const [month, ...rest] = process.argv.slice(2);
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")) die("usage: node scripts/self-watts.mjs YYYY-MM (--watts W --source TEXT | --vcpu N --memory-gb N [--egress-gb N] [--vcpu-allocated N] [--pue N])");
const opt = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i], v = rest[i + 1];
  if (!k?.startsWith("--") || v === undefined) die(`bad argument near "${k}"`);
  opt[k.slice(2)] = k === "--source" ? v : Number(v);
  if (k !== "--source" && !(Number(v) >= 0)) die(`${k} must be a number >= 0`);
}
const [y, m] = month.split("-").map(Number);
const hours = (Date.UTC(y, m, 1) - Date.UTC(y, m - 1, 1)) / 3_600_000;

// Railway's "Project Cost" view gives totals accumulated per minute over the billing period
// (GB-minutes, vCPU-minutes). Turn them into averages over the month (or --minutes).
const minutes = opt.minutes ?? hours * 60;
if (opt["vcpu-minutes"] !== undefined) opt.vcpu = opt["vcpu-minutes"] / minutes;
if (opt["memory-gb-minutes"] !== undefined) opt["memory-gb"] = opt["memory-gb-minutes"] / minutes;
const fromTotals = opt["vcpu-minutes"] !== undefined || opt["memory-gb-minutes"] !== undefined;

let watts, source;
if (opt.watts !== undefined) {
  if (!opt.source) die("--watts needs --source (say where the figure came from)");
  watts = opt.watts; source = opt.source;
} else {
  if (opt.vcpu === undefined || opt["memory-gb"] === undefined) die("give --watts, or --vcpu and --memory-gb, or --vcpu-minutes and --memory-gb-minutes");
  const used = opt.vcpu, alloc = opt["vcpu-allocated"];
  if (alloc !== undefined && alloc < used) die("--vcpu-allocated is less than --vcpu");
  const compute = alloc === undefined ? used * CCF.maxW : alloc * (CCF.minW + (used / alloc) * (CCF.maxW - CCF.minW));
  const memory = opt["memory-gb"] * CCF.memWPerGB;
  const network = ((opt["egress-gb"] ?? 0) * CCF.netKWhPerGB * 1000) / hours;
  const pue = opt.pue ?? CCF.pue;
  watts = (compute + memory + network) * pue;
  source =
    (fromTotals
      ? `Railway usage for ${month}: ${opt["vcpu-minutes"]} vCPU-minutes and ${opt["memory-gb-minutes"]} GB-minutes over ${minutes} minutes, i.e. ` 
      : `Railway metrics for ${month}: `) +
    `average CPU ${Number(used.toPrecision(4))} vCPU` +
    (alloc !== undefined ? ` of ${alloc} allocated` : " (taken as fully used)") +
    `, average memory ${Number(opt["memory-gb"].toPrecision(4))} GB` +
    (opt["egress-gb"] !== undefined ? `, network egress ${opt["egress-gb"]} GB` : "") +
    `; converted with the Cloud Carbon Footprint coefficients (GCP median ${CCF.minW}-${CCF.maxW} W per vCPU, ` +
    `${CCF.memWPerGB} W per GB of memory, ${CCF.netKWhPerGB} kWh per GB of egress) and a PUE of ${pue}` +
    (opt.source ? `. ${opt.source}` : "");
}
watts = Number(watts.toFixed(4));
if (!(watts > 0)) die("the result is 0 W; check the inputs");

const doc = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { months: {} };
doc.months ??= {};
const before = doc.months[month];
doc.months[month] = { watts, source };
doc.months = Object.fromEntries(Object.entries(doc.months).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");
console.log(`${month}: ${watts} W average -> ${((watts * hours) / 1000).toFixed(4)} kWh over ${hours} h${before ? ` (was ${before.watts} W)` : ""}`);
console.log(`written to ${FILE}`);
console.log("then: run the gateway tests, commit data/_self-measured.json, and redeploy (railway up, or push).");
