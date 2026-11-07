import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = [
  "/src/allowance-targets.js", "/src/allowance-observation.js", "/src/allowance-reader.js",
  "/src/allowance-file.js", "/src/allowance-controller.js", "/src/allowance-view.js",
  "/src/allowance-overview.js", "/examples/allowance-panel.js",
  "/src/allowance-bundle.js", "/examples/allowance-bundle-panel.js",
];
const testPaths = [
  "/test/browser/allowance-bundle-ui-tests.js",
  "/test/browser/allowance-demo/", "/test/browser/allowance-demo.js", "/test/browser/allowance-ui-tests.js",
];
async function served(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
for (const uiTest of [false, true]) {
  test("allowance server: modules served without cache " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of modules) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert(response.headers.get("content-type").startsWith("text/javascript"));
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert((await response.text()).length > 100);
      }
    });
  });
  test("allowance server: synthetic routes gated by test mode " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of testPaths) {
        const response = await fetch(base + path);
        assert.equal(response.status, uiTest ? 200 : 404);
        if (uiTest && path.endsWith("/")) assert((await response.text()).includes("すべて模擬データ"));
      }
    });
  });
  test("allowance server: local files and mutation methods unavailable " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of [
        "/scripts/check-allowance-file.js", "/test/helpers/allowance-fixtures.js",
        "/test/allowance-controller.test.js", "/src/allowance-file.js/extra",
        "/wallet-allowance-baseline-20261023/", "/.git/config",
      ]) assert.equal((await fetch(base + path)).status, 404, path);
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        assert.equal((await fetch(base + modules[0], { method })).status, 404, method);
      }
    });
  });
}
test("allowance server: all browser imports resolve locally", async () => {
  await served(true, async base => {
    const pending = [...modules, ...testPaths.filter(path => path.endsWith(".js")), "/examples/wallet-demo.js"];
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop();
      if (visited.has(path)) continue;
      visited.add(path);
      // One additional local module provides connection guidance.
      assert(visited.size <= 195, "Unexpected dependency expansion"); // Proposal modules, historical codec and same-origin client.
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const source = await response.text();
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const url = new URL(match[1], base + path);
        assert.equal(url.origin, base, "Remote dependency");
        pending.push(url.pathname);
      }
    }
    assert(visited.has("/src/security-data.js"));
    assert(visited.has("/src/security-callback.js") && visited.has("/src/security-abort.js"));
    assert(visited.has("/src/wallet-session.js"));
    assert(visited.has("/src/wallet-connection-guidance.js"));
    assert(visited.has("/src/agent-read-proposal.js") && visited.has("/src/agent-read-policy-registry.js") && visited.has("/examples/agent-proposal-panel.js"));
    assert(visited.has("/src/allowance-reader.js"));
    assert(visited.has("/src/state-notifier.js"));
    for (const name of ["model", "storage", "file", "query", "view", "controller", "sources", "continuity"]) {
      assert(visited.has("/src/report-history-" + name + ".js"), "Missing history dependency: " + name);
    }
  });
});
test("allowance server: production page styles and module remain present", async () => {
  await served(false, async base => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const text = await page.text();
    const stylesheet = text.match(/<link\s+rel="stylesheet"\s+href="(\/examples\/wallet-demo\.css)"\s*>/);
    assert.ok(stylesheet, "Production page links the external wallet stylesheet");
    const css = await fetch(new URL(stylesheet[1], base));
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(css.headers.get("cache-control"), "no-store");
    assert.equal(css.headers.get("x-content-type-options"), "nosniff");
    assert((await css.text()).includes(".allowance-panel"));
    assert(text.includes("/examples/wallet-entry.js"));
    const entry = await (await fetch(base + "/examples/wallet-entry.js")).text();
    assert(entry.includes('from "./wallet-demo.js"'));
    assert(!text.includes("allowance-demo.js"));
  });
});
