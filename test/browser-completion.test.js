import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { installBrowserCompletion } from "../scripts/browser-completion.js";

async function fixture(run, options) {
  const server = createServer((req, res) => { res.writeHead(404); res.end("original"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const receipt = installBrowserCompletion(server, options);
  const post = (body = "<body>complete</body>", extra = {}) => fetch(origin + receipt.pathname, {
    method: "POST", headers: { Origin: origin, "Content-Type": "text/html" }, body, ...extra,
  });
  try { await run({ server, origin, receipt, post }); }
  finally {
    receipt.dispose(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("CI completion waits for an explicit receipt and preserves its contents", async () => fixture(async ({ receipt, post }) => {
  let done = false;
  receipt.result.then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(done, false);
  assert.equal((await post()).status, 204);
  assert.equal(await receipt.result, "<body>complete</body>");
  assert.equal((await post("replacement")).status, 403);
}));

test("CI completion rejects wrong origin and method without ending the wait", async () => fixture(async ({ origin, receipt, post }) => {
  assert.equal((await post("bad", { headers: { Origin: "https://other.invalid", "Content-Type": "text/html" } })).status, 403);
  assert.equal((await fetch(origin + receipt.pathname)).status, 403);
  assert.equal((await post()).status, 204);
  assert.equal(await receipt.result, "<body>complete</body>");
}));

test("CI completion leaves other and incorrect nonce routes with the original handler", async () => fixture(async ({ origin, receipt, post }) => {
  for (const pathname of ["/", "/test/browser/ci-result/wrong"]) {
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "original");
  }
  await post(); await receipt.result;
}));

test("CI completion refuses an empty receipt", async () => fixture(async ({ receipt, post }) => {
  const rejected = assert.rejects(receipt.result, /Empty/);
  assert.equal((await post("")).status, 400);
  await rejected;
}));

test("CI completion bounds uploaded data", async () => fixture(async ({ receipt, post }) => {
  const rejected = assert.rejects(receipt.result, /Oversized/);
  await post("x".repeat(100)).catch(() => {});
  await rejected;
}, { maxBytes: 20 }));

test("CI completion fails a missing report on a bounded real-clock deadline", async () => fixture(async ({ receipt }) => {
  await assert.rejects(receipt.result, /did not report/);
}, { timeoutMs: 20 }));

test("CI completion reports browser termination and cleans up its handler", async () => fixture(async ({ receipt, server, origin }) => {
  const rejected = assert.rejects(receipt.result, /browser stopped/);
  receipt.fail(Error("browser stopped"));
  await rejected;
  receipt.dispose();
  assert.equal(server.listenerCount("request"), 1);
  assert.equal((await fetch(origin + receipt.pathname)).status, 404);
}));
