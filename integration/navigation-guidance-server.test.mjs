import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS } from "../examples/security-http.js";

const externalNavigation = Object.freeze({
  "sec-fetch-site": "cross-site",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
});

async function serving(run, uiTest = false) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const send = (path = "/", headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method,
      headers: Object.fromEntries(Object.entries({ host: "127.0.0.1:" + port, ...headers })
        .filter(([, value]) => value !== undefined)) }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
  try { await run({ port, send }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

function assertSecurityHeaders(result) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.equal(result.headers[name], value, name);
  }
  for (const name of ["location", "refresh", "set-cookie", "access-control-allow-origin",
    "access-control-allow-credentials"]) {
    assert.equal(result.headers[name], undefined, name);
  }
}

function assertPlainDenial(result, reason = "Cross-origin request refused", status = 403) {
  assert.equal(result.status, status);
  assert.equal(result.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(result.text, reason);
  assertSecurityHeaders(result);
}

for (const uiTest of [false, true]) {
  test("external user document navigation receives only a passive 403 address-bar guide: " + uiTest, async () => {
    await serving(async ({ port, send }) => {
      const result = await send("/", externalNavigation);
      assert.equal(result.status, 403);
      assert.equal(result.headers["content-type"], "text/html; charset=utf-8");
      assert.match(result.text, /ThreeCoreをアドレスバーから直接開いてください/);
      assert.match(result.text, /Open ThreeCore from the address bar/);
      assert.match(result.text, /この新しいタブ/);
      assert.match(result.text, /以前から開いているThreeCoreのタブ/);
      assert.match(result.text, /ウォレットに接続せず、保存記録を読み書きしません/);
      assert.ok(result.text.includes("<code>http://127.0.0.1:" + port + "/</code>"));
      assert.doesNotMatch(result.text, /ThreeCore Wallet|wallet-(?:entry|demo)\.js|localStorage|sessionStorage|indexedDB|ethereum|walletConnect/i);
      const allowedTags = new Set(["html", "head", "meta", "title", "body", "main", "h1", "h2", "p", "strong", "code", "section"]);
      for (const [, tag] of result.text.matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)) {
        assert.ok(allowedTags.has(tag.toLowerCase()), "Passive HTML tag: " + tag);
      }
      assert.doesNotMatch(result.text, /\b(?:href|src|srcset|action|formaction|http-equiv|on[a-z]+)\s*=|javascript:|url\s*\(/i);
      assertSecurityHeaders(result);
    }, uiTest);
  });
}

test("Origin-bearing navigation keeps the plain denial, including null and exact local Origin", async () => {
  await serving(async ({ port, send }) => {
    for (const origin of ["null", "https://untrusted.invalid", "chrome-extension://untrusted",
      "http://127.0.0.1:" + port, "http://localhost:" + port]) {
      assertPlainDenial(await send("/", { ...externalNavigation, origin }));
    }
  });
});

test("untrusted authorities cannot receive guidance or override the local Host boundary", async () => {
  await serving(async ({ port, send }) => {
    for (const host of ["untrusted.invalid", "127.0.0.1.untrusted.invalid:" + port,
      "127.0.0.1:" + (port === 65535 ? port - 1 : port + 1)]) {
      assertPlainDenial(await send("/", { ...externalNavigation, host,
        "x-forwarded-host": "127.0.0.1:" + port, "x-forwarded-proto": "http" }), "Local origin required");
    }
    for (const host of ["localhost:" + port, "[::1]:" + port]) {
      assertPlainDenial(await send("/", { ...externalNavigation, host }));
    }
  });
});

test("missing or incompatible navigation metadata never selects the guide", async () => {
  await serving(async ({ send }) => {
    for (const [name, values] of [
      ["sec-fetch-site", ["same-site", "bogus", "cross-site, same-origin"]],
      ["sec-fetch-mode", [undefined, "cors", "no-cors", "Navigate"]],
      ["sec-fetch-dest", [undefined, "empty", "script", "image", "iframe", "frame", "object", "embed"]],
      ["sec-fetch-user", [undefined, "?0", "?1, ?1"]],
    ]) {
      for (const value of values) {
        assertPlainDenial(await send("/", { ...externalNavigation, [name]: value }));
      }
    }
  });
});

test("non-root targets, app resources and private paths keep their plain cross-site denial", async () => {
  await serving(async ({ send }) => {
    for (const path of ["/?account=private-test", "/?", "/index.html", "/examples/wallet-entry.js",
      "/src/wallet-session.js", "/test/browser/", "/.env", "/.git/config", "/package.json",
      "/examples/security-http.js", "/wallet-report-set.bundle", "/%2e%2e/.env"]) {
      assertPlainDenial(await send(path, externalNavigation));
    }
    assertPlainDenial(await send("/src/wallet-session.js", {
      ...externalNavigation, "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script",
    }));
    assertPlainDenial(await send("/api/agent/propose", {
      ...externalNavigation, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty",
    }));
  });
});

test("malformed targets retain denial ordering and never receive HTML guidance", async () => {
  await serving(async ({ send }) => {
    for (const path of ["http://untrusted.invalid/", "//untrusted.invalid/", "/%", "/%zz",
      "/#fragment", "/\\untrusted.invalid/", "/?x=" + "a".repeat(2049)]) {
      assertPlainDenial(await send(path, externalNavigation));
      assertPlainDenial(await send(path, { "sec-fetch-site": "none" }), "Invalid request target", 400);
    }
  });
});

test("non-GET requests remain denied without a guide or a write endpoint", async () => {
  await serving(async ({ send }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const result = await send("/", externalNavigation, method);
      assertPlainDenial(result, method === "HEAD" ? "" : "Cross-origin request refused");
      assertPlainDenial(await send("/", { "sec-fetch-site": "none" }, method),
        method === "HEAD" ? "" : "Not found", 404);
    }
  });
});

