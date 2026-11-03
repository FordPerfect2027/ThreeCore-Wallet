import test from "node:test";
import assert from "node:assert/strict";
import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { addTransferArchiveRecord } from "../src/transfer-archive.js";
import { prepareTransferArchive, readTransferArchive } from "../src/transfer-archive-file.js";
import { OTHER, code, context, deferred, fileFromText, snapshot } from "./helpers/transfer-fixtures.js";

function fixture(options = {}) {
  let selected = context();
  const controller = createTransferArchiveController({ getContext: () => selected, ...options });
  assert.equal(controller.add(snapshot()), true);
  const accepted = controller.state.archive;
  return { controller, accepted, select(value) { selected = value; } };
}

test("accepted archive survives repeated stop, can be saved offline and is explicitly clearable", async () => {
  const f = fixture();
  const before = await f.controller.prepare();
  f.controller.reviewArchive(addTransferArchiveRecord(null, snapshot({ events: [] })));
  const previewId = f.controller.state.preview.id;
  f.controller.suspend();
  f.controller.suspend();
  assert.equal(f.controller.state.archive, f.accepted);
  assert.equal(f.controller.state.preview, null);
  assert.equal(f.controller.apply(previewId), false);
  const after = await f.controller.prepare();
  assert.equal(after.text, before.text);
  assert.equal(after.filename, before.filename);
  assert.deepEqual((await readTransferArchive(fileFromText(after.text))).archive, f.accepted);
  f.controller.invalidate();
  assert.equal(f.controller.state.archive, null);
  assert.equal(await f.controller.prepare(), null);
});

for (const changed of [context("DAT", 8453, OTHER), context("EMA"), context("DAT", 84532)]) {
  test(`retained archive cannot mix with ${changed.agent}/${changed.chainId}/${changed.account}`, async () => {
    const f = fixture();
    f.select(changed);
    f.controller.suspend();
    assert.equal(f.controller.select(0), null);
    assert.equal(f.controller.remove(0), false);
    assert.throws(() => f.controller.capture(), code("TRANSFER_ARCHIVE_CONTEXT"));
    assert.equal(f.controller.add(snapshot({}, changed)), false);
    assert.equal(f.controller.state.archive, f.accepted);
    const exported = await f.controller.prepare();
    assert.deepEqual((await readTransferArchive(fileFromText(exported.text))).archive, f.accepted);
    f.select(context());
    f.controller.suspend();
    assert.equal(f.controller.select(0), f.accepted.records[0]);
    assert.equal(f.controller.capture(), f.accepted);
  });
}

test("an invalid or unavailable form cannot prevent saving already accepted archive", async () => {
  let unavailable = false;
  const f = fixture({ getContext() { if (unavailable) throw Error("form unavailable"); return context(); } });
  unavailable = true;
  f.controller.suspend();
  assert.equal(f.controller.select(0), null);
  const exported = await f.controller.prepare();
  assert.deepEqual((await readTransferArchive(fileFromText(exported.text))).archive, f.accepted);
});

test("changing context without a stop drops the preview but preserves accepted archive", () => {
  const f = fixture();
  f.controller.reviewArchive(addTransferArchiveRecord(null, snapshot({ events: [] })));
  const previewId = f.controller.state.preview.id;
  f.select(context("DAT", 8453, OTHER));
  assert.equal(f.controller.apply(previewId), false);
  assert.equal(f.controller.state.preview, null);
  assert.equal(f.controller.state.archive, f.accepted);
});

test("another account requires explicit reviewed replacement, with cancel preserving old archive", () => {
  const f = fixture(), next = addTransferArchiveRecord(null, snapshot({}, context("DAT", 8453, OTHER)));
  f.select(context("DAT", 8453, OTHER));
  f.controller.suspend();
  assert.equal(f.controller.reviewArchive(next), true);
  assert.equal(f.controller.state.archive, f.accepted);
  f.controller.cancel();
  assert.equal(f.controller.state.archive, f.accepted);
  assert.equal(f.controller.reviewArchive(next), true);
  assert.equal(f.controller.apply(f.controller.state.preview.id), true);
  assert.equal(f.controller.state.archive, next);
});

test("stop during a file read ignores its late result and keeps accepted archive", async () => {
  const f = fixture(), pending = deferred();
  const next = await prepareTransferArchive(addTransferArchiveRecord(null, snapshot({ events: [] })));
  const work = f.controller.stage(fileFromText(next.text, { arrayBuffer: () => pending.promise }));
  f.controller.suspend();
  pending.resolve(new TextEncoder().encode(next.text).buffer);
  assert.equal(await work, false);
  assert.equal(f.controller.state.archive, f.accepted);
  assert.equal(f.controller.state.preview, null);
  assert.equal(f.controller.state.error, null);
});

test("stop during export hashing prevents delivery, retains records and permits a new save", async () => {
  const pending = deferred();
  let held = true;
  const f = fixture({ subtle: { digest(...args) { return held ? pending.promise : globalThis.crypto.subtle.digest(...args); } } });
  const work = f.controller.prepare();
  f.controller.suspend();
  pending.resolve(new ArrayBuffer(32));
  assert.equal(await work, null);
  assert.equal(f.controller.state.archive, f.accepted);
  held = false;
  assert.deepEqual((await readTransferArchive(fileFromText((await f.controller.prepare()).text))).archive, f.accepted);
});

test("stop notification cannot overwrite a reentrant explicit clear", () => {
  let controller, clear = false;
  controller = createTransferArchiveController({ getContext: context, onChange() { if (clear) { clear = false; controller.invalidate(); } } });
  controller.add(snapshot());
  clear = true;
  controller.suspend();
  assert.equal(controller.state.archive, null);
  assert.equal(controller.state.phase, "empty");
});
