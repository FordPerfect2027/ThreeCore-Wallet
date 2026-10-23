import test from "node:test";
import assert from "node:assert/strict";
import { collectPeriod } from "../src/period-reader.js";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { periodDraftProgress, periodDraftAnchors } from "../src/period-draft.js";
import { plan, checkpoint, periodSession, runFixture, context, OTHER, hash, clone, deferred, tick, code } from "./helpers/period-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) for (const chainId of [8453, 84532]) {
  test(`collects ${agent} ${chainId} in sequential windows with hash-pinned balances`, async () => {
    const selected = plan({}, context(agent, chainId));
    const f = await runFixture({}, selected);
    assert.equal(periodDraftProgress(f.draft).complete, true);
    assert.deepEqual(f.checkpoints.map(value => periodDraftProgress(value).completed), [1, 2, 3, 4, 5]);
    assert.deepEqual(f.calls.filter(row => row[0] === "balance").map(row => row[2]), [hash(30), hash(42)]);
    assert.deepEqual(f.calls.filter(row => row[0] === "logs").map(row => row[1]), [
      { fromBlock: "31", toBlock: "35", direction: "outgoing" },
      { fromBlock: "31", toBlock: "35", direction: "incoming" },
      { fromBlock: "36", toBlock: "40", direction: "outgoing" },
      { fromBlock: "36", toBlock: "40", direction: "incoming" },
      { fromBlock: "41", toBlock: "42", direction: "outgoing" },
      { fromBlock: "41", toBlock: "42", direction: "incoming" },
    ]);
    assert.equal(f.progress.at(-1).stage, "complete");
  });
}

test("historical identity reader requests the exact decimal block and preserves provenance", async () => {
  const f = periodSession();
  const result = await readTokenIdentity(f.session, { blockNumber: "30" });
  assert.equal(result.blockNumber, "30");
  assert.equal(result.blockHash, hash(30));
  assert.equal(f.calls[0][1], "0x1e");
  assert.equal(f.calls.at(-1)[1], "0x1e");
  assert.equal(result.siteOrigin, f.state.siteOrigin);
});

for (const blockNumber of [null, 30, -1, "-1", "0x1e", "030", "", "9".repeat(79)]) {
  test("historical identity rejects invalid block before RPC: " + String(blockNumber), async () => {
    const f = periodSession();
    await assert.rejects(readTokenIdentity(f.session, { blockNumber }));
    assert.deepEqual(f.calls, []);
  });
}

test("historical identity never accepts a silently substituted latest block", async () => {
  const f = periodSession();
  f.session.getBlockSnapshot = async () => ({ number: "0x2a", hash: hash(42) });
  await assert.rejects(readTokenIdentity(f.session, { blockNumber: "30" }), code("IDENTITY_BLOCK"));
});

for (const completed of [0, 1, 2, 3, 4, 5]) {
  test("resume rechecks all saved anchors then reads only missing steps: " + completed, async () => {
    const saved = checkpoint(completed);
    const f = periodSession();
    const anchors = periodDraftAnchors(saved);
    const output = await collectPeriod(f.session, saved.plan, { draft: saved });
    assert.equal(periodDraftProgress(output).complete, true);
    assert.deepEqual(f.calls.slice(0, anchors.length), anchors.map(row => ["block", "0x" + BigInt(row.number).toString(16)]));
    assert.equal(f.calls.filter(row => row[0] === "balance").length, Math.max(0, 2 - completed));
    assert.equal(f.calls.filter(row => row[0] === "logs").length, 2 * (3 - Math.max(0, completed - 2)));
    assert.deepEqual(saved, checkpoint(completed));
  });
}

