import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { EncryptedLibraryError, emptyEncryptedLibrary } from "../src/encrypted-library-model.js";
import { envelope, entry, library, clone, memoryStorage, gate, tick } from "./helpers/encrypted-library-fixtures.js";

function fixture(t, options = {}, initial = emptyEncryptedLibrary()) {
  const storage = options.storage ?? memoryStorage(initial);
  const changes = [], opened = [];
  let time = 1792820000000;
  const controller = createEncryptedLibraryController({ storage,
    now: () => time, onChange: state => changes.push(state),
    onOpen(text) { opened.push(text); return true; }, ...options });
  t.after(() => controller.dispose());
  return { controller, storage, changes, opened,
    advance(ms) { time += ms; },
    async loadSelect(index = 0) {
      assert.equal(await controller.load(), true);
      assert.equal(controller.select(controller.state().summary.entries[index].id), true);
    },
    async save(text = envelope()) {
      assert.equal(await controller.prepareSave(text), true);
      return controller.confirm(controller.state().review.ticket, true);
    } };
}

test("controller mount has no database, crypto or transport side effects", t => {
  const f = fixture(t);
  assert.equal(f.storage.calls.reads, 0);
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(f.controller.state().loaded, false);
  assert.equal(f.controller.state().review, null);
  assert.equal(f.controller.state().canExport, false);
});

test("load exposes metadata without persisting or decrypting anything", async t => {
  const initial = await library([1, 2]);
  const f = fixture(t, {}, initial);
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.state().summary.count, 2);
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(f.opened.length, 0);
  assert(!JSON.stringify(f.controller.state()).includes("ciphertext"));
});

test("saving needs a separate review and an exact acknowledgement", async t => {
  const f = fixture(t);
  assert.equal(await f.controller.prepareSave(envelope()), true);
  const review = f.controller.state().review;
  assert.equal(review.kind, "add");
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(await f.controller.confirm(review.ticket, true), true);
  assert.equal(f.storage.calls.writes, 1);
  assert.equal(f.controller.state().result, "saved");
  assert.equal(f.controller.state().summary.count, 1);
  assert.equal(f.controller.state().review, null);
});

