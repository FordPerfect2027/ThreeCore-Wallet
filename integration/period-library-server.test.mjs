import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "storage", "file", "query", "view", "controller"].map(name => "/src/period-library-" + name + ".js")
  .concat("/examples/period-library-panel.js");
const fixtures = ["/test/browser/period-library-demo/", "/test/browser/period-library-demo.js",
  "/test/browser/period-library-ui-tests.js", "/test/helpers/period-library-fixtures.js"];

async function served(uiTest, callback) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("library modules have explicit MIME and no caching: " + uiTest, () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const response = await fetch(base + "/examples/period-library.css");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
  }));

  test("library synthetic preview is gated by explicit test mode: " + uiTest, () => served(uiTest, async base => {
    for (const path of fixtures) assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
  }));

  test("library server cannot expose local backups or accept writes: " + uiTest, () => served(uiTest, async base => {
    for (const path of ["/ThreeCore-period-library.json", "/scripts/check-period-library.js",
      "/.git/config", "/test/period-library-controller.test.js", "/.env", "/package.json"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(base + modules[0], { method, body: "{}" })).status, 404);
    }
  }));
}

test("library preview imports resolve entirely to explicit local routes", () => served(true, async base => {
  const pending = [...modules, ...fixtures.filter(path => path.endsWith(".js"))], visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    assert.ok(visited.size < 140);
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const url = new URL(match[1], base + path);
      assert.equal(url.origin, base);
      pending.push(url.pathname);
    }
  }
  assert.ok(visited.has("/src/checkpoint-storage.js"));
  assert.ok(visited.has("/src/period-controller.js"));
  assert.ok(visited.has("/src/reconciliation-controller.js"));
}));

test("library preview labels synthetic data and disallows outside connections", () => served(true, async base => {
  const html = await (await fetch(base + fixtures[0])).text();
  assert.match(html, /すべて模擬データ/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /プレビュー専用/);
  const source = await (await fetch(base + fixtures[1])).text();
  assert.match(source, /threecore-demo-period-library-v1/);
  assert.doesNotMatch(source, /window\.ethereum|eth_requestAccounts|eth_sendTransaction|fetch\(/);
}));

test("main demo and browser harness load library styling and registration", () => served(true, async base => {
  for (const path of ["/", "/test/browser/"]) {
    const html = await (await fetch(base + path)).text();
    assert.match(html, /\/examples\/period-library\.css/);
  }
  const demo = await (await fetch(base + "/examples/wallet-demo.js")).text();
  assert.match(demo, /mountPeriodLibraryPanel/);
  assert.match(demo, /periodPanel\.getCheckpoint/);
  assert.match(demo, /periodLibrary\.dispose/);
  const tests = await (await fetch(base + "/test/browser/ui-tests.js")).text();
  assert.match(tests, /registerPeriodLibraryUITests\(test\)/);
}));
