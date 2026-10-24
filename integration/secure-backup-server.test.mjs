import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";

async function serving(uiTest, action) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const send = (path, method = "GET", body = "", headers = {}) => new Promise((resolve, reject) => {
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
  test("ordinary entry point works with strict script CSP, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      const page = await send("/");
      assert.match(page.text, /<script type="module" src="\/examples\/wallet-entry.js"><\/script>/);
      assert.doesNotMatch(page.text, /<script[^>]*>\s*import\s/);
      assert.match(page.headers["content-security-policy"], /script-src 'self';/);
      assert.doesNotMatch(page.headers["content-security-policy"], /script-src[^;]*'unsafe-inline'/);
      const entry = await send("/examples/wallet-entry.js");
      assert.equal(entry.status, 200);
      assert.match(entry.text, /import \{ mountWalletDemo \} from "\.\/wallet-demo.js"/);
      assert.match(entry.text, /pagehide/);
      assert.match(entry.text, /pageshow/);
    });
  });
  test("encrypted backup assets are explicit local uncached modules, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      for (const file of ["/src/secure-backup-format.js", "/src/secure-backup-crypto.js",
        "/src/secure-backup-runner.js", "/src/secure-backup-controller.js", "/examples/secure-backup-panel.js"]) {
        const response = await send(file);
        assert.equal(response.status, 200, file);
        assert.match(response.headers["content-type"], /javascript/);
        assert.match(response.headers["cache-control"], /no-store/);
        assert.equal(response.headers["access-control-allow-origin"], undefined);
      }
      const css = await send("/examples/secure-backup.css");
      assert.equal(css.status, 200);
      assert.match(css.headers["content-type"], /text\/css/);
      const page = await send("/");
      assert(page.text.includes('/examples/secure-backup.css'));
    });
  });

  test("encrypted backup data and key endpoints do not exist, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      for (const path of ["/ThreeCore-workspace-encrypted.json", "/api/encrypt", "/api/decrypt",
        "/api/restore", "/api/password", "/backup.json", "/.env", "/.git/config",
        "/test/helpers/secure-backup-fixtures.js", "/test/secure-backup-crypto.test.js"]) {
        const response = await send(path);
        assert.equal(response.status, 404, path);
        assert(!response.text.includes("synthetic only eleven"));
      }
    });
  });

  test("server cannot receive an encrypted backup upload, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      const payload = '{"syntheticPassword":"never echo this"}';
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await send("/api/decrypt", method, payload);
        assert.equal(response.status, 404);
        assert(!response.text.includes(payload));
      }
    });
  });

  test("foreign origin cannot obtain backup modules, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      const response = await send("/src/secure-backup-crypto.js", "GET", "", { Origin: "https://example.invalid" });
      assert.equal(response.status, 403);
      assert(!response.text.includes("encryptWorkspaceBackup"));
    });
  });

  test("synthetic encrypted UI test route is opt-in, mode=" + uiTest, async () => {
    await serving(uiTest, async send => {
      const response = await send("/test/browser/secure-backup-ui-tests.js");
      assert.equal(response.status, uiTest ? 200 : 404);
      if (uiTest) {
        assert(response.text.includes("registerSecureBackupUITests"));
        const harness = await send("/test/browser/ui-tests.js");
        assert(harness.text.includes("registerSecureBackupUITests(test)"));
      }
    });
  });
}
