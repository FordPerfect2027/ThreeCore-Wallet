import test from "node:test";
import assert from "node:assert/strict";
import { runProtectionBatch, PROTECTION_STEPS } from "../src/protection-batch.js";

function fixture(overrides = {}) {
  const calls = [];
  const steps = PROTECTION_STEPS.map(name => ({ name, run() {
    calls.push(name);
    return overrides[name]?.();
  } }));
  return { calls, steps, run: () => runProtectionBatch(steps) };
}

test("protection cancels file reads before backup, reports and three wallet sessions", () => {
  const f = fixture();
  assert.deepEqual(f.run(), { completed: true, attempted: 8, failed: [] });
  assert.deepEqual(f.calls, ["storage", "exports", "file-reads", "backup", "period", "DAT", "EMA", "CAWELON"]);
});

for (const name of PROTECTION_STEPS) {
  test(name + " cleanup exception cannot skip any other cleanup", () => {
    const f = fixture({ [name]() { throw Error("synthetic sensitive exception"); } });
    const result = f.run();
    assert.deepEqual(f.calls, PROTECTION_STEPS);
    assert.deepEqual(result, { completed: false, attempted: 8, failed: [name] });
    assert(!JSON.stringify(result).includes("sensitive"));
  });

  test(name + " negative completion is reported without short circuiting", () => {
    const f = fixture({ [name]: () => false });
    assert.deepEqual(f.run().failed, [name]);
    assert.deepEqual(f.calls, PROTECTION_STEPS);
  });

  test(name + " asynchronous cleanup cannot be counted as synchronously complete", async () => {
    const f = fixture({ [name]: () => Promise.resolve(true) });
    assert.equal(f.run().completed, false);
    assert.deepEqual(f.calls, PROTECTION_STEPS);
    await Promise.resolve();
  });

  test(name + " rejected cleanup is consumed and does not interrupt later steps", async () => {
    const f = fixture({ [name]: () => Promise.reject(Error("synthetic credential")) });
    assert.deepEqual(f.run().failed, [name]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls, PROTECTION_STEPS);
  });
}

test("several failed views are all identified with fixed names", () => {
  const f = fixture({ backup() { throw Error("private"); }, DAT: () => false,
    CAWELON() { throw null; } });
  const result = f.run();
  assert.deepEqual(result.failed, ["backup", "DAT", "CAWELON"]);
  assert.equal(result.attempted, 8);
  assert.deepEqual(f.calls, PROTECTION_STEPS);
});

test("a failed attempt can be retried from the beginning without retaining exceptions", () => {
  let broken = true;
  const f = fixture({ period() { if (broken) throw Error("private"); } });
  const previous = f.run();
  broken = false;
  assert.equal(f.run().completed, true);
  assert.deepEqual(previous.failed, ["period"]);
  assert.deepEqual(f.calls, [...PROTECTION_STEPS, ...PROTECTION_STEPS]);
});

test("successful callbacks may use the existing void-returning contract", () => {
  for (const value of [undefined, null, true, 0]) {
    assert.equal(runProtectionBatch([{ name: "backup", run: () => value }]).completed, true);
  }
});

test("empty cleanup collection is valid for an unmounted preview", () => {
  assert.deepEqual(runProtectionBatch([]), { completed: true, attempted: 0, failed: [] });
});

test("published cleanup result and failure collection cannot be changed by a view", () => {
  const f = fixture({ DAT: () => false }), result = f.run();
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.failed));
  assert.throws(() => { result.completed = true; }, TypeError);
  assert.throws(() => result.failed.splice(0), TypeError);
});

test("a throwing then getter does not stop the following wallet cleanup", () => {
  const value = Object.defineProperty({}, "then", { get() { throw Error("private"); } });
  const f = fixture({ backup: () => value });
  assert.deepEqual(f.run().failed, ["backup"]);
  assert.deepEqual(f.calls, PROTECTION_STEPS);
});

test("thenable rejection cannot cause an unhandled rejection", async () => {
  const f = fixture({ backup: () => ({ then(resolve, reject) { reject(Error("private")); } }) });
  assert.deepEqual(f.run().failed, ["backup"]);
  await new Promise(resolve => setImmediate(resolve));
});