for (const anchor of ["30", "31", "35", "36", "40", "41", "42"]) {
  test("resume fails closed if saved anchor changed: " + anchor, async () => {
    const f = periodSession();
    f.hashes.set(anchor, hash(999));
    await assert.rejects(collectPeriod(f.session, plan(), { draft: checkpoint() }), code("PERIOD_BLOCK_CHANGED"));
    assert.equal(f.calls.some(row => row[0] === "logs" || row[0] === "balance"), false);
  });
}

test("reorg after the last checkpoint fails the final check", async () => {
  const f = periodSession();
  let saved;
  await assert.rejects(collectPeriod(f.session, plan(), { onCheckpoint(value) {
    saved = value;
    if (periodDraftProgress(value).complete) f.hashes.set("30", hash(999));
  } }), code("PERIOD_BLOCK_CHANGED"));
  assert.equal(periodDraftProgress(saved).complete, true);
  // Complete collected evidence must not be confused with a successful final check.
  assert.equal(saved.independentlyVerified, false);
});

test("final recheck includes a saved event hash away from the endpoints", async () => {
  const selected = plan({ windowSize: 12 });
  const f = periodSession(selected);
  await assert.rejects(collectPeriod(f.session, selected, { onCheckpoint(value) {
    if (periodDraftProgress(value).complete) f.hashes.set("35", hash(999));
  } }), code("PERIOD_BLOCK_CHANGED"));
});

for (const field of ["account", "chainId", "agent", "connectionEpoch", "siteOrigin", "connected"]) {
  test("current session identity changes stop all subsequent reads: " + field, async () => {
    const f = periodSession();
    let countAfterChange;
    await assert.rejects(collectPeriod(f.session, plan(), { onCheckpoint() {
      f.state[field] = { account: OTHER, chainId: 84532, agent: "EMA", connectionEpoch: 2,
        siteOrigin: "http://127.0.0.1:4185", connected: false }[field];
      countAfterChange = f.calls.length;
    } }), code("PERIOD_SESSION_CHANGED"));
    assert.equal(f.calls.length, countAfterChange);
  });
}

for (const field of ["canSign", "canSendTransactions", "canBridge"]) {
  test("transaction-capable session is rejected before reads: " + field, async () => {
    const f = periodSession();
    f.state[field] = true;
    await assert.rejects(collectPeriod(f.session, plan()), code("PERIOD_CAPABILITIES"));
    assert.deepEqual(f.calls, []);
  });
}

for (const method of ["getBlockSnapshot", "getContractCode", "getNativeBalance", "getTokenMetadata", "getTokenBalance", "getTransferEvents"]) {
  test("missing required read method is rejected: " + method, async () => {
    const f = periodSession();
    delete f.session[method];
    await assert.rejects(collectPeriod(f.session, plan()), code("PERIOD_SESSION"));
    assert.deepEqual(f.calls, []);
  });
}

test("plan cannot be reused on another connected account", async () => {
  const f = periodSession();
  f.state.account = OTHER;
  await assert.rejects(collectPeriod(f.session, plan()), code("PERIOD_CONTEXT_MISMATCH"));
  assert.deepEqual(f.calls, []);
});

test("partial draft cannot be resumed under a different interval", async () => {
  const f = periodSession();
  await assert.rejects(collectPeriod(f.session, plan({ laterBlock: "43" }), { draft: checkpoint(2) }), code("PERIOD_PLAN_MISMATCH"));
  assert.deepEqual(f.calls, []);
});

for (const timeoutMs of [0, -1, 120001, 1.5, "30", Infinity]) {
  test("invalid operation timeout fails before reads: " + timeoutMs, async () => {
    const f = periodSession();
    await assert.rejects(collectPeriod(f.session, plan(), { timeoutMs }), code("PERIOD_TIMEOUT_OPTION"));
    assert.deepEqual(f.calls, []);
  });
}

test("abort before start performs no read", async () => {
  const f = periodSession();
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(collectPeriod(f.session, plan(), { signal: aborter.signal }), code("PERIOD_CANCELLED"));
  assert.deepEqual(f.calls, []);
});

