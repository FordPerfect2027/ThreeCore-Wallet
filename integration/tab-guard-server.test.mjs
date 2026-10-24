import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["/src/tab-guard-protocol.js", "/src/tab-guard-controller.js",
  "/src/tab-guard-transport.js", "/src/protection-batch.js", "/examples/tab-guard-panel.js"];
async function serving(uiTest, action) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    const call = request({ hostname: "127.0.0.1", port, path,
      method: options.method ?? "GET", headers: { Host: "127.0.0.1:" + port, ...options.headers } }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", text => { body += text; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    call.on("error", reject); call.end(options.body);
  });
  try { await action(get, "http://127.0.0.1:" + port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  for (const path of modules) {
    test("tab guard asset keeps server protections: " + uiTest + " " + path, async () => {
      await serving(uiTest, async get => {
        const result = await get(path);
        assert.equal(result.status, 200);
        assert.match(result.headers["content-type"], /javascript/);
        assert.equal(result.headers["cache-control"], "no-store");
        assert.equal(result.headers["x-content-type-options"], "nosniff");
        assert.equal(result.headers["x-frame-options"], "DENY");
        assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
        assert.equal(result.headers["access-control-allow-origin"], undefined);
        assert.match(result.headers["content-security-policy"], /script-src 'self';/);
        assert.match(result.headers["content-security-policy"], /connect-src 'self';/);
      });
    });
  }

  test("tab guard has no public send or resume endpoint: " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/api/stop", "/api/resume", "/api/tab-guard", "/api/receipt",
        "/threecore-wallet-stop-v1", "/.git/config", "/src/", "/test/tab-guard-workflow.test.js",
        "/test/helpers/tab-guard-fixtures.js", "/tab-guard-controller.js"]) {
        assert.equal((await get(path)).status, 404, path);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const result = await get(modules[0], { method, body: '{"kind":"resume","password":"fixture"}' });
        assert.equal(result.status, 404);
        assert(!result.body.includes("fixture"));
      }
    });
  });

  test("tab guard modules reject foreign fetch contexts: " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const headers of [{ Origin: "https://foreign.invalid" }, { Host: "foreign.invalid" },
        { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
        for (const path of modules) assert.equal((await get(path, { headers })).status, 403);
      }
    });
  });

  test("native tab guard test module is available only in explicit test mode: " + uiTest, async () => {
    await serving(uiTest, async get => {
      assert.equal((await get("/test/browser/tab-guard-ui-tests.js")).status, uiTest ? 200 : 404);
    });
  });

  test("protection imports resolve without external services: " + uiTest, async () => {
    await serving(uiTest, async (get, base) => {
      const queue = ["/examples/security-panel.js"], seen = new Set();
      while (queue.length) {
        const path = queue.pop();
        if (seen.has(path)) continue;
        seen.add(path);
        assert(seen.size <= 12, "Unexpected protection dependency expansion");
        const result = await get(path);
        assert.equal(result.status, 200, path);
        for (const match of result.body.matchAll(/from\s+["']([^"']+)["']/g)) {
          const dependency = new URL(match[1], base + path);
          assert.equal(dependency.origin, base);
          queue.push(dependency.pathname);
        }
      }
      for (const path of modules.filter(path => !path.includes("protection-batch"))) assert(seen.has(path));
    });
  });
}

test("normal demo imports the all-cleanups runner used by the stop handler", async () => {
  await serving(false, async get => {
    const page = await get("/examples/wallet-demo.js");
    assert.equal(page.status, 200);
    assert.match(page.body, /from "\.\.\/src\/protection-batch\.js"/);
    assert.match(page.body, /runProtectionBatch\(steps\)\.completed/);
  });
});
