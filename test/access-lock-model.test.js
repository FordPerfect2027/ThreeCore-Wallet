import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock, LOCK_IDLE_CHOICES } from "../src/security-lock.js";
import { fakeClock } from "./helpers/access-lifecycle.js";

// Independent event model: time and user intent are inputs, not readings from
// the implementation. Each seeded trace is one test, not 300 claimed tests.
function reference() {
  return { locked: false, disposed: false, fault: null, reason: null,
    lastSeen: 0, lastActivity: 0, idleMs: 300000, generation: 0 };
}
function stop(model, reason) {
  if (model.disposed || model.locked) return false;
  model.locked = true;
  model.reason = reason;
  model.generation++;
  return true;
}
function check(model, time) {
  if (model.disposed || model.locked) return false;
  if (time < model.lastSeen) {
    model.fault = "clock";
    stop(model, "clock");
    return false;
  }
  model.lastSeen = time;
  if (time - model.lastActivity >= model.idleMs) stop(model, "idle");
  return !model.locked;
}
function step(model, action, time, selected) {
  if (action === "stop") return stop(model, "manual");
  if (action === "check") return check(model, time);
  if (action === "activity") {
    if (!check(model, time)) return false;
    model.lastActivity = time;
    return true;
  }
  if (action === "resume") {
    if (model.disposed || !model.locked || model.fault) return false;
    if (time < model.lastSeen) {
      model.fault = model.reason = "clock";
      return false;
    }
    model.lastSeen = model.lastActivity = time;
    model.locked = false;
    model.reason = null;
    model.generation++;
    return true;
  }
  if (action === "configure") {
    if (model.disposed) return false;
    check(model, time);
    model.idleMs = selected;
    check(model, time);
    return true;
  }
  if (action === "dispose") {
    if (!model.disposed) {
      model.disposed = true;
      model.locked = true;
      model.reason ??= "disposed";
      model.generation++;
    }
  }
}
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

for (const seed of [1, 7, 29, 83, 199, 607, 1009, 2027, 8191, 16381, 65521, 99991]) {
  test(`security lock reference trace seed ${seed}`, t => {
    const next = random(seed), clock = fakeClock(), model = reference();
    const lock = createSecurityLock(clock.options);
    t.after(() => lock.dispose());
    let time = 0;
    const actions = ["check", "activity", "resume", "stop", "configure"];
    const oldTickets = [];
    for (let index = 0; index < 300; index++) {
      time += next() % 90001;
      if (index === 250 && seed % 2) time = Math.max(0, model.lastSeen - 1);
      clock.set(time);
      const action = index === 290 ? "dispose" : actions[next() % actions.length];
      const selected = LOCK_IDLE_CHOICES[next() % LOCK_IDLE_CHOICES.length];
      const expected = step(model, action, time, selected);
      const method = { stop: "lock", resume: "unlock" }[action] ?? action;
      const actual = action === "configure" ? lock[method](selected) : lock[method]();
      assert.equal(actual, expected, `${seed}/${index}/${action}`);
      const state = lock.state();
      assert.equal(state.locked, model.locked);
      assert.equal(state.disposed, model.disposed);
      assert.equal(state.reason, model.reason);
      assert.equal(state.fault, model.fault);
      assert.equal(state.idleMs, model.idleMs);
      assert.equal(state.version, model.generation);
      assert.equal(state.canRead, !model.locked && !model.disposed);
      assert.equal(state.canSign, false);
      assert.equal(state.canSendTransactions, false);
      // Timers are deliberately not delivered: action-time checks must suffice.
      assert(clock.timers().length <= 1);
      if (state.locked) assert.equal(clock.timers().length, 0);
      if (!state.locked && action !== "dispose") {
        const permitted = check(model, time);
        const ticket = lock.ticket();
        if (!permitted) { assert.equal(ticket, null); continue; }
        for (const old of oldTickets.filter(value => value !== ticket)) assert.equal(lock.valid(old), false);
        if (!oldTickets.includes(ticket)) oldTickets.push(ticket);
      }
    }
  });
}

for (const stopAt of [0, 1, 2, 3, 4]) {
  test(`stop at transition boundary ${stopAt} permanently invalidates its earlier ticket`, t => {
    const clock = fakeClock();
    const lock = createSecurityLock(clock.options);
    t.after(() => lock.dispose());
    const initial = lock.ticket();
    const events = [() => lock.activity(), () => lock.configure(60000),
      () => clock.advance(1000, false), () => lock.check(), () => lock.activity()];
    for (let i = 0; i < events.length; i++) {
      if (i === stopAt) { lock.lock(); lock.unlock(); }
      events[i]();
    }
    assert.equal(lock.valid(initial), false);
    assert.equal(lock.check(), true);
    const resumed = lock.ticket();
    assert.equal(lock.valid(resumed), true);
  });
}
