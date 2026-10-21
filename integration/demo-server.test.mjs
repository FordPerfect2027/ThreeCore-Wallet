import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

for (const uiTest of [false, true]) {
  test(`demo serves production modules and gates browser fixtures (uiTest=${uiTest})`, async () => {
    const server = createDemoServer({ uiTest });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const path of ["/", "/examples/wallet-demo.js", "/src/wallet-card-controller.js",
        "/src/wallet-session.js", "/src/provider-registry.js", "/src/provider-error.js", "/src/dapp-preflight.js"]) {
        const response = await fetch(base + path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        if (path.endsWith(".js")) assert.match(response.headers.get("content-type"), /^text\/javascript/);
        await response.text();
      }
      for (const path of ["/test/browser/", "/test/browser/ui-tests.js",
        "/test/browser/?harness-fault=error", "/test/browser/?harness-fault=unhandledrejection"]) {
        const response = await fetch(base + path);
        assert.equal(response.status, uiTest ? 200 : 404, path);
        await response.text();
      }
      for (const path of ["/.env", "/package.json", "/../.git/config", "/test/wallet-card-controller.test.js"]) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
      assert.equal((await fetch(base + "/", { method: "POST" })).status, 404);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
