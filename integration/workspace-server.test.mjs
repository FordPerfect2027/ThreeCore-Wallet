import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = [
  "/src/workspace-format.js",
  "/src/workspace-controller.js",
  "/src/workspace-file.js",
  "/src/workspace-overview.js",
  "/src/workspace-review.js",
  "/examples/workspace-panel.js",
];

async function withServer(uiTest, run) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const uiTest of [false, true]) {
  test("workspace modules and transitive imports are available locally: uiTest=" + uiTest, async () => {
    await withServer(uiTest, async base => {
      for (const route of modules) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200, route);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        const source = await response.text();
        for (const match of source.matchAll(/from "([./][^"]+)"/g)) {
          const imported = new URL(match[1], base + route);
          const dependency = await fetch(imported);
          assert.equal(dependency.status, 200, imported.pathname);
          await dependency.text();
        }
      }
    });
  });

  test("workspace backup and recovery data are not served or accepted as uploads: uiTest=" + uiTest, async () => {
    await withServer(uiTest, async base => {
      for (const route of [
        "/ThreeCore-workspace-backup.json",
        "/ThreeCore-local-recovery-draft.json",
        "/test/helpers/workspace-fixtures.js",
        "/test/workspace-workflow.test.js",
        "/.git/config",
        "/.env",
        "/workspace-workflow-evidence.json",
        "/%2e%2e/wallet-workspace-baseline-20261023/package.json",
      ]) {
        const response = await fetch(base + route);
        assert.equal(response.status, uiTest && route === "/test/helpers/workspace-fixtures.js" ? 200 : 404, route);
        const text = await response.text();
        if (!(uiTest && route === "/test/helpers/workspace-fixtures.js")) assert.equal(text, "Not found");
      }
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await fetch(base + "/examples/workspace-panel.js", { method });
        assert.equal(response.status, 404, method);
        assert.equal(await response.text(), "Not found");
      }
      const testSource = await fetch(base + "/test/browser/workspace-ui-tests.js");
      assert.equal(testSource.status, uiTest ? 200 : 404);
      await testSource.text();
    });
  });
}
