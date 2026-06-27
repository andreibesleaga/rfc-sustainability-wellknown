/**
 * Minimal ambient type declarations for `@tgwf/co2` (Green Web Foundation CO2.js).
 * The package ships no types; we declare only the surface this project uses.
 * Upstream: https://github.com/thegreenwebfoundation/co2.js (Apache-2.0).
 */
declare module "@tgwf/co2" {
  export interface Co2TraceVariables {
    bytes?: number;
    gridIntensity?: {
      device?: { value: number };
      dataCenter?: { value: number };
      network?: { value: number };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }
  export interface Co2Trace {
    co2: number;
    green: boolean;
    variables: Co2TraceVariables;
  }

  export class co2 {
    constructor(options?: { model?: "swd" | "1byte"; version?: number; rating?: boolean });
    perByte(bytes: number, green?: boolean): number;
    perVisit(bytes: number, green?: boolean): number;
    perByteTrace(bytes: number, green?: boolean, options?: unknown): Co2Trace;
    perVisitTrace(bytes: number, green?: boolean, options?: unknown): Co2Trace;
  }

  export const averageIntensity: { type: string; data: Record<string, number> };
  export const marginalIntensity: { type: string; data: Record<string, number> };

  export const hosting: {
    check(
      domain: string | string[],
      options?: { verbose?: boolean; userAgentIdentifier?: string },
    ): Promise<boolean | string[] | Record<string, unknown>>;
  };
}