test("guidance never reflects request headers or interprets unrelated request data", async () => {
  await serving(async ({ port, send }) => {
    const baseline = await send("/", externalNavigation);
    const result = await send("/", { ...externalNavigation,
      referer: "https://untrusted.invalid/private-test",
      cookie: "private-test=<script>alert(1)</script>",
      authorization: "Bearer private-test",
      "x-forwarded-host": "private-test.invalid:9999",
      "x-forwarded-proto": "https",
      "x-forwarded-port": "9999",
    });
    assert.equal(result.status, 403);
    assert.equal(result.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(result.text, baseline.text);
    assert.doesNotMatch(result.text, /private-test|untrusted|<script/i);
    assert.deepEqual(result.text.match(/https?:\/\/[^<\s]+/g), ["http://127.0.0.1:" + port + "/"]);
    assertSecurityHeaders(result);
  });
});

test("direct and same-origin navigation and public module reads remain available", async () => {
  await serving(async ({ port, send }) => {
    for (const headers of [
      { ...externalNavigation, "sec-fetch-site": "none" },
      { ...externalNavigation, "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:" + port },
      { ...externalNavigation, "sec-fetch-site": undefined },
      {},
    ]) {
      const result = await send("/", headers);
      assert.equal(result.status, 200);
      assert.equal(result.headers["content-type"], "text/html; charset=utf-8");
      assert.match(result.text, /ThreeCore Wallet/);
      assert.doesNotMatch(result.text, /Open ThreeCore from the address bar/);
      assertSecurityHeaders(result);
    }
    const module = await send("/src/wallet-session.js", { "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors", "sec-fetch-dest": "script", origin: "http://127.0.0.1:" + port });
    assert.equal(module.status, 200);
    assert.match(module.headers["content-type"], /^text\/javascript/);
    assertSecurityHeaders(module);
    assertPlainDenial(await send("/.env", { "sec-fetch-site": "same-origin" }), "Not found", 404);
  });
});
