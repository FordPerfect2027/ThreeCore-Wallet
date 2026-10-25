import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS } from "../examples/security-http.js";

const runtime = "/src/state-notifier.js";
const fixture = "/test/browser/observer-ui-tests.js";

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

test("observer runtime retains protected JavaScript response headers", async () => {
  await serving(false, async send => {
    const result = await send(runtime);
    assert.equal(result.status, 200);
    assert.match(result.headers["content-type"], /text\/javascript/);
    for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(result.headers[name], expected, name);
    }
    assert.equal(result.headers["access-control-allow-origin"], undefined);
    assert.equal(result.headers["set-cookie"], undefined);
  });
});

for (const mode of [false, true]) {
  test(`observer fixture is available only under ui-test=${mode}`, async () => {
    await serving(mode, async send => {
      const result = await send(fixture);
      assert.equal(result.status, mode ? 200 : 404);
      assert.equal(result.headers["cache-control"], "no-store");
      if (mode) assert.match(result.headers["content-type"], /text\/javascript/);
    });
  });
}

for (const headers of [
  { Origin: "https://foreign.invalid" },
  { Origin: "null" },
  { Host: "127.0.0.1.foreign.invalid" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Dest": "iframe" },
]) {
  test("observer routes reject foreign context " + JSON.stringify(headers), async () => {
    await serving(true, async send => {
      for (const path of [runtime, fixture]) {
        const result = await send(path, { headers });
        assert.equal(result.status, 403, path);
        assert(!result.body.includes("export function"));
      }
    });
  });
}

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test("observer additions expose no mutation endpoint: " + method, async () => {
    await serving(true, async send => {
      for (const path of [runtime, fixture]) {
        assert.equal((await send(path, { method })).status, 404, path);
      }
    });
  });
}

test("observer fixture and all five production services resolve locally", async () => {
  await serving(true, async send => {
    const queue = [fixture];
    const seen = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      assert(seen.size < 100, "bounded module graph");
      const result = await send(path);
      assert.equal(result.status, 200, path);
      assert.match(result.headers["content-type"], /text\/javascript/);
      for (const match of result.body.matchAll(/(?:from\s+|import\s+)["']((?:\.{1,2}\/|\/)[^"']+)["']/g)) {
        const url = new URL(match[1], "http://localhost" + path);
        assert.equal(url.origin, "http://localhost");
        queue.push(url.pathname);
      }
    }
    for (const path of [runtime, "/src/storage-guard.js", "/src/rpc-supervisor.js",
      "/src/secure-backup-runner.js", "/src/file-read-service.js", "/src/export-guard.js"]) {
      assert(seen.has(path), "native fixture reaches " + path);
    }
  });
});

for (const path of ["/test/observer-boundaries.test.js", "/test/helpers/observer-fixtures.js",
  "/test/observer-liveness.test.js", "/observer-state.json"]) {
  test("observer additions do not expose test helpers or captured state: " + path, async () => {
    await serving(true, async send => { assert.equal((await send(path)).status, 404); });
  });
}
