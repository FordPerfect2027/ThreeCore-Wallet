import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { renderLocalNavigationHelp } from "../examples/local-navigation-help.js";
const nav = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
async function serve(run) {
  let upstream = 0;
  const server = createDemoServer({ stateFetch() { upstream++; throw new Error("No RPC expected"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run("http://127.0.0.1:" + server.address().port, () => upstream); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function get(base, path, headers, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = httpRequest(base + path, { method, headers }, response => {
      let text = ""; response.setEncoding("utf8");
      response.on("data", part => { text += part; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on("error", reject); request.end();
  });
}
test("refused rehearsal navigation stays 403 and gives a passive Japanese direct-entry guide", () => serve(async (base, calls) => {
  const result = await get(base, "/rehearsal/", nav);
  assert.equal(result.status, 403); assert.match(result.headers["content-type"], /text\/html/);
  assert.match(result.text, /このタブで開き直してください/);
  assert.ok(result.text.includes('readonly value="' + base + '/rehearsal/"'));
  assert.match(result.text, /Ctrl＋L/); assert.match(result.text, /運用リハーサル/);
  assert.doesNotMatch(result.text, /<script|<iframe|<form|http-equiv="refresh"|location\s*=|<a\b/i);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-frame-options"], "DENY");
  assert.equal(result.headers["referrer-policy"], "no-referrer");
  assert.match(result.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(calls(), 0);
}));
test("wallet entry guide uses only the local listening port and fixed root route", () => serve(async base => {
  const result = await get(base, "/", { ...nav, origin: "https://PRIVATE_ORIGIN.invalid",
    referer: "https://PRIVATE_REFERRER.invalid/?token=SECRET" });
  assert.equal(result.status, 403);
  assert.ok(result.text.includes('readonly value="' + base + '/"'));
  assert.doesNotMatch(result.text, /PRIVATE_ORIGIN|PRIVATE_REFERRER|SECRET/);
}));
test("RPC, assets, unknown paths, embedding and write requests do not get the HTML guide", () => serve(async (base, calls) => {
  for (const [path, headers, method] of [
    ["/rpc/base-mainnet", nav, "POST"], ["/src/wallet-session.js", nav, "GET"],
    ["/unknown", nav, "GET"], ["/rehearsal/?private=SECRET", nav, "GET"],
    ["/rehearsal/", { ...nav, "sec-fetch-dest": "iframe" }, "GET"],
    ["/rehearsal/", { ...nav, "sec-fetch-mode": "cors" }, "GET"],
    ["/rehearsal/", nav, "POST"], ["/rehearsal/", nav, "HEAD"],
  ]) {
    const result = await get(base, path, headers, method);
    assert.equal(result.status, 403);
    assert.match(result.headers["content-type"], /text\/plain/);
    assert.doesNotMatch(result.text, /<html|SECRET/);
  }
  assert.equal(calls(), 0);
}));
test("invalid Host remains a plain rejection and is never echoed in a recovery URL", () => serve(async base => {
  const result = await get(base, "/rehearsal/", { ...nav, host: "attacker.invalid" });
  assert.equal(result.status, 403); assert.match(result.headers["content-type"], /text\/plain/);
  assert.equal(result.text, "Local origin required");
}));
test("ordinary direct navigation still serves the actual rehearsal page", () => serve(async base => {
  const result = await get(base, "/rehearsal/", { "sec-fetch-site": "none",
    "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
  assert.equal(result.status, 200);
  assert.match(result.text, /operation-rehearsal-page.js/);
  assert.doesNotMatch(result.text, /このタブで開き直してください/);
}));
test("guide helper refuses invalid local ports and unrelated verdicts", () => {
  const request = { method: "GET", url: "/rehearsal/", headers: nav, socket: { localPort: 4231 } };
  const refused = { status: 403, reason: "Cross-origin request refused" };
  for (const port of [0, 65536, "4231", 1.2, null])
    assert.equal(renderLocalNavigationHelp({ ...request, socket: { localPort: port } }, refused), null);
  for (const verdict of [{ status: 200 }, { status: 403, reason: "Embedding refused" }])
    assert.equal(renderLocalNavigationHelp(request, verdict), null);
});