test("abort during a pending provider call ignores its late result and sends no next request", async () => {
  const gate = deferred();
  const f = periodSession(plan(), { before: async method => { if (method === "native") await gate.promise; } });
  const aborter = new AbortController();
  const saved = [];
  const pending = collectPeriod(f.session, plan(), { signal: aborter.signal, onCheckpoint: value => saved.push(value) });
  while (!f.calls.some(row => row[0] === "native")) await tick();
  const count = f.calls.length;
  aborter.abort();
  await assert.rejects(pending, code("PERIOD_CANCELLED"));
  gate.resolve();
  await tick();
  assert.equal(f.calls.length, count);
  assert.deepEqual(saved, []);
});

test("operation timeout releases the caller without starting later RPCs", async () => {
  const gate = deferred();
  const f = periodSession(plan(), { before: () => gate.promise });
  const pending = collectPeriod(f.session, plan(), { timeoutMs: 10 });
  await assert.rejects(pending, code("PERIOD_TIMEOUT"));
  gate.resolve();
  await tick();
  assert.equal(f.calls.length, 1);
});

test("failed incoming query retains earlier completed windows but not the failed interval", async () => {
  const f = periodSession(plan(), { before(method, [request]) {
    if (method === "logs" && request.fromBlock === "36" && request.direction === "incoming") throw Error("down");
  } });
  const saved = [];
  await assert.rejects(collectPeriod(f.session, plan(), { onCheckpoint: value => saved.push(value) }), code("TRANSFER_RPC_FAILED"));
  assert.deepEqual(saved.map(value => periodDraftProgress(value).completed), [1, 2, 3]);
  assert.equal(saved.at(-1).records.length, 1);
  assert.equal(f.calls.filter(row => row[0] === "logs" && row[1].fromBlock === "36").length, 2);
});

test("no automatic retry is triggered by provider throttling", async () => {
  const f = periodSession(plan(), { before(method) { if (method === "balance") throw Object.assign(Error("throttled"), { code: 429 }); } });
  await assert.rejects(collectPeriod(f.session, plan()), code("PERIOD_READ_FAILED"));
  assert.equal(f.calls.filter(row => row[0] === "balance").length, 1);
});

test("throwing and asynchronously rejecting presentation callbacks do not change evidence", async () => {
  const f = periodSession();
  const result = await collectPeriod(f.session, plan(), {
    onProgress() { throw Error("display"); }, onCheckpoint() { return Promise.reject(Error("save unavailable")); },
  });
  assert.equal(periodDraftProgress(result).complete, true);
});

test("synchronous cancellation from progress prevents the immediately following read", async () => {
  const f = periodSession();
  const aborter = new AbortController();
  await assert.rejects(collectPeriod(f.session, plan(), { signal: aborter.signal,
    onProgress(value) { if (value.stage === "earlier") aborter.abort(); },
  }), code("PERIOD_CANCELLED"));
  assert.deepEqual(f.calls, []);
});

test("the input draft is never mutated by a resumed run", async () => {
  const input = clone(checkpoint(3));
  const key = JSON.stringify(input);
  const f = periodSession();
  const result = await collectPeriod(f.session, plan(), { draft: input });
  assert.equal(JSON.stringify(input), key);
  assert.equal(result.records.length, 3);
});

test("resumed observation provenance stays historical across connection origins", async () => {
  const saved = clone(checkpoint(1));
  saved.earlier.siteOrigin = "http://localhost:4185";
  saved.earlier.connectionEpoch = 99;
  const f = periodSession();
  const result = await collectPeriod(f.session, plan(), { draft: saved });
  assert.equal(result.earlier.siteOrigin, "http://localhost:4185");
  assert.equal(result.later.siteOrigin, "http://127.0.0.1:4193");
  assert.equal(result.earlier.connectionEpoch, 99);
  assert.equal(result.later.connectionEpoch, 1);
});
