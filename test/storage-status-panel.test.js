import test from "node:test";
import assert from "node:assert/strict";
import { createStorageGuard } from "../src/storage-guard.js";
import { validateStorageStatus, describeStorageStatus } from "../src/storage-guard-status.js";
import { mountStorageGuardPanel } from "../examples/storage-guard-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { microtasks } from "./helpers/storage-guard-fixtures.js";

const fresh = () => ({ ...createStorageGuard().state() });
function panel(t, guard = createStorageGuard()) {
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("main");
  const view = mountStorageGuardPanel({ document, parent, guard });
  const find = name => parent.find("storage-guard-" + name);
  t.after(() => view.dispose());
  return { guard, view, parent, find };
}

test("valid status snapshots are detached and frozen", () => {
  const original = fresh();
  const snapshot = validateStorageStatus(original);
  original.completed = 900;
  assert.equal(snapshot.completed, 0);
  assert(Object.isFrozen(snapshot));
});

for (const key of Object.keys(fresh())) {
  test("missing aggregate field fails closed: " + key, () => {
    const input = fresh();
    delete input[key];
    assert.equal(validateStorageStatus(input), null);
  });
  test("accessor aggregate field is not read: " + key, () => {
    const input = fresh();
    let calls = 0;
    Object.defineProperty(input, key, { get() { calls++; return 0; } });
    assert.equal(validateStorageStatus(input), null);
    assert.equal(calls, 0);
  });
}

for (const field of ["database", "account", "fileText", "filename", "password", "privateKey", "error"]) {
  test("private or unexpected status field is refused: " + field, () => {
    const input = { ...fresh(), [field]: "private content" };
    const view = describeStorageStatus(input);
    assert.equal(view.level, "unavailable");
    assert(!JSON.stringify(view).includes("private content"));
  });
}

for (const value of [-1, 1.5, NaN, Infinity, "1", null, 1_000_000_001]) {
  test("invalid aggregate count is not rendered: " + String(value), () => {
    assert.equal(validateStorageStatus({ ...fresh(), completed: value }), null);
  });
}

for (const changes of [
  { schema: "other" }, { maxActive: 100 }, { active: 5, opening: 5 },
  { active: 1 }, { opening: 1 }, { disposed: true, canStart: true },
  { clockFault: true, canStart: true }, { active: 4, opening: 4, canStart: true },
  { uncertain: 1, late: 0 },
]) {
  test("inconsistent aggregate is refused: " + JSON.stringify(changes), () => {
    assert.equal(validateStorageStatus({ ...fresh(), ...changes }), null);
  });
}

test("cancelled work and potentially committed work have distinct explanations", () => {
  const draining = { ...fresh(), active: 1, draining: 1, cancelled: 1 };
  assert.equal(describeStorageStatus(draining).level, "draining");
  assert.match(describeStorageStatus(draining).detail, /終了が確認できるまで/);
  const uncertain = { ...fresh(), late: 1, uncertain: 1, cancelled: 1 };
  assert.equal(describeStorageStatus(uncertain).level, "review");
  assert.match(describeStorageStatus(uncertain).detail, /一覧を再読み込み/);
});

test("capacity exhaustion is described without automatic retry", () => {
  const view = describeStorageStatus({ ...fresh(), active: 4, opening: 4, canStart: false });
  assert.equal(view.level, "limited");
  assert.match(view.detail, /自動で繰り返し保存することはありません/);
});

test("clock failure and disposal both prevent claiming readiness", () => {
  assert.equal(describeStorageStatus({ ...fresh(), canStart: false, clockFault: true }).level, "stopped");
  assert.equal(describeStorageStatus({ ...fresh(), canStart: false, disposed: true }).level, "stopped");
});

test("panel initially disables Stop and exposes an accessible status", t => {
  const f = panel(t);
  assert.equal(f.find("stop").disabled, true);
  assert.equal(f.find("heading").getAttribute("role"), "status");
  assert.equal(f.find("heading").getAttribute("aria-live"), "polite");
  assert.match(f.find("heading").textContent, /待機中/);
});

test("Stop requests cancellation without invoking any persistence API", async t => {
  const f = panel(t);
  let cancelled = 0;
  const lease = f.guard.acquire(() => cancelled++);
  lease.phase("writing");
  await microtasks();
  assert.equal(f.find("stop").disabled, false);
  f.find("stop").click();
  await microtasks();
  assert.equal(cancelled, 1);
  assert.equal(f.find("stop").disabled, true);
  assert.match(f.find("action").textContent, /1件に停止を依頼/);
  assert.match(f.find("heading").textContent, /終了を待っています/);
  lease.finish();
});

test("uncertain commit is visible until the user can inspect saved content", async t => {
  const f = panel(t);
  const lease = f.guard.acquire(() => {});
  lease.phase("writing");
  lease.stop();
  lease.finish({ late: true, uncertain: true });
  await microtasks();
  assert.match(f.find("heading").textContent, /再確認が必要/);
  assert.match(f.find("counts").textContent, /再確認 1件/);
});

test("disposing a panel removes its listener but leaves the shared guard usable", async t => {
  const f = panel(t);
  const stop = f.find("stop");
  const heading = f.find("heading");
  const before = heading.textContent;
  f.view.dispose();
  const lease = f.guard.acquire(() => {});
  await microtasks();
  stop.dispatchEvent(new Event("click"));
  assert.equal(f.guard.state().cancelled, 0);
  assert.equal(f.guard.state().disposed, false);
  assert.equal(heading.textContent, before);
  assert.equal(f.parent.children.length, 0);
  lease.finish({ success: true });
});

test("failed status or subscription access never renders native error prose", t => {
  const f = panel(t, {
    state() { throw Error("private saved content"); },
    subscribe() { throw Error("private subscription details"); },
  });
  assert.match(f.find("heading").textContent, /確認できません/);
  assert.equal(f.find("stop").disabled, true);
  assert(!f.find("detail").textContent.includes("private"));
});

test("unsupported subscription cleanup is handled as unavailable status", t => {
  const f = panel(t, { state: fresh, subscribe: () => null });
  assert.match(f.find("heading").textContent, /確認できません/);
});

test("throwing or rejected unsubscribe callbacks cannot break disposal", async t => {
  const a = panel(t, { state: fresh, subscribe: () => () => { throw Error("private"); } });
  const b = panel(t, { state: fresh, subscribe: () => async () => { throw Error("private"); } });
  assert.doesNotThrow(() => a.view.dispose());
  assert.doesNotThrow(() => b.view.dispose());
  await microtasks();
});
