import test from "node:test";
import assert from "node:assert/strict";
import { createAllowanceController } from "../src/allowance-controller.js";
import { targets, record, saved, S1, S2, ACCOUNT, OTHER, deferred, tick, nextRecord, code } from "./helpers/allowance-fixtures.js";

function fixture(options = {}) {
  let context = { ...targets(), account: ACCOUNT };
  const events = [];
  const reads = [];
  const controller = createAllowanceController({
    getContext: () => context,
    onChange: state => events.push(state),
    read: async (plan, opts) => { reads.push({ plan, opts }); return record({ targets: plan }); },
    ...options,
  });
  return { controller, events, reads, setContext(value) { context = value; },
    configure() {
      assert.equal(controller.preview(S1 + " | Exchange A\n" + S2 + " | Exchange B"), true);
      assert.equal(controller.apply(), true);
    } };
}
test("allowance controller: explicit preview/apply/read lifecycle", async () => {
  const f = fixture();
  assert.equal(f.controller.state().phase, "idle");
  assert.equal(f.reads.length, 0);
  f.configure();
  assert.equal(f.controller.state().phase, "configured");
  assert.equal(f.reads.length, 0);
  assert.equal(await f.controller.inspect(), true);
  const state = f.controller.state();
  assert.equal(state.phase, "ready");
  assert.equal(state.provenance, "read");
  assert.equal(f.reads.length, 1);
  assert.deepEqual(state.observation, record());
  assert(Object.isFrozen(state));
});
test("allowance controller: preview alone never authorizes read", async () => {
  const f = fixture();
  f.controller.preview(S1);
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.reads.length, 0);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_REVIEW_REQUIRED");
});
test("allowance controller: invalid draft clears previous result and plan", async () => {
  const f = fixture();
  f.configure();
  await f.controller.inspect();
  assert.equal(f.controller.preview("invalid"), false);
  assert.equal(f.controller.state().observation, null);
  assert.equal(f.controller.state().plan, null);
});
for (const mutation of ["account", "chainId", "agent", "tokenAddress"]) {
  test("allowance controller: context changes invalidate staged plan " + mutation, () => {
    const f = fixture();
    f.controller.preview(S1);
    const context = { ...targets(), account: ACCOUNT };
    if (mutation === "account") context.account = OTHER;
    if (mutation === "chainId") Object.assign(context, targets("DAT", 84532));
    if (mutation === "agent") Object.assign(context, targets("EMA"));
    if (mutation === "tokenAddress") context.tokenAddress = S1;
    f.setContext(context);
    assert.equal(f.controller.apply(), false);
    assert.equal(f.controller.state().plan, null);
  });
}
test("allowance controller: one staged plan can only be applied once", () => {
  const f = fixture();
  f.configure();
  assert.equal(f.controller.apply(), false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_REVIEW_REQUIRED");
});
for (const method of ["invalidate", "editTargets", "cancel", "dispose"]) {
  test("allowance controller: " + method + " aborts in-flight read and ignores its result", async () => {
    const pending = deferred();
    let signal;
    const f = fixture({ read: (plan, options) => { signal = options.signal; return pending.promise; } });
    f.configure();
    const operation = f.controller.inspect();
    f.controller[method]();
    assert.equal(signal.aborted, true);
    pending.resolve(record());
    assert.equal(await operation, false);
    assert.equal(f.controller.state().observation, null);
  });
}
test("allowance controller: newer read supersedes old without clearing new result", async () => {
  const older = deferred();
  let calls = 0;
  const f = fixture({ read: async () => ++calls === 1 ? older.promise : nextRecord(record()) });
  f.configure();
  const first = f.controller.inspect();
  assert.equal(await f.controller.inspect(), true);
  older.reject(Error("late"));
  assert.equal(await first, false);
  assert.equal(f.controller.state().observation.identity.blockNumber, "43");
  assert.equal(f.controller.state().errorCode, null);
});
test("allowance controller: context changes during read cause no ready state", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  f.configure();
  const operation = f.controller.inspect();
  f.setContext({ ...targets(), account: OTHER });
  pending.resolve(record());
  assert.equal(await operation, false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_CONTEXT_CHANGED");
  assert.equal(f.controller.state().plan, null);
});
test("allowance controller: no account causes no read", async () => {
  const f = fixture();
  f.setContext({ ...targets(), account: "" });
  f.configure();
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_NOT_CONNECTED");
  assert.equal(f.reads.length, 0);
});
for (const change of [
  r => { r.identity.account = OTHER; },
  r => { Object.assign(r, record({}, "EMA")); },
  r => { Object.assign(r, record({}, "DAT", 84532)); },
  r => { r.rows[0].label = r.targets.targets[0].label = "Changed"; },
  r => { r.rows.reverse(); r.targets.targets.reverse(); },
]) {
  test("allowance controller: result must match exact applied request " + change.toString(), async () => {
    const f = fixture({ read: async () => { const result = record(); change(result); return result; } });
    f.configure();
    assert.equal(await f.controller.inspect(), false);
    assert.equal(f.controller.state().errorCode, "ALLOWANCE_RESULT_CONTEXT");
    assert.equal(f.controller.state().observation, null);
  });
}
test("allowance controller: read error retains plan for explicit retry", async () => {
  let calls = 0;
  const f = fixture({ read: async () => {
    if (++calls === 1) throw Object.assign(Error("failed"), { code: "ALLOWANCE_TIMEOUT" });
    return record();
  } });
  f.configure();
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_TIMEOUT");
  assert(f.controller.state().plan);
  assert.equal(await f.controller.inspect(), true);
  assert.equal(calls, 2);
});
test("allowance controller: observer reentrancy during reading prevents RPC", async () => {
  let controller;
  let reads = 0;
  controller = createAllowanceController({
    getContext: () => ({ ...targets(), account: ACCOUNT }),
    read: () => { reads++; return record(); },
    onChange(state) { if (state.phase === "reading") controller.cancel(); },
  });
  controller.preview(S1);
  controller.apply();
  assert.equal(await controller.inspect(), false);
  assert.equal(reads, 0);
});
test("allowance controller: synchronous and asynchronous observer errors are isolated", async () => {
  for (const asyncError of [false, true]) {
    const f = fixture({ onChange() { if (asyncError) return Promise.reject(Error("observer")); throw Error("observer"); } });
    f.configure();
    assert.equal(await f.controller.inspect(), true);
    await tick();
  }
});
test("allowance controller: progress only accepts current monotonic finite values", async () => {
  const pending = deferred();
  let progress;
  const f = fixture({ read: (plan, options) => { progress = options.onProgress; return pending.promise; } });
  f.configure();
  const operation = f.controller.inspect();
  const event = { agent: "DAT", stage: "row-complete", completed: 1, total: 2, spenderAddress: S1 };
  progress(event);
  assert.equal(f.controller.state().progress.completed, 1);
  for (const patch of [
    { completed: 0 }, { completed: 3 }, { completed: NaN }, { total: 3 },
    { agent: "EMA" }, { stage: "signing" }, { spenderAddress: OTHER },
  ]) {
    progress({ ...event, ...patch });
    assert.equal(f.controller.state().progress.completed, 1);
    assert.equal(f.controller.state().progress.stage, "row-complete");
  }
  pending.resolve(record());
  await operation;
  progress({ ...event, completed: 2 });
  assert.equal(f.controller.state().progress, null);
});
test("allowance controller: importing targets stages preview without RPC", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await saved("targets", targets())), true);
  assert.equal(f.controller.state().phase, "preview");
  assert.equal(f.controller.state().plan, null);
  assert.equal(f.reads.length, 0);
  assert.equal(f.controller.apply(), true);
});
test("allowance controller: importing observations is historical and does not apply targets", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await saved()), true);
  assert.equal(f.controller.state().provenance, "imported");
  assert.equal(f.controller.state().plan, null);
  assert.equal(f.reads.length, 0);
});
test("allowance controller: offline observation from another account is labelled historical", async () => {
  const f = fixture();
  const value = record();
  value.identity.account = OTHER;
  assert.equal(await f.controller.load(await saved("observation", value)), true);
  assert.equal(f.controller.state().observation.identity.account, OTHER);
  assert.equal(f.controller.state().provenance, "imported");
  assert.equal(f.reads.length, 0);
});
test("allowance controller: another token's record is rejected", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await saved("observation", record({}, "EMA"))), false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_IMPORT_AGENT");
});
test("allowance controller: target plan from another chain is not silently applied", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await saved("targets", targets("DAT", 84532))), false);
  assert.equal(f.controller.state().plan, null);
});
test("allowance controller: cancelled file read never displays late contents", async () => {
  const pending = deferred();
  const f = fixture();
  const file = await saved();
  const original = file.arrayBuffer;
  file.arrayBuffer = async () => { await pending.promise; return original(); };
  const operation = f.controller.load(file);
  f.controller.cancel();
  pending.resolve();
  assert.equal(await operation, false);
  assert.equal(f.controller.state().observation, null);
});
test("allowance controller: targets and observations save explicitly", async () => {
  const f = fixture();
  f.configure();
  assert.equal(await f.controller.prepare("targets"), true);
  assert.equal(f.controller.state().file.kind, "targets");
  assert.equal(f.reads.length, 0);
  await f.controller.inspect();
  assert.equal(await f.controller.prepare("observation"), true);
  assert.equal(f.controller.state().file.kind, "observation");
});
test("allowance controller: stale prepared download ignored after edit", async () => {
  const gate = deferred();
  const f = fixture({ subtle: { async digest(algorithm, bytes) {
    await gate.promise;
    return crypto.subtle.digest(algorithm, bytes);
  } } });
  f.configure();
  const operation = f.controller.prepare("targets");
  f.controller.editTargets();
  gate.resolve();
  assert.equal(await operation, false);
  assert.equal(f.controller.state().file, null);
});
test("allowance controller: baseline survives a target draft edit and can be compared later", async () => {
  let value = record();
  const f = fixture({ read: async () => value });
  f.configure();
  await f.controller.inspect();
  assert.equal(f.controller.useAsBaseline(), true);
  f.controller.editTargets();
  assert(f.controller.state().baseline);
  f.configure();
  value = nextRecord(value);
  value.rows[1].allowanceBaseUnits = "11";
  await f.controller.inspect();
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state().comparison.rows[1].deltaBaseUnits, "1");
  f.controller.invalidate();
  assert.equal(f.controller.state().baseline, null);
});
test("allowance controller: failed comparison retains both visible records", async () => {
  const f = fixture();
  await f.controller.load(await saved());
  f.controller.useAsBaseline();
  const different = record();
  different.identity.account = OTHER;
  await f.controller.load(await saved("observation", different));
  assert.equal(f.controller.compare(), false);
  assert.equal(f.controller.state().errorCode, "ALLOWANCE_COMPARE_CONTEXT");
  assert(f.controller.state().baseline);
  assert(f.controller.state().observation);
});
test("allowance controller: invalid direct apply while reading retires pending operation", async () => {
  const pending = deferred();
  const f = fixture({ read: () => pending.promise });
  f.configure();
  const operation = f.controller.inspect();
  assert.equal(f.controller.apply(), false);
  pending.resolve(record());
  assert.equal(await operation, false);
  assert.equal(f.controller.state().observation, null);
});
test("allowance controller: disposed methods do not call readers or callbacks", async () => {
  const f = fixture();
  f.controller.dispose();
  const count = f.events.length;
  f.controller.invalidate();
  f.controller.cancel();
  f.controller.editTargets();
  assert.equal(f.controller.preview(S1), false);
  assert.equal(f.controller.apply(), false);
  assert.equal(await f.controller.inspect(), false);
  assert.equal(await f.controller.load(await saved()), false);
  assert.equal(await f.controller.prepare("targets"), false);
  assert.equal(f.controller.compare(), false);
  assert.equal(f.controller.useAsBaseline(), false);
  assert.equal(f.events.length, count);
  assert.equal(f.reads.length, 0);
});
test("allowance controller: invalid adapter rejected immediately", () => {
  for (const options of [{}, { getContext: () => ({}) }, { read: () => ({}) }]) {
    assert.throws(() => createAllowanceController(options), code("ALLOWANCE_ADAPTER"));
  }
});
