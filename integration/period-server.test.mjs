import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["plan", "draft", "reader", "file", "view", "controller", "recovery", "progress"].map(name => "/src/period-" + name + ".js")
  .concat(["/examples/period-panel.js"]);
const fixtures = ["/test/browser/period-demo/", "/test/browser/period-demo.js",
  "/test/browser/period-ui-tests.js", "/test/helpers/period-fixtures.js"];

async function served(uiTest, callback) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("period modules are served with explicit safe MIME and no caching: " + uiTest, () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const response = await fetch(base + "/examples/period.css");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
  }));

  test("period synthetic fixtures require explicit test mode: " + uiTest, () => served(uiTest, async base => {
    for (const path of fixtures) assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
  }));

  test("period server never serves downloaded data, scripts or repository metadata: " + uiTest, () => served(uiTest, async base => {
    for (const path of ["/ThreeCore-period-DAT.json", "/.git/config", "/scripts/check-period.js",
      "/test/period-provider.test.js", "/test/helpers/period-provider.js", "/.env"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.equal((await fetch(base + modules[0], { method, body: "synthetic" })).status, 404);
    }
  }));
}

test("period preview and browser suite import graph resolves without external packages", () => served(true, async base => {
  const pending = [...modules, ...fixtures.filter(path => path.endsWith(".js"))];
  const visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    assert.ok(visited.size < 161); // Six explicit encrypted-library modules added.
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const url = new URL(match[1], base + path);
      assert.equal(url.origin, base);
      pending.push(url.pathname);
    }
  }
  assert.ok(visited.has("/src/token-identity-reader.js"));
  assert.ok(visited.has("/src/transfer-reader.js"));
  assert.ok(visited.has("/src/reconciliation-controller.js"));
}));

test("period test preview has conspicuous synthetic labeling and disallows network connections", () => served(true, async base => {
  const html = await (await fetch(base + fixtures[0])).text();
  assert.match(html, /すべて模擬データ/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  const js = await (await fetch(base + fixtures[1])).text();
  assert.doesNotMatch(js, /window\.ethereum|eth_requestAccounts|eth_sendTransaction|fetch\(/);
  assert.match(js, /periodSession/);
}));

test("main wallet and browser harness include period stylesheet and module integration", () => served(true, async base => {
  for (const path of ["/", "/test/browser/"]) {
    const html = await (await fetch(base + path)).text();
    assert.match(html, /\/examples\/period\.css/);
  }
  const demo = await (await fetch(base + "/examples/wallet-demo.js")).text();
  assert.match(demo, /mountPeriodPanel/);
  assert.match(demo, /readPeriod/);
  assert.match(demo, /stageCollected/);
  const suite = await (await fetch(base + "/test/browser/ui-tests.js")).text();
  assert.match(suite, /registerPeriodUITests\(test\)/);
}));
