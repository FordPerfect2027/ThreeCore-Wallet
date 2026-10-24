import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

const assets = ["/src/export-policy.js", "/src/export-payload.js", "/src/export-guard.js",
  "/src/export-status.js", "/examples/export-resource.js", "/examples/export-download.js",
  "/examples/export-guard-panel.js"];

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
    test("export HTTP: protected static module " + uiTest + "/" + asset, async () => {
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
      });
    });
  }
  test("export HTTP: no download upload or status endpoint " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/api/export", "/api/export/status", "/api/export/retry", "/api/download",
        "/api/upload", "/.git/config", "/test/helpers/export-fixtures.js", "/test/export-payload.test.js"]) {
        assert.equal((await get(path)).status, 404, path);
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const result = await get(assets[2], { method, body: "synthetic private export" });
        assert.equal(result.status, 404);
        assert(!result.body.includes("private"));
      }
    });
  });
  test("export HTTP: foreign request context cannot load modules " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const headers of [{ Host: "attacker.invalid" }, { Origin: "https://attacker.invalid" },
        { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
        for (const asset of assets) assert.equal((await get(asset, { headers })).status, 403);
      }
    });
  });
  test("export HTTP: synthetic UI is available only in explicit test mode " + uiTest, async () => {
    await serving(uiTest, async get => {
      for (const path of ["/test/browser/export-guard-ui-tests.js", "/test/browser/export-guard-demo/",
        "/test/browser/export-guard-demo.js"]) {
        assert.equal((await get(path)).status, uiTest ? 200 : 404, path);
      }
    });
  });
  test("export HTTP: normal app wires shared budget into protection stop " + uiTest, async () => {
    await serving(uiTest, async get => {
      const demo = await get("/examples/wallet-demo.js");
      const stop = await get("/src/protection-batch.js");
      assert(demo.body.includes("exportGuard = getDocumentExportGuard(document)"));
      assert(demo.body.includes('name: "exports", run: () => exportGuard.clear()'));
      assert(stop.body.includes('["exports", "file-reads"'));
      assert(demo.body.includes("mountExportGuardPanel"));
      const css = await get("/examples/security.css");
      assert(css.body.includes(".export-guard-panel"));
    });
  });
}

test("export HTTP: twelve former URL allocation sites all resolve the same guard", async () => {
  const modules = ["history-files", "allowance-panel", "allowance-bundle-panel", "token-identity-panel",
    "transfer-panel", "transfer-vault-panel", "reconciliation-panel", "period-panel", "period-library-panel",
    "period-report-panel", "report-history-panel", "report-set-panel"];
  await serving(false, async get => {
    for (const name of modules) {
      const result = await get("/examples/" + name + ".js");
      assert.equal(result.status, 200, name);
      assert(result.body.includes('from "./export-download.js"'), name);
      assert(result.body.includes("return offerWalletDownload({ document, prepared:"), name);
      assert(!result.body.includes("createObjectURL"), name);
      assert(!result.body.includes("revokeObjectURL"), name);
    }
  });
});

test("export HTTP: all new module imports resolve locally without new network privileges", async () => {
  await serving(false, async (get, base) => {
    const visited = new Set(), pending = [assets[6], assets[5]];
    while (pending.length) {
      const path = pending.pop();
      if (visited.has(path)) continue;
      visited.add(path);
      assert(visited.size <= assets.length);
      const response = await get(path);
      assert.equal(response.status, 200, path);
      for (const match of response.body.matchAll(/from\s+["']([^"']+)["']/g)) {
        const next = new URL(match[1], base + path);
        assert.equal(next.origin, base);
        pending.push(next.pathname);
      }
    }
    assert.deepEqual([...visited].sort(), [...assets].sort());
  });
});
