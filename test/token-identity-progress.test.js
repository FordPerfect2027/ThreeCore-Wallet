import test from "node:test";
import assert from "node:assert/strict";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { observation, ACCOUNT, deferred, tick, readerSession } from "./helpers/identity-fixtures.js";

function fixture() {
  const gate = deferred();
  const context = { agent: "DAT", chainId: 8453, account: ACCOUNT };
  let update;
  const views = [];
  const controller = createTokenIdentityController({
    getContext: () => context,
    read: input => { update = input.onProgress; return gate.promise; },
    onChange: state => views.push(state),
  });
  const pending = controller.inspect();
  return { controller, context, gate, views, pending, update: (stage, agent = "DAT") => update({ stage, agent }) };
}

test("progress starts empty and only increases through known stages", async () => {
  const f = fixture();
  assert.equal(f.controller.state().progress, null);
  for (const stage of ["block", "code", "native", "metadata", "balance", "canonical", "complete"]) {
    f.update(stage);
    assert.equal(f.controller.state().progress, stage);
    assert.equal(f.controller.state().phase, "reading");
    assert.equal(f.controller.state().observation, null);
  }
  f.gate.resolve(observation());
  assert.equal(await f.pending, true);
  assert.equal(f.controller.state().progress, null);
});

test("duplicate or backward progress is ignored", async () => {
  const f = fixture();
  f.update("metadata");
  const count = f.views.length;
  f.update("metadata");
  f.update("block");
  f.update("code");
  assert.equal(f.views.length, count);
  assert.equal(f.controller.state().progress, "metadata");
  f.gate.resolve(observation());
  await f.pending;
});

for (const stage of ["unknown", "", "__proto__", "constructor", "private diagnostic"]) {
  test("unrecognized progress cannot enter UI state: " + stage, async () => {
    const f = fixture();
    f.update(stage);
    assert.equal(f.controller.state().progress, null);
    f.gate.resolve(observation());
    await f.pending;
  });
}

for (const agent of ["EMA", "CAWELON", undefined, "dat"]) {
  test("progress for another agent is ignored: " + String(agent), async () => {
    const f = fixture();
    // Passing undefined to the helper would use its default.
    if (agent !== undefined) f.update("balance", agent);
    else f.update("balance", null);
    assert.equal(f.controller.state().progress, null);
    f.gate.resolve(observation());
    await f.pending;
  });
}

test("complete stage is not completion until the returned record validates", async () => {
  const f = fixture();
  f.update("complete");
  assert.equal(f.controller.state().phase, "reading");
  f.gate.resolve({ broken: true });
  assert.equal(await f.pending, false);
  assert.equal(f.controller.state().phase, "error");
  assert.equal(f.controller.state().progress, null);
  assert.equal(f.controller.state().observation, null);
});

for (const stop of ["cancel", "invalidate", "dispose"]) {
  test("late progress after " + stop + " cannot recreate a result", async () => {
    const f = fixture();
    f.update("block");
    f.controller[stop]();
    f.update("metadata");
    f.update("complete");
    f.gate.resolve(observation());
    assert.equal(await f.pending, false);
    assert.equal(f.controller.state().progress, null);
    assert.equal(f.controller.state().observation, null);
  });
}

test("changed input detected by progress invalidates the operation", async () => {
  const f = fixture();
  f.context.chainId = 84532;
  f.update("balance");
  assert.equal(f.controller.state().errorCode, "IDENTITY_STALE");
  assert.equal(f.controller.state().progress, null);
  f.gate.resolve(observation());
  assert.equal(await f.pending, false);
});

test("a callback retained by an older read cannot change a newer read", async () => {
  const gates = [deferred(), deferred()];
  const updates = [];
  let index = 0;
  const controller = createTokenIdentityController({
    getContext: () => ({ agent: "DAT", chainId: 8453, account: ACCOUNT }),
    read: input => { updates.push(input.onProgress); return gates[index++].promise; },
  });
  const first = controller.inspect();
  controller.cancel();
  const second = controller.inspect();
  updates[1]({ stage: "code", agent: "DAT" });
  updates[0]({ stage: "complete", agent: "DAT" });
  assert.equal(controller.state().progress, "code");
  gates[0].resolve(observation());
  gates[1].resolve(observation());
  assert.equal(await first, false);
  assert.equal(await second, true);
});

test("real collector stages reach controller without releasing provisional data", async () => {
  const f = readerSession();
  const states = [];
  const controller = createTokenIdentityController({
    getContext: () => ({ agent: "DAT", chainId: 8453, account: ACCOUNT }),
    read: options => readTokenIdentity(f.session, options),
    onChange: state => states.push(state),
  });
  assert.equal(await controller.inspect(), true);
  assert.deepEqual(states.filter(state => state.progress).map(state => state.progress),
    ["block", "code", "native", "metadata", "balance", "canonical", "complete"]);
  assert.ok(states.filter(state => state.phase === "reading").every(state => state.observation === null));
});

test("missing code skips token subreads but still completes canonical confirmation", async () => {
  const f = readerSession({ hasCode: false, metadata: null, balanceBaseUnits: null });
  const states = [];
  const controller = createTokenIdentityController({
    getContext: () => ({ agent: "DAT", chainId: 8453, account: ACCOUNT }),
    read: options => readTokenIdentity(f.session, options),
    onChange: state => states.push(state),
  });
  assert.equal(await controller.inspect(), true);
  assert.deepEqual(states.filter(state => state.progress).map(state => state.progress),
    ["block", "code", "native", "canonical", "complete"]);
  assert.equal(controller.state().assessment.status, "missing-code");
});

test("failure clears progress and does not schedule automatic retries", async () => {
  const f = fixture();
  f.update("code");
  f.gate.resolve(Promise.reject(Error("provider unavailable")));
  assert.equal(await f.pending, false);
  await tick();
  assert.equal(f.controller.state().progress, null);
  assert.equal(f.controller.state().phase, "error");
});
