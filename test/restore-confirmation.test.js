import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceController } from "../src/workspace-controller.js";
import { createWalletSetupReview, encodeWalletSetup } from "../src/wallet-setup.js";
import { draft, text, clone, OPTIONS, tick, gate } from "./helpers/workspace-fixtures.js";
import { raw, setup } from "./helpers/setup-fixtures.js";

function workspaceFixture() {
  let value = draft({ block: "10" }), prepare = () => {}, write = () => {}, read = () => value;
  const writes = [];
  const controller = createWorkspaceController({ readDraft: () => read(),
    prepareWrite: (...args) => prepare(...args),
    writeDraft(next) { writes.push(clone(next)); value = clone(next); return write(next); } });
  return { controller, writes, value: () => clone(value),
    prepare: fn => { prepare = fn; }, write: fn => { write = fn; }, read: fn => { read = fn; },
    replace: next => { value = clone(next); },
    operation(mode) {
      const payload = text({ block: "20" }), preview = controller.preview(payload, OPTIONS);
      const apply = () => controller.apply(preview.id, payload, OPTIONS);
      if (mode === "restore") return apply;
      apply(); const undo = controller.undoPreview(); return () => controller.undoApply(undo.id);
    } };
}

for (const mode of ["restore", "undo"]) {
  test(`${mode}: explicit failed preparation cannot write`, () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value(), count = f.writes.length;
    f.prepare(() => false);
    assert.throws(run, { code: "WORKSPACE_REVIEW_REQUIRED" });
    assert.deepEqual(f.value(), before); assert.equal(f.writes.length, count);
    assert.equal(f.controller.state().pending, false);
  });
  test(`${mode}: a negative write receipt forces verified rollback`, () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value(), count = f.writes.length;
    let calls = 0; f.write(() => ++calls === 1 ? false : undefined);
    assert.throws(run, { code: "WORKSPACE_ROLLED_BACK" });
    assert.deepEqual(f.value(), before); assert.equal(f.writes.length, count + 2);
    assert.equal(f.controller.state().recoveryRequired, false);
  });
  test(`${mode}: a negative rollback receipt retains the recovery copy`, () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value();
    f.write(() => false);
    assert.throws(run, { code: "WORKSPACE_RECOVERY_REQUIRED" });
    assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
    assert.equal(f.controller.state().recoveryRequired, true);
    assert.throws(() => f.controller.preview(text(), OPTIONS), { code: "WORKSPACE_RECOVERY_REQUIRED" });
  });
  test(`${mode}: asynchronous writer cannot be described as rolled back`, async () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value(), count = f.writes.length;
    const delayed = gate();
    f.write(next => delayed.promise.then(() => f.replace(next)));
    assert.throws(run, { code: "WORKSPACE_RECOVERY_REQUIRED" });
    assert.equal(f.writes.length, count + 1, "do not race an unsettled writer with another write");
    delayed.resolve(); await tick();
    assert.equal(f.controller.state().recoveryRequired, true);
    assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
    assert.throws(run, { code: "WORKSPACE_RECOVERY_REQUIRED" });
  });
  test(`${mode}: write receipt getter is captured once`, async () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value();
    let reads = 0, calls = 0;
    f.write(() => ({ get then() { reads++; return resolve => { calls++; resolve(true); }; } }));
    assert.throws(run, { code: "WORKSPACE_RECOVERY_REQUIRED" }); await tick();
    assert.equal(reads, 1); assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
  });
  test(`${mode}: an unreadable write receipt requires recovery`, () => {
    const f = workspaceFixture(), run = f.operation(mode), before = f.value();
    f.write(() => ({ get then() { throw Error("private adapter detail"); } }));
    assert.throws(run, { code: "WORKSPACE_RECOVERY_REQUIRED" });
    assert.deepEqual(JSON.parse(f.controller.recoveryText()).entries, before);
  });
  for (const receipt of [undefined, true]) {
    test(`${mode}: compatible synchronous receipt ${receipt} still verifies destination`, () => {
      const f = workspaceFixture(), run = f.operation(mode);
      f.prepare(() => receipt); f.write(() => receipt);
      run(); assert.equal(f.controller.state().recoveryRequired, false);
      assert.equal(f.controller.state().pending, false);
    });
  }
}

for (const stage of ["preview", "apply", "post-write"]) {
  test(`workspace ${stage}: asynchronous read is consumed and cannot confirm`, async () => {
    const f = workspaceFixture(); let run;
    if (stage === "preview") run = () => f.controller.preview(text(), OPTIONS);
    else run = f.operation("restore");
    const failRead = () => Promise.reject(Error("synthetic reader failure"));
    if (stage === "post-write") f.write(() => { f.read(failRead); });
    else f.read(failRead);
    assert.throws(run); await tick();
    assert.equal(f.controller.state().pending, false);
    assert.equal(f.controller.state().recoveryRequired, stage === "post-write");
  });
}

