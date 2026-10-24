import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "engine", "file", "view", "export", "controller", "diagnostics", "timeline"]
  .map(name => "/src/report-set-" + name + ".js").concat("/examples/report-set-panel.js", "/examples/report-set-timeline-panel.js");
const previews = ["/test/browser/report-set-demo/", "/test/browser/report-set-demo.js",
  "/test/browser/report-set-ui-tests.js", "/test/helpers/report-set-fixtures.js"];

async function served(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const uiTest of [false, true]) {
  test("report set: explicit module routes and stylesheet are available " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of modules) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
      const style = await fetch(base + "/examples/report-set.css");
      assert.equal(style.status, 200);
      assert.match(style.headers.get("content-type"), /^text\/css/);
      assert.match(await style.text(), /\[hidden\]/);
    });
  });

  test("report set: synthetic fixtures are exposed only in UI-test mode " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of previews) {
        assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
      }
    });
  });

  test("report set: private source, backups and mutation requests are unavailable " + uiTest, async () => {
    await served(uiTest, async base => {
      for (const path of ["/.git/config", "/.env", "/scripts/check-report-set.js", "/src/",
        "/test/report-set-controller.test.js", "/ThreeCore-report-set.json", "/docs/REPORT_SET_LOCAL.md"]) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
      for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
        assert.equal((await fetch(base + modules[0], { method })).status, 404);
      }
    });
  });
}

test("report set: main wallet mounts and disposes the panel with no synthetic imports", async () => {
  await served(false, async base => {
    const script = await (await fetch(base + "/examples/wallet-demo.js")).text();
    assert.match(script, /mountReportSetPanel\(\{ document, parent: reportSetHost \}\)/);
    assert.match(script, /reportSet\.dispose\(\)/);
    assert.ok(!script.includes("report-set-fixtures"));
    const html = await (await fetch(base)).text();
    assert.ok(html.includes("/examples/report-set.css"));
    assert.ok(!html.includes("report-set-demo.js"));
  });
});

test("report set: preview prevents network connections and uses a separate named database", async () => {
  await served(true, async base => {
    const html = await (await fetch(base + previews[0])).text();
    const script = await (await fetch(base + previews[1])).text();
    assert.ok(html.includes("connect-src 'none'"));
    assert.ok(html.includes("すべて模擬データ"));
    assert.ok(script.includes("threecore-demo-report-set-v1"));
    assert.ok(!script.includes("window.ethereum"));
  });
});
