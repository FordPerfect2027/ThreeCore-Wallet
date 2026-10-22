import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = [
  "/src/token-identity-codec.js",
  "/src/token-catalog.js",
  "/src/token-identity-model.js",
  "/src/token-identity-reader.js",
  "/src/token-identity-report.js",
  "/src/token-identity-view.js",
  "/src/token-identity-controller.js",
  "/src/identity-overview.js",
  "/examples/token-identity-panel.js",
];
const testPaths = [
  "/test/browser/token-identity-ui-tests.js",
  "/test/browser/token-identity-demo/",
  "/test/browser/token-identity-demo.js",
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
  test("identity modules are available with correct media and no caching: " + uiTest, async () => {
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

  test("identity synthetic routes require test mode: " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of testPaths) {
        const response = await fetch(base + path);
        assert.equal(response.status, uiTest ? 200 : 404, path);
        const text = await response.text();
        if (uiTest && path.endsWith("/")) {
          assert.match(text, /すべて模擬データ/);
          assert.match(text, /実際の資産残高ではありません/);
        }
      }
    });
  });

  test("identity server does not expose local test inputs or CLI sources: " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of [
        "/test/helpers/identity-fixtures.js",
        "/test/token-identity-report.test.js",
        "/scripts/check-token-identity.js",
        "/wallet-identity-baseline-20261023",
        "/node_modules/",
        "/src/token-identity-codec.js/extra",
      ]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 404, path);
      }
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const response = await fetch(base + "/src/token-catalog.js", { method });
        assert.equal(response.status, 404, method);
      }
    });
  });
}

test("browser-facing identity modules have resolvable relative imports", async () => {
  await served(true, async base => {
    const pending = [...modules, ...testPaths.filter(path => path.endsWith(".js"))];
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop();
      if (visited.has(path)) continue;
      visited.add(path);
      assert.ok(visited.size < 100, "Unexpected import graph expansion");
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      const source = await response.text();
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        assert.ok(match[1].startsWith(".") || match[1].startsWith("/"), "Unbundled or remote import");
        const url = new URL(match[1], base + path);
        assert.equal(url.origin, base, "Remote import");
        pending.push(url.pathname);
      }
    }
    assert.ok(visited.has("/src/wallet-session.js"));
    assert.ok(visited.has("/src/provider-error.js"));
  });
});
