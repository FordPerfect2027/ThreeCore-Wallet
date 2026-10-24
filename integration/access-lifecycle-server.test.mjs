import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS } from "../examples/security-http.js";

async function serving(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const get = (path, options = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: { Host: `127.0.0.1:${port}`, ...options.headers } }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
  try { await run(get); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const path of ["/src/wallet-read-scope.js", "/src/security-lock.js", "/examples/security-panel.js"]) {
  test(`access lifecycle runtime is served with all security headers: ${path}`, async () => {
    await serving(false, async get => {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], /text\/javascript/);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
      assert.equal(response.headers["set-cookie"], undefined);
      assert(!response.text.includes("PRIVATE KEY"));
    });
  });
}

for (const path of ["/test/browser/access-lifecycle-ui-tests.js", "/test/browser/access-lifecycle-demo/",
  "/test/browser/access-lifecycle-demo.js", "/test/browser/access-lifecycle-demo.css"]) {
  for (const enabled of [false, true]) {
    test(`synthetic access workflow ${path} only available with uiTest=${enabled}`, async () => {
      await serving(enabled, async get => {
        const response = await get(path);
        assert.equal(response.status, enabled ? 200 : 404);
        assert.equal(response.headers["cache-control"], "no-store");
        if (enabled && path.endsWith("/")) assert.match(response.headers["content-type"], /text\/html/);
        if (enabled && path.endsWith(".css")) assert.match(response.headers["content-type"], /text\/css/);
      });
    });
  }
}

for (const headers of [{ Origin: "https://outside.invalid" }, { Origin: "null" },
  { Host: "127.0.0.1.outside.invalid" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Dest": "iframe" }]) {
  test(`new read scope refuses foreign browser request ${JSON.stringify(headers)}`, async () => {
    await serving(true, async get => {
      const result = await get("/src/wallet-read-scope.js", { headers });
      assert.equal(result.status, 403);
      assert(!result.text.includes("createWalletReadScope"));
    });
  });
}

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test(`read scope server does not accept filesystem mutation through ${method}`, async () => {
    await serving(true, async get => {
      const result = await get("/src/wallet-read-scope.js", { method });
      assert.equal(result.status, 404);
      assert(!result.text.includes("createWalletReadScope"));
    });
  });
}

test("preview uses only synthetic sessions and declares the test-only boundary", async () => {
  await serving(true, async get => {
    const script = await get("/test/browser/access-lifecycle-demo.js");
    const html = await get("/test/browser/access-lifecycle-demo/");
    assert(!script.text.includes("window.ethereum"));
    assert(!script.text.includes("fetch("));
    assert(!script.text.includes("indexedDB"));
    assert.match(html.text, /実ウォレット・資金・保存済みの履歴にはアクセスしません/);
    assert.match(html.text, /lang="ja"/);
    assert.match(script.text, /createWalletCardController/);
    assert.match(script.text, /mountSecurityPanel/);
  });
});
