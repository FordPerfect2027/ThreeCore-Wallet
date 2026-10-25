import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS } from "../examples/security-http.js";

async function serving(run, uiTest = false) {
  const server = createDemoServer({ uiTest });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const send = (path, headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: "127.0.0.1:" + port, ...headers } }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
  try { await run({ send, port }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const production = ["/src/security-callback.js", "/src/security-abort.js", "/src/secure-deadline.js", "/src/secure-backup-status.js",
  "/src/secure-backup-runner.js", "/src/secure-backup-controller.js",
  "/examples/secure-operation-panel.js", "/examples/secure-backup-panel.js", "/examples/workspace-panel.js"];
const fixtures = ["/test/browser/restore-confirmation-ui-tests.js", "/test/helpers/history-fixtures.js", "/test/browser/storage-receipt-ui-tests.js", "/test/helpers/export-receipt-fixtures.js", "/test/helpers/encrypted-library-fixtures.js", "/test/helpers/checkpoint-fixtures.js", "/test/helpers/workspace-fixtures.js", "/test/browser/adapter-boundary-ui-tests.js", "/test/browser/secure-lifecycle-fixture.js", "/test/browser/secure-lifecycle-ui-tests.js",
  "/test/helpers/secure-lifecycle-time.js", "/test/browser/secure-lifecycle-demo/",
  "/test/browser/secure-lifecycle-demo.js", "/test/browser/secure-lifecycle-demo.css"];

for (const path of production) {
  test("lifecycle module is available under production CSP: " + path, async () => {
    await serving(async ({ send }) => {
      const response = await send(path);
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], /text\/javascript/);
      assert(response.text.length > 10);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
      assert.equal(response.headers["set-cookie"], undefined);
    });
  });
}
for (const path of fixtures) {
  for (const uiTest of [false, true]) {
    test("synthetic lifecycle fixture route " + path + " test=" + uiTest, async () => {
      await serving(async ({ send }) => {
        const response = await send(path);
        assert.equal(response.status, uiTest ? 200 : 404);
        assert.equal(response.headers["cache-control"], "no-store");
        if (!uiTest) assert(!response.text.includes("synthetic"));
      }, uiTest);
    });
  }
}

for (const headers of [
  { Origin: "https://foreign.invalid" },
  { Host: "127.0.0.1.attacker.invalid" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Dest": "iframe" },
  { Origin: "null" },
]) {
  test("new lifecycle routes reject foreign request context " + JSON.stringify(headers), async () => {
    await serving(async ({ send }) => {
      for (const path of production) {
        const response = await send(path, headers);
        assert.equal(response.status, 403);
        assert(!response.text.includes("export function"));
      }
    });
  });
}

for (const path of ["/src/secure-deadline.js", "/examples/secure-operation-panel.js"]) {
  test("lifecycle routes accept no write method: " + path, async () => {
    await serving(async ({ send }) => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal((await send(path, {}, method )).status, 404);
      }
    });
  });
}

test("all transitive relative imports of the backup UI remain available", async () => {
  await serving(async ({ send }) => {
    const queue = ["/examples/secure-backup-panel.js"];
    const seen = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      assert(seen.size < 150, "module graph bounded");
      const response = await send(path);
      assert.equal(response.status, 200, path);
      for (const match of response.text.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const next = new URL(match[1], "http://localhost" + path).pathname;
        assert(next.startsWith("/src/") || next.startsWith("/examples/"));
        queue.push(next);
      }
    }
    assert(seen.has("/src/secure-deadline.js"));
    assert(seen.has("/src/secure-backup-status.js"));
    assert(![...seen].some(path => path.startsWith("/test/")));
  });
});

test("lifecycle additions do not expose evidence or repository files", async () => {
  await serving(async ({ send }) => {
    for (const path of ["/.git/config", "/../wallet-backup-lifecycle-verification-20261025/before-development.bundle",
      "/docs/SECURE_BACKUP_LIFECYCLE_2026-10-25.md", "/test/secure-backup-native-lifecycle.test.js"]) {
      const response = await send(path);
      assert.notEqual(response.status, 200);
      assert(!response.text.includes("[core]"));
      assert(!response.text.includes("import test"));
    }
  });
});
