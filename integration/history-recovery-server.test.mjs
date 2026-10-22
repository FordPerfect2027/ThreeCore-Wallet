import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";
for (const uiTest of [false, true]) {
  test("recovery modules are read-only routes, fixtures gated: " + uiTest, async () => {
    const server = createDemoServer({ uiTest });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      for (const path of ["/src/history-recovery.js", "/src/history-recovery-report.js", "/examples/history-recovery-panel.js"]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        await response.text();
        assert.equal((await fetch(base + path, { method: "POST", body: "{}" })).status, 404);
      }
      assert.equal((await fetch(base + "/test/browser/history-recovery-ui-tests.js")).status, uiTest ? 200 : 404);
      for (const path of ["/test/history-recovery.test.js", "/test/history-recovery-screen.test.js",
        "/recovery.json", "/before-change.json", "/.git/config"]) {
        assert.equal((await fetch(base + path)).status, 404);
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
