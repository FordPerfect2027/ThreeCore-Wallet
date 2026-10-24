import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointStorage, CHECKPOINT_DATABASE } from "../src/checkpoint-storage.js";
import { createEncryptedLibraryStorage, ENCRYPTED_LIBRARY_DATABASE } from "../src/encrypted-library-storage.js";
import { createPeriodLibraryStorage, PERIOD_LIBRARY_DATABASE } from "../src/period-library-storage.js";
import { createReportHistoryStorage, REPORT_HISTORY_DATABASE } from "../src/report-history-storage.js";
import { createVaultStorage, VAULT_DATABASE } from "../src/transfer-vault-storage.js";
import { emptyCheckpointDocument } from "../src/checkpoint-model.js";
import { emptyEncryptedLibrary } from "../src/encrypted-library-model.js";
import { emptyPeriodLibrary } from "../src/period-library-model.js";
import { emptyReportHistory } from "../src/report-history-model.js";
import { emptyVaultDocument } from "../src/transfer-vault-model.js";
import { saveOperation as checkpointSave } from "./helpers/checkpoint-fixtures.js";
import { entry as encryptedEntry } from "./helpers/encrypted-library-fixtures.js";
import { saveOperation as periodSave } from "./helpers/period-library-fixtures.js";
import { saveHistory } from "./helpers/report-history-fixtures.js";
import { saveOperation as vaultSave } from "./helpers/vault-fixtures.js";
import { createStorageGuard } from "../src/storage-guard.js";
import { database, manualTime, microtasks, outcome, clone, invariant } from "./helpers/storage-guard-fixtures.js";

const formats = [
  { name: "checkpoint", create: createCheckpointStorage, database: CHECKPOINT_DATABASE,
    empty: emptyCheckpointDocument, operation: () => checkpointSave(), expected: () => 0 },
  { name: "encrypted", create: createEncryptedLibraryStorage, database: ENCRYPTED_LIBRARY_DATABASE,
    empty: emptyEncryptedLibrary, operation: async () => ({ kind: "add", entry: await encryptedEntry() }),
    expected: emptyEncryptedLibrary },
  { name: "period", create: createPeriodLibraryStorage, database: PERIOD_LIBRARY_DATABASE,
    empty: emptyPeriodLibrary, operation: () => periodSave(), expected: () => 0 },
  { name: "report", create: createReportHistoryStorage, database: REPORT_HISTORY_DATABASE,
    empty: emptyReportHistory, operation: () => saveHistory(), expected: () => 0 },
  { name: "vault", create: createVaultStorage, database: VAULT_DATABASE,
    empty: emptyVaultDocument, operation: () => vaultSave(), expected: () => 0 },
];
const translated = (format, code) => format.name === "encrypted" ? {
  CHECKPOINT_CANCELLED: "LIBRARY_CANCELLED", CHECKPOINT_TIMEOUT: "LIBRARY_TIMEOUT",
  CHECKPOINT_BUSY: "LIBRARY_BUSY", CHECKPOINT_CLOSED: "LIBRARY_CLOSED",
  CHECKPOINT_QUOTA: "LIBRARY_QUOTA", CHECKPOINT_CLOCK: "LIBRARY_STORAGE",
  CHECKPOINT_ADAPTER: "LIBRARY_FORMAT", CHECKPOINT_CAPACITY: "LIBRARY_CAPACITY",
}[code] ?? code : code;

function setup(t, format, { initial, guard = createStorageGuard(), ...options } = {}) {
  const f = database(initial);
  const time = manualTime();
  const storage = format.create({ indexedDB: f.factory, guard, openTimeoutMs: 100,
    transactionTimeoutMs: 100, deadlineOptions: time.options, ...options });
  t.after(async () => { storage.close(); f.drain(); await microtasks(); });
  return { ...f, storage, time, guard,
    async open() { f.succeed(); await microtasks(); return f.transactions.at(-1); } };
}

test("all five storage features have distinct unchanged production database names", () => {
  assert.equal(new Set(formats.map(value => value.database)).size, 5);
  assert.deepEqual(formats.map(value => value.database), [
    "threecore-workspace-checkpoints-v1", "threecore-encrypted-backups-v1",
    "threecore-period-library-v1", "threecore-report-history-v1", "threecore-transfer-vault-v1",
  ]);
});

