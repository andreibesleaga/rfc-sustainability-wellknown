#!/usr/bin/env node
"use strict";
// Thin launcher: delegates to the compiled CLI in dist/.
const { runCli } = require("../dist/cli");

runCli(process.argv.slice(2)).catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
