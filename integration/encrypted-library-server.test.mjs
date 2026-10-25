import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

const assets = [
  "/src/encrypted-library-model.js", "/src/encrypted-library-storage.js",
  "/src/encrypted-library-controller.js", "/src/encrypted-library-archive.js",
  "/examples/encrypted-library-panel.js",
];
async function serving(uiTest, action) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const send = (path, { method = "GET", headers = {}, body = "" } = {}) =>
    new Promise((resolve, reject) => {
      const call = request({ hostname: "127.0.0.1", port, path, method,
        headers: { Host: "127.0.0.1:" + port, ...headers } }, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
      });
      call.on("error", reject);
      call.end(body);
    });
  try { await action(send); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  for (const asset of assets) {
    test("library module is same-origin, uncached and protected: " + uiTest + " " + asset, async () => {
      await serving(uiTest, async send => {
        const result = await send(asset);
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
  test("no server route can read stored archives or accept credentials: " + uiTest, async () => {
    await serving(uiTest, async send => {
      for (const path of ["/api/library", "/api/library/export", "/api/library/import", "/api/password",
        "/ThreeCore-encrypted-library.json", "/threecore-encrypted-backups-v1", "/.git/config",
        "/scripts/check-encrypted-library.js", "/test/helpers/encrypted-library-fixtures.js"]) {
        assert.equal((await send(path)).status, uiTest && path === "/test/helpers/encrypted-library-fixtures.js" ? 200 : 404, path);
      }
      for (const method of ["POST", "PUT", "DELETE"]) {
        const result = await send("/", { method, body: '{"passphrase":"synthetic secret"}' });
        assert.equal(result.status, 404);
        assert(!result.text.includes("synthetic secret"));
      }
    });
  });
  test("new assets refuse foreign origins and framing: " + uiTest, async () => {
    await serving(uiTest, async send => {
      for (const headers of [{ Origin: "https://foreign.invalid" }, { Host: "foreign.invalid" },
        { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
        assert.equal((await send(assets[0], { headers })).status, 403);
      }
    });
  });
  test("native library test page exists only in explicit UI test mode: " + uiTest, async () => {
    await serving(uiTest, async send => {
      const result = await send("/test/browser/encrypted-library-ui-tests.js");
      assert.equal(result.status, uiTest ? 200 : 404);
    });
  });
}
