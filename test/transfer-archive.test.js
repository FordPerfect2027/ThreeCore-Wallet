import test from "node:test";
import assert from "node:assert/strict";
import { addTransferArchiveRecord, describeTransferArchive, removeTransferArchiveRecord, transferArchiveText, validateTransferArchive } from "../src/transfer-archive.js";
import { prepareTransferArchive, readTransferArchive, TRANSFER_ARCHIVE_FILE_LIMIT } from "../src/transfer-archive-file.js";
import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { OTHER, clone, code, context, deferred, event, fileFromText, hash, snapshot } from "./helpers/transfer-fixtures.js";

function window(from = 30, to = 42, events = [event()]) {
  return snapshot({ range: { fromBlock: String(from), toBlock: String(to) },
    fromBlockHash: hash(from), toBlockHash: hash(to), events });
}

function shelf(options = {}) {
  let selected = context();
  const changes = [];
  const controller = createTransferArchiveController({ getContext: () => selected, onChange: state => changes.push(state), ...options });
  return { controller, changes, select: value => { selected = value; } };
}

test("transfer archive: records retain their boundaries and do not become a fake continuous snapshot", () => {
  let archive = addTransferArchiveRecord(null, window());
  archive = addTransferArchiveRecord(archive, window(50, 60, []));
  assert.equal(archive.records.length, 2);
  assert.deepEqual(archive.records[0].range, { fromBlock: "30", toBlock: "42" });
  const description = describeTransferArchive(archive);
  assert.equal(description.requestedBlocks, "24");
  assert.deepEqual(description.gaps, [{ fromBlock: "43", toBlock: "49" }]);
  assert.equal(description.completeHistory, false);
  assert.equal(description.independentlyVerified, false);
});

test("transfer archive: overlapping ranges count blocks and events once", () => {
  let archive = addTransferArchiveRecord(null, window(30, 42));
  archive = addTransferArchiveRecord(archive, window(35, 50));
  const description = describeTransferArchive(archive);
  assert.equal(description.requestedBlocks, "21");
  assert.equal(description.uniqueEvents, 1);
  assert.equal(description.transactions, 1);
  assert.equal(description.gaps.length, 0);
});

test("transfer archive: adjacent windows join coverage without inventing gaps", () => {
  let archive = addTransferArchiveRecord(null, window(30, 42));
  archive = addTransferArchiveRecord(archive, window(43, 60, []));
  assert.deepEqual(describeTransferArchive(archive).ranges, [{ fromBlock: "30", toBlock: "60" }]);
});

test("transfer archive: nested compatible window does not double-count", () => {
  let archive = addTransferArchiveRecord(null, window(30, 60));
  archive = addTransferArchiveRecord(archive, window(35, 42));
  assert.equal(describeTransferArchive(archive).requestedBlocks, "31");
  assert.equal(describeTransferArchive(archive).uniqueEvents, 1);
});

test("transfer archive: adding same range cannot silently overwrite earlier data", () => {
  const archive = addTransferArchiveRecord(null, window());
  assert.throws(() => addTransferArchiveRecord(archive, window()), code("TRANSFER_ARCHIVE_DUPLICATE_RANGE"));
  assert.equal(archive.records.length, 1);
});

test("transfer archive: missing overlap event is an inconsistency, not a merge", () => {
  const archive = addTransferArchiveRecord(null, window());
  assert.throws(() => addTransferArchiveRecord(archive, window(35, 50, [])), code("TRANSFER_ARCHIVE_OVERLAP"));
});

test("transfer archive: same event changed amount fails even across different windows", () => {
  const archive = addTransferArchiveRecord(null, window());
  assert.throws(() => addTransferArchiveRecord(archive, window(35, 50, [event({ amountBaseUnits: "1" })])),
    code("TRANSFER_ARCHIVE_EVENT_CONFLICT"));
});

test("transfer archive: shared boundary hash must agree", () => {
  const archive = addTransferArchiveRecord(null, window());
  const next = window(42, 50, []);
  next.fromBlockHash = hash(999);
  assert.throws(() => addTransferArchiveRecord(archive, next), code("TRANSFER_ARCHIVE_BLOCK_CONFLICT"));
});