for (const format of formats) {
  test(format.name + ": first read opens only its own named database", async t => {
    const f = setup(t, format);
    assert.equal(f.requests.length, 0);
    const pending = outcome(f.storage.read());
    assert.equal(f.requests[0].name, format.database);
    assert.equal(f.requests[0].version, 1);
    const tx = await f.open();
    tx.read();
    tx.complete();
    assert.deepEqual((await pending).value, format.empty());
    assert.equal(f.effects.puts, 0);
  });

  test(format.name + ": supported document saves only on native completion", async t => {
    const f = setup(t, format);
    const operation = await format.operation();
    let resolved = false;
    const pending = outcome(f.storage.change(format.expected(), operation)).then(value => { resolved = true; return value; });
    const tx = await f.open();
    tx.read();
    await microtasks();
    assert.equal(resolved, false);
    assert.equal(f.effects.puts, 1);
    assert.equal(f.effects.commits, 0);
    tx.complete();
    const result = await pending;
    assert(result.ok);
    assert.equal(result.value.revision, 1);
    assert.equal(result.value.entries.length, 1);
    assert.deepEqual(f.current(), result.value);
  });

  test(format.name + ": cancelled approval cannot enqueue a put", async t => {
    const f = setup(t, format);
    const abort = new AbortController();
    const pending = outcome(f.storage.change(format.expected(), await format.operation(), {
      signal: abort.signal,
      canCommit() { abort.abort(); return true; },
    }));
    const tx = await f.open();
    tx.read();
    assert.equal((await pending).code, translated(format, "CHECKPOINT_CANCELLED"));
    assert.equal(f.effects.puts, 0);
    assert.equal(f.current(), undefined);
  });

  test(format.name + ": transaction deadline is enforced before put without a timer", async t => {
    const f = setup(t, format);
    const pending = outcome(f.storage.change(format.expected(), await format.operation()));
    const tx = await f.open();
    f.time.advance(100);
    tx.read();
    assert.equal((await pending).code, translated(format, "CHECKPOINT_TIMEOUT"));
    assert.equal(f.effects.puts, 0);
  });

  test(format.name + ": opening timeout is forwarded by the adapter", async t => {
    const f = setup(t, format);
    const pending = outcome(f.storage.read());
    f.time.advance(100);
    f.time.flush();
    assert.equal((await pending).code, translated(format, "CHECKPOINT_TIMEOUT"));
    assert.equal(f.guard.state().draining, 1);
    f.fail();
    assert.equal(f.guard.state().active, 0);
  });

  test(format.name + ": input budget is applied before touching the database", async t => {
    const f = setup(t, format, { snapshotLimits: { nodes: 1, characters: 1, depth: 1 } });
    const pending = outcome(f.storage.change(format.expected(), await format.operation()));
    assert.equal((await pending).code, translated(format, "CHECKPOINT_CAPACITY"));
    assert.equal(f.requests.length, 0);
  });

  test(format.name + ": malformed mutation getters never run", async t => {
    const f = setup(t, format);
    let calls = 0;
    const pending = outcome(f.storage.change(format.expected(), {
      get kind() { calls++; return "save"; },
    }));
    assert.equal((await pending).code, translated(format, "CHECKPOINT_ADAPTER"));
    assert.equal(calls, 0);
    assert.equal(f.requests.length, 0);
  });

  test(format.name + ": existing records remain intact after quota failure", async t => {
    const f = setup(t, format);
    const pending = outcome(f.storage.change(format.expected(), await format.operation()));
    const tx = await f.open();
    tx.read();
    tx.put.error = new DOMException("private details", "QuotaExceededError");
    tx.put.onerror();
    assert.equal((await pending).code, translated(format, "CHECKPOINT_QUOTA"));
    await microtasks();
    assert.equal(f.effects.commits, 0);
    assert.equal(f.current(), undefined);
  });

  test(format.name + ": input is frozen before concurrent caller mutation", async t => {
    const f = setup(t, format);
    const operation = clone(await format.operation());
    const pending = outcome(f.storage.change(format.expected(), operation));
    operation.kind = "unreviewed-operation";
    const tx = await f.open();
    tx.read();
    tx.complete();
    assert((await pending).ok);
    assert.equal(f.current().entries.length, 1);
  });

  test(format.name + ": cancellation while opening returns without waiting for IndexedDB", async t => {
    const f = setup(t, format);
    const abort = new AbortController();
    const pending = outcome(f.storage.read({ signal: abort.signal }));
    abort.abort();
    assert.equal((await pending).code, translated(format, "CHECKPOINT_CANCELLED"));
    assert.equal(f.transactions.length, 0);
    assert.equal(f.guard.state().draining, 1);
    f.succeed();
    await microtasks();
    assert.equal(f.effects.closes, 1);
    assert.equal(f.guard.state().active, 0);
  });

  test(format.name + ": repeated completion reports exactly one save", async t => {
    const f = setup(t, format);
    const pending = outcome(f.storage.change(format.expected(), await format.operation()));
    const tx = await f.open();
    tx.read();
    tx.complete();
    tx.oncomplete();
    assert((await pending).ok);
    assert.equal(f.guard.state().completed, 1);
    assert.equal(f.effects.puts, 1);
  });

  test(format.name + ": closed storage cannot reopen even with a valid operation", async t => {
    const f = setup(t, format);
    f.storage.close();
    assert.equal((await outcome(f.storage.change(format.expected(), await format.operation()))).code,
      translated(format, "CHECKPOINT_CLOSED"));
    assert.equal(f.requests.length, 0);
  });
}

test("all five repositories share one page-wide admission budget", async t => {
  const guard = createStorageGuard();
  const fixtures = formats.map(format => setup(t, format, { guard }));
  const pending = fixtures.slice(0, 4).map(f => outcome(f.storage.read()));
  assert.equal(guard.state().active, 4);
  const denied = await outcome(fixtures[4].storage.read());
  assert.equal(denied.code, "CHECKPOINT_BUSY");
  assert.equal(fixtures[4].requests.length, 0);
  fixtures[0].fail();
  await pending[0];
  const accepted = outcome(fixtures[4].storage.read());
  assert.equal(fixtures[4].requests.length, 1);
  const tx = await fixtures[4].open();
  tx.read();
  tx.complete();
  assert((await accepted).ok);
  guard.cancelAll();
  for (const f of fixtures.slice(1, 4)) f.fail();
  await Promise.all(pending);
  assert.equal(guard.state().active, 0);
  invariant(guard, assert);
});

test("the global stop reaches all repository types without deleting records", async t => {
  const guard = createStorageGuard();
  const fixtures = formats.slice(0, 4).map(format => setup(t, format, { guard, initial: format.empty() }));
  const pending = [];
  for (const f of fixtures) {
    pending.push(outcome(f.storage.read()));
    await f.open();
  }
  assert.equal(guard.cancelAll(), 4);
  for (const item of pending) assert.equal((await item).ok, false);
  await microtasks();
  for (const [index, f] of fixtures.entries()) {
    assert.deepEqual(f.current(), formats[index].empty());
    assert.equal(f.effects.puts, 0);
  }
});
