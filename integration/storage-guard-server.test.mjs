import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS } from "../examples/security-http.js";

const runtime = ["/src/storage-guard-policy.js", "/src/storage-guard.js",
  "/src/storage-guard-status.js", "/examples/storage-guard-panel.js"];
const synthetic = ["/test/browser/storage-guard-fixture.js", "/test/browser/storage-guard-ui-tests.js",
  "/test/browser/storage-guard-demo/", "/test/browser/storage-guard-demo.js", "/test/browser/storage-guard-demo.css"];

async function serving(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const send = (path, { method = "GET", headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: `127.0.0.1:${port}`, ...headers } }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
  try { await run(send); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const path of runtime) {
  test("storage guard runtime retains HTTP security headers: " + path, async () => {
    await serving(false, async send => {
      const result = await send(path);
      assert.equal(result.status, 200);
      assert.match(result.headers["content-type"], /text\/javascript/);
      for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
        assert.equal(result.headers[name], expected, name);
      }
      assert.equal(result.headers["access-control-allow-origin"], undefined);
      assert.equal(result.headers["set-cookie"], undefined);
    });
  });
}

for (const path of synthetic) {
  for (const mode of [false, true]) {
    test(`storage guard fixture route ${path} only under ui-test=${mode}`, async () => {
      await serving(mode, async send => {
        const result = await send(path);
        assert.equal(result.status, mode ? 200 : 404);
        assert.equal(result.headers["cache-control"], "no-store");
        if (mode && path.endsWith(".css")) assert.match(result.headers["content-type"], /text\/css/);
        if (mode && path.endsWith("/")) assert.match(result.headers["content-type"], /text\/html/);
      });
    });
  }
}

for (const headers of [
  { Origin: "https://foreign.invalid" },
  { Origin: "null" },
  { Host: "127.0.0.1.foreign.invalid" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Dest": "iframe" },
]) {
  test("storage guard routes refuse foreign browser context " + JSON.stringify(headers), async () => {
    await serving(true, async send => {
      for (const path of [...runtime, ...synthetic]) {
        const result = await send(path, { headers });
        assert.equal(result.status, 403, path);
        assert(!result.body.includes("export function"));
      }
    });
  });
}

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test("storage guard adds no HTTP mutation endpoint: " + method, async () => {
    await serving(true, async send => {
      for (const path of [...runtime, ...synthetic]) {
        assert.equal((await send(path, { method })).status, 404, path);
      }
    });
  });
}

test("storage guard native browser fixture import graph is complete and same-origin", async () => {
  await serving(true, async send => {
    const queue = [...runtime, ...synthetic.filter(path => path.endsWith(".js"))];
    const seen = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      assert(seen.size < 220, "bounded static module graph");
      const result = await send(path);
      assert.equal(result.status, 200, path);
      assert.match(result.headers["content-type"], /text\/javascript/);
      for (const match of result.body.matchAll(/(?:from\s+|import\s+)["']((?:\.{1,2}\/|\/)[^"']+)["']/g)) {
        const url = new URL(match[1], "http://localhost" + path);
        assert.equal(url.origin, "http://localhost", "no external import");
        queue.push(url.pathname);
      }
    }
    for (const path of ["/src/checkpoint-storage.js", "/src/secure-deadline.js", "/src/transfer-vault-storage.js",
      "/src/encrypted-library-storage.js", "/src/period-library-storage.js", "/src/report-history-storage.js"]) {
      assert(seen.has(path), "native suite reaches " + path);
    }
  });
});

test("storage preview controls and entry module are protected without inline executable code", async () => {
  await serving(true, async send => {
    const response = await send("/test/browser/storage-guard-demo/");
    assert.match(response.body, /id="prepare"/);
    assert.match(response.body, /id="cancel-write"/);
    assert.match(response.body, /id="expire-write"/);
    assert.match(response.body, /id="reload"/);
    assert.match(response.body, /type="module" src="\/test\/browser\/storage-guard-demo.js"/);
    assert(!/\son\w+=/.test(response.body));
    assert(!response.body.includes("http://github"));
    assert.match(response.body, /connect-src 'none'/);
    assert.equal(response.headers["content-security-policy"], SECURITY_HEADERS["content-security-policy"]);
  });
});

test("test fixture owns a fresh database and never enumerates existing saved information", async () => {
  await serving(true, async send => {
    const result = await send("/test/browser/storage-guard-fixture.js");
    assert.match(result.body, /threecore-storage-guard-test-/);
    assert.match(result.body, /crypto.randomUUID\(\)/);
    assert.match(result.body, /owned.has\(name\)/);
    assert(!result.body.includes("indexedDB.databases"));
    assert(!result.body.includes("localStorage" + "."));
    assert(!result.body.includes("window.ethereum"));
  });
});

for (const path of ["/storage.json", "/storage-guard-state.json", "/.git/config",
  "/src/../package.json", "/test/storage-deadline.test.js", "/test/helpers/storage-guard-fixtures.js"]) {
  test("storage security additions do not expose local data: " + path, async () => {
    await serving(true, async send => { assert.equal((await send(path)).status, 404); });
  });
}
