import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

// Exercises only the local server allowlist: no external endpoints or tokens.
for (const uiTest of [false, true]) {
  test("history files are served as scripts and fixtures remain gated: " + uiTest, async () => {
    const server = createDemoServer({ uiTest });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const base = "http://127.0.0.1:" + server.address().port;
    try {
      for (const path of [
        "/examples/history-panel.js",
        "/examples/history-files.js",
        "/src/portfolio-history.js",
        "/src/history-import-controller.js",
        "/src/portfolio-history-summary.js",
        "/src/history-file.js",
        "/src/history-file-reader.js",
        "/src/history-query.js",
      ]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.ok((await response.text()).length > 100);
        const post = await fetch(base + path, { method: "POST", body: "{}" });
        assert.equal(post.status, 404, "no uploads: " + path);
      }
      for (const path of [
        "/test/browser/history-ui-tests.js",
        "/test/browser/history-file-ui-tests.js",
      ]) {
        const response = await fetch(base + path);
        assert.equal(response.status, uiTest ? 200 : 404, path);
        await response.text();
      }
      for (const path of [
        "/test/helpers/history-fixtures.js",
        "/test/history-file-workflow.test.js",
        "/LOCAL-HISTORY-UI-RESULT.md",
        "/.git/config",
        "/history.json",
      ]) {
        assert.equal((await fetch(base + path)).status,
          uiTest && path === "/test/helpers/history-fixtures.js" ? 200 : 404, "fixture gate: " + path);
      }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
