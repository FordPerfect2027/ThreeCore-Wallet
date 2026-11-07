import test from "node:test";
import assert from "node:assert/strict";
import { createProposalHttpHost } from "../server/proposal-http-host.mjs";

test("host normalizes constructor-forged diagnostics and retains genuine private error metadata", { timeout: 10000 }, async t => {
  let original;
  assert.throws(() => createProposalHttpHost({ port: -1, createService() {} }), error => {
    assert.equal(error.code, "INVALID_HTTP_HOST_CONFIG");
    original = error;
    return true;
  });
  // A caller can obtain this constructor without any service or listener access.
  const Captured = original.constructor;
  original.code = "SYNTHETIC_MUTATED_CODE";
  original.message = "SYNTHETIC_MUTATED_DETAIL";
  original.status = 201;
  let selected, calls = 0, disposals = 0;
  const observed = [];
  const host = createProposalHttpHost({ enabled: true, requestTimeoutMs: 1000,
    createService() { return {
      handle() {
        calls++;
        if (selected === "genuine-mutated") throw original;
        if (selected === "constructor-forged") throw new Captured("SYNTHETIC_PRIVATE_DIAGNOSTIC", 418);
        throw Error("SYNTHETIC_PRIVATE_DIAGNOSTIC");
      },
      register() {}, revoke() {}, dispose() { disposals++; },
    }; } });
  let activeBeforeClose;
  try {
    const { origin, endpoint } = await host.start();
    for (selected of ["ordinary", "genuine-mutated", "constructor-forged"]) {
      const response = await fetch(endpoint, { method: "POST", headers: {
        origin, "sec-fetch-site": "same-origin", "content-type": "application/json",
        authorization: "Bearer " + "a".repeat(64),
      }, body: "{}" });
      observed.push({ kind: selected, status: response.status, body: await response.json() });
    }
    activeBeforeClose = host.state.activeRequests;
  } finally {
    await host.close();
    t.diagnostic(JSON.stringify({ observed, cleanup: { status: host.state.status,
      activeBeforeClose, activeAfterClose: host.state.activeRequests, disposals, serviceCalls: calls } }));
  }
  assert.equal(calls, 3);
  assert.equal(disposals, 1);
  assert.equal(activeBeforeClose, 0);
  assert.equal(host.state.activeRequests, 0);
  assert.equal(host.state.status, "closed");
  assert.deepEqual(observed, [
    { kind: "ordinary", status: 502, body: { error: "HTTP_HOST_ERROR", executed: false } },
    { kind: "genuine-mutated", status: 503, body: { error: "INVALID_HTTP_HOST_CONFIG", executed: false } },
    { kind: "constructor-forged", status: 502, body: { error: "HTTP_HOST_ERROR", executed: false } },
  ]);
});
