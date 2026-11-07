import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { setImmediate as nextTurn } from "node:timers/promises";
import * as hosts from "../server/proposal-http-host.mjs";
import { createAgentProposalService } from "../server/agent-proposal-service.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { createAgentProposalClient } from "../src/agent-proposal-client.js";

// Actual loopback listeners, synthetic context and explicit private grants only.
const NOW = 1800000000000, address = n => "0x" + String(n).repeat(40);
const HTML = '<!doctype html><title>Synthetic proposal fixture</title><script type="module" src="/app.js"></script><link rel="stylesheet" href="/style.css">';
const assets = () => [
  { path: "/", contentType: "text/html;charset=utf-8", body: HTML },
  { path: "/app.js", contentType: "text/javascript;charset=utf-8", body: 'export const fixture = "local synthetic read";' },
  { path: "/style.css", contentType: "text/css;charset=utf-8", body: "body { color: #123; }" },
];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t, { factory = hosts.createProposalApplicationHost, wrap, ...options } = {}) {
  let origin, serviceCalls = 0, proposalCalls = 0, disposed = 0;
  const registry = createAgentReadPolicyRegistry();
  const host = factory({ enabled: true, publicAssets: assets(), ...options,
    createService: ({ origin: local }) => {
      origin = local;
      const service = createAgentProposalService({ origin, enabled: true, now: () => NOW, timeoutMs: 1000, maxRequests: 4 });
      const delegated = wrap ? wrap(service) : service;
      return { ...delegated,
        handle: request => { serviceCalls++; return delegated.handle(request); },
        dispose: () => { disposed++; delegated.dispose(); },
      };
    },
  });
  t.after(() => host.close());
  await host.start();
  function register(propose) {
    const agent = "DAT", account = address(1), chainId = 84532;
    const sessionState = { agent, account, chainId, siteOrigin: origin, connected: true, connectionEpoch: 1,
      canSign: false, canSendTransactions: false, canBridge: false };
    const policy = registry.set(agent, JSON.stringify({ schema: "threecore-agent-read-config-v1", agent, account, chainId,
      siteOrigin: origin, maxProposalAgeMs: 60000, targets: [{ tokenAddress: address(4), spenderAddress: address(5) }] }));
    const readContext = () => ({ policyText: registry.readPolicyText(agent), sessionState });
    const result = () => ({ status: "unexecuted-model-proposal", executed: false, grantsAuthority: false, review: {},
      proposalText: JSON.stringify({ schema: "threecore-agent-read-proposal-v1", id: "synthetic-read", agent, account,
        chainId, siteOrigin: origin, connectionEpoch: 1, policyRevision: policy.revision, createdAtMs: NOW,
        expiresAtMs: NOW + 60000, rationale: "Synthetic local read only",
        action: { kind: "inspect-spender", tokenAddress: address(4), spenderAddress: address(5) } }),
    });
    const grant = host.register({ agent, expiresAtMs: NOW + 120000, readContext,
      propose: input => { proposalCalls++; return propose ? propose(input, result) : result(); },
    });
    return { grant, result, readContext, init: { method: "POST",
      headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json", authorization: `Bearer ${grant.token}` },
      body: JSON.stringify({ agent, requestId: "request-1", objective: "Read configured target" }),
    } };
  }
  return { host, origin, register, serviceCalls: () => serviceCalls, proposalCalls: () => proposalCalls, disposed: () => disposed };
}

async function expected(response, status, code) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: code, executed: false });
}
function publicHeaders(response, contentType) {
  for (const [name, value] of Object.entries({ "content-type": contentType, "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
    "cross-origin-resource-policy": "same-origin", connection: "close" })) assert.equal(response.headers.get(name), value, name);
  const csp = response.headers.get("content-security-policy");
  for (const directive of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"])
    assert.ok(csp.includes(directive), directive);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(response.headers.get("permissions-policy"), /payment=\(\)/);
}
function raw(origin, { method = "GET", path = "/", headers = [], body = "", host = new URL(origin).host } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(new URL(origin).port), "127.0.0.1"); let wire = "";
    socket.setTimeout(2000, () => socket.destroy(Error("synthetic raw HTTP timed out")));
    socket.on("error", reject);
    socket.on("data", bytes => { wire += bytes; });
    socket.on("end", () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(wire)?.[1]), wire }));
    socket.on("connect", () => socket.end([
      `${method} ${path} HTTP/1.1`, `Host: ${host}`, ...headers, "Connection: close", "", body,
    ].join("\r\n")));
  });
}
function rawError(response, status, code) {
  assert.equal(response.status, status);
  assert.ok(response.wire.includes(`"error":"${code}"`), code);
}

