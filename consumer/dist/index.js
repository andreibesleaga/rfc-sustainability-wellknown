"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConformanceChecks = exports.fetchDisclosure = exports.resolveDisclosureLinks = exports.aggregate = exports.flatten = exports.toNdjson = exports.toCsvRows = exports.convertCarbon = exports.convertEnergy = exports.withoutSentinels = exports.isNotReported = exports.SustainabilityClient = exports.WELL_KNOWN_PATH = exports.fetchSustainability = exports.ValidationError = exports.assertValid = exports.validateDocument = exports.RESPONSE_JTD_SCHEMA = void 0;
/**
 * sustainability-wellknown-consumer
 *
 * A reference client for `/.well-known/sustainability` (draft-besleaga-
 * sustainability-wellknown): fetch, validate, and transform. Complements
 * `sustainability-wellknown-publisher` (the reference producer).
 */
__exportStar(require("./types"), exports);
var schema_1 = require("./schema");
Object.defineProperty(exports, "RESPONSE_JTD_SCHEMA", { enumerable: true, get: function () { return schema_1.RESPONSE_JTD_SCHEMA; } });
var validate_1 = require("./validate");
Object.defineProperty(exports, "validateDocument", { enumerable: true, get: function () { return validate_1.validateDocument; } });
Object.defineProperty(exports, "assertValid", { enumerable: true, get: function () { return validate_1.assertValid; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return validate_1.ValidationError; } });
var fetch_1 = require("./fetch");
Object.defineProperty(exports, "fetchSustainability", { enumerable: true, get: function () { return fetch_1.fetchSustainability; } });
Object.defineProperty(exports, "WELL_KNOWN_PATH", { enumerable: true, get: function () { return fetch_1.WELL_KNOWN_PATH; } });
var client_1 = require("./client");
Object.defineProperty(exports, "SustainabilityClient", { enumerable: true, get: function () { return client_1.SustainabilityClient; } });
var sentinel_1 = require("./sentinel");
Object.defineProperty(exports, "isNotReported", { enumerable: true, get: function () { return sentinel_1.isNotReported; } });
Object.defineProperty(exports, "withoutSentinels", { enumerable: true, get: function () { return sentinel_1.withoutSentinels; } });
var units_1 = require("./units");
Object.defineProperty(exports, "convertEnergy", { enumerable: true, get: function () { return units_1.convertEnergy; } });
Object.defineProperty(exports, "convertCarbon", { enumerable: true, get: function () { return units_1.convertCarbon; } });
var transform_1 = require("./transform");
Object.defineProperty(exports, "toCsvRows", { enumerable: true, get: function () { return transform_1.toCsvRows; } });
Object.defineProperty(exports, "toNdjson", { enumerable: true, get: function () { return transform_1.toNdjson; } });
Object.defineProperty(exports, "flatten", { enumerable: true, get: function () { return transform_1.flatten; } });
Object.defineProperty(exports, "aggregate", { enumerable: true, get: function () { return transform_1.aggregate; } });
var disclosure_1 = require("./disclosure");
Object.defineProperty(exports, "resolveDisclosureLinks", { enumerable: true, get: function () { return disclosure_1.resolveDisclosureLinks; } });
Object.defineProperty(exports, "fetchDisclosure", { enumerable: true, get: function () { return disclosure_1.fetchDisclosure; } });
var conformance_1 = require("./conformance");
Object.defineProperty(exports, "runConformanceChecks", { enumerable: true, get: function () { return conformance_1.runConformanceChecks; } });
