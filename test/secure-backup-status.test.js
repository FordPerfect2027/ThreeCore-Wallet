import test from "node:test";
import assert from "node:assert/strict";
import { secureOperationStatus, describeSecureOperation, describeSecureOperationCounts } from "../src/secure-backup-status.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { mountSecureOperationPanel } from "../examples/secure-operation-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";
import { gate } from "./helpers/secure-backup-fixtures.js";
const sample = () => ({ ...createSecureBackupRunner().state() });

test("status copies only safe fields and ignores untrusted extra metadata", () => {
  const value = { ...sample(), password: "synthetic secret", filename: "private.json", text: "private payload" };
  const safe = secureOperationStatus(value);
  assert(Object.isFrozen(safe));
  assert.equal(safe.available, true);
  const text = JSON.stringify(safe) + describeSecureOperation(value) + describeSecureOperationCounts(value);
  for (const word of ["synthetic", "private", "filename", "password"]) assert(!text.includes(word));
});

test("status is an immutable snapshot instead of a reference", () => {
  const value = sample();
  const safe = secureOperationStatus(value);
  value.started = 600;
  value.phase = "draining";
  assert.equal(safe.started, 0);
  assert.equal(safe.phase, "idle");
});

for (const name of ["phase", "busy", "disposed", "clockFault", "started", "completed", "failed", "cancelled", "timedOut", "late", "denied"]) {
  test("status rejects accessor field without invoking it: " + name, () => {
    const value = sample();
    let reads = 0;
    Object.defineProperty(value, name, { get() { reads++; return "private value"; } });
    assert.deepEqual(secureOperationStatus(value), { available: false });
    assert.equal(reads, 0);
    assert.match(describeSecureOperation(value), /確認できません/);
    assert.equal(describeSecureOperationCounts(value), "");
    assert.equal(reads, 0);
  });
}

for (const name of ["started", "completed", "failed", "cancelled", "timedOut", "late", "denied"]) {
  for (const value of [-1, 0.5, NaN, Infinity, 1_000_000_001, "1"]) {
    test("status rejects invalid counter " + name + "=" + String(value), () => {
      assert.deepEqual(secureOperationStatus({ ...sample(), [name]: value }), { available: false });
    });
  }
}

for (const fields of [
  { phase: "unknown secret" }, { phase: "idle", busy: true },
  { phase: "running", busy: false }, { phase: "draining", busy: false },
  { phase: "disposed", disposed: false }, { phase: "idle", disposed: true },
  { busy: "false" }, { disposed: 0 }, { clockFault: null },
]) {
  test("status rejects inconsistent lifecycle: " + JSON.stringify(fields), () => {
    assert.deepEqual(secureOperationStatus({ ...sample(), ...fields }), { available: false });
  });
}

test("status accepts draining and disposed with outstanding native work", () => {
  const draining = { ...sample(), phase: "draining", busy: true };
  assert.equal(secureOperationStatus(draining).available, true);
  assert.match(describeSecureOperation(draining), /その結果は使いません/);
  const disposed = { ...draining, phase: "disposed", disposed: true };
  assert.equal(secureOperationStatus(disposed).available, true);
  assert.match(describeSecureOperation(disposed), /終了しています/);
});

test("clock fault guidance takes priority over idle wording", () => {
  assert.match(describeSecureOperation({ ...sample(), clockFault: true }), /経過時間/);
});

test("missing, inherited and proxy-failing status returns a safe unavailable summary", () => {
  for (const value of [null, [], {}, Object.create(sample()), new Proxy({}, {
    getOwnPropertyDescriptor() { throw Error("private failure"); },
  })]) assert.deepEqual(secureOperationStatus(value), { available: false });
});

test("observers receive coalesced frozen snapshots", async () => {
  const runner = createSecureBackupRunner();
  const seen = [];
  runner.subscribe(value => seen.push(value));
  assert.equal(await runner.run(() => 1), 1);
  await microtasks();
  assert(seen.length >= 1);
  assert(seen.every(Object.isFrozen));
  assert.equal(seen.at(-1).phase, "idle");
  assert.equal(seen.at(-1).completed, 1);
  runner.dispose();
});

