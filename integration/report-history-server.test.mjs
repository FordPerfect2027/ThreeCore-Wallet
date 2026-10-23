import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["model", "storage", "file", "query", "view", "controller", "sources", "continuity"].map(name => "/src/report-history-" + name + ".js")
  .concat("/examples/report-history-panel.js");
const fixtures = ["/test/browser/report-history-demo/", "/test/browser/report-history-demo.js",
  "/test/browser/report-history-ui-tests.js", "/test/helpers/report-history-fixtures.js"];
async function served(uiTest, callback) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
for (const uiTest of [false, true]) {
  test("history modules and CSS are available with safe content types: " + uiTest, () => served(uiTest, async base => {
    for (const path of modules) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path); assert.match(response.headers.get("content-type"), /^text\/javascript/);
      assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const response = await fetch(base + "/examples/report-history.css");
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /^text\/css/);
  }));
  test("history synthetic fixtures require UI test mode: " + uiTest, () => served(uiTest, async base => {
    for (const path of fixtures) assert.equal((await fetch(base + path)).status, uiTest ? 200 : 404, path);
  }));
  test("history backups, repository metadata and executable scripts stay private: " + uiTest, () => served(uiTest, async base => {
    for (const path of ["/.git/config", "/ThreeCore-report-history.json", "/report-history.bundle", "/.env",
      "/scripts/check-report-history.js", "/test/report-history-model.test.js"]) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.equal((await fetch(base + "/examples/report-history-panel.js", { method })).status, 404, method);
    }
  }));
}
test("history preview blocks external connections and declares synthetic balances", () => served(true, async base => {
  const response = await fetch(base + "/test/browser/report-history-demo/");
  const html = await response.text();
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /すべて模擬データ/);
  assert.match(html, /report-history\.css/);
}));
test("main wallet mounts and disposes history after the report panel", () => served(false, async base => {
  const source = await (await fetch(base + "/examples/wallet-demo.js")).text();
  assert.match(source, /mountReportHistoryPanel/);
  assert.match(source, /getReport: periodReport.getInput, stageReport: periodReport.stageHistory/);
  assert.match(source, /reportHistory.dispose\(\)/);
  const html = await (await fetch(base + "/")).text();
  assert.match(html, /report-history\.css/);
}));
