import test from "node:test";
import assert from "node:assert/strict";
import { createWalletSetupReview, encodeWalletSetup } from "../src/wallet-setup.js";
import { A, B, C, setup, raw } from "./helpers/setup-fixtures.js";

const text = encodeWalletSetup(setup());
function fixture() {
  let fields = raw();
  let readAction = () => {};
  let prepareAction = () => {};
  let applyAction = () => {};
  let writes = 0;
  let preparations = 0;
  const review = createWalletSetupReview({
    readFields() { readAction(); return fields; },
    prepareApply() { preparations++; return prepareAction(); },
    applyPlan(plan) {
      writes++;
      fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" }));
      return applyAction();
    },
  });
  return { review, fields: () => fields, writes: () => writes,
    preparations: () => preparations,
    onRead: action => { readAction = action; },
    onPrepare: action => { prepareAction = action; },
    onApply: action => { applyAction = action; },
    set: value => { fields = value; } };
}

for (const stop of ["cancel", "dispose"]) {
  test(`setup boundary: ${stop} while reading a preview cannot create approval`, () => {
    const f = fixture();
    f.onRead(() => f.review[stop]());
    assert.throws(() => f.review.preview(text));
    f.onRead(() => {});
    assert.throws(() => f.review.apply(1, text));
    assert.equal(f.writes(), 0);
  });

  test(`setup boundary: ${stop} during apply destination read prevents writing`, () => {
    const f = fixture();
    const p = f.review.preview(text);
    f.onRead(() => f.review[stop]());
    assert.throws(() => f.review.apply(p.id, text));
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.fields(), raw());
  });

  test(`setup boundary: ${stop} during disconnect preparation prevents writing`, () => {
    const f = fixture();
    const p = f.review.preview(text);
    f.onPrepare(() => f.review[stop]());
    assert.throws(() => f.review.apply(p.id, text));
    assert.equal(f.preparations(), 1);
    assert.equal(f.writes(), 0);
    assert.deepEqual(f.fields(), raw());
  });
}

test("setup boundary: unfinished edit made during disconnect is preserved", () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onPrepare(() => f.set(raw(["0xunfinished", "", ""])));
  assert.throws(() => f.review.apply(p.id, text), { code: "SETUP_STALE" });
  assert.equal(f.fields()[0].account, "0xunfinished");
  assert.equal(f.writes(), 0);
});

test("setup boundary: cancellation from final destination read prevents writing", () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onPrepare(() => f.onRead(() => f.review.cancel()));
  assert.throws(() => f.review.apply(p.id, text));
  assert.equal(f.writes(), 0);
});

test("setup boundary: a nested preview cannot replace an in-flight preview", () => {
  const f = fixture();
  let nested = 0;
  f.onRead(() => {
    f.onRead(() => {});
    assert.throws(() => f.review.preview(text), { code: "SETUP_REVIEW_REQUIRED" });
    nested++;
  });
  const p = f.review.preview(text);
  assert.equal(nested, 1);
  f.review.apply(p.id, text);
  assert.equal(f.writes(), 1);
});

test("setup boundary: disconnect preparation cannot create a second approval", () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onPrepare(() => {
    assert.throws(() => f.review.preview(text), { code: "SETUP_REVIEW_REQUIRED" });
    assert.throws(() => f.review.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  });
  f.review.apply(p.id, text);
  assert.equal(f.preparations(), 1);
  assert.equal(f.writes(), 1);
  assert.throws(() => f.review.apply(p.id, text));
});

test("setup boundary: failed preparation cannot write or leave reusable approval", () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onPrepare(() => { throw Error("disconnect failed"); });
  assert.throws(() => f.review.apply(p.id, text), /disconnect failed/);
  assert.equal(f.writes(), 0);
  assert.throws(() => f.review.apply(p.id, text));
  f.onPrepare(() => {});
  const fresh = f.review.preview(text);
  f.review.apply(fresh.id, text);
  assert.equal(f.writes(), 1);
});

test("setup boundary: asynchronous preparation is refused without applying", async () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onPrepare(() => Promise.reject(Error("synthetic rejection")));
  assert.throws(() => f.review.apply(p.id, text), { code: "SETUP_ADAPTER" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.writes(), 0);
});

test("setup boundary: cancellation during apply is not reported as success", () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onApply(() => f.review.cancel());
  assert.throws(() => f.review.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.writes(), 1);
  assert.throws(() => f.review.apply(p.id, text));
});

test("setup boundary: an asynchronous writer cannot report a synchronous success", async () => {
  const f = fixture();
  const p = f.review.preview(text);
  f.onApply(() => Promise.reject(Error("synthetic writer rejection")));
  assert.throws(() => f.review.apply(p.id, text), { code: "SETUP_ADAPTER" });
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => f.review.apply(p.id, text));
});

test("setup boundary: correct apply consumes confirmation and preserves all three identities", () => {
  const f = fixture();
  const p = f.review.preview(text);
  const result = f.review.apply(p.id, text);
  assert.equal(f.preparations(), 1);
  assert.equal(f.writes(), 1);
  assert.deepEqual(f.fields().map(row => row.account), [A, B, C]);
  assert.equal(result.authorizesConnection, false);
  assert.equal(result.authorizesTransaction, false);
  assert.throws(() => f.review.apply(p.id, text));
});

test("setup boundary: a retained preparation check expires after completion", () => {
  let check;
  const c = createWalletSetupReview({ readFields: () => raw(),
    prepareApply(plan, changes, checkCurrent) { check = checkCurrent; check(); },
    applyPlan() {} });
  const p = c.preview(text);
  c.apply(p.id, text);
  assert.throws(() => check(), { code: "SETUP_REVIEW_REQUIRED" });
});

test("setup boundary: asynchronous destination read is caught without unhandled rejection", async () => {
  const c = createWalletSetupReview({ readFields: () => Promise.reject(Error("synthetic read")), applyPlan() {} });
  assert.throws(() => c.preview(text), { code: "SETUP_ADAPTER" });
  await new Promise(resolve => setImmediate(resolve));
});

test("setup boundary: invalid adapter is rejected before any destination callback", () => {
  let reads = 0;
  assert.throws(() => createWalletSetupReview({ readFields: () => { reads++; return raw(); },
    prepareApply: null, applyPlan() {} }), { code: "SETUP_ADAPTER" });
  assert.equal(reads, 0);
});
