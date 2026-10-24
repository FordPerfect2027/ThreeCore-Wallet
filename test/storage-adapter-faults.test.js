import test from "node:test";
import assert from "node:assert/strict";
import { fixture, outcome, saveOperation, microtasks, code } from "./helpers/storage-guard-fixtures.js";
import { CheckpointError } from "../src/checkpoint-model.js";
import { checkpointStorageError, createCheckpointStorage } from "../src/checkpoint-storage.js";
import { createStorageGuard } from "../src/storage-guard.js";

for (const signal of [null, {}, false, 1, "abort", { aborted: false, addEventListener() {}, removeEventListener() {} }]) {
  test("non-native signal is rejected before open: " + String(signal), async t => {
    const f = fixture(t);
    const result = await outcome(f.storage.read({ signal }));
    assert.equal(result.code, "CHECKPOINT_ADAPTER");
    assert.equal(f.requests.length, 0);
    assert.equal(f.guard.state().active, 0);
  });
}

test("a prototype-only AbortSignal imitation cannot pass the native brand check", async t => {
  const f = fixture(t);
  const signal = Object.create(AbortSignal.prototype);
  const result = await outcome(f.storage.read({ signal }));
  assert.equal(result.ok, false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.guard.state().active, 0);
});

test("a previously aborted native signal creates no timer or storage request", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  abort.abort();
  const result = await outcome(f.storage.read({ signal: abort.signal }));
  assert.equal(result.code, "CHECKPOINT_CANCELLED");
  assert.equal(f.requests.length, 0);
  assert.equal(f.time.pending, 0);
});

test("signal registration failure prevents backend dispatch and removes partial listener", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  const originalAdd = abort.signal.addEventListener;
  const originalRemove = abort.signal.removeEventListener;
  let removals = 0;
  abort.signal.addEventListener = function (...args) {
    originalAdd.apply(this, args);
    throw Error("private registration failure");
  };
  abort.signal.removeEventListener = function (...args) {
    removals++;
    originalRemove.apply(this, args);
  };
  const result = await outcome(f.storage.read({ signal: abort.signal }));
  assert.equal(result.ok, false);
  assert.equal(removals, 1);
  assert.equal(f.requests.length, 0);
  abort.abort();
  assert.equal(f.guard.state().active, 0);
});

test("abort during listener registration leaves no orphan deadline", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  const original = abort.signal.addEventListener;
  abort.signal.addEventListener = function (...args) {
    original.apply(this, args);
    abort.abort();
  };
  const result = await outcome(f.storage.read({ signal: abort.signal }));
  assert.equal(result.code, "CHECKPOINT_CANCELLED");
  assert.equal(f.requests.length, 0);
  assert.equal(f.time.pending, 0);
  assert.equal(f.guard.state().active, 0);
});

test("listener cleanup exceptions cannot convert cancellation to success", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  abort.signal.removeEventListener = () => { throw Error("private cleanup"); };
  const pending = outcome(f.storage.read({ signal: abort.signal }));
  const tx = await f.open();
  abort.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  tx.read();
  await microtasks();
  assert.equal(f.guard.state().completed, 0);
});

test("reentrant snapshot traps cannot create parallel storage opens", async t => {
  const f = fixture(t);
  const nested = [];
  const operation = new Proxy(saveOperation(), {
    ownKeys(value) {
      nested.push(outcome(f.storage.read()));
      nested.push(outcome(f.storage.read()));
      return Reflect.ownKeys(value);
    },
  });
  const pending = outcome(f.storage.change(0, operation));
  assert.equal(f.requests.length, 1);
  for (const value of nested) assert.equal((await value).code, "CHECKPOINT_BUSY");
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await pending).ok);
});

test("closing from the open method accessor never invokes the backend", async t => {
  const f = fixture(t);
  let calls = 0;
  Object.defineProperty(f.factory, "open", { get() {
    f.storage.close();
    return () => { calls++; return {}; };
  } });
  const pending = outcome(f.storage.read());
  assert.equal((await pending).code, "CHECKPOINT_CLOSED");
  assert.equal(calls, 0);
  assert.equal(f.guard.state().active, 0);
});

