#!/usr/bin/env node
/**
 * sfc-check: check a sustainability declaration against the SFC profile, version 2.0.
 * The work is in lib/; run `node sfc-check.mjs --help` for the options.
 * Exit status: 0 normally, 1 when a check FAILs, 2 on a usage error or an unexpected error.
 */
import { main } from "./lib/cli.mjs";

const io = { out: (text) => process.stdout.write(text), err: (text) => process.stderr.write(text) };
process.exitCode = await main(process.argv.slice(2), io);
