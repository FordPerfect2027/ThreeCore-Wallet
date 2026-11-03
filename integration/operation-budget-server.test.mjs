import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

test("budget page serves its complete local graph and denies network/write/file exposure", async () => {
  const server = createDemoServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const page = await fetch(origin + "/budget/"); assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const html = await page.text(); assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/);
    assert.match(html, /現在の残高・手数料は取得しません/);
    assert.match(await (await fetch(origin + "/rehearsal/")).text(), /href="\/budget\/"/);
    assert.match(html, /href="\/budget\/shared\/"/);
    const shared = await fetch(origin + "/budget/shared/"); assert.equal(shared.status, 200);
    const sharedHtml = await shared.text(); assert.match(sharedHtml, /connect-src 'none'/); assert.match(sharedHtml, /同じ口座/);
    const evidence = await fetch(origin + "/budget/evidence/"); assert.equal(evidence.status, 200);
    const evidenceHtml = await evidence.text(); assert.match(evidenceHtml, /connect-src 'none'/); assert.match(evidenceHtml, /保存された過去の記録/);
    const pending = ["/examples/operation-budget-page.js", "/examples/shared-operation-budget-page.js", "/examples/operation-budget-evidence-page.js"], visited = new Set();
    while (pending.length) {
      const route = pending.pop(); if (visited.has(route)) continue; visited.add(route); assert.ok(visited.size <= 40);
      const response = await fetch(origin + route); assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), /text\/javascript/);
      const source = await response.text();
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        const url = new URL(match[1], origin + route); assert.equal(url.origin, origin); pending.push(url.pathname);
      }
    }
    assert.ok(visited.has("/src/operation-budget.js")); assert.ok(visited.has("/src/shared-operation-budget.js")); assert.ok(visited.has("/src/security-file.js"));
    assert.ok(visited.has("/src/operation-budget-evidence.js")); assert.ok(visited.has("/src/token-identity-report.js"));
    for (const path of ["/budget/.env", "/budget/record.json", "/scripts/check-operation-budget.js"])
      assert.equal((await fetch(origin + path)).status, 404);
    assert.equal((await fetch(origin + "/budget/", { method: "POST", body: "{}" })).status, 404);
    assert.equal((await fetch(origin + "/budget/", { headers: { origin: "https://other.example" } })).status, 403);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