for (const acknowledgement of [undefined, false, 1, "true", {}, []]) {
  test("non-boolean acknowledgement cannot write " + JSON.stringify(acknowledgement), async t => {
    const f = fixture(t);
    await f.controller.prepareSave(envelope());
    assert.equal(await f.controller.confirm(f.controller.state().review.ticket, acknowledgement), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_CONFIRM");
    assert.equal(f.storage.calls.writes, 0);
    assert.equal(f.controller.state().review, null);
  });
}

test("saving duplicate ciphertext preserves the original saved timestamp and revision", async t => {
  const f = fixture(t, {}, await library([1]));
  const before = f.storage.snapshot();
  await f.controller.prepareSave(envelope(1));
  assert.equal(f.controller.state().review.duplicate, true);
  await f.controller.confirm(f.controller.state().review.ticket, true);
  assert.deepEqual(f.storage.snapshot(), before);
  assert.equal(f.controller.state().result, "duplicate");
});

test("save review state contains no encrypted payload or workspace content", async t => {
  const f = fixture(t);
  await f.controller.prepareSave(envelope());
  const text = JSON.stringify(f.changes);
  assert(!text.includes("ciphertext"));
  assert(!text.includes("PBKDF2"));
  assert(!text.includes("AES-GCM"));
  assert(!text.includes(envelope()));
  assert(Object.isFrozen(f.controller.state().review));
});

test("plain workspace JSON cannot reach the persistence adapter", async t => {
  const f = fixture(t);
  assert.equal(await f.controller.prepareSave('{"account":"private-to-user"}'), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_FORMAT");
  assert.equal(f.storage.calls.reads, 0);
  assert.equal(f.storage.calls.writes, 0);
});

test("full library fails before asking to confirm an impossible save", async t => {
  const f = fixture(t, {}, await library([1,2,3,4,5,6,7,8,9,10]));
  assert.equal(await f.controller.prepareSave(envelope(11)), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_CAPACITY");
  assert.equal(f.controller.state().review, null);
  assert.equal(f.storage.calls.writes, 0);
});

test("remove review binds exactly the selected record and current inventory", async t => {
  const f = fixture(t, {}, await library([1, 2, 3]));
  await f.loadSelect(1);
  const selected = f.controller.state().selected;
  assert.equal(await f.controller.prepareRemove(), true);
  assert.equal(f.controller.state().review.id, selected);
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(await f.controller.confirm(f.controller.state().review.ticket, true), true);
  assert.equal(f.storage.snapshot().entries.length, 2);
  assert(!f.storage.snapshot().entries.some(entry => entry.id === selected));
  assert.equal(f.controller.state().selected, null);
  assert.equal(f.controller.state().result, "removed");
});

for (const action of ["prepareRemove", "open", "prepareExport"]) {
  test(action + " requires an explicit selection", async t => {
    const f = fixture(t, {}, await library());
    await f.controller.load();
    assert.equal(await f.controller[action](), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_SELECTION");
    assert.equal(f.storage.calls.writes, 0);
    assert.equal(f.opened.length, 0);
  });
}

for (const action of ["prepareRemove", "open", "prepareExport"]) {
  test(action + " rejects a competing tab's newly committed snapshot", async t => {
    const f = fixture(t, {}, await library());
    await f.loadSelect();
    f.storage.replace(await library([1, 2]));
    assert.equal(await f.controller[action](), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_CONFLICT");
    assert.equal(f.controller.state().loaded, false);
    assert.equal(f.storage.calls.writes, 0);
    assert.equal(f.opened.length, 0);
  });
}

for (const kind of ["add", "remove"]) {
  test(kind + " confirmation refuses a competing transaction after preview", async t => {
    const f = fixture(t, {}, await library([1]));
    await f.loadSelect();
    if (kind === "add") await f.controller.prepareSave(envelope(3));
    else await f.controller.prepareRemove();
    const ticket = f.controller.state().review.ticket;
    const changed = await library([1, 2]);
    f.storage.replace(changed);
    assert.equal(await f.controller.confirm(ticket, true), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_CONFLICT");
    assert.deepEqual(f.storage.snapshot(), changed);
  });
}

test("reusing a consumed confirmation ticket cannot perform a second write", async t => {
  const f = fixture(t);
  await f.controller.prepareSave(envelope());
  const ticket = f.controller.state().review.ticket;
  assert.equal(await f.controller.confirm(ticket, true), true);
  assert.equal(await f.controller.confirm(ticket, true), false);
  assert.equal(f.storage.calls.writes, 1);
});

test("a prior confirmation cannot commit a later candidate", async t => {
  const f = fixture(t);
  await f.controller.prepareSave(envelope(1));
  const first = f.controller.state().review.ticket;
  await f.controller.prepareSave(envelope(2));
  assert.notEqual(f.controller.state().review.ticket, first);
  assert.equal(await f.controller.confirm(first, true), false);
  assert.equal(f.storage.calls.writes, 0);
});

for (const offset of [-1, 60000, 60001]) {
  test("clock change invalidates a review at offset " + offset, async t => {
    const f = fixture(t);
    await f.controller.prepareSave(envelope());
    const ticket = f.controller.state().review.ticket;
    f.advance(offset);
    assert.equal(await f.controller.confirm(ticket, true), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_REVIEW");
    assert.equal(f.storage.calls.writes, 0);
  });
}

test("review expiry clears ciphertext candidate even with no next user action", async t => {
  const f = fixture(t, { reviewLifetimeMs: 15 });
  await f.controller.prepareSave(envelope());
  assert(f.controller.state().review);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.controller.state().review, null);
  assert.equal(f.controller.state().errorCode, "LIBRARY_REVIEW");
  assert.equal(f.storage.calls.writes, 0);
});

test("clock expiry is rechecked inside the pending storage transaction", async t => {
  const base = memoryStorage();
  let pending;
  const storage = { ...base, change(expected, operation, options) {
    pending = { expected, operation, options };
    return new Promise((resolve, reject) => {
      pending.complete = () => base.change(expected, operation, options).then(resolve, reject);
    });
  } };
  const f = fixture(t, { storage });
  await f.controller.prepareSave(envelope());
  const saving = f.controller.confirm(f.controller.state().review.ticket, true);
  f.advance(60001);
  assert.equal(pending.options.canCommit(), false);
  pending.complete();
  assert.equal(await saving, false);
  assert.equal(base.calls.writes, 0);
});

test("cancel clears review, inventory and all selection without deleting stored records", async t => {
  const initial = await library([1, 2]);
  const f = fixture(t, {}, initial);
  await f.loadSelect();
  await f.controller.prepareRemove();
  f.controller.cancel();
  assert.equal(f.controller.state().loaded, false);
  assert.equal(f.controller.state().selected, null);
  assert.equal(f.controller.state().review, null);
  assert.deepEqual(f.storage.snapshot(), initial);
});

for (const action of ["cancel", "dispose"]) {
  test(action + " discards a late storage read and prevents any handoff", async t => {
    const pending = gate(), base = memoryStorage();
    const f = fixture(t, { storage: { ...base, read: () => pending.promise } });
    const loading = f.controller.load();
    f.controller[action]();
    pending.resolve(await library([1]));
    assert.equal(await loading, false);
    assert.equal(f.controller.state().summary, null);
    assert.equal(f.opened.length, 0);
  });

  test(action + " discards a late digest before any database read", async t => {
    const pending = gate();
    const f = fixture(t, { crypto: { subtle: { digest: () => pending.promise } } });
    const preparing = f.controller.prepareSave(envelope());
    f.controller[action]();
    pending.resolve(new ArrayBuffer(32));
    assert.equal(await preparing, false);
    assert.equal(f.storage.calls.reads, 0);
    assert.equal(f.storage.calls.writes, 0);
    assert.equal(f.controller.state().review, null);
  });
}

test("a canceled commit passes an aborted signal and closes its commit gate", async t => {
  const pending = gate(), base = memoryStorage();
  let options;
  const f = fixture(t, { storage: { ...base,
    change(expected, operation, incoming) { options = incoming; return pending.promise; } } });
  await f.controller.prepareSave(envelope());
  const saving = f.controller.confirm(f.controller.state().review.ticket, true);
  f.controller.cancel();
  assert(options.signal.aborted);
  assert.equal(options.canCommit(), false);
  pending.resolve(await library([1]));
  assert.equal(await saving, false);
  assert.equal(f.controller.state().summary, null);
});

test("a cancelled older request cannot replace a new inventory", async t => {
  const pending = gate(), initial = await library([1, 2]);
  let reads = 0;
  const base = memoryStorage(initial);
  const f = fixture(t, { storage: { ...base, read() { return ++reads === 1 ? pending.promise : base.read(); } } });
  const old = f.controller.load();
  f.controller.cancel();
  assert.equal(await f.controller.load(), true);
  pending.resolve(await library([1]));
  await old;
  assert.equal(f.controller.state().summary.count, 2);
});

test("concurrent actions cannot duplicate storage/crypto work", async t => {
  const pending = gate(), base = memoryStorage();
  let reads = 0;
  const f = fixture(t, { storage: { ...base, read() { reads++; return pending.promise; } } });
  const first = f.controller.load();
  assert.equal(await f.controller.load(), false);
  assert.equal(await f.controller.prepareSave(envelope()), false);
  assert.equal(await f.controller.prepareRemove(), false);
  assert.equal(f.controller.select("a".repeat(64)), false);
  assert.equal(reads, 1);
  pending.resolve(emptyEncryptedLibrary());
  assert.equal(await first, true);
});

test("hung storage times out, clears displayed content, and consumes a late rejection", async t => {
  const pending = gate(), base = memoryStorage();
  const f = fixture(t, { deadlineMs: 10, storage: { ...base, read: () => pending.promise } });
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_TIMEOUT");
  pending.reject(Error("late sensitive database error"));
  await tick();
  assert.equal(f.controller.state().summary, null);
});

test("opening only hands off integrity-checked ciphertext, not restored settings", async t => {
  const initial = await library([1]);
  const f = fixture(t, {}, initial);
  await f.loadSelect();
  assert.equal(await f.controller.open(), true);
  assert.deepEqual(f.opened, [initial.entries[0].text]);
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(f.controller.state().result, "opened");
});

for (const onOpen of [() => false, () => undefined, () => { throw Error("secret"); },
  async () => true, () => Promise.reject(Error("secret"))]) {
  test("unsupported or failed open callback is contained: " + onOpen.toString(), async t => {
    const f = fixture(t, { onOpen }, await library());
    await f.loadSelect();
    assert.equal(await f.controller.open(), false);
    assert.equal(f.storage.calls.writes, 0);
    assert(!JSON.stringify(f.controller.state()).includes("secret"));
  });
}

test("export requires preparation and a separate synchronous user action", async t => {
  const f = fixture(t, {}, await library());
  const downloads = [];
  assert.equal(f.controller.offer(item => downloads.push(item)), false);
  await f.loadSelect();
  assert.equal(await f.controller.prepareExport(), true);
  assert.equal(downloads.length, 0);
  assert.equal(f.controller.offer(item => downloads.push(item)), true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].text, envelope());
  assert.equal(downloads[0].filename, "ThreeCore-workspace-encrypted.json");
  assert.equal(f.controller.state().canExport, false);
  assert.equal(f.controller.offer(item => downloads.push(item)), false);
  assert.equal(downloads.length, 1);
});

test("export cancellation during callback does not restore cleared status", async t => {
  const f = fixture(t, {}, await library());
  await f.loadSelect();
  await f.controller.prepareExport();
  assert.equal(f.controller.offer(() => f.controller.cancel()), false);
  assert.equal(f.controller.state().phase, "cancelled");
  assert.equal(f.controller.state().result, null);
});

for (const download of [() => { throw Error("secret"); }, async () => true,
  () => Promise.reject(Error("private error"))]) {
  test("export failures consume the offer and suppress raw details: " + download.toString(), async t => {
    const f = fixture(t, {}, await library());
    await f.loadSelect();
    await f.controller.prepareExport();
    assert.equal(f.controller.offer(download), false);
    assert.equal(f.controller.state().errorCode, "LIBRARY_EXPORT");
    assert.equal(f.controller.state().canExport, false);
  });
}

test("selection changes invalidate a pending destructive review and export", async t => {
  const f = fixture(t, {}, await library([1, 2]));
  await f.loadSelect();
  await f.controller.prepareRemove();
  const ticket = f.controller.state().review.ticket;
  f.controller.select(f.controller.state().summary.entries[1].id);
  assert.equal(f.controller.state().review, null);
  assert.equal(await f.controller.confirm(ticket, true), false);
  assert.equal(f.storage.calls.writes, 0);
});

test("corrupt records fail closed without deleting or overwriting storage", async t => {
  const initial = clone(await library([1, 2]));
  initial.entries[0].id = "f".repeat(64);
  const f = fixture(t, {}, initial);
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.state().errorCode, "LIBRARY_INTEGRITY");
  assert.equal(f.controller.state().loaded, false);
  assert.deepEqual(f.storage.snapshot(), initial);
});

test("an observer exception cannot interrupt a verified local commit", async t => {
  const f = fixture(t, { onChange() { throw Error("observer"); } });
  assert.equal(await f.save(), true);
  assert.equal(f.storage.snapshot().entries.length, 1);
});

test("a cancelling observer prevents the operation from starting", async t => {
  let controller;
  const storage = memoryStorage();
  controller = createEncryptedLibraryController({ storage,
    onChange(state) { if (state.phase === "loading") controller.cancel(); } });
  t.after(() => controller.dispose());
  assert.equal(await controller.load(), false);
  assert.equal(storage.calls.reads, 0);
});

test("dispose closes once and all later actions are inactive", async t => {
  const f = fixture(t);
  f.controller.dispose();
  f.controller.dispose();
  for (const action of ["load", "prepareRemove", "open", "prepareExport"]) {
    assert.equal(await f.controller[action](), false);
  }
  assert.equal(await f.controller.prepareSave(envelope()), false);
  assert.equal(await f.controller.confirm(1, true), false);
  assert.equal(f.controller.select("a".repeat(64)), false);
  assert.equal(f.storage.calls.closes, 1);
  assert.equal(f.storage.calls.reads, 0);
});

for (const option of [
  { deadlineMs: 0 }, { deadlineMs: 60001 }, { deadlineMs: 1.5 },
  { reviewLifetimeMs: 0 }, { reviewLifetimeMs: 60001 }, { reviewLifetimeMs: "100" },
  { now: null }, { onOpen: null }, { onChange: null }, { storage: {} },
]) {
  test("invalid controller options are rejected " + JSON.stringify(option), () => {
    assert.throws(() => createEncryptedLibraryController(option));
  });
}

for (const errorCode of ["LIBRARY_QUOTA", "LIBRARY_BLOCKED", "LIBRARY_UNAVAILABLE", "LIBRARY_CANCELLED"]) {
  test("storage failure is reported without automatic retry: " + errorCode, async t => {
    const base = memoryStorage();
    let calls = 0;
    const f = fixture(t, { storage: { ...base, change() { calls++; throw new EncryptedLibraryError(errorCode); } } });
    await f.controller.prepareSave(envelope());
    assert.equal(await f.controller.confirm(f.controller.state().review.ticket, true), false);
    assert.equal(f.controller.state().errorCode, errorCode);
    assert.equal(calls, 1);
    assert.equal(base.snapshot().entries.length, 0);
  });
}
