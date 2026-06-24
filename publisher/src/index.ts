/**
 * sustainability-wellknown-publisher
 *
 * A production gateway that serves a draft-conformant `/.well-known/sustainability`
 * document (draft-besleaga-green-sustainability-wellknown) from pluggable metric
 * sources. Pipeline: adapter → normalize → security safeguards → JTD validation
 * gate → cache → HTTP exposure.
 */
export * from "./types";
export * from "./normalize";
export * from "./security";
export * from "./validate";
export * from "./publisher";
export * from "./handler";
export * from "./server";
export * from "./adapters";
export { RESPONSE_JTD_SCHEMA } from "./schema";
export { expressSustainability } from "./middleware/express";
export { fastifySustainability } from "./middleware/fastify";
export type { FastifyPluginOptions } from "./middleware/fastify";
export { fromWire, lastFullMonth } from "./util";
