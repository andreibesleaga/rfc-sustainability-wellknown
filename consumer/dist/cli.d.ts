/** Accepts an absolute http(s) origin; bare hostnames are promoted to https. */
export declare function normalizeOrigin(input: string): string | undefined;
/** Runs the CLI for the given argv (excluding `node script.js`); returns the process exit code. */
export declare function runCli(argv: string[]): Promise<number>;
