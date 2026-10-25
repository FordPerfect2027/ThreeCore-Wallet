import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "analytics", "file", "collection", "storage", "controller", "messages"]
  .map(name => "/src/transfer-vault-" + name + ".js").concat(["/examples/transfer-vault-panel.js"]);
const fixtures = ["/test/browser/transfer-vault-demo/", "/test/browser/transfer-vault-demo.js", "/test/browser/transfer-vault-ui-tests.js", "/test/helpers/vault-fixtures.js"];
async function served(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("vault server: explicit modules are uncached " + uiTest, async () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
  }));

  test("vault server: synthetic routes require test mode " + uiTest, async () => served(uiTest, async base => {
    for (const path of fixtures) {
      const response = await fetch(base + path);
      assert.equal(response.status, uiTest ? 200 : 404, path);
    }
  }));

  test("vault server: no saved records, file upload or database API is exposed " + uiTest, async () => served(uiTest, async base => {
    for (const path of ["/vault.json", "/ThreeCore-transfer-vault-collection.json", "/.git/config", "/scripts/check-transfer-vault.js", "/test/transfer-vault-cli.test.js", "/src/"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(base + modules[0], { method, body: "do not store" })).status, 404);
    }
  }));
}

test("vault server: complete imports stay local and resolve", async () => served(true, async base => {
  const pending = [...modules, ...fixtures.filter(path => path.endsWith(".js"))], visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    assert.ok(visited.size < 191); // Two explicit callback/abort runtime modules added.
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    const source = await response.text();
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const url = new URL(match[1], base + path);
      assert.equal(url.origin, base);
      pending.push(url.pathname);
    }
  }
  assert(visited.has("/src/security-callback.js") && visited.has("/src/security-abort.js"));
  assert.ok(visited.has("/src/checkpoint-storage.js"));
  assert.ok(visited.has("/src/transfer-archive.js"));
  assert.ok(visited.has("/src/transfer-vault-collection.js"));
}));

test("vault server: preview forbids network and uses a separate storage namespace", async () => served(true, async base => {
  const html = await (await fetch(base + fixtures[0])).text();
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /すべて模擬データ/);
  const script = await (await fetch(base + fixtures[1])).text();
  assert.match(script, /threecore-transfer-vault-preview-only-v1/);
  assert.ok(!script.includes("window.ethereum"));
}));
