import test from "node:test";
import assert from "node:assert/strict";
import { runProtectionBatch, PROTECTION_STEPS } from "../src/protection-batch.js";
import { createStateNotifier } from "../src/state-notifier.js";
import { mountWalletSetupPanel } from "../examples/wallet-setup-panel.js";
import { controllerFixture, draft, tick } from "./helpers/secure-backup-fixtures.js";
import { raw, setup } from "./helpers/setup-fixtures.js";
import { Element } from "./helpers/panel-dom.js";

function receiptFixture(kind) {
  let reads = 0, calls = 0;
  const result = kind === "false" ? false : kind === "rejection" ? Promise.reject(Error("synthetic private rejection")) : {
    get then() {
      reads++;
      if (kind === "unreadable") throw Error("synthetic private getter");
      if (kind === "async-then") return async () => { calls++; throw Error("synthetic private async then"); };
      return resolve => { calls++; resolve(true); };
    },
  };
  return { result, reads: () => reads, calls: () => calls };
}

for (const name of PROTECTION_STEPS) {
  test(`protection ${name}: malformed async then cannot interrupt remaining cleanup`, async () => {
    const order = [], receipt = receiptFixture("async-then");
    const result = runProtectionBatch(PROTECTION_STEPS.map(key => ({ name: key, run() {
      order.push(key); return key === name ? receipt.result : undefined;
    } })));
    await tick();
    assert.deepEqual(order, PROTECTION_STEPS); assert.deepEqual(result.failed, [name]);
    assert.equal(receipt.reads(), 1); assert.equal(receipt.calls(), 1);
    assert.equal(result.completed, false); assert(!JSON.stringify(result).includes("private"));
  });
}
for (const deferred of [false, true]) {
  test(`state notifier deferred=${deferred}: async observer failure preserves later stopped-state delivery`, async () => {
    const observers = new Set(), seen = []; let stopped = false, receipts = [];
    const notifier = createStateNotifier({ observers, deferred, read: () => Object.freeze({ stopped }) });
    observers.add(() => { stopped = true; const receipt = receiptFixture("async-then"); receipts.push(receipt); return receipt.result; });
    observers.add(value => seen.push(value));
    notifier.notify(); await tick();
    assert.deepEqual(seen, [{ stopped: true }]);
    assert(receipts.every(receipt => receipt.reads() === 1 && receipt.calls() === 1));
    notifier.notify(); await tick(); assert.deepEqual(seen, [{ stopped: true }]);
  });
}
for (const kind of ["false", "rejection", "changing", "unreadable", "async-then"]) {
  for (const action of ["download", "stage"]) {
    test(`encrypted backup ${action}: ${kind} cannot mark delivery complete`, async () => {
      let receipt;
      const f = controllerFixture({ onStage: () => { receipt = receiptFixture(kind); return receipt.result; } });
      const before = f.draft;
      try {
        if (action === "download") {
          assert.equal(await f.seal(), true);
          assert.equal(f.controller.offer(() => { receipt = receiptFixture(kind); return receipt.result; }), false);
        } else {
          assert.equal(await f.select(), true); assert.equal(await f.unlock(), true);
          assert.equal(f.controller.stage(), false);
        }
        await tick();
        assert.equal(f.controller.state().phase, "error");
        assert.equal(f.controller.state().downloadOffered, false); assert.equal(f.controller.state().canStage, false);
        assert.deepEqual(f.draft, before);
        if (["changing", "async-then", "unreadable"].includes(kind)) assert.equal(receipt.reads(), 1);
        assert(!JSON.stringify(f.controller.state()).includes("private"));
      } finally { f.controller.dispose(); }
    });
  }
}
for (const stage of ["seal", "offer", "unlock", "stage"]) {
  test(`encrypted backup ${stage}: rejected asynchronous source read is contained`, async () => {
    let fail = false;
    const f = controllerFixture({ readDraft: () => fail ? Promise.reject(Error("synthetic source")) : draft() });
    try {
      if (stage === "offer") await f.seal();
      if (["unlock", "stage"].includes(stage)) await f.select();
      if (stage === "stage") await f.unlock();
      fail = true;
      const result = stage === "seal" ? await f.seal() : stage === "unlock" ? await f.unlock() :
        stage === "offer" ? f.controller.offer(() => { throw Error("must not deliver"); }) : f.controller.stage();
      assert.equal(result, false); await tick();
      assert.equal(f.controller.state().phase, "error"); assert.equal(f.controller.state().errorCode, "SECURE_CONTENT");
      assert.equal(f.staged.length, 0);
    } finally { f.controller.dispose(); }
  });
}
test("encrypted backup: async observer cannot discard a valid operation or leak rejection", async () => {
  const receipts = [];
  const f = controllerFixture({ onChange() { const receipt = receiptFixture("async-then"); receipts.push(receipt); return receipt.result; } });
  try {
    assert.equal(await f.seal(), true); await tick();
    assert.equal(f.controller.state().phase, "encrypted");
    assert(receipts.length >= 2); assert(receipts.every(receipt => receipt.reads() === 1 && receipt.calls() === 1));
  } finally { f.controller.dispose(); await tick(); }
});

function panelFixture(options = {}) {
  const parent = new Element("main"), document = { createElement: tag => new Element(tag) };
  let fields = raw(setup().entries.map(row => row.account));
  const panel = mountWalletSetupPanel({ parent, document, readFields: () => fields,
    applyPlan(plan) { fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" })); }, ...options });
  return { panel, parent, fields: () => fields, node: name => parent.find("wallet-setup-" + name) };
}
for (const kind of ["false", "rejection", "changing", "unreadable", "async-then"]) {
  test(`setup save: ${kind} receipt cannot announce a download`, async () => {
    let receipt;
    const f = panelFixture({ download() { receipt = receiptFixture(kind); return receipt.result; } });
    try {
      const before = structuredClone(f.fields()); f.node("save").click(); await tick();
      assert.match(f.node("status").textContent, /開始できません/);
      assert(!f.node("status").textContent.includes("開始しました"));
      assert.deepEqual(f.fields(), before);
      if (["changing", "async-then", "unreadable"].includes(kind)) assert.equal(receipt.reads(), 1);
    } finally { f.panel.dispose(); }
  });
}
for (const stop of ["cancel", "invalidate", "dispose"]) {
  test(`setup save: ${stop} inside download cannot revive a success message`, () => {
    const f = panelFixture({ download() {
      if (stop === "cancel") f.node("cancel").click(); else f.panel[stop]();
      return true;
    } });
    const status = f.node("status"); f.node("save").click();
    assert(!status.textContent.includes("開始しました"));
    if (stop === "dispose") assert.equal(f.parent.children.length, 0);
    f.panel.dispose();
  });
}
for (const action of ["refresh", "export", "save", "preview"]) {
  test(`setup ${action}: invalid asynchronous reader has no unhandled rejection`, async () => {
    let fail = false, downloads = 0;
    const f = panelFixture({ readFields: () => fail ? Promise.reject(Error("synthetic private read")) : raw(),
      download() { downloads++; } });
    try {
      fail = true; f.node(action).click(); await tick();
      assert.equal(downloads, 0); assert(!f.node("status").textContent.includes("private"));
      assert(!f.node("status").textContent.includes("開始しました"));
    } finally { f.panel.dispose(); }
  });
}