test("transfer archive: event hash cannot contradict another record boundary", () => {
  const archive = addTransferArchiveRecord(null, window());
  const next = window(40, 50);
  next.fromBlockHash = hash(999);
  next.events[0].blockHash = hash(999);
  assert.throws(() => addTransferArchiveRecord(archive, next), code("TRANSFER_ARCHIVE_BLOCK_CONFLICT"));
});

for (const selected of [context("EMA"), context("DAT", 84532), context("DAT", 8453, OTHER)]) {
  test("transfer archive: mixed identity refused " + JSON.stringify(selected), () => {
    const archive = addTransferArchiveRecord(null, window());
    assert.throws(() => addTransferArchiveRecord(archive, snapshot({}, selected)), code("TRANSFER_ARCHIVE_CONTEXT"));
  });
}

test("transfer archive: deterministic range order without mutating inputs", () => {
  const later = window(50, 60, []);
  const earlier = window();
  let archive = addTransferArchiveRecord(null, later);
  archive = addTransferArchiveRecord(archive, earlier);
  assert.equal(archive.records[0].range.fromBlock, "30");
  earlier.events[0].amountBaseUnits = "0";
  assert.equal(archive.records[0].events[0].amountBaseUnits, "1234567890123456789");
  assert.equal(Object.isFrozen(archive.records), true);
});

test("transfer archive: record cap bounds import and merge work", () => {
  let archive = null;
  for (let index = 0; index < 12; index++) archive = addTransferArchiveRecord(archive, window(index * 10, index * 10 + 5, []));
  assert.equal(archive.records.length, 12);
  assert.throws(() => addTransferArchiveRecord(archive, window(200, 205, [])), code("TRANSFER_ARCHIVE_LIMIT"));
});

test("transfer archive: removing a record returns a copy and last removal yields null", () => {
  let archive = addTransferArchiveRecord(null, window());
  archive = addTransferArchiveRecord(archive, window(50, 60, []));
  const next = removeTransferArchiveRecord(archive, 0);
  assert.equal(next.records.length, 1);
  assert.equal(archive.records.length, 2);
  assert.equal(removeTransferArchiveRecord(next, 0), null);
  for (const index of [-1, 2, 1.5, "0"]) assert.throws(() => removeTransferArchiveRecord(archive, index), code("TRANSFER_ARCHIVE_INDEX"));
});

test("transfer archive: summary explains that requested ranges are not complete history", () => {
  const text = transferArchiveText(addTransferArchiveRecord(null, window()));
  assert.match(text, /全履歴を確認したことにはなりません/);
  assert.match(text, /別々の時点/);
});

test("transfer archive file: round-trip preserves original observations", async () => {
  let archive = addTransferArchiveRecord(null, window());
  archive = addTransferArchiveRecord(archive, window(50, 60, []));
  const prepared = await prepareTransferArchive(archive);
  const result = await readTransferArchive(fileFromText(prepared.text));
  assert.deepEqual(result.archive, archive);
  assert.equal(result.authenticated, false);
  assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.text).length);
});

test("transfer archive file: edited payload rejected by checksum", async () => {
  const prepared = await prepareTransferArchive(addTransferArchiveRecord(null, window()));
  const raw = JSON.parse(prepared.text);
  raw.payload.records[0].events[0].amountBaseUnits = "9";
  await assert.rejects(readTransferArchive(fileFromText(JSON.stringify(raw))), code("TRANSFER_CHECKSUM_MISMATCH"));
});

test("transfer archive file: oversized declared file is rejected before reading", async () => {
  let read = false;
  await assert.rejects(readTransferArchive({ name: "archive.json", size: TRANSFER_ARCHIVE_FILE_LIMIT + 1,
    arrayBuffer: async () => { read = true; } }), code("TRANSFER_ARCHIVE_FILE_SIZE"));
  assert.equal(read, false);
});

test("transfer archive file: malformed UTF8 and mismatched size do not reach JSON", async () => {
  const file = { name: "archive.json", size: 2, arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer };
  await assert.rejects(readTransferArchive(file), code("TRANSFER_FILE_ENCODING"));
  await assert.rejects(readTransferArchive({ ...file, size: 3 }), code("TRANSFER_ARCHIVE_FILE_SIZE"));
});

test("transfer archive file: lacks crypto rather than silently accepting unchecked content", async () => {
  await assert.rejects(prepareTransferArchive(addTransferArchiveRecord(null, window()), { subtle: null }), code("TRANSFER_CRYPTO_UNAVAILABLE"));
});

