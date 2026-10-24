import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["codec", "reader", "view", "file", "messages", "controller", "archive", "archive-file", "archive-controller"]
  .map(name => "/src/transfer-" + name + ".js").concat(["/examples/transfer-panel.js", "/examples/transfer-archive-panel.js"]);
const testPaths = ["/test/browser/transfer-demo/", "/test/browser/transfer-demo.js", "/test/browser/transfer-ui-tests.js", "/test/helpers/transfer-fixtures.js"];
async function served(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("transfer server: module routes are explicit and uncached " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of modules) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.ok((await response.text()).length > 100);
      }
    });
  });
  test("transfer server: synthetic fixtures are test-mode-only " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of testPaths) {
        const response = await fetch(base + path);
        assert.equal(response.status, uiTest ? 200 : 404, path);
        if (uiTest && path.endsWith("/")) assert.match(await response.text(), /すべて模擬データ/);
      }
    });
  });
  test("transfer server: no local source directory or mutation API exposed " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of ["/.git/config", "/.env", "/test/transfer-reader.test.js", "/scripts/check-transfer-file.js",
        "/src/transfer-codec.js/extra", "/src/", "/test/helpers/"]) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal((await fetch(base + modules[0], { method })).status, 404, method);
      }
    });
  });
}

test("transfer server: complete import graph resolves on localhost", async () => {
  await served(true, async base => {
    const pending = [...modules, ...testPaths.filter(path => path.endsWith(".js")), "/examples/wallet-demo.js"];
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop();
      if (visited.has(path)) continue;
      visited.add(path);
      assert.ok(visited.size < 181, "Unexpected dependency expansion"); // Six explicit file-boundary runtime and test modules added.
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const source = await response.text();
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const url = new URL(match[1], base + path);
        assert.equal(url.origin, base);
        pending.push(url.pathname);
      }
    }
    assert.ok(visited.has("/src/transfer-reader.js"));
    assert.ok(visited.has("/src/transfer-archive-file.js"));
    assert.ok(visited.has("/src/wallet-session.js"));
    for (const name of ["model", "engine", "file", "view", "export", "controller", "diagnostics"]) {
      assert.ok(visited.has("/src/report-set-" + name + ".js"), "Missing set dependency: " + name);
    }
    for (const name of ["model", "storage", "file", "query", "view", "controller", "sources", "continuity"]) {
      assert.ok(visited.has("/src/report-history-" + name + ".js"), "Missing history dependency: " + name);
    }
    for (const name of ["model", "engine", "file", "query", "view", "export", "controller", "comparison"]) {
      assert.ok(visited.has("/src/period-report-" + name + ".js"), "Missing report dependency: " + name);
    }
  });
});

test("transfer server: main demo includes real panel but no synthetic data script", async () => {
  await served(false, async base => {
    const html = await (await fetch(base)).text();
    assert.match(html, /\.transfer-panel/);
    assert.match(html, /送受信履歴/);
    assert.ok(!html.includes("transfer-demo.js"));
  });
});

test("transfer server: fixture page prohibits external network connections", async () => {
  await served(true, async base => {
    const html = await (await fetch(base + "/test/browser/transfer-demo/")).text();
    assert.ok(html.includes("connect-src 'none'"));
    assert.match(html, /実Wallet・資産・外部サービスへ接続せず/);
  });
});
