/** Re-exports of the 2.0 primitives the tests use, plus two hex helpers. */
export { addMonths, canonicalize, figureOk, hashOf, parseDec, roundHalfEven, textHash, toText, unb64u } from "../src/adapters/sfc-ledger-2/primitives";
export const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
export const fromHexString = (h: string): Buffer => Buffer.from(h, "hex");
