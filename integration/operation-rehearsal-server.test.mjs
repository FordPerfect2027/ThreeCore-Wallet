import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

async function served(run) {
  const server = createDemoServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test("rehearsal is reachable from the wallet and explicitly disconnects network access", () => served(async base => {
  const main = await (await fetch(base + "/")).text();
  assert.match(main, /href="\/rehearsal\/"/);
  const response = await fetch(base + "/rehearsal/");
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  assert.match(html, /connect-src 'none'/); assert.match(html, /すべて仮の記録/);
  assert.match(html, /損失の上限/); assert.match(html, /元本を含む/);
  assert.match(html, /src="\/examples\/operation-rehearsal-page.js"/);
}));
test("all module imports resolve from the explicit allowlist with safe content types", () => served(async base => {
  const pending = ["/examples/operation-rehearsal-page.js"], visited = new Set();
  while (pending.length) {
    const path = pending.pop(); if (visited.has(path)) continue; visited.add(path);
    assert.ok(visited.size < 30);
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /text\/javascript/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = new URL(match[1], base + path); assert.equal(target.origin, base);
      pending.push(target.pathname);
    }
  }
  assert.ok(visited.has("/src/security-data.js"));
  assert.ok(visited.has("/src/operation-rehearsal.js"));
  const css = await fetch(base + "/examples/operation-rehearsal.css");
  assert.match(css.headers.get("content-type"), /text\/css/);
}));
test("rehearsal exposes no files outside allowlist or writable endpoint", () => served(async base => {
  for (const path of ["/rehearsal/.env", "/rehearsal/record.json", "/.git/config",
    "/test/operation-rehearsal.test.js"]) assert.equal((await fetch(base + path)).status, 404);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    assert.equal((await fetch(base + "/rehearsal/", { method, body: "{}" })).status, 404);
  assert.equal((await fetch(base + "/rehearsal/", { headers: { origin: "https://other.example" } })).status, 403);
}));
