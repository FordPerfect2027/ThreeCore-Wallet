import test from "node:test";
import assert from "node:assert/strict";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { clockFixture, deferred, drain } from "./helpers/rpc-supervisor-fixtures.js";

// Independent reference model: records of local outcomes and native settlements.
// It does not import the production lease manager, status validator or timers.
class RequestModel {
  constructor() {
    this.time = 1000;
    this.rows = [];
    this.disposed = false;
    this.fault = null;
    this.counts = { started: 0, completed: 0, failed: 0,
      timedOut: 0, cancelled: 0, denied: 0, late: 0 };
  }

  add(provider, duration, cancelBeforeDispatch) {
    const row = { provider, deadline: this.time + duration,
      native: false, local: "waiting", dispatched: false };
    this.rows.push(row);
    if (this.disposed) {
      row.local = "RPC_SUPERVISOR_CLOSED";
      this.counts.failed++;
    } else if (this.fault) {
      row.local = "RPC_CLOCK";
      this.counts.failed++;
    } else if (this.rows.filter(item => item.native).length >= 7 ||
        this.rows.filter(item => item.native && item.provider === provider).length >= 3) {
      row.local = "RPC_CAPACITY";
      this.counts.denied++;
    } else if (cancelBeforeDispatch) {
      row.local = "SESSION_CHANGED";
      this.counts.cancelled++;
    } else {
      row.dispatched = row.native = true;
      this.counts.started++;
    }
    return row;
  }

  cancel(row) {
    if (row.local !== "waiting") return;
    row.local = "SESSION_CHANGED";
    this.counts.cancelled++;
  }

  timers() {
    for (const row of this.rows) {
      if (row.local === "waiting" && this.time >= row.deadline) {
        row.local = "READ_TIMEOUT";
        this.counts.timedOut++;
      }
    }
  }

  settle(row, success) {
    if (!row.native) return;
    row.native = false;
    if (row.local !== "waiting") {
      this.counts.late++;
    } else if (this.time >= row.deadline) {
      row.local = "READ_TIMEOUT";
      this.counts.timedOut++;
      this.counts.late++;
    } else {
      row.local = success ? "value" : "PROVIDER_FAILURE";
      this.counts[success ? "completed" : "failed"]++;
    }
  }

  breakClock() {
    this.fault = "RPC_CLOCK";
    for (const row of this.rows) {
      if (row.local !== "waiting") continue;
      row.local = "RPC_CLOCK";
      this.counts.failed++;
    }
  }

  dispose() {
    this.disposed = true;
    for (const row of this.rows) {
      if (row.local !== "waiting") continue;
      row.local = "RPC_SUPERVISOR_CLOSED";
      this.counts.failed++;
    }
  }

  expected() {
    const native = this.rows.filter(row => row.native);
    const waiting = native.filter(row => row.local === "waiting").length;
    return { schema: "threecore-rpc-status-v1", perProvider: 3, perPage: 7,
      pending: native.length, waiting, abandoned: native.length - waiting,
      occupiedProviders: new Set(native.map(row => row.provider)).size,
      ...this.counts, fault: this.fault, disposed: this.disposed,
      canStart: !this.disposed && this.fault === null };
  }
}

function random(seed) {
  let value = seed >>> 0;
  return bound => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % bound;
  };
}