test("application host remains inert and disabled until an explicit enabled start", async () => {
  let factories = 0;
  const host = hosts.createProposalApplicationHost({ publicAssets: assets(), createService: () => { factories++; } });
  assert.deepEqual(host.state, { status: "idle", origin: null, activeRequests: 0 });
  await assert.rejects(host.start(), { code: "HTTP_HOST_DISABLED" });
  assert.equal(factories, 0);
  await host.close(); assert.equal(host.state.status, "closed");
});

test("public document, modules and CSS compose with a privately granted client and real proposal service", async t => {
  const f = await fixture(t);
  const page = await fetch(f.origin + "/", { headers: { "sec-fetch-site": "none", "sec-fetch-dest": "document" } });
  assert.equal(page.status, 200); publicHeaders(page, "text/html;charset=utf-8");
  assert.equal(await page.text(), HTML);
  for (const asset of assets().slice(1)) {
    const response = await fetch(f.origin + asset.path, { headers: { origin: f.origin, "sec-fetch-site": "same-origin" } });
    assert.equal(response.status, 200); publicHeaders(response, asset.contentType);
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(asset.body)));
    assert.equal(await response.text(), asset.body);
  }
  assert.equal(f.serviceCalls(), 0); assert.equal(f.proposalCalls(), 0);
  const { grant, readContext, result } = f.register();
  assert.equal(grant.endpoint, new URL("/api/agent/proposal", page.url).href);
  const staged = [];
  const client = createAgentProposalClient({ agent: "DAT", origin: f.origin, enabled: true, readContext, now: () => NOW,
    stageProposal: text => { staged.push(text); return true; },
    // Node's fetch has no ambient document; reproduce the browser's Origin metadata explicitly.
    fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, origin: f.origin, "sec-fetch-site": "same-origin" } }),
  });
  t.after(() => client.dispose());
  assert.equal(client.acceptGrant(grant), true);
  assert.equal(f.serviceCalls(), 0);
  assert.deepEqual(await client.request({ requestId: "client-request-1", objective: "Read configured target" }),
    { status: "staged", requestId: "client-request-1", executed: false });
  assert.deepEqual(staged, [result().proposalText]);
  assert.equal(f.serviceCalls(), 1); assert.equal(f.proposalCalls(), 1);
  assert.ok(!HTML.includes(grant.token));
});

test("legacy API-only factory does not publish assets even when publicAssets is supplied", async t => {
  const f = await fixture(t, { factory: hosts.createProposalHttpHost });
  await expected(await fetch(f.origin + "/", { headers: { origin: f.origin } }), 404, "NOT_FOUND");
  await expected(await fetch(f.origin + "/"), 403, "ORIGIN_DENIED");
  assert.equal(f.serviceCalls(), 0); assert.equal(f.proposalCalls(), 0);
});

test("public assets are captured before start and Content-Length measures UTF-8 bytes", async t => {
  const original = { path: "/", contentType: "text/html;charset=utf-8", body: "<title>日本語 é</title>" };
  const expectedBody = original.body, declarations = [original];
  let serviceCalls = 0;
  const host = hosts.createProposalApplicationHost({ enabled: true, publicAssets: declarations,
    createService: () => ({ handle() { serviceCalls++; }, register() {}, revoke() {}, dispose() {} }),
  });
  t.after(() => host.close());
  original.path = "/changed"; original.body = "changed"; original.contentType = "text/javascript;charset=utf-8";
  declarations.splice(0, 1, { path: "/added", contentType: "text/html;charset=utf-8", body: "added" });
  const { origin } = await host.start(), response = await fetch(origin + "/");
  assert.equal(response.status, 200); publicHeaders(response, "text/html;charset=utf-8");
  assert.equal(response.headers.get("content-length"), String(Buffer.byteLength(expectedBody, "utf8")));
  assert.equal(await response.text(), expectedBody);
  await expected(await fetch(origin + "/added", { headers: { origin } }), 404, "NOT_FOUND");
  assert.equal(serviceCalls, 0);
});

test("invalid asset declarations fail synchronously without invoking field getters or service factory", () => {
  let factories = 0, getters = 0;
  const entry = path => ({ path, contentType: "text/javascript;charset=utf-8", body: "export {};" });
  const invalidPaths = ["/api/agent/proposal", "/SeRvEr/source.mjs", "/%61pp.js", "/app.js?q=1", "/app.js#x",
    "/a\\b.js", "/a//b.js", "/a/../b.js", "/app.js\n", "/é.js", "/" + "a".repeat(256)];
  const getterEntry = { path: "/", contentType: "text/html;charset=utf-8", get body() { getters++; return "read"; } };
  const invalid = [undefined, [], [{ ...entry("/"), extra: true }], ...invalidPaths.map(path => [entry(path)]),
    [{ ...entry("/"), contentType: "application/json" }], [{ ...entry("/"), body: new Uint8Array(1) }],
    [entry("/a.js"), entry("/a.js")], [getterEntry]];
  for (const publicAssets of invalid) assert.throws(() => hosts.createProposalApplicationHost({ publicAssets,
    enabled: true, createService: () => { factories++; } }), { code: "INVALID_PUBLIC_ASSETS" });
  assert.equal(getters, 0); assert.equal(factories, 0);
});

