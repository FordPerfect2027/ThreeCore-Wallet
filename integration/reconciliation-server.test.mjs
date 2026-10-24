import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "engine", "file", "view", "query", "controller", "ledger"].map(name => "/src/reconciliation-" + name + ".js")
  .concat(["/examples/reconciliation-panel.js"]);
const fixtures = ["/test/browser/reconciliation-demo/", "/test/browser/reconciliation-demo.js",
  "/test/browser/reconciliation-ui-tests.js", "/test/helpers/reconciliation-fixtures.js"];

async function served(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("reconciliation server serves only explicitly allowed modules " + uiTest, () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const css = await fetch(base + "/examples/reconciliation.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /^text\/css/);
  }));

  test("reconciliation synthetic fixtures require test flag " + uiTest, () => served(uiTest, async base => {
    for (const path of fixtures) assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
  }));

  test("reconciliation server never exposes saved data or mutation endpoints " + uiTest, () => served(uiTest, async base => {
    for (const path of ["/ThreeCore-balance-reconciliation.json", "/.git/config", "/scripts/check-reconciliation.js", "/test/reconciliation-cli.test.js"]) {
      assert.equal((await fetch(base + path)).status, 404);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.equal((await fetch(base + modules[0], { method, body: "synthetic data" })).status, 404);
    }
  }));
}

test("reconciliation import graph resolves locally, with no CDN dependency", () => served(true, async base => {
  const pending = [...modules, ...fixtures.filter(path => path.endsWith(".js"))];
  const visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    assert.ok(visited.size < 179); // Six explicit file-boundary runtime and test modules added.
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const url = new URL(match[1], base + path);
      assert.equal(url.origin, base);
      pending.push(url.pathname);
    }
  }
  assert.ok(visited.has("/src/reconciliation-engine.js"));
  assert.ok(visited.has("/src/token-identity-model.js"));
  assert.ok(visited.has("/src/transfer-archive.js"));
}));

test("reconciliation preview is labeled synthetic and denies network requests", () => served(true, async base => {
  const html = await (await fetch(base + fixtures[0])).text();
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /すべて模擬データ/);
  const js = await (await fetch(base + fixtures[1])).text();
  assert.doesNotMatch(js, /window\.ethereum|eth_requestAccounts|eth_sendTransaction/);
  const main = await (await fetch(base + "/")).text();
  assert.match(main, /\/examples\/reconciliation\.css/);
}));