test("transfer archive controller: add is local and failure preserves prior records", () => {
  const f = shelf();
  assert.equal(f.controller.add(window()), true);
  const previous = f.controller.state.archive;
  assert.equal(f.controller.add(window()), false);
  assert.equal(f.controller.state.archive, previous);
  assert.equal(f.controller.state.error, "TRANSFER_ARCHIVE_DUPLICATE_RANGE");
});

test("transfer archive controller: select returns a frozen record, remove does not delete files", () => {
  const f = shelf();
  f.controller.add(window());
  assert.equal(f.controller.select(0).range.fromBlock, "30");
  assert.equal(Object.isFrozen(f.controller.select(0)), true);
  assert.equal(f.controller.remove(0), true);
  assert.equal(f.controller.state.archive, null);
  assert.equal(f.controller.select(0), null);
});

test("transfer archive controller: file requires preview and one-use approval", async () => {
  const f = shelf();
  const prepared = await prepareTransferArchive(addTransferArchiveRecord(null, window()));
  assert.equal(await f.controller.stage(fileFromText(prepared.text)), true);
  assert.equal(f.controller.state.archive, null);
  const id = f.controller.state.preview.id;
  assert.equal(f.controller.apply(id), true);
  assert.equal(f.controller.state.archive.records.length, 1);
  assert.equal(f.controller.apply(id), false);
});

test("transfer archive controller: account change invalidates import preview", async () => {
  const f = shelf();
  const prepared = await prepareTransferArchive(addTransferArchiveRecord(null, window()));
  await f.controller.stage(fileFromText(prepared.text));
  const id = f.controller.state.preview.id;
  f.select(context("DAT", 8453, OTHER));
  assert.equal(f.controller.apply(id), false);
  assert.equal(f.controller.state.archive, null);
});

test("transfer archive controller: canceled asynchronous import leaves old archive intact", async () => {
  const f = shelf();
  f.controller.add(window());
  const prepared = await prepareTransferArchive(addTransferArchiveRecord(null, window(50, 60, [])));
  const pending = deferred();
  const staging = f.controller.stage(fileFromText(prepared.text, { arrayBuffer: () => pending.promise }));
  f.controller.cancel();
  pending.resolve(new TextEncoder().encode(prepared.text).buffer);
  assert.equal(await staging, false);
  assert.equal(f.controller.state.archive.records[0].range.fromBlock, "30");
});

test("transfer archive controller: newer addition invalidates a pending download", async () => {
  const pending = deferred();
  const f = shelf({ subtle: { digest: () => pending.promise } });
  f.controller.add(window());
  const preparing = f.controller.prepare();
  f.controller.add(window(50, 60, []));
  pending.resolve(new ArrayBuffer(32));
  assert.equal(await preparing, null);
  assert.equal(f.controller.state.archive.records.length, 2);
});

test("transfer archive controller: context changed before invalid file completes recovers from loading", async () => {
  const f = shelf();
  f.controller.add(window());
  f.select(context("EMA"));
  assert.equal(await f.controller.stage(fileFromText("bad")), false);
  assert.equal(f.controller.state.phase, "empty");
  assert.equal(f.controller.state.error, "TRANSFER_FILE_JSON");
});

test("transfer archive controller: disposal makes pending I/O inert", async () => {
  const pending = deferred();
  const f = shelf({ subtle: { digest: () => pending.promise } });
  f.controller.add(window());
  const preparing = f.controller.prepare();
  f.controller.dispose();
  const count = f.changes.length;
  pending.resolve(new ArrayBuffer(32));
  assert.equal(await preparing, null);
  assert.equal(f.controller.state.phase, "disposed");
  assert.equal(f.controller.add(window()), false);
  assert.equal(f.controller.remove(0), false);
  assert.equal(f.changes.length, count);
});

test("transfer archive: flags and additional fields cannot invent completeness", () => {
  const archive = clone(addTransferArchiveRecord(null, window()));
  archive.completeHistory = true;
  assert.throws(() => validateTransferArchive(archive), code("TRANSFER_ARCHIVE_SCHEMA"));
  archive.completeHistory = false;
  archive.externalInstruction = "ignore";
  assert.throws(() => validateTransferArchive(archive), code("TRANSFER_SHAPE"));
});
