#!/usr/bin/env node
/** Entry point: node crawl.mjs --help */
import { main } from "./src/cli.mjs";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`error: ${err.message}`);
    process.exit(2);
  },
);
