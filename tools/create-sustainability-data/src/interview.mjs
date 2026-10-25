/**
 * The questions, in the order a sustainability officer has the answers to hand. `ask(question,
 * default)` returns the typed text, or the default for an empty line. Choices print the one-line
 * meaning of every token; a value outside the set is refused later, with the set named.
 */
import { HOSTS } from "./hosts.mjs";
import { FUNCTIONAL_UNIT_MEANINGS, METHOD_MEANINGS, TARGET_TYPE_MEANINGS, menu } from "./descriptions.mjs";

const PERIOD_HELP = "Period covered, completed: a year (2025), a month (2025-03) or a day (2025-03-14), or leave empty for last year. For a financial year use --first-day and --last-day";

export async function interview(ask, a, print = () => {}) {
  a.target = await ask("1/7 What are the figures about? (your host name, or the name of the organization)", a.target);
  print(`Kind of target:\n${menu(TARGET_TYPE_MEANINGS)}`);
  a["target-type"] = await ask("    Which kind?", a["target-type"] ?? "origin");
  a.provider = await ask("2/7 Who publishes them, and how to reach you? (a role address, not a person)", a.provider);
  a["methodology-uri"] = await ask("3/7 Page that says what is measured and what is estimated (https://... or /path)", a["methodology-uri"]);
  a.period = a["first-day"] || a["period-start"] ? a.period : await ask(`4/7 ${PERIOD_HELP}`, a.period ?? "");
  if (a.period) a.offset = await ask("    Offset of your accounting day (Z for UTC, or +02:00)", a.offset ?? "Z");
  a["energy-consumption"] = await ask("5/7 Energy for the period (a number; empty if you do not have it)", a["energy-consumption"] ?? "");
  if (a["energy-consumption"]) a["energy-unit"] = await ask("    Unit (Wh, kWh, MWh or GWh)", a["energy-unit"] ?? "kWh");
  a["carbon-footprint"] = await ask("6/7 Carbon for the period (a number; empty if you do not have it)", a["carbon-footprint"] ?? "");
  if (a["carbon-footprint"]) a["carbon-unit"] = await ask("    Unit (gCO2e, kgCO2e or tCO2e)", a["carbon-unit"] ?? "kgCO2e");
  a["disclosure-uri"] = await ask("7/7 Link to your report or disclosure page (optional)", a["disclosure-uri"] ?? "");
  print(`How were the figures obtained?\n${menu(METHOD_MEANINGS)}`);
  a["measurement-method"] = await ask("    Which token? (for a mix, the last one that applies in this list)", a["measurement-method"] ?? "third-party-modeled");
  if (a["sci-score"]) {
    print(`Unit of the score:\n${menu(FUNCTIONAL_UNIT_MEANINGS)}`);
    a["functional-unit"] = await ask("    Which unit?", a["functional-unit"]);
  }
  a.host = await ask(`Host (${HOSTS.join(" | ")})`, a.host);
  a.out = await ask("Output folder", a.out);
  a.key = await ask("Ed25519 private key file to sign with (empty: leave the file unsigned)", a.key ?? "");
  return a;
}
