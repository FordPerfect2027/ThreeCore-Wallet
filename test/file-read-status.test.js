import test from "node:test";
import assert from "node:assert/strict";
import { validateFileReadStatus, describeFileReadStatus } from "../src/file-read-status.js";
import { FILE_READ_RESERVED_LIMIT } from "../src/file-read-policy.js";
import { fixture, fakeClock, stalledFile, fallbackFile, outcome, tick } from "./helpers/file-boundary-fixtures.js";

const valid = changes => ({ schema: "threecore-file-read-status-v1", disposed: false, clockFault: false,
  canStart: true, active: 0, waiting: 0, retained: 0, reservedBytes: 0,
  maxActive: 4, maxReservedBytes: FILE_READ_RESERVED_LIMIT,
  accepted: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, rejected: 0, ...changes });

test("file status: exact schema round trip is detached and frozen", () => {
  const input = valid();
  const result = validateFileReadStatus(input);
  assert.deepEqual(result, input);
  assert(Object.isFrozen(result));
  input.completed = 999;
  assert.equal(result.completed, 0);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(valid()).sort());
});

for (const key of Object.keys(valid())) {
  test("file status: absent field refused " + key, () => {
    const input = valid();
    delete input[key];
    assert.equal(validateFileReadStatus(input), null);
    assert.equal(describeFileReadStatus(input).level, "unavailable");
  });

  test("file status: accessors never executed " + key, () => {
    let hits = 0;
    const input = valid();
    Object.defineProperty(input, key, { get() { hits++; return "private secret"; } });
    assert.equal(validateFileReadStatus(input), null);
    assert(!JSON.stringify(describeFileReadStatus(input)).includes("private"));
    assert.equal(hits, 0);
  });
}

for (const extra of ["name", "path", "content", "address", "request", "error", "__proto__", Symbol("private")]) {
  test("file status: unknown field refused " + String(extra), () => {
    const input = valid();
    Object.defineProperty(input, extra, { value: "sensitive marker", enumerable: true });
    assert.equal(validateFileReadStatus(input), null);
    assert(!JSON.stringify(describeFileReadStatus(input)).includes("sensitive"));
  });
}

for (const key of ["active", "waiting", "retained", "reservedBytes", "accepted", "completed",
  "failed", "cancelled", "timedOut", "rejected"]) {
  for (const value of [-1, 0.5, NaN, Infinity, "0", Number.MAX_SAFE_INTEGER + 1]) {
    test(`file status: invalid aggregate ${key}/${String(value)}`, () => {
      assert.equal(validateFileReadStatus(valid({ [key]: value })), null);
    });
  }
}

for (const changed of [
  { active: 1 },
  { waiting: 1 },
  { retained: 1 },
  { reservedBytes: 1 },
  { active: 5, waiting: 5, reservedBytes: 5, canStart: false },
  { active: 2, waiting: 2, reservedBytes: 1 },
  { active: 1, waiting: 1, reservedBytes: FILE_READ_RESERVED_LIMIT + 1 },
  { active: 4, waiting: 4, reservedBytes: 4 },
  { active: 1, waiting: 1, reservedBytes: FILE_READ_RESERVED_LIMIT },
  { canStart: false },
  { disposed: true },
  { clockFault: true },
  { maxActive: 5 },
  { maxReservedBytes: FILE_READ_RESERVED_LIMIT - 1 },
  { schema: "other" },
]) {
  test("file status: inconsistent snapshot refused " + JSON.stringify(changed), () => {
    assert.equal(validateFileReadStatus(valid(changed)), null);
  });
}

for (const value of [undefined, null, [], "status", 1, Object.create({ inherited: true }),
  new Date(), new Proxy({}, { getPrototypeOf() { throw Error("private"); } })]) {
  test("file status: unsupported input has a fixed fallback " + typeof value, () => {
    const view = describeFileReadStatus(value);
    assert.equal(view.level, "unavailable");
    assert(Object.isFrozen(view));
    assert(!view.heading.includes("private"));
  });
}

test("file status: null prototype exact aggregate is accepted", () => {
  assert.deepEqual(validateFileReadStatus(Object.assign(Object.create(null), valid())), valid());
});

test("file status: saturation counters are valid without arithmetic overflow", () => {
  const input = valid({ accepted: Number.MAX_SAFE_INTEGER, completed: Number.MAX_SAFE_INTEGER,
    cancelled: Number.MAX_SAFE_INTEGER, rejected: Number.MAX_SAFE_INTEGER });
  assert(validateFileReadStatus(input));
  assert(describeFileReadStatus(input).counts.includes(String(Number.MAX_SAFE_INTEGER)));
});

test("file status: real lifecycle states all meet validation", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const seen = [];
  service.subscribe(state => seen.push(state));
  const input = stalledFile();
  const pending = outcome(service.readText(input.file, { timeoutMs: 10 }));
  await tick(); clock.set(10); clock.fire(); await pending;
  input.settle(); await tick();
  assert.equal(await service.readText(fallbackFile().file), "ok");
  service.dispose();
  assert(seen.every(value => validateFileReadStatus(value)));
  assert(seen.some(value => value.waiting === 1));
  assert(seen.some(value => value.retained === 1));
  assert(seen.some(value => value.completed === 1));
  assert(seen.some(value => value.disposed));
});

test("file status: ready description does not claim an audit or saved file", () => {
  const view = describeFileReadStatus(valid());
  assert.equal(view.level, "ready");
  assert.match(view.heading, /待機/);
  assert.match(view.detail, /同時に4件/);
  assert(!/監査済み|保存完了|安全を保証/.test(JSON.stringify(view)));
});

test("file status: pending and retained work have distinct messages", () => {
  const waiting = describeFileReadStatus(valid({ active: 1, waiting: 1, reservedBytes: 10 }));
  const retained = describeFileReadStatus(valid({ active: 1, retained: 1, reservedBytes: 10 }));
  assert.equal(waiting.level, "reading");
  assert.equal(retained.level, "retained");
  assert.match(retained.detail, /枠を保持/);
  assert.match(retained.detail, /破棄/);
});

test("file status: count quota and byte quota both explain refusal", () => {
  for (const changes of [
    { active: 4, waiting: 4, reservedBytes: 4, canStart: false },
    { active: 2, waiting: 1, retained: 1, reservedBytes: FILE_READ_RESERVED_LIMIT, canStart: false },
  ]) {
    const view = describeFileReadStatus(valid(changes));
    assert.equal(view.level, "limited");
    assert.match(view.heading, /受け付けられません/);
    assert.match(view.detail, /自動で再読み込みはしません/);
  }
});

test("file status: terminal clock fault overrides ordinary pending message", () => {
  const state = valid({ clockFault: true, active: 1, retained: 1, reservedBytes: 4, canStart: false });
  const view = describeFileReadStatus(state);
  assert.equal(view.level, "stopped");
  assert.match(view.detail, /経過時間/);
  assert.match(view.detail, /再読み込み/);
});