const setupText = encodeWalletSetup(setup());
function setupFixture() {
  let fields = raw(), prepare = () => {}, write = plan => { fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" })); };
  let reads = () => fields, writes = 0;
  const controller = createWalletSetupReview({ readFields: () => reads(),
    prepareApply: (...args) => prepare(...args), applyPlan(...args) { writes++; return write(...args); } });
  return { controller, fields: () => fields, writes: () => writes,
    prepare: fn => { prepare = fn; }, write: fn => { write = fn; }, read: fn => { reads = fn; },
    set: value => { fields = value; },
    apply(payload = setupText) { const p = controller.preview(payload); return () => controller.apply(p.id, payload); } };
}

test("setup: failed preparation cannot reach any card writer", () => {
  const f = setupFixture(), run = f.apply(); f.prepare(() => false);
  assert.throws(run, { code: "SETUP_ADAPTER" }); assert.equal(f.writes(), 0);
  assert.deepEqual(f.fields(), raw()); assert.throws(run, { code: "SETUP_REVIEW_REQUIRED" });
});
test("setup: failed write receipt cannot confirm success even if values match", () => {
  const f = setupFixture(), run = f.apply();
  f.write(plan => { f.set(plan.entries); return false; });
  assert.throws(run, { code: "SETUP_ADAPTER" });
  assert.equal(f.writes(), 1); assert.throws(run, { code: "SETUP_REVIEW_REQUIRED" });
});
test("setup: a no-op writer cannot report applied settings", () => {
  const f = setupFixture(), run = f.apply(); f.write(() => {});
  assert.throws(run, { code: "SETUP_WRITE_MISMATCH" });
  assert.deepEqual(f.fields(), raw()); assert.throws(run, { code: "SETUP_REVIEW_REQUIRED" });
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const field of ["account", "chainId"]) {
    test(`setup: partial ${agent} ${field} application is not all-card success`, () => {
      const f = setupFixture(), run = f.apply();
      f.write(plan => f.set(plan.entries.map(row => row.agent !== agent ? { ...row } :
        { ...row, [field]: field === "account" ? "" : 8453 })));
      assert.throws(run, { code: "SETUP_WRITE_MISMATCH" });
      assert.equal(f.writes(), 1, "do not guess a rollback over partially edited fields");
      assert.throws(run, { code: "SETUP_REVIEW_REQUIRED" });
    });
  }
}
for (const stop of ["cancel", "dispose"]) {
  test(`setup: ${stop} during readback cannot revive approval`, () => {
    const f = setupFixture(), run = f.apply();
    f.write(plan => { f.set(plan.entries); f.read(() => { f.controller[stop](); return f.fields(); }); });
    assert.throws(run, { code: "SETUP_REVIEW_REQUIRED" }); assert.equal(f.writes(), 1);
    assert.throws(run); assert.equal(f.writes(), 1);
  });
}
test("setup: each subsequent explicit review uses the actual partial destination", () => {
  const f = setupFixture(), run = f.apply();
  f.write(plan => f.set(plan.entries.map((row, index) => index ? { ...row } : { ...row, account: "" })));
  assert.throws(run, { code: "SETUP_WRITE_MISMATCH" });
  const p = f.controller.preview(setupText); assert.deepEqual(p.changedAgents, ["DAT"]);
  f.write(plan => f.set(plan.entries));
  f.controller.apply(p.id, setupText); assert.equal(f.writes(), 2);
});
test("setup: empty addresses, case and whitespace normalize for successful readback", () => {
  const f = setupFixture(), payload = encodeWalletSetup(setup([null, setup().entries[1].account, null]));
  f.write(plan => f.set(plan.entries.map(row => ({ ...row,
    account: row.account ? " " + row.account.toUpperCase().replace("0X", "0x") + " " : "" }))));
  const result = f.apply(payload)(); assert.equal(result.configured, 1); assert.equal(f.writes(), 1);
});
for (const boundary of ["prepare", "write", "readback"]) {
  test(`setup ${boundary}: mutable then receipt is observed once`, async () => {
    const f = setupFixture(), run = f.apply(); let reads = 0, calls = 0;
    const result = { get then() { reads++; return resolve => { calls++; resolve(true); }; } };
    if (boundary === "prepare") f.prepare(() => result);
    if (boundary === "write") f.write(() => result);
    if (boundary === "readback") f.write(plan => { f.set(plan.entries); f.read(() => result); });
    assert.throws(run, { code: "SETUP_ADAPTER" }); await tick();
    assert.equal(reads, 1); assert.equal(calls, 1);
    assert.equal(f.writes(), boundary === "prepare" ? 0 : 1);
    assert.throws(run, { code: boundary === "write" ? "SETUP_RECOVERY_REQUIRED" : "SETUP_REVIEW_REQUIRED" });
  });
}
