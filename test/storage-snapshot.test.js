import test from "node:test";
import assert from "node:assert/strict";
import { captureStorageInput, STORAGE_SNAPSHOT_LIMITS, synchronousStorageValue,
  ownStorageData } from "../src/storage-guard-policy.js";
import { code } from "./helpers/storage-guard-fixtures.js";

const bounds = changes => ({ ...STORAGE_SNAPSHOT_LIMITS, ...changes });

test("capture severs all mutable references in a reviewed nested operation", () => {
  const source = { expected: 0, operation: { kind: "save", entries: [{ label: "reviewed", tags: ["DAT"] }] } };
  const snapshot = captureStorageInput(source);
  source.expected = 7;
  source.operation.entries[0].label = "changed";
  source.operation.entries[0].tags.push("EMA");
  source.operation.entries.push({ label: "other" });
  assert.deepEqual(snapshot, { expected: 0, operation: { kind: "save", entries: [{ label: "reviewed", tags: ["DAT"] }] } });
  assert(Object.isFrozen(snapshot.operation.entries[0].tags));
  assert.throws(() => { snapshot.operation.kind = "purge"; }, TypeError);
});

for (const value of [null, true, false, 0, -1, 1.25, "", "日本語🔒", [], {}]) {
  test("JSON data survives a bounded snapshot: " + JSON.stringify(value), () => {
    assert.deepEqual(captureStorageInput(value), value);
  });
}

for (const [name, value] of [
  ["undefined", undefined], ["function", () => 1], ["symbol", Symbol("secret")],
  ["bigint", 1n], ["NaN", NaN], ["infinity", Infinity], ["negative infinity", -Infinity],
  ["date", new Date(0)], ["set", new Set()], ["map", new Map()],
  ["buffer", new Uint8Array(2)], ["regexp", /secret/], ["boxed", new String("secret")],
]) {
  test("unsupported input type is rejected: " + name, () => {
    assert.throws(() => captureStorageInput(value), code("CHECKPOINT_ADAPTER"));
  });
}

test("ordinary getters are never invoked during capture", () => {
  let calls = 0;
  const value = { get content() { calls++; return "secret"; } };
  assert.throws(() => captureStorageInput(value), code("CHECKPOINT_ADAPTER"));
  assert.equal(calls, 0);
});

test("toJSON hooks cannot change the captured content", () => {
  let calls = 0;
  const value = { toJSON() { calls++; return "private"; } };
  assert.throws(() => captureStorageInput(value), code("CHECKPOINT_ADAPTER"));
  assert.equal(calls, 0);
});

test("null-prototype data is copied to a normal frozen data object", () => {
  const input = Object.assign(Object.create(null), { value: [1, 2] });
  const output = captureStorageInput(input);
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.deepEqual(output, { value: [1, 2] });
});

for (const key of ["__proto__", "constructor", "prototype"]) {
  test("prototype-sensitive key is refused without changing global objects: " + key, () => {
    const value = Object.create(null);
    value[key] = { polluted: true };
    assert.throws(() => captureStorageInput(value), code("CHECKPOINT_ADAPTER"));
    assert.equal({}.polluted, undefined);
  });
}

test("sparse arrays are rejected rather than filled with implicit nulls", () => {
  const input = [];
  input.length = 3;
  input[2] = "visible";
  assert.throws(() => captureStorageInput(input), code("CHECKPOINT_ADAPTER"));
});

test("array accessors do not run during admission", () => {
  let calls = 0;
  const input = [0];
  Object.defineProperty(input, "0", { get() { calls++; return 1; }, enumerable: true });
  assert.throws(() => captureStorageInput(input), code("CHECKPOINT_ADAPTER"));
  assert.equal(calls, 0);
});

for (const make of [
  () => Object.assign([1], { extra: true }),
  () => Object.assign({}, { [Symbol("hidden")]: "private" }),
  () => Object.defineProperty({}, "hidden", { value: "private" }),
  () => Object.setPrototypeOf({}, { inherited: true }),
  () => Object.setPrototypeOf([], null),
]) {
  test("non-JSON structure has no silent interpretation: " + make.toString(), () => {
    assert.throws(() => captureStorageInput(make()), code("CHECKPOINT_ADAPTER"));
  });
}

