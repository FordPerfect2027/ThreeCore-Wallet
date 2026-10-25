import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

const assets = ["/src/rpc-capacity.js", "/src/rpc-supervisor.js", "/src/rpc-status.js",
  "/src/provider-events.js", "/src/provider-event-gate.js", "/examples/rpc-status-panel.js", "/src/state-notifier.js", "/src/security-callback.js"];

async function serving(uiTest, action) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
  function get(path, options = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path,
        method: options.method ?? "GET", headers: { Host: "127.0.0.1:" + port, ...options.headers } }, response => {
        let body = "";
        response.setEncoding("utf8"); response.on("data", value => { body += value; });
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
      });
      req.on("error", reject); req.end(options.body);
    });
  }
  try { await action(get, base); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  for (const asset of assets) {
    test("request supervisor asset is served with protections: " + uiTest + " " + asset, async () => {
      await serving(uiTest, async get => {
        const response = await get(asset);
        assert.equal(response.status, 200);
        assert.match(response.headers["content-type"], /javascript/);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["x-frame-options"], "DENY");
        assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
        assert.equal(response.headers["access-control-allow-origin"], undefined);
        assert.match(response.headers["content-security-policy"], /connect-src 'self';/);
        assert.match(response.headers["content-security-policy"], /script-src 'self';/);
      });
    });
  }

  test("supervisor assets are denied to foreign fetch contexts: " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const headers of [{ Host: "attacker.invalid" }, { Origin: "https://attacker.invalid" },
        { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
        for (const asset of assets) assert.equal((await get(asset, { headers })).status, 403);
      }
    });
  });

  test("request supervision exposes no server-side request, reset or diagnostics API: " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/api/rpc", "/api/rpc-status", "/api/rpc/reset", "/api/provider",
        "/api/approve", "/api/sign", "/api/send", "/.git/config",
        "/test/rpc-supervisor.test.js", "/test/helpers/rpc-supervisor-fixtures.js"]) {
        assert.equal((await get(path)).status, 404, path);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await get(assets[1], { method, body: '{"private":"synthetic payload"}' });
        assert.equal(response.status, 404);
        assert(!response.body.includes("synthetic payload"));
      }
    });
  });

  test("synthetic response-protection tests require explicit test mode: " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/test/browser/rpc-supervisor-ui-tests.js", "/test/browser/rpc-protection-demo/", "/test/browser/rpc-protection-demo.js"]) {
        const response = await get(path);
        assert.equal(response.status, uiTest ? 200 : 404);
      }
    });
  });

  test("response-protection import graph resolves locally: " + uiTest, async () => {
    await serving(uiTest, async (get, base) => {
      const todo = ["/examples/rpc-status-panel.js", "/src/provider-events.js"];
      const visited = new Set();
      while (todo.length) {
        const path = todo.pop();
        if (visited.has(path)) continue;
        visited.add(path);
        assert(visited.size <= assets.length + 1, "Unexpected supervisor dependency expansion");
        const response = await get(path);
        assert.equal(response.status, 200, path);
        for (const match of response.body.matchAll(/from\s+["']([^"']+)["']/g)) {
          const next = new URL(match[1], base + path);
          assert.equal(next.origin, base);
          todo.push(next.pathname);
        }
      }
      for (const asset of assets) assert(visited.has(asset), asset);
      assert(visited.has("/src/security-provider-error.js"));
    });
  });

  test("normal demo mounts aggregate status and session supervises provider calls: " + uiTest, async () => {
    await serving(uiTest, async get => {
      const demo = await get("/examples/wallet-demo.js");
      assert.match(demo.body, /mountRpcStatusPanel/);
      assert.match(demo.body, /supervisor: rpcSupervisor/);
      const wallet = await get("/src/wallet-session.js");
      assert.match(wallet.body, /this\.#rpcSupervisor\.start/);
      assert.match(wallet.body, /observeWalletProvider/);
      const controller = await get("/src/wallet-card-controller.js");
      assert.match(controller.body, /observeWalletProvider/);
      const css = await get("/examples/security.css");
      assert.match(css.body, /\.rpc-status-panel/);
      assert.match(css.body, /white-space:pre-wrap/);
    });
  });
}
