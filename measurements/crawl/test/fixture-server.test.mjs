import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFixtureServer } from "./fixture-server.mjs";

let server;
before(async () => (server = await startFixtureServer()));
after(() => server.close());

test("an origin named like an Object property is an unknown origin (404), not a dispatch to that property", async () => {
  const get = server.portFor();
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const res = await get(`http://${name}/x`);
    assert.equal(res.status, 404, name);
  }
});
