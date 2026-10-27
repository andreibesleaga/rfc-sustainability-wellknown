/** The worked case: three operators, the twelve months of the evaluation window, one correction, one silent month, one retirement of 2 t split over two months, one rounding case. */
import { World, retirement } from "../build/world.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { T0, scenario, monthIndex, OPS } from "./base.mjs";

export function worked() {
  const w = new World({ readAt: T0 });
  const ops = OPS.map((n) => w.operator(n, { from: "2024-12-01T00:00:00Z" }));
  const at = (m, d = 1) => addDays(addMonths(m, 1), d);
  for (let i = 3; i < 15; i++) {          // April 2025 to March 2026
    const m = monthIndex(i);
    ops.forEach((op, j) => {
      let kWh = 20000 + 1500 * j + 37.25 * (i - 3);
      if (j === 2 && i === 14) kWh += 0.0005;                    // the rounding case: the total is a tie in the seventh decimal of MWh
      let h;
      if (!(j === 1 && i === 10)) h = w.energy(op, m, { kWh, nodes: 3 + j, method: j === 2 ? "cloud-billing" : "hardware-metered" });   // operator b is silent for energy in November 2025
      if (j === 0 && i === 7) w.energy(op, m, { kWh: kWh + 100 }, { supersedes: h, commit: "2025-09-12T09:00:00Z" });                      // a correction of August 2025
      const emissions = { s2: 330.25 + 20 * j + 0.5 * i, s3: 215 + 5 * j };
      if (j === 0 && i === 12) w.carbon(op, m, { s2: 900, s3: 400, retirements: [retirement("RET-WORKED-2T", 1500, { tonnes: 2, at: "2026-01-20T12:00:00Z" })] });          // 1 500 kg of a 2 t retirement in January
      else if (j === 0 && i === 13) w.carbon(op, m, { s2: 300, s3: 150, retirements: [retirement("RET-WORKED-2T", 500, { tonnes: 2, at: "2026-01-20T12:00:00Z" })] });      // and 500 kg in February
      else w.carbon(op, m, { ...emissions, retirements: [retirement(`RET-WORKED-${"ABC"[j]}${i}`, 1000, { at: at(m) })] });
    });
  }
  const period = { start: monthBound(2025, 4), end: monthBound(2026, 4) };
  return { id: "worked", scenarios: [scenario("worked", w, { derive: [{ period, cutoff: T0, level: "network", energyUnit: "MWh", carbonUnit: "tCO2e", consensus: "proof-of-authority" }], effectiveAt: T0 })] };
}
