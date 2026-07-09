"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertEnergy = convertEnergy;
exports.convertCarbon = convertCarbon;
const ENERGY_TO_WH = {
    Wh: 1,
    kWh: 1_000,
    MWh: 1_000_000,
    GWh: 1_000_000_000,
};
const CARBON_TO_G = {
    gCO2e: 1,
    kgCO2e: 1_000,
    mtCO2e: 1_000_000,
};
function convertEnergy(value, from, to) {
    return (value * ENERGY_TO_WH[from]) / ENERGY_TO_WH[to];
}
function convertCarbon(value, from, to) {
    return (value * CARBON_TO_G[from]) / CARBON_TO_G[to];
}