test("removing an observer before notification prevents its invocation", async () => {
  const runner = createSecureBackupRunner();
  let calls = 0;
  const remove = runner.subscribe(() => { calls++; });
  const work = runner.run(() => 1);
  remove();
  await work;
  await microtasks();
  assert.equal(calls, 0);
});

test("throwing and asynchronous failing observers do not block peers", async () => {
  const runner = createSecureBackupRunner();
  const seen = [];
  runner.subscribe(() => { throw Error("broken observer"); });
  runner.subscribe(async () => { throw Error("async broken observer"); });
  runner.subscribe(value => seen.push(value));
  assert.equal(await runner.run(() => 1), 1);
  await microtasks();
  assert.equal(seen.at(-1).completed, 1);
  runner.dispose();
});

test("observer capacity is bounded and slots are reusable after unsubscribe", () => {
  const runner = createSecureBackupRunner();
  const stops = Array.from({ length: 16 }, () => runner.subscribe(() => {}));
  assert.throws(() => runner.subscribe(() => {}), { code: "SECURE_INTERNAL" });
  stops.pop()();
  const stop = runner.subscribe(() => {});
  stop();
  stops.forEach(fn => fn());
  runner.dispose();
  assert.throws(() => runner.subscribe(() => {}), { code: "SECURE_INTERNAL" });
});

test("observer cancellation cannot dispatch new native work", async () => {
  const runner = createSecureBackupRunner();
  const stop = runner.subscribe(value => { if (value.phase === "running") runner.cancel(); });
  let calls = 0;
  await assert.rejects(runner.run(() => { calls++; }), { code: "SECURE_CANCELLED" });
  assert.equal(calls, 0);
  stop();
  runner.dispose();
});

test("signal getter cannot start a second simultaneous operation during validation", async () => {
  const runner = createSecureBackupRunner();
  let nested;
  let once = false;
  const signal = { get aborted() {
    if (!once) { once = true; nested = runner.run(() => assert.fail()).catch(e => e.code); }
    return false;
  }, addEventListener() {}, removeEventListener() {} };
  assert.equal(await runner.run(() => 1, { signal }), 1);
  assert.equal(await nested, "SECURE_BUSY");
  assert.equal(runner.state().started, 1);
});

test("disposal during signal validation blocks outer invocation", async () => {
  const runner = createSecureBackupRunner();
  const signal = { get aborted() { runner.dispose(); return false; },
    addEventListener() {}, removeEventListener() {} };
  await assert.rejects(runner.run(() => assert.fail(), { signal }), { code: "SECURE_DISPOSED" });
  assert.equal(runner.state().started, 0);
});

function panelFixture(runner) {
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("main");
  const panel = mountSecureOperationPanel({ document, parent, runner });
  return { panel, parent, status: () => parent.find("secure-operation-status"),
    counts: () => parent.find("secure-operation-counts") };
}

test("operation panel explains running, draining and idle without secret content", async () => {
  const runner = createSecureBackupRunner();
  const f = panelFixture(runner);
  const pending = gate();
  const work = runner.run(() => pending.promise);
  await microtasks();
  assert.match(f.status().textContent, /同時に実行できるのは1件/);
  runner.cancel();
  await assert.rejects(work);
  await microtasks();
  assert.match(f.status().textContent, /その結果は使いません/);
  assert.match(f.counts().textContent, /取り消し: 1件/);
  pending.resolve("private payload");
  await microtasks();
  assert.match(f.status().textContent, /待機はありません/);
  assert(!f.status().textContent.includes("private"));
  f.panel.dispose();
  assert.equal(f.parent.children.length, 0);
});

test("operation panel disposal leaves the shared runner usable", async () => {
  const runner = createSecureBackupRunner();
  const f = panelFixture(runner);
  const status = f.status();
  const before = status.textContent;
  f.panel.dispose();
  assert.equal(await runner.run(() => 42), 42);
  await microtasks();
  assert.equal(status.textContent, before);
  assert.equal(runner.state().disposed, false);
});

test("operation panel remains safe if a custom runner cannot expose status", () => {
  const f = panelFixture({ run() {} });
  assert.match(f.status().textContent, /確認できません/);
  assert.equal(f.counts().textContent, "");
  f.panel.dispose();
});
