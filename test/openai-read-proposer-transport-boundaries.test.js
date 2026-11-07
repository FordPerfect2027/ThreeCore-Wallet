import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createOpenAIReadProposer } from "../server/openai-read-proposer.mjs";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";

// Local synthetic transports only. No environment files, provider keys or network.
const NOW = 1800000000000, MARKER = "SYNTHETIC_PROVIDER_EXCEPTION_MARKER";
const address = n => "0x" + n.repeat(40);
const payload = new TextEncoder().encode(JSON.stringify({ status: "completed", output: [
  { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text",
    text: JSON.stringify({ decision: "inspect", targetIndex: 0, rationale: "Inspect the configured synthetic target" }) }] },
] }));

function fixture(fetchImpl, options = {}) {
  const registry = createAgentReadPolicyRegistry();
  const identity = { agent: "DAT", account: address("1"), chainId: 84532, siteOrigin: "https://fixture.invalid" };
  registry.set("DAT", JSON.stringify({ schema: "threecore-agent-read-config-v1", ...identity,
    maxProposalAgeMs: 60000, targets: [{ tokenAddress: address("4"), spenderAddress: address("7") }] }));
  const state = { ...identity, connected: true, connectionEpoch: 0, canSign: false, canSendTransactions: false, canBridge: false };
  const adapter = createOpenAIReadProposer({ enabled: true, apiKey: "sk-synthetic-only-not-a-key", model: "synthetic-no-network",
    now: () => NOW, newId: () => "transport-boundary", fetchImpl, ...options });
  return { adapter, run: extra => adapter.propose({ objective: "Inspect configured target",
    readContext: () => ({ policyText: registry.readPolicyText("DAT"), sessionState: state }), ...extra }) };
}

async function genuineError() {
  const disabled = createOpenAIReadProposer({ fetchImpl: () => { throw Error("Disabled fixture must not fetch"); } });
  try { await disabled.propose(); } catch (error) { return error; }
  assert.fail("Disabled adapter must reject");
}
async function canonicalRejection(promise, code, original) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.notEqual(error, original);
    assert.equal(String(error.stack).includes(MARKER), false);
    return true;
  });
}

test("proposer sanitizes rejected Proxy without inspecting its prototype", async () => {
  let inspected = 0, dispatched = 0;
  const original = new Proxy({}, { getPrototypeOf() { inspected++; throw Error(MARKER); } });
  const f = fixture(async () => { dispatched++; throw original; });
  await canonicalRejection(f.run(), "MODEL_REQUEST_REJECTED", original);
  assert.equal(inspected, 0);
  assert.equal(dispatched, 1);
  assert.deepEqual(f.adapter.status(), { enabled: true, attempts: 1, remaining: 0, busy: false });
});

test("proposer sanitizes a revoked Proxy instead of leaking a native classifier error", async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  const f = fixture(async () => { throw proxy; });
  await canonicalRejection(f.run(), "MODEL_REQUEST_REJECTED", proxy);
  assert.equal(f.adapter.status().attempts, 1);
  assert.equal(f.adapter.status().busy, false);
});

test("proposer rebuilds a mutated genuine exception from its original private code", async () => {
  const original = await genuineError();
  original.code = MARKER; original.message = MARKER;
  let constructorReads = 0;
  Object.defineProperty(original, "constructor", { get() { constructorReads++; throw Error(MARKER); } });
  const f = fixture(async () => { throw original; });
  await canonicalRejection(f.run(), "MODEL_DISABLED", original);
  assert.equal(constructorReads, 0);
  assert.equal(f.adapter.status().busy, false);
});

test("a captured internal exception constructor cannot fabricate a trusted error code", async () => {
  const captured = await genuineError();
  const original = new captured.constructor(MARKER);
  const f = fixture(async () => { throw original; });
  await canonicalRejection(f.run(), "MODEL_REQUEST_REJECTED", original);
  assert.equal(f.adapter.status().attempts, 1);
  assert.equal(f.adapter.status().busy, false);
});

test("finite empty response chunks cannot bypass the elapsed transport deadline", async () => {
  const emptyChunks = 12000;
  let pulls = 0, cancelled = 0;
  const f = fixture(async () => new Response(new ReadableStream({
    pull(stream) {
      // One bounded 12 ms callback guarantees the 5 ms budget is exceeded even
      // on fast hardware; the stream itself remains finite and byte-bounded.
      if (pulls === 128) { const end = performance.now() + 12; while (performance.now() < end) {} }
      if (pulls++ < emptyChunks) stream.enqueue(new Uint8Array(0));
      else { stream.enqueue(payload); stream.close(); }
    },
    cancel() { cancelled++; },
  }), { headers: { "content-type": "application/json" } }), { timeoutMs: 5 });
  await canonicalRejection(f.run(), "MODEL_TIMEOUT");
  assert(pulls < emptyChunks, "An elapsed deadline stops finite prompt response reads before completion");
  assert(cancelled > 0, "The owned response body is cancelled");
  assert.deepEqual(f.adapter.status(), { enabled: true, attempts: 1, remaining: 0, busy: false });
});

test("finite prompt response reads give a queued caller cancellation a turn", async () => {
  const emptyChunks = 12000, controller = new AbortController();
  let pulls = 0, cancelled = 0, cancellationTurnRan = false, immediate;
  const f = fixture(async () => {
    immediate = setImmediate(() => { cancellationTurnRan = true; controller.abort(); });
    return new Response(new ReadableStream({
      pull(stream) {
        if (pulls++ < emptyChunks) stream.enqueue(new Uint8Array(0));
        else { stream.enqueue(payload); stream.close(); }
      }, cancel() { cancelled++; },
    }), { headers: { "content-type": "application/json" } });
  }, { timeoutMs: 60000 });
  try {
    await canonicalRejection(f.run({ signal: controller.signal }), "MODEL_CANCELLED");
    assert.equal(cancellationTurnRan, true);
    assert(pulls < emptyChunks, "The pending caller stop runs before the finite stream completes");
    assert(cancelled > 0, "Cancellation releases the response body");
    assert.deepEqual(f.adapter.status(), { enabled: true, attempts: 1, remaining: 0, busy: false });
  } finally { clearImmediate(immediate); }
});
