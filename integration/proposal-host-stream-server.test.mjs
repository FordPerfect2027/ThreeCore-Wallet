import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { createProposalHttpHost } from "../server/proposal-http-host.mjs";

// Local loopback transport and synthetic adapters only; no wallet or model.
async function fixture(t, handle, requestTimeoutMs = 1000) {
  const host = createProposalHttpHost({ enabled: true, requestTimeoutMs,
    maxConnections: 4, maxConcurrentRequests: 1,
    createService: () => ({ handle, register() {}, revoke() {}, dispose() {} }) });
  t.after(() => host.close());
  const { origin, endpoint } = await host.start();
  const request = (options = {}) => fetch(endpoint, { method: "POST", body: "{}",
    headers: { origin, authorization: "Bearer " + "a".repeat(64), "content-type": "application/json" }, ...options });
  return { host, request };
}
async function until(predicate) {
  const limit = performance.now() + 2000;
  while (!predicate()) { assert(performance.now() < limit, "host cleanup must settle"); await nextTurn(); }
}

test("prompt empty response chunks cannot bypass the host deadline", async t => {
  const limit = 100000, empty = new Uint8Array(0);
  let chunks = 0, cancelled = 0;
  const f = await fixture(t, () => new Response(new ReadableStream({
    pull(controller) {
      if (++chunks <= limit) controller.enqueue(empty);
      else { controller.enqueue(new TextEncoder().encode('{"executed":false}')); controller.close(); }
    },
    cancel() { cancelled++; },
  }), { headers: { "content-type": "application/json" } }), 20);
  const response = await f.request();
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: "HOST_REQUEST_TIMEOUT", executed: false });
  assert(chunks < limit, "the response loop must stop before exhausting the prompt stream");
  assert.equal(cancelled, 1);
  assert.equal(f.host.state.activeRequests, 0);
});

test("prompt byte response chunks yield to client cancellation and permit recovery", async t => {
  const limit = 100000, space = new Uint8Array([32]), abort = new AbortController();
  let chunks = 0, cancelled = 0, calls = 0, timer;
  t.after(() => clearTimeout(timer));
  const f = await fixture(t, () => {
    if (++calls > 1) return Response.json({ recovered: true, executed: false });
    timer = setTimeout(() => abort.abort(), 0);
    return new Response(new ReadableStream({
      pull(controller) {
        if (++chunks <= limit) controller.enqueue(space);
        else { controller.enqueue(new TextEncoder().encode('{"executed":false}')); controller.close(); }
      },
      cancel() { cancelled++; },
    }), { headers: { "content-type": "application/json" } });
  });
  await assert.rejects(f.request({ signal: abort.signal }), { name: "AbortError" });
  await until(() => f.host.state.activeRequests === 0);
  assert(chunks < limit, "a cancelled client must not wait for every prompt chunk");
  assert.equal(cancelled, 1);
  assert.equal(calls, 1);
  const recovered = await f.request();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { recovered: true, executed: false });
  assert.equal(calls, 2);
});

test("an elapsed response deadline is rejected before a delayed timer callback runs", async t => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    // Simulate bounded in-process formatting work that resolves through microtasks.
    const untilTime = performance.now() + 40;
    while (performance.now() < untilTime) await Promise.resolve();
    return Response.json({ executed: false });
  }, 20);
  const response = await f.request();
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: "HOST_REQUEST_TIMEOUT", executed: false });
  assert.equal(calls, 1);
  assert.equal(f.host.state.activeRequests, 0);
});

test("finite fragmented JSON and empty chunks retain exact bytes within the deadline", async t => {
  const expected = { message: "ThreeCore \u03b1\u03b2\u03b3".repeat(40), executed: false };
  const encoded = new TextEncoder().encode(JSON.stringify(expected));
  let index = 0;
  const f = await fixture(t, () => new Response(new ReadableStream({
    pull(controller) {
      if (index === encoded.length) { controller.close(); return; }
      controller.enqueue(new Uint8Array(0));
      controller.enqueue(encoded.subarray(index, ++index));
    },
  }), { headers: { "content-type": "application/json" } }));
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  assert.equal(index, encoded.length);
  assert.equal(f.host.state.activeRequests, 0);
});
