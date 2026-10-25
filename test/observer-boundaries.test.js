import test from "node:test";
import assert from "node:assert/strict";
import { serviceFixture, SERVICE_NAMES, tick, deferred } from "./helpers/observer-fixtures.js";
import { createFileReadService } from "../src/file-read-service.js";
import { clockFixture } from "./helpers/export-fixtures.js";

for (const name of SERVICE_NAMES) {
  test(`${name}: a later observer never receives the pre-cancellation snapshot`, async t => {
    const f = serviceFixture(name), mismatches = [];
    t.after(() => f.close());
    let stopped = false, inspected = 0;
    f.service.subscribe(value => {
      if (!stopped && f.started(value)) { stopped = true; f.stop(); }
    });
    f.service.subscribe(value => {
      inspected++;
      if (JSON.stringify(value) !== JSON.stringify(f.service.state())) mismatches.push(value);
    });
    f.begin(); await tick();
    assert(stopped && inspected > 0, "Cancellation boundary must be exercised");
    assert.equal(mismatches.length, 0, "An observer received state from before another observer stopped work");
  });

  test(`${name}: a late observer stop refreshes an earlier display`, async t => {
    const f = serviceFixture(name), displayed = [];
    t.after(() => f.close());
    let stopped = false;
    f.service.subscribe(value => displayed.push(value));
    f.service.subscribe(value => {
      if (!stopped && f.started(value)) { stopped = true; f.stop(); }
    });
    f.begin(); await tick();
    assert(stopped);
    assert.deepEqual(displayed.at(-1), f.service.state());
  });

  test(`${name}: removing a later listener from a stop callback prevents delivery`, async t => {
    const f = serviceFixture(name);
    t.after(() => f.close());
    let started = false, lateCalls = 0, remove = () => {};
    f.service.subscribe(value => {
      if (!started && f.started(value)) { started = true; remove(); f.stop(); }
    });
    remove = f.service.subscribe(() => { if (started) lateCalls++; });
    f.begin(); await tick();
    assert(started); assert.equal(lateCalls, 0);
  });

  test(`${name}: disposal inside a notification stops remaining observers`, async t => {
    const f = serviceFixture(name);
    t.after(() => f.close());
    let closed = false, stale = 0;
    f.service.subscribe(value => {
      if (!closed && f.started(value)) { closed = true; f.service.dispose(); }
    });
    f.service.subscribe(() => { if (closed) stale++; });
    f.begin(); await tick();
    assert(closed); assert.equal(stale, 0); assert(f.service.state().disposed);
  });

  test(`${name}: a rejecting stop observer cannot hide the stopped state`, async t => {
    const f = serviceFixture(name), displayed = [];
    t.after(() => f.close());
    let stopped = false;
    f.service.subscribe(value => {
      if (!stopped && f.started(value)) { stopped = true; f.stop(); }
      return Promise.reject(Error("synthetic observer error"));
    });
    f.service.subscribe(value => displayed.push(value));
    f.begin(); await tick();
    assert(stopped); assert.deepEqual(displayed.at(-1), f.service.state());
  });
}

test("file: a stop notification cannot launch a new read outside the cancellation batch", async t => {
  const clock = clockFixture();
  const service = createFileReadService({ now: clock.now, schedule: clock.schedule, unschedule: clock.unschedule });
  const first = deferred(), second = deferred();
  let secondCalls = 0, attempted = false, next;
  t.after(async () => { service.dispose(); first.resolve(new ArrayBuffer(1)); second.resolve(new ArrayBuffer(1)); await tick(); });
  const initial = service.readText({ size: 1, arrayBuffer: () => first.promise }).catch(error => error.code);
  await tick();
  service.subscribe(state => {
    if (state.cancelled && !attempted) {
      attempted = true;
      next = service.readText({ size: 1, arrayBuffer() { secondCalls++; return second.promise; } })
        .then(() => "unexpected completion", error => error.code);
    }
  });
  service.cancelAll(); await tick();
  assert(attempted);
  assert.equal(secondCalls, 0, "A new worker escaped the stop batch");
  assert.equal(await next, "FILE_BUSY");
  assert.equal(await initial, "FILE_CANCELLED");
});

test("file: a new explicit read is available after cancellation returns", async t => {
  const clock = clockFixture();
  const service = createFileReadService({ now: clock.now, schedule: clock.schedule, unschedule: clock.unschedule });
  t.after(() => service.dispose());
  let calls = 0;
  service.subscribe(state => { if (state.waiting && !calls++) service.cancelAll(); });
  await assert.rejects(service.readText(new Blob(["first"])), { code: "FILE_CANCELLED" });
  await tick();
  assert.equal(await service.readText(new Blob(["second"])), "second");
  assert.equal(service.state().active, 0);
});

test("file: repeated cancel from the stop notification is idempotent", async t => {
  const clock = clockFixture();
  const service = createFileReadService({ now: clock.now, schedule: clock.schedule, unschedule: clock.unschedule });
  t.after(() => service.dispose());
  const counts = [];
  service.subscribe(state => { if (state.waiting || state.cancelled) counts.push(service.cancelAll()); });
  await assert.rejects(service.readText(new Blob(["synthetic"])), { code: "FILE_CANCELLED" });
  await tick();
  assert.equal(service.state().cancelled, 1);
  assert(counts.length < 10); assert.equal(service.state().active, 0);
});