for (const boundary of ["transaction", "objectStore", "get", "put"]) {
  test("cancellation while looking up native method is rechecked: " + boundary, async t => {
    const f = fixture(t);
    const abort = new AbortController();
    const pending = outcome(f.storage.change(0, saveOperation(), { signal: abort.signal }));
    let calls = 0;
    if (boundary === "transaction") {
      const original = f.db.transaction;
      Object.defineProperty(f.db, "transaction", { get() {
        abort.abort();
        return function (...args) { calls++; return original.apply(this, args); };
      } });
    } else {
      f.hooks.onTransaction = tx => {
        const host = boundary === "objectStore" ? tx : tx.store;
        const original = host[boundary];
        Object.defineProperty(host, boundary, { get() {
          abort.abort();
          return function (...args) { calls++; return original.apply(this, args); };
        } });
      };
    }
    await f.open();
    if (boundary === "put") f.transactions[0].read();
    assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
    assert.equal(calls, 0);
    assert.equal(f.effects.puts, 0);
  });
}

for (const boundary of ["transaction", "objectStore", "get", "put"]) {
  test("throwing native method has a bounded error and no successful commit: " + boundary, async t => {
    const f = fixture(t);
    const pending = outcome(f.storage.change(0, saveOperation()));
    const failure = () => { throw Error("private filesystem detail"); };
    if (boundary === "transaction") f.db.transaction = failure;
    else f.hooks.onTransaction = tx => { (boundary === "objectStore" ? tx : tx.store)[boundary] = failure; };
    await f.open();
    if (boundary === "put") f.transactions[0].read();
    const result = await pending;
    assert.equal(result.code, "CHECKPOINT_STORAGE");
    assert(!result.error.message.includes("private"));
    assert.equal(f.effects.commits, 0);
  });
}

test("handler-registration failure holds unknown native work rather than reopening", async t => {
  const f = fixture(t);
  f.hooks.onOpen = request => {
    Object.defineProperty(request, "onblocked", { set() { throw Error("private"); } });
  };
  const result = await outcome(f.storage.read());
  assert.equal(result.code, "CHECKPOINT_STORAGE");
  assert.equal(f.guard.state().draining, 1);
  assert.equal((await outcome(f.storage.read())).code, "CHECKPOINT_BLOCKED");
  assert.equal(f.requests.length, 1);
});

for (const field of ["name", "code", "message"]) {
  test("error accessor is never used in static translation: " + field, () => {
    let calls = 0;
    const input = {};
    Object.defineProperty(input, field, { get() { calls++; throw Error("secret"); } });
    const result = checkpointStorageError(input);
    assert.equal(result.message, "CHECKPOINT_STORAGE");
    assert.equal(calls, 0);
  });
}

for (const value of ["__proto__", "constructor", "toString", {}, Symbol("name")]) {
  test("exception name cannot index inherited mapping data: " + String(value), () => {
    const result = checkpointStorageError({ name: value });
    assert.equal(result.code, "CHECKPOINT_STORAGE");
    assert.equal(result.message, "CHECKPOINT_STORAGE");
  });
}

test("recognized application errors are copied without arbitrary message data", () => {
  const error = new CheckpointError("CHECKPOINT_STALE");
  error.message = "private account content";
  const safe = checkpointStorageError(error);
  assert.notEqual(safe, error);
  assert.equal(safe.message, "CHECKPOINT_STALE");
});

test("unrecognized application codes cannot escape through status messages", () => {
  const error = new CheckpointError("CHECKPOINT_PRIVATE_ACCOUNT_DATA");
  assert.equal(checkpointStorageError(error).code, "CHECKPOINT_STORAGE");
});

for (const value of [0, -1, 1.5, 60001, Infinity, "100"]) {
  test("transaction deadline configuration remains bounded: " + String(value), () => {
    assert.throws(() => createCheckpointStorage({ transactionTimeoutMs: value }), code("CHECKPOINT_ADAPTER"));
  });
}

test("policy callbacks are captured once and cannot be swapped during open", async t => {
  const { emptyCheckpointDocument, mutateCheckpoints } = await import("../src/checkpoint-model.js");
  const policy = { empty: emptyCheckpointDocument, validate: value => value,
    mutate: mutateCheckpoints, mapError: checkpointStorageError };
  const f = fixture(t, { documentPolicy: policy });
  const pending = outcome(f.storage.change(0, saveOperation()));
  policy.mutate = () => { throw Error("replacement"); };
  policy.mapError = () => Error("private");
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await pending).ok);
});
