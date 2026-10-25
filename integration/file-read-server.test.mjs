import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

const assets = ["/src/file-read-policy.js", "/src/file-read-source.js", "/src/file-read-service.js",
  "/src/file-read-status.js", "/src/security-file.js", "/examples/file-read-panel.js", "/src/state-notifier.js", "/src/security-callback.js", "/src/security-abort.js"];
const fixtures = ["/test/browser/file-read-ui-tests.js", "/test/browser/file-boundary-demo/",
  "/test/browser/file-boundary-demo.js"];

async function serving(uiTest, action) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    // Each rejected request is independent: do not reuse a socket closed by
    // the server before its rejected request body has been consumed.
    const payloadHeaders = options.body === undefined ? {} :
      { "Content-Length": Buffer.byteLength(options.body) };
    const req = request({ hostname: "127.0.0.1", port, path, agent: false,
      method: options.method ?? "GET",
      headers: { Host: "127.0.0.1:" + port, ...payloadHeaders, ...options.headers } }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", value => { body += value; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
  try { await action(get, base); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  for (const asset of assets) {
    test(`file boundary HTTP: guarded static module ${uiTest}/${asset}`, async () => {
      await serving(uiTest, async get => {
        const result = await get(asset);
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

  test("file boundary HTTP: no read, upload, filesystem or status endpoint " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/api/file", "/api/files", "/api/file-read", "/api/file-read/status",
        "/api/upload", "/api/download", "/api/filesystem", "/api/file-read/reset",
        "/.git/config", "/test/file-read-options.test.js", "/test/helpers/file-boundary-fixtures.js"]) {
        const response = await get(path);
        assert.equal(response.status, 404, path);
      }
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const response = await get(assets[2], { method, body: "synthetic private file content" });
        assert.equal(response.status, 404);
        assert(!response.body.includes("private"));
      }
    });
  });

  test("file boundary HTTP: foreign fetch and frame contexts cannot load modules " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const headers of [{ Host: "attacker.invalid" }, { Origin: "https://attacker.invalid" },
        { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
        for (const asset of assets) assert.equal((await get(asset, { headers })).status, 403);
      }
    });
  });

  test("file boundary HTTP: synthetic harness requires explicit test mode " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of fixtures) assert.equal((await get(path)).status, uiTest ? 200 : 404, path);
    });
  });

  test("file boundary HTTP: all new imports resolve within local allowlist " + uiTest, async () => {
    await serving(uiTest, async (get, base) => {
      const pending = ["/examples/file-read-panel.js", "/src/security-file.js"];
      const visited = new Set();
      while (pending.length) {
        const path = pending.pop();
        if (visited.has(path)) continue;
        visited.add(path);
        assert(visited.size <= assets.length);
        const result = await get(path);
        assert.equal(result.status, 200, path);
        for (const match of result.body.matchAll(/from\s+["']([^"']+)["']/g)) {
          const next = new URL(match[1], base + path);
          assert.equal(next.origin, base);
          pending.push(next.pathname);
        }
      }
      assert.deepEqual([...visited].sort(), [...assets].sort());
    });
  });

  test("file boundary HTTP: main screen wires file cancellation into ordered protection " + uiTest, async () => {
    await serving(uiTest, async get => {
      const demo = await get("/examples/wallet-demo.js");
      const protection = await get("/src/protection-batch.js");
      const css = await get("/examples/security.css");
      assert.match(demo.body, /mountFileReadPanel/);
      assert.match(demo.body, /name: "file-reads", run: \(\) => fileReadService.cancelAll\(\)/);
      assert.match(protection.body, /\["storage", "exports", "file-reads", "backup", "period", "DAT", "EMA", "CAWELON"\]/);
      assert.match(css.body, /\.file-read-panel/);
      assert.match(css.body, /overflow-wrap: anywhere/);
    });
  });
}

test("file boundary HTTP: every migrated entry module resolves guarded byte/text readers", async () => {
  await serving(false, async get => {
    const expected = {
      "allowance-file": "readFormatFileBytes", "allowance-bundle": "readFormatFileBytes",
      "token-identity-report": "readFormatFileBytes", "transfer-archive-file": "readFormatFileText",
      "transfer-vault-collection": "readFormatFileText", "wallet-setup-file": "readSecurityFileBytes",
      "workspace-file": "readSecurityFileBytes", "checkpoint-transfer": "readSecurityFileBytes",
    };
    for (const [name, symbol] of Object.entries(expected)) {
      const module = await get("/src/" + name + ".js");
      assert.equal(module.status, 200, name);
      assert(module.body.includes(symbol), name);
      assert(!module.body.includes("await file.arrayBuffer()"), name);
    }
    const history = await get("/examples/history-files.js");
    assert.equal(history.status, 200);
    assert(history.body.includes("readSecurityFileBytes"));
    assert(!history.body.includes("await file.arrayBuffer()"));
  });
});