test("asset count and UTF-8 byte budgets accept their exact boundaries and reject excess", async () => {
  const body = "é".repeat(65536), entry = (i, text = body) => ({ path: `/asset${i}.js`, contentType: "text/javascript;charset=utf-8", body: text });
  const create = publicAssets => hosts.createProposalApplicationHost({ publicAssets, createService() {} });
  for (const publicAssets of [[entry(0)], Array.from({ length: 32 }, (_, i) => entry(i)),
    Array.from({ length: 256 }, (_, i) => entry(i, "")), [{ ...entry(0, ""), path: "/apiary.js" }]]) await create(publicAssets).close();
  for (const publicAssets of [[entry(0, body + "a")], Array.from({ length: 33 }, (_, i) => entry(i)),
    Array.from({ length: 257 }, (_, i) => entry(i, ""))]) assert.throws(() => create(publicAssets), { code: "INVALID_PUBLIC_ASSETS" });
});

test("public navigation rejects foreign and ambiguous Host, Origin and Fetch Metadata", async t => {
  const f = await fixture(t), boundHost = new URL(f.origin).host;
  const cases = [
    [{ host: `localhost:${new URL(f.origin).port}` }, 403, "ORIGIN_DENIED"],
    [{ headers: [`Host: ${boundHost}`] }, 400, "AMBIGUOUS_HEADERS"],
    [{ headers: ["Origin: https://foreign.example"] }, 403, "ORIGIN_DENIED"],
    [{ headers: [`Origin: ${f.origin}`, `Origin: ${f.origin}`] }, 400, "AMBIGUOUS_HEADERS"],
    [{ headers: ["Sec-Fetch-Site: cross-site"] }, 403, "ORIGIN_DENIED"],
    [{ headers: ["Sec-Fetch-Site: same-site"] }, 403, "ORIGIN_DENIED"],
    [{ headers: ["Sec-Fetch-Dest: iframe"] }, 403, "ORIGIN_DENIED"],
    [{ headers: ["Sec-Fetch-Dest: document", "Sec-Fetch-Dest: document"] }, 400, "AMBIGUOUS_HEADERS"],
  ];
  for (const [request, status, code] of cases) rawError(await raw(f.origin, request), status, code);
  assert.equal(await (await fetch(f.origin + "/")).text(), HTML);
  assert.equal(f.serviceCalls(), 0); assert.equal(f.proposalCalls(), 0);
});

test("public GET refuses bodies and compression before any service work", async t => {
  const f = await fixture(t);
  rawError(await raw(f.origin, { headers: ["Content-Length: 1"], body: "x" }), 400, "REQUEST_BODY_NOT_ALLOWED");
  rawError(await raw(f.origin, { headers: ["Transfer-Encoding: chunked"], body: "1\r\nx\r\n0\r\n\r\n" }), 400, "REQUEST_BODY_NOT_ALLOWED");
  rawError(await raw(f.origin, { headers: ["Content-Encoding: gzip"] }), 415, "ENCODING_REJECTED");
  const valid = await raw(f.origin, { headers: ["Content-Length: 0", "Content-Encoding: identity"] });
  assert.equal(valid.status, 200); assert.ok(valid.wire.endsWith(HTML));
  assert.equal(f.serviceCalls(), 0);
});

test("only declared exact GET targets are public; methods, query aliases and private paths retain API routing", async t => {
  const f = await fixture(t), headers = [`Origin: ${f.origin}`];
  for (const path of ["/?query=1", "/%61pp.js", "/public/../app.js", "/api/agent/register", "/server/openai-read-proposer.mjs", "/.env.local"])
    rawError(await raw(f.origin, { path, headers }), 404, "NOT_FOUND");
  rawError(await raw(f.origin, { method: "POST", headers: [...headers, "Content-Length: 0"] }), 404, "NOT_FOUND");
  const head = await fetch(f.origin + "/app.js", { method: "HEAD", headers: { origin: f.origin } });
  assert.equal(head.status, 404); assert.equal(await head.text(), "");
  await expected(await fetch(f.origin + "/api/agent/proposal", { headers: { origin: f.origin } }), 405, "METHOD_NOT_ALLOWED");
  assert.equal(f.serviceCalls(), 0); assert.equal(f.proposalCalls(), 0);
});