test("direct and indirect cycles fail without recursive stack overflow", () => {
  const a = {}, b = { a };
  a.b = b;
  assert.throws(() => captureStorageInput(a), code("CHECKPOINT_ADAPTER"));
  const list = [];
  list.push(list);
  assert.throws(() => captureStorageInput(list), code("CHECKPOINT_ADAPTER"));
});

test("reused acyclic objects count and copy each occurrence independently", () => {
  const shared = { token: "DAT" };
  const copy = captureStorageInput([shared, shared]);
  assert.notEqual(copy[0], copy[1]);
  assert.deepEqual(copy, [{ token: "DAT" }, { token: "DAT" }]);
  assert.throws(() => captureStorageInput([shared, shared], bounds({ nodes: 4 })), code("CHECKPOINT_CAPACITY"));
});

for (const limit of [1, 2, 4, 10]) {
  test("node budget admits exactly the bounded flat array: " + limit, () => {
    const values = Array.from({ length: limit - 1 }, () => null);
    assert.deepEqual(captureStorageInput(values, bounds({ nodes: limit })), values);
    assert.throws(() => captureStorageInput([...values, null], bounds({ nodes: limit })), /CHECKPOINT_/);
  });
}

for (const text of ["abc", "日本語", "🔒🔒", "a\u0000b"]) {
  test("string and property-name accounting follows UTF-16 units: " + text, () => {
    const size = text.length + 1;
    assert.deepEqual(captureStorageInput({ x: text }, bounds({ characters: size })), { x: text });
    assert.throws(() => captureStorageInput({ x: text }, bounds({ characters: size - 1 })), code("CHECKPOINT_CAPACITY"));
  });
}

test("depth has an independent bound even for a narrow tree", () => {
  assert.deepEqual(captureStorageInput([[0]], bounds({ depth: 2 })), [[0]]);
  assert.throws(() => captureStorageInput([[[0]]], bounds({ depth: 2 })), code("CHECKPOINT_CAPACITY"));
});

for (const name of ["nodes", "characters", "depth"]) {
  for (const value of [0, -1, 1.5, NaN, Infinity, "4", null]) {
    test("invalid snapshot budget is refused: " + name + "=" + String(value), () => {
      assert.throws(() => captureStorageInput({}, bounds({ [name]: value })), code("CHECKPOINT_ADAPTER"));
    });
  }
  test("budget cannot be expanded beyond application cap: " + name, () => {
    assert.throws(() => captureStorageInput({}, bounds({ [name]: STORAGE_SNAPSHOT_LIMITS[name] + 1 })), code("CHECKPOINT_ADAPTER"));
  });
}

for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
  test("proxy trap errors become static admission errors: " + trap, () => {
    const input = new Proxy({ field: 1 }, { [trap]() { throw Error("secret adapter details"); } });
    assert.throws(() => captureStorageInput(input), error => error.code === "CHECKPOINT_ADAPTER" && !error.message.includes("secret"));
  });
}

test("own-data inspection neither executes accessors nor traverses prototypes", () => {
  let calls = 0;
  const input = Object.create({ code: "CHECKPOINT_TIMEOUT" });
  Object.defineProperty(input, "name", { get() { calls++; return "secret"; } });
  assert.equal(ownStorageData(input, "code"), undefined);
  assert.equal(ownStorageData(input, "name"), undefined);
  assert.equal(calls, 0);
});

test("a returned rejected promise is consumed and rejected as an adapter contract", async () => {
  assert.throws(() => synchronousStorageValue(Promise.reject(Error("private"))), code("CHECKPOINT_ADAPTER"));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("plain synchronous values preserve exact identity for policy evaluation", () => {
  const input = { value: "DAT" };
  assert.equal(synchronousStorageValue(input), input);
  assert.equal(synchronousStorageValue(true), true);
});
