/** The command line: every option is `--name value`; a few names repeat or are switches. */

export const SWITCHES = ["help", "yes", "methodology-stub"];
export const REPEATED = ["upstream", "extension"];
export const VALUE_OPTIONS = [
  "out", "host", "target", "target-type", "provider", "methodology-uri", "disclosure-uri", "verifiable-attestation-uri",
  "period", "offset", "period-start", "period-end", "first-day", "last-day", "updated",
  "measurement-method", "energy-consumption", "energy-unit", "energy-kwh", "carbon-footprint", "carbon-unit", "carbon-kgco2e",
  "carbon-accounting", "scope-1", "scope-2", "scope-3", "renewable-energy", "sci-score", "functional-unit", "noise", "key",
];

export function parseArgs(args) {
  const o = { out: ".", host: "file" };
  for (const k of REPEATED) o[k] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a} (see --help)`);
    const k = a.slice(2);
    if (SWITCHES.includes(k)) { o[k] = true; continue; }
    if (!VALUE_OPTIONS.includes(k) && !REPEATED.includes(k)) throw new Error(`unknown option ${a} (see --help)`);
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    if (REPEATED.includes(k)) o[k].push(v); else o[k] = v;
  }
  return o;
}