test("composed API still requires exact Origin, same-origin metadata, bearer JSON and bounded upload", async t => {
  const f = await fixture(t), { grant, init } = f.register();
  for (const [patch, status, code] of [[{ origin: undefined }, 403, "ORIGIN_DENIED"],
    [{ origin: "https://foreign.example" }, 403, "ORIGIN_DENIED"], [{ "sec-fetch-site": "none" }, 403, "ORIGIN_DENIED"],
    [{ authorization: undefined }, 401, "SESSION_REQUIRED"], [{ "content-type": "text/plain" }, 415, "JSON_REQUIRED"]]) {
    const headers = { ...init.headers, ...patch };
    for (const key of Object.keys(headers)) if (headers[key] === undefined) delete headers[key];
    await expected(await fetch(grant.endpoint, { ...init, headers }), status, code);
  }
  const oversized = await new Promise((resolve, reject) => {
    const req = httpRequest(grant.endpoint, { method: "POST", headers: init.headers }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(2000, () => req.destroy(Error("synthetic upload timed out"))); req.on("error", reject);
    req.write("x".repeat(4096)); req.end("x".repeat(4097));
  });
  assert.equal(oversized.status, 413); assert.deepEqual(JSON.parse(oversized.body), { error: "REQUEST_TOO_LARGE", executed: false });
  assert.equal(f.serviceCalls(), 0); assert.equal(f.proposalCalls(), 0);
  const accepted = await fetch(grant.endpoint, init);
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).executed, false);
  assert.equal(f.serviceCalls(), 1); assert.equal(f.proposalCalls(), 1);
});

test("public assets share API admission through timeout until ignored cancellation actually settles", async t => {
  const started = deferred(), finish = deferred(); let signal, first = true;
  t.after(() => finish.resolve(Response.json({ executed: false })));
  const f = await fixture(t, { maxConcurrentRequests: 1, requestTimeoutMs: 120,
    wrap: service => ({ ...service, handle: request => {
      if (!first) return service.handle(request);
      first = false; signal = request.signal; started.resolve(); return finish.promise;
    } }),
  });
  const { grant, init } = f.register(), pending = fetch(grant.endpoint, init);
  await started.promise;
  await expected(await fetch(f.origin + "/"), 429, "HOST_BUSY");
  await expected(await pending, 504, "HOST_REQUEST_TIMEOUT");
  assert.equal(signal.aborted, true); assert.equal(f.host.state.activeRequests, 1);
  await expected(await fetch(f.origin + "/app.js"), 429, "HOST_BUSY");
  finish.resolve(Response.json({ executed: false })); await nextTurn();
  assert.equal(f.host.state.activeRequests, 0);
  assert.equal(await (await fetch(f.origin + "/")).text(), HTML);
  const response = await fetch(grant.endpoint, init);
  assert.equal(response.status, 200); assert.equal((await response.json()).executed, false);
  assert.equal(f.proposalCalls(), 1); assert.equal(f.serviceCalls(), 2);
});

test("close cancels API work and fresh same-origin hosts require a new private grant", async t => {
  const started = deferred(), finish = deferred(); let signal;
  t.after(() => finish.resolve());
  const f = await fixture(t), registration = f.register(async (input, result) => {
    signal = input.signal; started.resolve(); await finish.promise; return result();
  });
  const pending = fetch(registration.grant.endpoint, registration.init).then(async response => ({ status: response.status, body: await response.text() }), () => null);
  await started.promise;
  await f.host.close(); await f.host.close();
  assert.equal(signal.aborted, true); assert.equal(f.disposed(), 1); assert.equal(f.host.state.status, "closed");
  await assert.rejects(f.host.start(), { code: "HTTP_HOST_CLOSED" });
  assert.throws(() => f.host.register({}), { code: "HTTP_HOST_NOT_READY" });
  const prior = await pending; assert.notEqual(prior?.status, 200);
  finish.resolve(); await nextTurn();
  const fresh = await fixture(t, { port: Number(new URL(f.origin).port) });
  assert.equal(fresh.origin, f.origin);
  await expected(await fetch(registration.grant.endpoint, registration.init), 401, "SESSION_REQUIRED");
  assert.equal(fresh.proposalCalls(), 0);
  assert.equal(await (await fetch(fresh.origin + "/")).text(), HTML);
  const current = fresh.register(), response = await fetch(current.grant.endpoint, current.init);
  assert.equal(response.status, 200); assert.equal((await response.json()).executed, false);
  assert.equal(fresh.proposalCalls(), 1);
});
