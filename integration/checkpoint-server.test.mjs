import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

const modules = ["checkpoint-model", "checkpoint-storage", "checkpoint-controller", "checkpoint-transfer"]
  .map(name => "/src/" + name + ".js").concat("/examples/checkpoint-panel.js");
const testRoutes = ["/test/browser/checkpoint-ui-tests.js",
  "/test/browser/checkpoint-demo/", "/test/browser/checkpoint-demo.js"];
async function withServer(uiTest, run) {
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
  test("checkpoint module routes and dependencies resolve: uiTest=" + uiTest, async () => {
    await withServer(uiTest, async base => {
      for (const route of modules) {
        const response = await fetch(base + route);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/javascript/);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        const source = await response.text();
        for (const match of source.matchAll(/from "([./][^"]+)"/g)) {
          const dependency = await fetch(new URL(match[1], base + route));
          assert.equal(dependency.status, 200, match[1]);
          await dependency.text();
        }
      }
    });
  });

  test("checkpoint fixtures and inspection tools are not exposed: uiTest=" + uiTest, async () => {
    await withServer(uiTest, async base => {
      for (const route of ["/ThreeCore-saved-checkpoints.json", "/test/helpers/checkpoint-fixtures.js",
        "/scripts/check-checkpoint-collection.js", "/.git/config", "/checkpoint-tests.log"]) {
        const response = await fetch(base + route);
        assert.equal(response.status, uiTest && route === "/test/helpers/checkpoint-fixtures.js" ? 200 : 404, route);
        await response.text();
      }
      for (const method of ["POST", "PUT", "DELETE"]) {
        const response = await fetch(base + "/src/checkpoint-model.js", { method, body: "{}" });
        assert.equal(response.status, 404, method);
        await response.text();
      }
    });
  });

  test("checkpoint UI fixtures are available only behind --ui-test: " + uiTest, async () => {
    await withServer(uiTest, async base => {
      for (const route of testRoutes) {
        const response = await fetch(base + route);
        assert.equal(response.status, uiTest ? 200 : 404);
        await response.text();
      }
    });
  });
}