test("steps are captured before execution so callbacks cannot remove later cleanup", () => {
  const f = fixture({ backup() { f.steps.splice(1); } });
  assert.equal(f.run().completed, true);
  assert.deepEqual(f.calls, PROTECTION_STEPS);
  assert.equal(f.steps.length, 1);
});

test("callbacks cannot replace a captured wallet cleanup with a successful no-op", () => {
  const f = fixture({ backup() { f.steps[2].run = () => true; } });
  f.run();
  assert.deepEqual(f.calls, PROTECTION_STEPS);
});

test("each named operation is allowed only once", () => {
  let count = 0;
  const step = { name: "DAT", run() { count++; } };
  assert.throws(() => runProtectionBatch([step, step]), /PROTECTION_CONFIG/);
  assert.equal(count, 0);
});

for (const invalid of [undefined, null, {}, true, 5, "DAT", new Set()]) {
  test("invalid cleanup collection is refused before invoking anything: " + typeof invalid, () => {
    assert.throws(() => runProtectionBatch(invalid), /PROTECTION_CONFIG/);
  });
}

test("oversized cleanup collection is rejected before executing its first callback", () => {
  let count = 0;
  const rows = Array.from({ length: 9 }, () => ({ name: "DAT", run() { count++; } }));
  assert.throws(() => runProtectionBatch(rows), /PROTECTION_CONFIG/);
  assert.equal(count, 0);
});

test("sparse collection cannot omit a required cleanup silently", () => {
  const rows = new Array(2);
  rows[1] = { name: "DAT", run() {} };
  assert.throws(() => runProtectionBatch(rows), /PROTECTION_CONFIG/);
});

for (const name of ["__proto__", "constructor", "toString", "arbitrary-address", "password", ""]) {
  test("unrecognized step names cannot appear in the status: " + name, () => {
    let count = 0;
    assert.throws(() => runProtectionBatch([{ name, run() { count++; } }]), /PROTECTION_CONFIG/);
    assert.equal(count, 0);
  });
}

for (const field of ["name", "run"]) {
  test("step property accessor is refused without executing it: " + field, () => {
    let reads = 0;
    const row = { name: "DAT", run() {} };
    Object.defineProperty(row, field, { get() { reads++; throw Error("private"); } });
    assert.throws(() => runProtectionBatch([row]), /PROTECTION_CONFIG/);
    assert.equal(reads, 0);
  });
}

test("array item accessors are not invoked during cleanup preparation", () => {
  let reads = 0;
  const rows = [null];
  Object.defineProperty(rows, "0", { get() { reads++; return { name: "DAT", run() {} }; } });
  assert.throws(() => runProtectionBatch(rows), /PROTECTION_CONFIG/);
  assert.equal(reads, 0);
});

test("a later configuration error prevents partial execution of an earlier valid step", () => {
  let count = 0;
  assert.throws(() => runProtectionBatch([
    { name: "backup", run() { count++; } }, { name: "DAT", run: null },
  ]), /PROTECTION_CONFIG/);
  assert.equal(count, 0);
});

test("extra step properties cannot carry hidden cleanup data", () => {
  const row = { name: "DAT", run() {}, password: "synthetic" };
  assert.throws(() => runProtectionBatch([row]), /PROTECTION_CONFIG/);
});

test("symbol step properties cannot carry hidden cleanup data", () => {
  const row = { name: "DAT", run() {}, [Symbol("private")]: "synthetic" };
  assert.throws(() => runProtectionBatch([row]), /PROTECTION_CONFIG/);
});

test("null-prototype descriptors can be used without inherited behavior", () => {
  const row = Object.assign(Object.create(null), { name: "DAT", run() {} });
  assert.equal(runProtectionBatch([row]).completed, true);
});

test("inherited step fields are never used", () => {
  const row = Object.create({ name: "DAT", run() {} });
  assert.throws(() => runProtectionBatch([row]), /PROTECTION_CONFIG/);
});

test("custom collection fields cannot alter the cleanup contract", () => {
  const rows = [{ name: "DAT", run() {} }];
  rows.secret = "synthetic";
  assert.throws(() => runProtectionBatch(rows), /PROTECTION_CONFIG/);
});
