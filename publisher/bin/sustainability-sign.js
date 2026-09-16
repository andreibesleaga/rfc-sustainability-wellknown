#!/usr/bin/env node
"use strict";
// Offline signing tool for static hosts: signs a declaration file in place of
// a served publisher (draft, Appendix A, step 7).
//   sustainability-sign <in.json> <out.json> --key <private.jwk> [--kid <id>]
const { runSign } = require("../dist/cli");

runSign(process.argv.slice(2)).catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
