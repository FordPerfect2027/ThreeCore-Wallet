import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
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

const paths = ["/test/browser/acceptance-fixture.js", "/test/browser/acceptance-ui-tests.js",
  "/test/browser/acceptance-demo.js", "/test/browser/acceptance-demo/"];
for (const path of paths) for (const enabled of [false, true]) {
  test(`acceptance route ${path} is isolated: uiTest=${enabled}`, async () => {
    await serving(enabled, async get => {
      const response = await get(path);
      assert.equal(response.status, enabled ? 200 : 404);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.equal(response.headers["x-frame-options"], "DENY");
    });
  });
}
test("acceptance fixtures never use an extension or an external network", async () => {
  await serving(true, async get => {
    for (const path of paths) {
      const response = await get(path);
      assert.doesNotMatch(response.text, /window\.ethereum|fetch\(|eth_sendTransaction|personal_sign/);
    }
    const html = await get(paths[3]);
    assert.match(html.text, /connect-src 'none'/);
    assert.match(html.text, /既存の保存データへアクセスしません/);
    const fixture = await get(paths[0]);
    assert.match(fixture.text, /threecore-test-acceptance-/);
    assert.match(fixture.text, /Only balanceOf is supported here/);
  });
});
for (const headers of [{ Origin: "https://outside.invalid" }, { "Sec-Fetch-Dest": "iframe" }]) {
  test(`acceptance demo refuses ${JSON.stringify(headers)}`, async () => {
    await serving(true, async get => assert.equal((await get(paths[3], { headers })).status, 403));
  });
}
