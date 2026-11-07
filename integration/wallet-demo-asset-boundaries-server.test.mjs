import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import filePromises from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { createWalletDemoApplicationHost, WALLET_DEMO_ASSET_FILES } from "../server/wallet-demo-assets.mjs";

// Independent boundary checks against actual local HTTP. No live model, wallet,
// external endpoint, source-file mutation, or public capability bootstrap.
function serviceCounters() {
  let created = 0, handled = 0, disposed = 0;
  return {
    createService() {
      created++;
      return { handle() { handled++; return Response.json({ executed: false }); },
        register() {}, revoke() {}, dispose() { disposed++; } };
    },
    counts: () => ({ created, handled, disposed }),
  };
}
function request(origin, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(origin);
    const req = httpRequest({ hostname: "127.0.0.1", port: Number(target.port), method: "GET", path,
      headers: { connection: "close", ...headers } }, response => {
      const parts = [];
      response.on("data", part => parts.push(part));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(parts).toString("utf8") }));
    });
    req.setTimeout(2000, () => req.destroy(Error("Synthetic local HTTP deadline")));
    req.on("error", reject); req.end();
  });
}

test("demo application configuration cannot supply a public root, asset map, test mode or accessor", async () => {
  const counter = serviceCounters(); let getters = 0;
  const accessor = { createService: counter.createService };
  Object.defineProperty(accessor, "enabled", { enumerable: true, get() { getters++; return true; } });
  const inherited = Object.assign(Object.create({ uiTest: true }), { createService: counter.createService });
  for (const options of [
    { createService: counter.createService, root: "/synthetic-private-root" },
    { createService: counter.createService, publicAssets: [{ path: "/private", contentType: "text/html;charset=utf-8", body: "private" }] },
    { createService: counter.createService, uiTest: true }, accessor, inherited,
  ]) await assert.rejects(createWalletDemoApplicationHost(options), { code: "INVALID_WALLET_DEMO_CONFIG" });
  assert.equal(getters, 0);
  assert.deepEqual(counter.counts(), { created: 0, handled: 0, disposed: 0 });
});

test("async asset capture retains the original host options before the caller can mutate them", async t => {
  const counter = serviceCounters(); let replacementCalls = 0;
  const options = { enabled: true, port: 0, requestTimeoutMs: 1000, createService: counter.createService };
  const creating = createWalletDemoApplicationHost(options);
  options.enabled = false; options.port = -1;
  options.createService = () => { replacementCalls++; throw Error("Unapproved replacement factory"); };
  const host = await creating;
  t.after(() => host.close());
  assert.deepEqual(counter.counts(), { created: 0, handled: 0, disposed: 0 });
  assert.equal(host.state.status, "idle");
  const { origin } = await host.start();
  assert.equal((await request(origin, "/")).status, 200);
  assert.equal(replacementCalls, 0);
  assert.deepEqual(counter.counts(), { created: 1, handled: 0, disposed: 0 });
  await host.close();
  assert.deepEqual(counter.counts(), { created: 1, handled: 0, disposed: 1 });
});

test("normal demo assets expose no test harness, private module, dotfile or registration route", async t => {
  const counter = serviceCounters();
  const host = await createWalletDemoApplicationHost({ enabled: true, createService: counter.createService });
  t.after(() => host.close());
  const { origin } = await host.start();
  for (const path of ["/test/browser/", "/test/browser/ui-tests.js", "/scripts/test-browser-ui.js",
    "/examples/dev-server.js", "/server/agent-proposal-service.mjs", "/server/wallet-demo-assets.mjs",
    "/.env.local", "/api/agent/register", "/api/agent/bootstrap"]) {
    const response = await request(origin, path, { origin });
    assert.equal(response.status, 404, path);
    assert.deepEqual(JSON.parse(response.body), { error: "NOT_FOUND", executed: false }, path);
  }
  assert.equal((await request(origin, "/")).status, 200);
  assert.deepEqual(counter.counts(), { created: 1, handled: 0, disposed: 0 });
});

test("resolved application host serves captured HTML, JavaScript and CSS without later filesystem reads", async () => {
  const counter = serviceCounters();
  const host = await createWalletDemoApplicationHost({ enabled: true, createService: counter.createService });
  const cssPath = WALLET_DEMO_ASSET_FILES.find(asset => asset.contentType === "text/css;charset=utf-8").path;
  const originals = [], attempts = [];
  const boundaries = [[fs, "open"], [fs, "openSync"], [fs, "readFile"], [fs, "readFileSync"],
    [fs, "createReadStream"], [filePromises, "open"], [filePromises, "readFile"]];
  try {
    // This test file runs in its own Node test process. Restore every built-in
    // binding before cleanup/reporting, even when an assertion fails.
    for (const [holder, name] of boundaries) {
      originals.push([holder, name, holder[name]]);
      holder[name] = () => { attempts.push(name); throw Error("Filesystem access after public asset capture"); };
    }
    syncBuiltinESMExports();
    const { origin } = await host.start();
    for (const [path, type] of [["/", "text/html;charset=utf-8"],
      ["/examples/wallet-entry.js", "text/javascript;charset=utf-8"], [cssPath, "text/css;charset=utf-8"]]) {
      const response = await request(origin, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers["content-type"], type, path);
      assert.ok(response.body.length > 0, path);
    }
    assert.deepEqual(attempts, []);
    assert.deepEqual(counter.counts(), { created: 1, handled: 0, disposed: 0 });
  } finally {
    for (const [holder, name, value] of originals) holder[name] = value;
    syncBuiltinESMExports();
    await host.close();
  }
});
