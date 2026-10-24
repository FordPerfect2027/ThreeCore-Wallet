import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createDemoServer } from "../examples/dev-server.js";
import { SECURITY_HEADERS, inspectLocalRequest } from "../examples/security-http.js";

async function serving(run, uiTest = false) {
  const server = createDemoServer({ uiTest });
  await new Promise((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const send = (path = "/", headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: "127.0.0.1:" + port, ...headers } }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    req.on("error", reject); req.end();
  });
  try { await run({ port, send }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const uiTest of [false, true]) {
  test("security headers cover successful files, missing paths and denied requests: " + uiTest, async () => {
    await serving(async ({ send }) => {
      for (const [path, headers] of [["/", {}], ["/src/security-json.js", {}], ["/missing", {}],
        ["/.git/config", {}], ["/", { Host: "attacker.invalid" }], ["/", { Origin: "null" }]]) {
        const result = await send(path, headers);
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(result.headers[key], value, key);
        assert.equal(result.headers["access-control-allow-origin"], undefined);
        assert.equal(result.headers["set-cookie"], undefined);
      }
    }, uiTest);
  });
}

test("canonical loopback authority and exact same-origin reads remain available", async () => {
  await serving(async ({ send, port }) => {
    for (const host of ["127.0.0.1:" + port, "localhost:" + port, "[::1]:" + port]) {
      const result = await send("/", { Host: host, Origin: "http://" + host, "Sec-Fetch-Site": "same-origin" });
      assert.equal(result.status, 200);
      assert.match(result.text, /ThreeCore Wallet/);
    }
    assert.equal((await send("/", { "Sec-Fetch-Site": "none" })).status, 200);
  });
});

for (const host of ["attacker.invalid", "127.0.0.1.attacker.invalid", "localhost.attacker.invalid", "0.0.0.0",
  "127.1", "2130706433", "[::ffff:127.0.0.1]", "127.0.0.1:1", "localhost.", "user@127.0.0.1"]) {
  test("Host validation rejects DNS rebinding authority: " + host, async () => {
    await serving(async ({ send }) => {
      const result = await send("/src/wallet-session.js", { Host: host });
      assert.equal(result.status, 403);
      assert.equal(result.text.includes("class ThreeCoreWalletSession"), false);
      assert.equal(result.text.includes(host), false);
    });
  });
}

for (const origin of ["null", "https://attacker.invalid", "http://localhost:1", "file://", "chrome-extension://fake"]) {
  test("foreign Origin is refused even with a valid Host: " + origin, async () => {
    await serving(async ({ send }) => {
      const result = await send("/", { Origin: origin });
      assert.equal(result.status, 403);
      assert.equal(result.headers["access-control-allow-origin"], undefined);
    });
  });
}

for (const site of ["cross-site", "same-site", "bogus"]) {
  test("Fetch Metadata refuses non-origin browser request: " + site, async () => {
    await serving(async ({ send }) => assert.equal((await send("/", { "Sec-Fetch-Site": site })).status, 403));
  });
}

for (const destination of ["iframe", "frame", "object", "embed"]) {
  test("local wallet cannot be embedded as " + destination, async () => {
    await serving(async ({ send }) => {
      const result = await send("/", { "Sec-Fetch-Dest": destination });
      assert.equal(result.status, 403);
      assert.equal(result.headers["x-frame-options"], "DENY");
      assert.match(result.headers["content-security-policy"], /frame-ancestors 'none'/);
    });
  });
}

test("Origin comparison includes the port and host spelling", async () => {
  await serving(async ({ send, port }) => {
    for (const origin of ["http://localhost:" + port, "http://127.0.0.1:" + (port + 1),
      "https://127.0.0.1:" + port, "http://127.0.0.1:" + port + "/"]) {
      assert.equal((await send("/", { Origin: origin })).status, 403);
    }
  });
});

for (const target of ["http://attacker.invalid/", "//attacker.invalid/", "/%", "/%zz", "/#fragment", "/\\attacker.invalid/"]) {
  test("ambiguous HTTP target is refused without crashing server: " + target, async () => {
    await serving(async ({ send }) => {
      assert.equal((await send(target)).status, 400);
      assert.equal((await send("/")).status, 200);
    });
  });
}

test("request target length is bounded independently of body or query content", async () => {
  await serving(async ({ send }) => {
    assert.equal((await send("/?x=" + "a".repeat(2049))).status, 400);
    assert.equal((await send("/?safe=1")).status, 200);
  });
});

test("forwarded headers cannot override the local Host requirement", async () => {
  await serving(async ({ send, port }) => {
    const result = await send("/", { Host: "attacker.invalid",
      "X-Forwarded-Host": "127.0.0.1:" + port, "X-Forwarded-Proto": "http" });
    assert.equal(result.status, 403);
  });
});

test("server rejects write methods and never provides an upload endpoint", async () => {
  await serving(async ({ send }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      const result = await send("/", {}, method);
      assert.equal(result.status, 404);
      assert.equal(result.headers["access-control-allow-origin"], undefined);
    }
  });
});

test("source allowlist excludes private files, policies and backup artifacts", async () => {
  await serving(async ({ send }) => {
    for (const path of ["/.git/config", "/.env", "/package.json", "/examples/security-http.js",
      "/docs/SECURITY_LOCAL_20261024.md", "/wallet-report-set.bundle", "/%2e%2e/.env",
      "/src/%2e%2e/.git/config", "/C:/Users/aseet/.env"]) {
      const result = await send(path);
      assert.equal(result.status, 404, path);
      assert.equal(result.text, "Not found");
    }
  });
});

test("all new production security modules are explicitly available", async () => {
  await serving(async ({ send }) => {
    for (const path of ["/src/security-json.js", "/src/security-file.js", "/src/security-rpc.js",
      "/src/security-lock.js", "/src/security-provider-error.js", "/examples/security-panel.js", "/examples/security.css"]) {
      const result = await send(path);
      assert.equal(result.status, 200, path);
      assert.match(result.headers["content-type"], path.endsWith(".css") ? /^text\/css/ : /^text\/javascript/);
    }
  });
});

test("CSP excludes executable inline code, eval, external connections and embedding", () => {
  const policy = SECURITY_HEADERS["content-security-policy"];
  const directives = Object.fromEntries(policy.split("; ").map(value => {
    const [key, ...tokens] = value.split(" "); return [key, tokens];
  }));
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["connect-src"], ["'self'"]);
  for (const key of ["object-src", "base-uri", "frame-ancestors", "frame-src", "form-action", "worker-src"]) {
    assert.deepEqual(directives[key], ["'none'"]);
  }
  assert.equal(policy.includes("unsafe-eval"), false);
});

test("inspection is read-only and returns no reflected private request text", () => {
  const request = { url: "/?account=private-test", headers: { host: "localhost:4198" }, socket: { localPort: 4198 } };
  const original = JSON.stringify(request);
  assert.deepEqual(inspectLocalRequest(request), { status: 200, pathname: "/" });
  assert.equal(JSON.stringify(request), original);
  request.headers.origin = "https://private-test.invalid";
  assert.equal(JSON.stringify(inspectLocalRequest(request)).includes("private-test"), false);
});
