/**
 * The closed token sets of the draft that this tool reads or writes. Each list
 * is in the order of the draft's CDDL; test/tokens.test.mjs compares them with
 * publisher/src/tokens.ts, so a change of the draft cannot pass unnoticed.
 * The tool has no dependencies, which is why the lists are written out here.
 */

/** From the most to the least direct (draft, Mandatory Members). */
export const MEASUREMENT_METHODS = ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"];

/**
 * The methods this tool writes. Never `hardware-metered`: nothing in a report's text shows that
 * every figure behind the declaration was read from a meter, and a declaration that combines
 * methods carries the least direct token. An operator who holds meter readings or utility bills
 * for the whole declaration can publish it with create-sustainability-data.
 */
export const ALLOWED_METHODS = MEASUREMENT_METHODS.filter((m) => m !== "hardware-metered");

export const ENERGY_UNITS = ["Wh", "kWh", "MWh", "GWh"];
export const CARBON_UNITS = ["gCO2e", "kgCO2e", "tCO2e"];
export const CARBON_ACCOUNTING = ["location-based", "market-based"];

export const TARGET_TYPES = [
  "origin", "path", "organization", "facility", "service", "product", "device", "tenant", "data-source",
];

/** The spelling of the metric tonne in earlier revisions of the draft; the number is unchanged. */
export const LEGACY_CARBON_UNIT = "mtCO2e";
