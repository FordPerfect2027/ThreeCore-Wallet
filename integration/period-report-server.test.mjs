import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "engine", "file", "query", "view", "export", "controller", "comparison"]
  .map(name => "/src/period-report-" + name + ".js").concat("/examples/period-report-panel.js");
const fixtures = ["/test/browser/period-report-demo/", "/test/browser/period-report-demo.js",
  "/test/browser/period-report-ui-tests.js", "/test/helpers/period-report-fixtures.js"];
async function served(uiTest, callback) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("report local modules have correct headers: " + uiTest, () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const css = await fetch(base + "/examples/period-report.css");
    assert.equal(css.status, 200); assert.match(css.headers.get("content-type"), /^text\/css/);
  }));

  test("report fixtures require explicit UI-test mode: " + uiTest, () => served(uiTest, async base => {
    for (const path of fixtures) assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
  }));

  test("report server refuses writes and private file paths: " + uiTest, () => served(uiTest, async base => {
    for (const path of ["/.git/config", "/ThreeCore-period-report.json", "/ThreeCore-period-report.html",
      "/.env", "/scripts/check-period-report.js", "/test/period-report-cli.test.js"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(base + modules[0], { method, body: "{}" })).status, 404);
    }
  }));
}

test("report preview has a complete local import graph", () => served(true, async base => {
  const queue = [...modules, ...fixtures.filter(path => path.endsWith(".js"))], seen = new Set();
  while (queue.length) {
    const path = queue.pop(); if (seen.has(path)) continue; seen.add(path);
    assert.ok(seen.size < 140);
    const response = await fetch(base + path); assert.equal(response.status, 200, path);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const url = new URL(match[1], base + path); assert.equal(url.origin, base); queue.push(url.pathname);
    }
  }
  assert.ok(seen.has("/src/reconciliation-engine.js"));
  assert.ok(seen.has("/src/checkpoint-storage.js"));
}));

test("report preview clearly labels synthetic data and restricts connections", () => served(true, async base => {
  const html = await (await fetch(base + fixtures[0])).text();
  assert.match(html, /すべて模擬データ/);
  assert.match(html, /プレビュー専用/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  const source = await (await fetch(base + fixtures[1])).text();
  assert.match(source, /threecore-demo-period-report-v1/);
  assert.doesNotMatch(source, /window\.ethereum|eth_requestAccounts|eth_sendTransaction|fetch\(/);
}));

test("report is integrated into main demo lifecycle and browser harness", () => served(true, async base => {
  for (const path of ["/", "/test/browser/"]) {
    const html = await (await fetch(base + path)).text(); assert.match(html, /period-report\.css/);
  }
  const source = await (await fetch(base + "/examples/wallet-demo.js")).text();
  assert.match(source, /mountPeriodReportPanel/); assert.match(source, /periodReport\.dispose/);
  const harness = await (await fetch(base + "/test/browser/ui-tests.js")).text();
  assert.match(harness, /registerPeriodReportUITests\(test\)/);
}));
