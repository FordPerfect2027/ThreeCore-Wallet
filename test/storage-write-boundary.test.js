import test from "node:test";
import assert from "node:assert/strict";
import { fixture, outcome, saveOperation, microtasks, document, code } from "./helpers/storage-guard-fixtures.js";
import { emptyCheckpointDocument, mutateCheckpoints } from "../src/checkpoint-model.js";
import { checkpointStorageError } from "../src/checkpoint-storage.js";

const policy = mutate => ({ empty: emptyCheckpointDocument, validate: value => value,
  mutate, mapError: checkpointStorageError });

test("reviewed operation is fixed before opening the database", async t => {
  const f = fixture(t);
  const operation = saveOperation();
  const pending = outcome(f.storage.change(0, operation));
  operation.label = "not reviewed";
  operation.fileText = "private replacement";
  const tx = await f.open();
  tx.read();
  tx.complete();
  const result = await pending;
  assert(result.ok);
  assert.equal(result.value.entries[0].label, "控え 1");
  assert.equal(result.value.entries[0].fileText, "{}");
});

test("mutation during a queued read cannot replace the captured operation", async t => {
  const f = fixture(t);
  const operation = saveOperation();
  const pending = outcome(f.storage.change(0, operation));
  const tx = await f.open();
  operation.kind = "purge";
  operation.confirmed = true;
  tx.read();
  tx.complete();
  assert.equal((await pending).value.entries.length, 1);
  assert.equal(f.effects.puts, 1);
});

test("nested imported entries retain their reviewed values", async t => {
  const f = fixture(t);
  const operation = { kind: "import", entries: document(2).entries };
  const pending = outcome(f.storage.change(0, operation));
  operation.entries[0].label = "unreviewed";
  operation.entries.splice(1, 1);
  const tx = await f.open();
  tx.read();
  tx.complete();
  const result = await pending;
  assert.equal(result.value.entries.length, 2);
  assert.equal(result.value.entries[0].label, "控え 1");
});

test("stored-data parsing cannot silently overwrite corrupted documents", async t => {
  const bad = { schema: "wrong", revision: 0, entries: [] };
  const f = fixture(t, { initial: bad });
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  assert.equal((await pending).code, "CHECKPOINT_SCHEMA");
  await microtasks();
  assert.equal(f.effects.puts, 0);
  assert.deepEqual(f.current(), bad);
});

test("the caller receives a detached, frozen committed result", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  tx.complete();
  const result = (await pending).value;
  assert(Object.isFrozen(result.entries[0]));
  assert.throws(() => { result.entries[0].label = "other"; }, TypeError);
  assert.equal(f.current().entries[0].label, "控え 1");
});

for (const stage of ["validate", "mutate", "authorize", "put-getter"]) {
  test("cancellation at write boundary prevents any put: " + stage, async t => {
    const abort = new AbortController();
    const custom = policy((current, expected, operation) => {
      if (stage === "mutate") abort.abort();
      return mutateCheckpoints(current, expected, operation);
    });
    custom.validate = value => {
      if (stage === "validate") abort.abort();
      return value;
    };
    const f = fixture(t, { initial: document(0), documentPolicy: custom });
    const pending = outcome(f.storage.change(0, saveOperation(), {
      signal: abort.signal,
      canCommit() { if (stage === "authorize") abort.abort(); return true; },
    }));
    const tx = await f.open();
    if (stage === "put-getter") {
      const put = tx.store.put;
      Object.defineProperty(tx.store, "put", { get() { abort.abort(); return put; } });
    }
    tx.read();
    assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
    await microtasks();
    assert.equal(f.effects.puts, 0);
    assert.equal(f.current().revision, 0);
  });
}

for (const stage of ["validate", "mutate", "authorize"]) {
  test("closing from a policy callback prevents a replacement write: " + stage, async t => {
    let storage;
    const custom = policy((current, expected, operation) => {
      if (stage === "mutate") storage.close();
      return mutateCheckpoints(current, expected, operation);
    });
    custom.validate = value => { if (stage === "validate") storage.close(); return value; };
    const f = fixture(t, { initial: document(0), documentPolicy: custom });
    storage = f.storage;
    const pending = outcome(storage.change(0, saveOperation(), {
      canCommit() { if (stage === "authorize") storage.close(); return true; },
    }));
    const tx = await f.open();
    tx.read();
    assert.equal((await pending).code, "CHECKPOINT_ABORTED");
    assert.equal(f.effects.puts, 0);
  });
}

