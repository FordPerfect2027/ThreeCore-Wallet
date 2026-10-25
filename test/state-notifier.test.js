import test from "node:test";
import assert from "node:assert/strict";
import { createStateNotifier } from "../src/state-notifier.js";
import { tick } from "./helpers/observer-fixtures.js";

function fixture(deferred) {
  const observers = new Set();
  let revision = 0;
  const read = () => Object.freeze({ revision });
  const notifier = createStateNotifier({ observers, read, deferred });
  return { notifier, observers, read,
    change() { revision++; notifier.notify(); },
    add(fn) { observers.add(fn); return () => { notifier.forget(fn); observers.delete(fn); }; },
  };
}

for (const deferred of [false, true]) {
  const mode = deferred ? "deferred" : "synchronous";
  test(`${mode} notifier: reads immediately before every observer`, async () => {
    const f = fixture(deferred), seen = [];
    let changed = false;
    f.add(() => { if (!changed) { changed = true; f.change(); } });
    f.add(value => seen.push([value.revision, f.read().revision]));
    f.change(); await tick();
    assert(seen.length > 0);
    assert(seen.every(([delivered, current]) => delivered === current));
  });

  test(`${mode} notifier: a late stop is delivered back to earlier observers`, async () => {
    const f = fixture(deferred), seen = [];
    let changed = false;
    f.add(value => seen.push(value.revision));
    f.add(() => { if (!changed) { changed = true; f.change(); } });
    f.change(); await tick();
    assert.deepEqual(seen, [1, 2]);
  });

  test(`${mode} notifier: no-op invalidations do not loop`, async () => {
    const f = fixture(deferred);
    let calls = 0;
    f.add(() => { calls++; f.notifier.notify(); });
    f.change(); await tick();
    assert.equal(calls, 1);
    f.change(); await tick(); assert.equal(calls, 2);
  });

  test(`${mode} notifier: continually mutating observer has a bounded turn`, async () => {
    const f = fixture(deferred);
    let calls = 0;
    f.add(() => { if (++calls > 10) throw Error("Runaway observer"); f.change(); });
    f.change(); await tick();
    assert.equal(calls, 2);
    // The final state remains available without restarting notifications.
    assert.equal(f.read().revision, 3);
    f.change(); await tick(); assert.equal(calls, 4);
  });

  test(`${mode} notifier: unsubscribe before delivery suppresses the callback`, async () => {
    const f = fixture(deferred);
    let calls = 0, remove;
    f.add(() => remove());
    remove = f.add(() => calls++);
    f.change(); await tick();
    assert.equal(calls, 0);
  });

  test(`${mode} notifier: clearing observers stops the remaining batch`, async () => {
    const f = fixture(deferred);
    let calls = 0;
    f.add(() => f.observers.clear());
    f.add(() => calls++);
    f.change(); await tick();
    assert.equal(calls, 0);
  });

  test(`${mode} notifier: new subscription during a pass receives current state`, async () => {
    const f = fixture(deferred), seen = [];
    const later = value => seen.push(value.revision);
    f.add(() => { f.add(later); f.notifier.initial(later); });
    f.change(); await tick();
    assert.deepEqual(seen, [1]);
  });

  test(`${mode} notifier: duplicate initial delivery cannot recurse`, () => {
    const f = fixture(deferred);
    let calls = 0;
    const listener = () => { calls++; f.notifier.initial(listener); };
    f.add(listener); f.notifier.initial(listener);
    assert.equal(calls, 1);
  });

  test(`${mode} notifier: a replacement subscription gets an initial snapshot`, () => {
    const f = fixture(deferred), seen = [];
    const listener = value => seen.push(value.revision);
    const remove = f.add(listener); f.notifier.initial(listener);
    remove(); f.add(listener); f.notifier.initial(listener);
    assert.deepEqual(seen, [0, 0]);
  });

  for (const failure of ["throw", "reject", "then-getter", "then-call"]) {
    test(`${mode} notifier: ${failure} does not suppress a healthy observer`, async () => {
      const f = fixture(deferred), seen = [];
      f.add(() => {
        if (failure === "throw") throw Error("synthetic private message");
        if (failure === "reject") return Promise.reject(Error("synthetic private message"));
        if (failure === "then-getter") return { get then() { throw Error("synthetic private message"); } };
        return { then(resolve, reject) { reject(Error("synthetic private message")); } };
      });
      f.add(value => seen.push(value.revision));
      f.change(); await tick();
      assert.deepEqual(seen, [1]);
    });
  }

  test(`${mode} notifier: removed listener is not retained by a pending notification`, async () => {
    const f = fixture(deferred);
    let calls = 0;
    const remove = f.add(() => calls++);
    f.notifier.notify(); remove(); await tick();
    assert.equal(calls, deferred ? 0 : 1);
    f.change(); await tick(); assert.equal(calls, deferred ? 0 : 1);
  });
}

test("deferred notifier coalesces a burst without losing the newest state", async () => {
  const f = fixture(true), seen = [];
  f.add(value => seen.push(value.revision));
  for (let index = 0; index < 100; index++) f.change();
  assert.equal(seen.length, 0);
  await tick(); assert.deepEqual(seen, [100]);
});

test("synchronous initial status does not notify unrelated observers", () => {
  const f = fixture(false), seen = [];
  const first = () => seen.push("first"), second = () => seen.push("second");
  f.add(first); f.add(second); f.notifier.initial(second);
  assert.deepEqual(seen, ["second"]);
});

for (const change of [{ observers: [] }, { read: null }, { deferred: "yes" }]) {
  test("notifier rejects invalid configuration " + Object.keys(change)[0], () => {
    assert.throws(() => createStateNotifier({ observers: new Set(), read: () => ({}), ...change }), TypeError);
  });
}
