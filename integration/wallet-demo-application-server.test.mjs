import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoServer } from "../examples/dev-server.js";
import { WALLET_DEMO_ASSET_FILES, captureWalletDemoPublicAssets,
  createWalletDemoApplicationHost } from "../server/wallet-demo-assets.mjs";

const digest = text => createHash("sha256").update(text).digest("hex");
const ORIGIN = "http://127.0.0.1:4173";
function serviceFixture() {
  const calls = { create: 0, handle: 0, register: 0, revoke: 0, dispose: 0 };
  return { calls, createService({ origin }) {
    calls.create++;
    assert.match(origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
    return {
      handle() { calls.handle++; return new Response("{}", { status: 503 }); },
      register() { calls.register++; }, revoke() { calls.revoke++; }, dispose() { calls.dispose++; },
    };
  } };
}

test("wallet demo application: fixed capture closes every normal module and stylesheet dependency", async () => {
  const assets = await captureWalletDemoPublicAssets();
  const byPath = new Map(assets.map(asset => [asset.path, asset]));
  assert.ok(Object.isFrozen(assets) && assets.every(Object.isFrozen));
  assert.ok(Object.isFrozen(WALLET_DEMO_ASSET_FILES) && WALLET_DEMO_ASSET_FILES.every(Object.isFrozen));
  assert.equal(byPath.size, assets.length, "No duplicate public target");
  assert.ok(assets.length <= 256);
  assert.ok(assets.every(asset => Buffer.byteLength(asset.body) <= 131072));
  assert.ok(assets.reduce((sum, asset) => sum + Buffer.byteLength(asset.body), 0) <= 4194304);
  const html = byPath.get("/").body;
  assert.doesNotMatch(html, /data-base-state-relay/);
  assert.match(html, /<p hidden class="state-source-note"/);
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|\son[a-z]+\s*=/i, "Normal entry must work without inline CSP exceptions");
  const styles = [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(styles.slice(0, 3), ["/examples/security.css", "/examples/secure-backup.css", "/examples/wallet-demo.css"]);
  assert.equal(styles[3], "/examples/reconciliation.css", "Moved styles retain their original cascade position");
  for (const path of styles) assert.equal(byPath.get(path)?.contentType, "text/css;charset=utf-8", path);
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(scripts, ["/examples/wallet-entry.js"], "Normal entry must stay unchanged and opt-in behavior must not replace it");
  const visited = new Set();
  function visit(path) {
    if (visited.has(path)) return;
    const asset = byPath.get(path);
    assert.equal(asset?.contentType, "text/javascript;charset=utf-8", "Missing normal import: " + path);
    visited.add(path);
    assert.doesNotMatch(asset.body, /\bimport\s*\(/, "Dynamic imports require an explicit reviewed asset contract: " + path);
    const imports = /\b(?:import|export)\s+(?:[^;'\"]*?\sfrom\s*)?[\"']([^\"']+)[\"']/g;
    for (const match of asset.body.matchAll(imports)) {
      assert.ok(match[1].startsWith("."), "Unexpected non-relative normal import: " + path);
      const url = new URL(match[1], ORIGIN + path);
      assert.equal(url.origin, ORIGIN);
      assert.equal(url.search + url.hash, "");
      visit(url.pathname);
    }
  }
  scripts.forEach(visit);
  assert.ok(visited.has("/examples/wallet-demo.js") && visited.has("/src/wallet-session.js"));
  assert.ok(visited.has("/examples/workspace-panel.js") && visited.has("/examples/checkpoint-panel.js"));
  assert.throws(() => { byPath.get("/").body = "changed"; }, TypeError);
});

test("wallet demo application: capture and disabled construction do not bind or create a service", async () => {
  const f = serviceFixture();
  const host = await createWalletDemoApplicationHost({ createService: f.createService });
  try {
    assert.equal(host.state.status, "idle");
    assert.equal(f.calls.create, 0);
    await assert.rejects(host.start(), { code: "HTTP_HOST_DISABLED" });
    assert.equal(f.calls.create, 0);
  } finally { await host.close(); }
  assert.deepEqual(f.calls, { create: 0, handle: 0, register: 0, revoke: 0, dispose: 0 });
});

test("wallet demo application: every declared normal asset is served as captured UTF-8 under strict CSP", async () => {
  const expected = await captureWalletDemoPublicAssets(), f = serviceFixture();
  const host = await createWalletDemoApplicationHost({ enabled: true, createService: f.createService });
  try {
    const { origin } = await host.start();
    for (let offset = 0; offset < expected.length; offset += 4) {
      await Promise.all(expected.slice(offset, offset + 4).map(async asset => {
        const response = await fetch(origin + asset.path);
        assert.equal(response.status, 200, asset.path);
        assert.equal(response.headers.get("content-type"), asset.contentType, asset.path);
        assert.equal(Number(response.headers.get("content-length")), Buffer.byteLength(asset.body), asset.path);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        const csp = response.headers.get("content-security-policy");
        assert.match(csp, /script-src 'self'/);
        assert.match(csp, /style-src 'self'/);
        assert.match(csp, /connect-src 'self'/);
        assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
        assert.equal(digest(await response.text()), digest(asset.body), asset.path);
      }));
    }
    const relay = await fetch(origin + "/rpc/base-mainnet", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: "{}" });
    assert.equal(relay.status, 404);
    assert.deepEqual(f.calls, { create: 1, handle: 0, register: 0, revoke: 0, dispose: 0 });
  } finally { await host.close(); }
  await host.close();
  assert.equal(f.calls.dispose, 1);
});

test("wallet demo application: the existing normal demo serves the shared external stylesheet", async () => {
  const server = createDemoServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    const html = await (await fetch(origin + "/")).text();
    assert.match(html, /href="\/examples\/wallet-demo\.css"/);
    assert.match(html, /<html lang="ja" data-base-state-relay>/);
    assert.doesNotMatch(html, /<style\b/i);
    const response = await fetch(origin + "/examples/wallet-demo.css");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
    const bytes = await readFile(new URL("../examples/wallet-demo.css", import.meta.url));
    assert.equal(digest(await response.text()), digest(bytes));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

// Invalid-file controls run against an owned temporary module tree. No source
// file in the checkout is renamed, rewritten or used as a fault-injection target.
async function isolatedAssetTree(run) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-demo-asset-input-"));
  try {
    await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
    const dependencies = ["server/wallet-demo-assets.mjs", "server/proposal-http-host.mjs",
      "src/security-data.js", "src/security-callback.js"];
    for (const name of dependencies) {
      const target = join(directory, name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(new URL("../" + name, import.meta.url), target);
    }
    const fixture = await import(pathToFileURL(join(directory, "server/wallet-demo-assets.mjs")).href);
    for (const asset of fixture.WALLET_DEMO_ASSET_FILES) {
      const name = relative(directory, asset.file).replaceAll("\\", "/");
      assert.ok(!name.startsWith("../"));
      if (dependencies.includes(name)) continue;
      await mkdir(dirname(asset.file), { recursive: true });
      await writeFile(asset.file, "", { flag: "wx" });
    }
    await run(fixture, directory, new Set(dependencies));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("wallet demo application: damaged or oversized coded files fail before service creation", async () => {
  await isolatedAssetTree(async (fixture, directory, dependencies) => {
    const f = serviceFixture();
    const valid = await fixture.createWalletDemoApplicationHost({ createService: f.createService });
    await valid.close();
    const css = join(directory, "examples/wallet-demo.css");
    const rejected = async () => {
      await assert.rejects(fixture.createWalletDemoApplicationHost({ enabled: true, createService: f.createService }),
        { code: "WALLET_DEMO_ASSET_UNAVAILABLE", message: "WALLET_DEMO_ASSET_UNAVAILABLE" });
      assert.equal(f.calls.create, 0);
    };
    await writeFile(css, Buffer.from([0xc0, 0xaf]));
    await rejected(); // Invalid UTF-8 is not silently replaced.
    await writeFile(css, Buffer.alloc(131073, 0x61));
    await rejected(); // One byte beyond the fixed per-file boundary.
    await rm(css);
    await rejected(); // A missing coded file never becomes request-time fallback.
    await mkdir(css);
    await rejected(); // Directories are not public text files.
    await rm(css, { recursive: true });
    const body = Buffer.alloc(22000, 0x61);
    for (const asset of fixture.WALLET_DEMO_ASSET_FILES) {
      const name = relative(directory, asset.file).replaceAll("\\", "/");
      if (!dependencies.has(name)) await writeFile(asset.file, body);
    }
    await rejected(); // Individually bounded assets can still exceed 4 MiB together.
  });
});