for (const stage of ["validate", "mutate", "authorize"]) {
  test("elapsed-time expiry is checked after synchronous work: " + stage, async t => {
    let time;
    const custom = policy((current, expected, operation) => {
      if (stage === "mutate") time.advance(100);
      return mutateCheckpoints(current, expected, operation);
    });
    custom.validate = value => { if (stage === "validate") time.advance(100); return value; };
    const f = fixture(t, { initial: document(0), documentPolicy: custom });
    time = f.time;
    const pending = outcome(f.storage.change(0, saveOperation(), {
      canCommit() { if (stage === "authorize") time.advance(100); return true; },
    }));
    const tx = await f.open();
    tx.read();
    assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
    assert.equal(f.effects.puts, 0);
  });
}

for (const value of [false, undefined, null, "true", 1]) {
  test("save authority requires literal true: " + String(value), async t => {
    const f = fixture(t);
    const pending = outcome(f.storage.change(0, saveOperation(), { canCommit: () => value }));
    const tx = await f.open();
    tx.read();
    assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
    assert.equal(f.effects.puts, 0);
  });
}

for (const phase of ["empty", "validate", "mutate", "authorize"]) {
  test("async policies cannot hold write authority open: " + phase, async t => {
    const custom = policy(mutateCheckpoints);
    custom.validate = value => value;
    if (phase !== "authorize") custom[phase] = async () => { throw Error("private async"); };
    const f = fixture(t, { initial: phase === "empty" ? undefined : document(0), documentPolicy: custom });
    const pending = outcome(f.storage.change(0, saveOperation(), {
      canCommit: phase === "authorize" ? async () => { throw Error("private"); } : () => true,
    }));
    const tx = await f.open();
    tx.read();
    const result = await pending;
    assert.equal(result.code, "CHECKPOINT_ADAPTER");
    assert.equal(f.effects.puts, 0);
    await microtasks();
  });
}

test("duplicate request success events cannot issue a second put", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  tx.read();
  tx.complete();
  assert((await pending).ok);
  assert.equal(f.effects.puts, 1);
});

test("completion without successful data validation cannot fabricate empty state", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  tx.complete();
  assert.equal((await pending).code, "CHECKPOINT_STORAGE");
  assert.equal(f.guard.state().completed, 0);
});

test("stale revisions fail even when the caller mutates its expected revision later", async t => {
  const f = fixture(t, { initial: document(1) });
  const pending = outcome(f.storage.change(0, saveOperation(2)));
  const tx = await f.open();
  tx.read();
  assert.equal((await pending).code, "CHECKPOINT_STALE");
  assert.equal(f.effects.puts, 0);
  assert.equal(f.current().entries.length, 1);
});

test("a failed commit request leaves the durable document unchanged", async t => {
  const original = document(1);
  const f = fixture(t, { initial: original });
  const pending = outcome(f.storage.change(1, saveOperation(2)));
  const tx = await f.open();
  tx.read();
  tx.put.error = new DOMException("private quota details", "QuotaExceededError");
  tx.put.onerror();
  assert.equal((await pending).code, "CHECKPOINT_QUOTA");
  await microtasks();
  assert.deepEqual(f.current(), original);
});

test("plain stored references cannot mutate the returned result before completion", async t => {
  let reference;
  const custom = policy(mutateCheckpoints);
  custom.validate = value => { reference = value; return value; };
  const f = fixture(t, { initial: document(1), documentPolicy: custom });
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  tx.read();
  reference.entries[0].label = "late mutation";
  tx.complete();
  assert.equal((await pending).value.entries[0].label, "控え 1");
});

test("snapshot admission runs before the first IndexedDB open", async t => {
  const f = fixture(t);
  let calls = 0;
  const operation = { get kind() { calls++; return "save"; } };
  const result = await outcome(f.storage.change(0, operation));
  assert.equal(result.code, "CHECKPOINT_ADAPTER");
  assert.equal(calls, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.guard.state().active, 0);
});