function traceFixture(seed) {
  const next = random(seed);
  const model = new RequestModel();
  const clock = clockFixture();
  const providers = Array.from({ length: 4 }, () => ({}));
  const supervisor = createRpcSupervisor({ ...clock.options, perProvider: 3, perPage: 7 });
  const rows = [];
  let invocations = 0;
  const trace = [];

  function add(providerIndex = next(providers.length), duration = 1 + next(20), queuedCancel = false) {
    const result = deferred();
    const expected = model.add(providerIndex, duration, queuedCancel);
    const operation = supervisor.start({ provider: providers[providerIndex], timeoutMs: duration,
      invoke() { invocations++; return result.promise; } });
    const row = { expected, result, operation, observed: "waiting", callbacks: 0 };
    operation.promise.then(() => {
      row.callbacks++; row.observed = "value";
    }, error => {
      row.callbacks++; row.observed = error.code;
    });
    rows.push(row);
    if (queuedCancel) operation.cancel();
    trace.push(["add", providerIndex, duration, queuedCancel]);
    return row;
  }

  function pick(nativeOnly = false) {
    const eligible = nativeOnly ? rows.filter(row => row.expected.native) : rows;
    return eligible[next(Math.max(eligible.length, 1))];
  }

  function cancel() {
    const row = pick();
    if (!row) return;
    model.cancel(row.expected); row.operation.cancel();
    trace.push(["cancel", rows.indexOf(row)]);
  }

  function settle(success = true) {
    const row = pick(true);
    if (!row) return;
    model.settle(row.expected, success);
    if (success) row.result.resolve("synthetic value");
    else row.result.reject(Error("untrusted synthetic message"));
    trace.push(["settle", rows.indexOf(row), success]);
  }

  function advance() {
    const elapsed = next(8);
    model.time += elapsed; clock.advance(elapsed);
    trace.push(["advance without running timers", elapsed]);
  }

  function fireTimers() {
    model.timers();
    // Also fire early timers. A correct implementation must re-arm them without
    // changing local outcomes or granting extra capacity.
    for (const timer of clock.timers()) clock.fire(timer.id);
    trace.push(["timers"]);
  }

  function dispose() {
    model.dispose(); supervisor.dispose(); trace.push(["dispose"]);
  }

  async function check(step) {
    await drain();
    const context = JSON.stringify({ seed, step, trace: trace.slice(-12) });
    assert.deepEqual(supervisor.state(), model.expected(), context);
    assert.equal(invocations, model.counts.started, context);
    for (const row of rows) {
      assert.equal(row.observed, row.expected.local, context);
      assert.equal(row.callbacks, row.expected.local === "waiting" ? 0 : 1, context);
      assert.equal(row.operation.state().dispatched, row.expected.dispatched, context);
    }
  }

  async function step(index) {
    switch (next(8)) {
      case 0: case 1: add(); break;
      case 2: add(undefined, undefined, true); break;
      case 3: cancel(); break;
      case 4: settle(true); break;
      case 5: settle(false); break;
      case 6: advance(); break;
      case 7: fireTimers(); break;
    }
    await check(index);
  }

  async function breakClock() {
    model.breakClock();
    clock.set(0);
    // A new request is one of the boundaries at which clock integrity is checked.
    add();
    await check("clock fault");
  }

  async function close() {
    dispose();
    await check("dispose");
    while (rows.some(row => row.expected.native)) {
      settle(next(2) === 0);
      await check("drain abandoned native work");
    }
    for (const row of rows) {
      // Double resolution and cancellation must not affect a different request.
      row.result.resolve("duplicate"); row.operation.cancel();
    }
    await check("duplicate cleanup");
    assert.equal(clock.timers().length, 0);
  }

  return { add, step, check, breakClock, close, dispose, advance, fireTimers };
}

for (const seed of [1, 7, 13, 29, 37, 71, 101, 313, 997, 2026, 8453, 84532]) {
  test("independent request lifecycle model with interleaved deadlines: seed " + seed, async () => {
    const f = traceFixture(seed);
    try {
      // Ensure every trace exercises both the identity and page-wide limit.
      for (let i = 0; i < 12; i++) {
        f.add(Math.floor(i / 4), 20);
        await f.check("initial saturation " + i);
      }
      for (let i = 0; i < 200; i++) await f.step(i);
      if (seed % 2) await f.breakClock();
      else { f.dispose(); await f.check("explicit disposal"); }
      for (let i = 0; i < 16; i++) await f.step("closed " + i);
    } finally { await f.close(); }
  });
}

test("reference model covers expiry without timer delivery before replacement dispatch", async () => {
  const f = traceFixture(42);
  try {
    for (let i = 0; i < 3; i++) { f.add(0, 1); await f.check(i); }
    for (let i = 0; i < 4; i++) f.advance();
    f.add(0, 1);
    await f.check("expired work still charged before timer");
    f.fireTimers();
    await f.check("local timeouts preserve native capacity");
    f.add(0, 1);
    await f.check("timed out native work still charged");
  } finally { await f.close(); }
});
