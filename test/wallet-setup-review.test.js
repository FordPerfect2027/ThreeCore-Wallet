import test from "node:test";
import assert from "node:assert/strict";
import { createWalletSetupReview, encodeWalletSetup } from "../src/wallet-setup.js";
import { A, B, C, setup, raw, clone } from "./helpers/setup-fixtures.js";

function fixture() {
  let fields = raw();
  const applied = [];
  const controller = createWalletSetupReview({ readFields: () => fields,
    applyPlan: (plan, changes) => { applied.push({ plan, changes }); fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" })); } });
  return { controller, applied, get: () => fields, set: value => { fields = value; } };
}
const text = encodeWalletSetup(setup());

test("preview alone cannot modify any settings", () => {
  const f = fixture();
  const original = clone(f.get());
  const preview = f.controller.preview(text);
  assert.equal(f.applied.length, 0);
  assert.deepEqual(f.get(), original);
  assert.equal(preview.configured, 3);
});

test("exact confirmed preview applies a frozen normalized plan", () => {
  const f = fixture();
  const preview = f.controller.preview(text);
  const result = f.controller.apply(preview.id, text);
  assert.deepEqual(f.applied[0].plan, setup());
  assert.equal(f.applied.length, 1);
  assert(Object.isFrozen(f.applied[0].plan.entries));
  assert.deepEqual(result.changedAgents, ["DAT", "EMA", "CAWELON"]);
});

test("apply without preview is refused", () => {
  const f = fixture();
  assert.throws(() => f.controller.apply(0, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 0);
});

test("preview cannot be replayed", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.controller.apply(p.id, text);
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 1);
});

test("even formatting edits invalidate the preview", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  assert.throws(() => f.controller.apply(p.id, text + "\n"), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 0);
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
});

test("changing a public address after preview preserves the new input", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.set(raw([C, "", ""]));
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_STALE" });
  assert.equal(f.get()[0].account, C);
  assert.equal(f.applied.length, 0);
});

test("changing chain after preview cannot be silently overwritten", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.set(raw(["", "", ""], [8453, 84532, 84532]));
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_STALE" });
  assert.equal(f.get()[0].chainId, 8453);
});

test("invalid new input also invalidates an earlier good preview", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.set(raw(["0xpartial", "", ""]));
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_STALE" });
  assert.equal(f.applied.length, 0);
});

test("a new preview invalidates its predecessor", () => {
  const f = fixture();
  const previous = f.controller.preview(text);
  const next = f.controller.preview(text);
  assert.notEqual(previous.id, next.id);
  assert.throws(() => f.controller.apply(previous.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 0);
});

test("failed preview clears prior authorization", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  assert.throws(() => f.controller.preview("broken"));
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 0);
});

test("cancellation invalidates a still-visible old preview", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.controller.cancel();
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(f.applied.length, 0);
});

test("dispose forbids later preview and apply", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  f.controller.dispose();
  assert.throws(() => f.controller.preview(text), { code: "SETUP_DISPOSED" });
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_DISPOSED" });
  assert.equal(f.applied.length, 0);
});

test("callback failure cannot leave a reusable approval", () => {
  let calls = 0;
  const c = createWalletSetupReview({ readFields: () => raw(), applyPlan() { calls++; throw Error("callback failure"); } });
  const p = c.preview(text);
  assert.throws(() => c.apply(p.id, text), /callback failure/);
  assert.throws(() => c.apply(p.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  assert.equal(calls, 1);
});

test("reentrant apply cannot consume one confirmation twice", () => {
  let preview;
  let applied = 0;
  let fields = raw();
  const c = createWalletSetupReview({ readFields: () => fields, applyPlan(plan) {
    fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" }));
    applied++;
    assert.throws(() => c.apply(preview.id, text), { code: "SETUP_REVIEW_REQUIRED" });
  } });
  preview = c.preview(text);
  c.apply(preview.id, text);
  assert.equal(applied, 1);
});

test("unchanged identity still requires preview but produces no changed cards", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  const p = f.controller.preview(text);
  assert.deepEqual(p.changedAgents, []);
  const result = f.controller.apply(p.id, text);
  assert.deepEqual(result.changedAgents, []);
});

test("preview object cannot mutate future applied data", () => {
  const f = fixture();
  const p = f.controller.preview(text);
  assert.throws(() => { p.plan.entries[0].account = C; }, TypeError);
  assert.throws(() => { p.before[0].account = C; }, TypeError);
  assert.throws(() => p.changedAgents.push("other"), TypeError);
  f.controller.apply(p.id, text);
  assert.equal(f.applied[0].plan.entries[0].account, A);
});

test("replacement plan clears only explicitly empty addresses", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  const partial = encodeWalletSetup(setup([A, null, C]));
  const p = f.controller.preview(partial);
  f.controller.apply(p.id, partial);
  assert.deepEqual(f.applied[0].changes.filter(r => r.accountChanged).map(r => r.agent), ["EMA"]);
  assert.equal(f.applied[0].plan.entries[1].account, null);
});

test("raw field changes including whitespace require fresh review", () => {
  const f = fixture();
  f.set(raw([A, B, C]));
  const p = f.controller.preview(text);
  f.set(raw([A + " ", B, C]));
  assert.throws(() => f.controller.apply(p.id, text), { code: "SETUP_STALE" });
});

test("apply verifies destination again after preparation before writing", () => {
  let reads = 0;
  let fields = raw();
  const c = createWalletSetupReview({ readFields: () => { reads++; return fields; },
    applyPlan(plan) { fields = plan.entries.map(row => ({ ...row, account: row.account ?? "" })); } });
  const p = c.preview(text);
  c.apply(p.id, text);
  assert.equal(reads, 4);
});

test("mutating the source fields after preview cannot mutate the captured before state", () => {
  const fields = raw();
  const c = createWalletSetupReview({ readFields: () => fields, applyPlan() {} });
  const p = c.preview(text);
  fields[0].account = C;
  assert.equal(p.before[0].account, "");
  assert.throws(() => c.apply(p.id, text), { code: "SETUP_STALE" });
});
