import test from "node:test";
import assert from "node:assert/strict";
import { FILE_READ_RESERVED_LIMIT, FILE_SECURITY_LIMIT } from "../src/file-read-policy.js";
import { fixture, bytes, tick, code, outcome, stalledFile, streamFile, fallbackFile } from "./helpers/file-boundary-fixtures.js";

for (const stream of [true, false]) {
  test("file admission: four outstanding reads shared by byte and text modes " + stream, async t => {
    const service = fixture(t);
    const files = Array.from({ length: 4 }, () => stalledFile({ stream }));
    const pending = files.map((item, i) => outcome(service[i % 2 ? "readText" : "readBytes"](item.file)));
    await tick();
    assert.equal(service.state().active, 4);
    assert.equal(service.state().waiting, 4);
    const denied = fallbackFile("new");
    await assert.rejects(service.readText(denied.file), code("FILE_BUSY"));
    assert.equal(denied.calls(), 0);
    assert.equal(service.state().accepted, 4);
    assert.equal(service.state().rejected, 1);
    assert.equal(service.cancelAll(), 4);
    assert.deepEqual(await Promise.all(pending), files.map(() => ({ code: "FILE_CANCELLED" })));
    assert.equal(service.state().retained, 4);
    await assert.rejects(service.readText(denied.file), code("FILE_BUSY"));
    for (const item of files) item.settle();
    await tick();
    assert.equal(service.state().active, 0);
    assert.equal(service.state().reservedBytes, 0);
    assert.equal(await service.readText(denied.file), "new");
  });

  test("file admission: freeing one real worker permits exactly one replacement " + stream, async t => {
    const service = fixture(t);
    const files = Array.from({ length: 4 }, () => stalledFile({ stream }));
    const pending = files.map(item => outcome(service.readText(item.file)));
    await tick();
    service.cancelAll();
    await Promise.all(pending);
    files[0].settle();
    await tick();
    const replacement = stalledFile({ stream });
    const current = outcome(service.readBytes(replacement.file));
    await tick();
    assert.equal(service.state().active, 4);
    assert.equal(service.state().retained, 3);
    assert.equal(service.state().waiting, 1);
    await assert.rejects(service.readText(fallbackFile().file), code("FILE_BUSY"));
    service.cancelAll();
    replacement.settle();
    files.forEach(item => item.settle());
    await current;
    await tick();
    assert.equal(service.state().active, 0);
  });

  test("file admission: same-turn cancel before dispatch never calls source " + stream, async t => {
    const service = fixture(t);
    const input = stalledFile({ stream });
    const pending = outcome(service.readText(input.file));
    assert.equal(service.cancelAll(), 1);
    assert.deepEqual(await pending, { code: "FILE_CANCELLED" });
    assert.equal(input.calls.read, 0);
    assert.equal(service.state().active, 0);
    assert.equal(service.state().reservedBytes, 0);
  });
}

test("file admission: reserved-byte cap is shared independently of count", async t => {
  const service = fixture(t);
  const large = stalledFile({ size: FILE_SECURITY_LIMIT });
  const smaller = stalledFile({ size: FILE_READ_RESERVED_LIMIT - FILE_SECURITY_LIMIT });
  const pending = [outcome(service.readText(large.file)), outcome(service.readBytes(smaller.file))];
  await tick();
  assert.equal(service.state().active, 2);
  assert.equal(service.state().reservedBytes, FILE_READ_RESERVED_LIMIT);
  assert.equal(service.state().canStart, false);
  await assert.rejects(service.readText(fallbackFile("x").file), code("FILE_BUSY"));
  service.cancelAll();
  await Promise.all(pending);
  assert.equal(service.state().reservedBytes, FILE_READ_RESERVED_LIMIT);
  large.settle(); smaller.settle();
  await tick();
  assert.equal(service.state().reservedBytes, 0);
});

test("file admission: byte quota rejects over-cap declaration before IO", async t => {
  const service = fixture(t);
  const first = stalledFile({ size: 80 * 1024 * 1024 });
  const second = stalledFile({ size: 49 * 1024 * 1024 });
  const pending = outcome(service.readBytes(first.file));
  await tick();
  await assert.rejects(service.readBytes(second.file), code("FILE_BUSY"));
  assert.equal(second.calls.read, 0);
  assert.equal(service.state().reservedBytes, first.file.size);
  service.cancelAll(); first.settle();
  await pending; await tick();
});

test("file admission: a per-format limit cannot increase global per-file policy", async t => {
  const service = fixture(t);
  const input = fallbackFile("abc");
  await assert.rejects(service.readText(input.file, { maxBytes: 2 }), code("FILE_SIZE"));
  await assert.rejects(service.readText(input.file, { maxBytes: FILE_SECURITY_LIMIT + 1 }), code("FILE_OPTIONS"));
  assert.equal(input.calls(), 0);
  assert.equal(service.state().active, 0);
  assert.equal(service.state().accepted, 0);
});

test("file admission: repeated validation failures never reserve bytes", async t => {
  const service = fixture(t);
  for (let i = 0; i < 25; i++) {
    await assert.rejects(service.readText({ size: -1 }), code("FILE_SIZE"));
  }
  assert.equal(service.state().active, 0);
  assert.equal(service.state().reservedBytes, 0);
  assert.equal(service.state().rejected, 25);
  assert.equal(await service.readText(fallbackFile().file), "ok");
});

test("file admission: success frees capacity after exact input length", async t => {
  const service = fixture(t);
  const outputs = await Promise.all(Array.from({ length: 4 }, (_, i) =>
    service.readText(streamFile([bytes("item" + i)]).file)));
  assert.deepEqual(outputs, ["item0", "item1", "item2", "item3"]);
  assert.equal(service.state().active, 0);
  assert.equal(service.state().completed, 4);
  assert.equal(service.state().failed, 0);
  assert.equal(await service.readText(fallbackFile("next").file), "next");
});

test("file admission: truncation releases reservation without a completed count", async t => {
  const service = fixture(t);
  const input = streamFile([bytes("ab")], { size: 3 });
  await assert.rejects(service.readBytes(input.file), code("FILE_SIZE"));
  assert.equal(service.state().active, 0);
  assert.equal(service.state().failed, 1);
  assert.equal(service.state().completed, 0);
  assert.equal(input.calls.cancel, 1);
});

test("file admission: disposal retains unfinished work and rejects future files", async t => {
  const service = fixture(t);
  const input = stalledFile({ stream: false, size: 20 });
  const pending = outcome(service.readText(input.file));
  await tick();
  service.dispose(); service.dispose();
  assert.deepEqual(await pending, { code: "FILE_DISPOSED" });
  assert.equal(service.state().active, 1);
  assert.equal(service.state().retained, 1);
  assert.equal(service.state().reservedBytes, 20);
  await assert.rejects(service.readText(new Proxy({}, { get() { throw Error("must not inspect"); } })), code("FILE_DISPOSED"));
  input.settle(); await tick();
  assert.equal(service.state().active, 0);
  assert.equal(service.state().canStart, false);
});

test("file admission: separate service instances have separate declared scopes", async t => {
  const a = fixture(t), b = fixture(t);
  const files = Array.from({ length: 4 }, () => stalledFile());
  const pending = files.map(item => outcome(a.readText(item.file)));
  await tick();
  assert.equal(await b.readText(fallbackFile("isolated").file), "isolated");
  assert.equal(a.state().active, 4);
  assert.equal(b.state().completed, 1);
  a.cancelAll(); files.forEach(item => item.settle());
  await Promise.all(pending); await tick();
});

test("file admission: cancelAll does not erase prior counters or completed values", async t => {
  const service = fixture(t);
  const completed = await service.readBytes(fallbackFile("kept").file);
  assert.equal(service.cancelAll(), 0);
  assert.equal(service.state().completed, 1);
  assert.equal(service.state().cancelled, 0);
  assert.equal(new TextDecoder().decode(completed), "kept");
});

test("file admission: a late rejection releases only its own reservation", async t => {
  const service = fixture(t);
  const old = stalledFile({ stream: false, size: 10 });
  const pending = outcome(service.readText(old.file));
  await tick(); service.cancelAll(); await pending;
  const current = stalledFile({ size: 7 });
  const currentResult = outcome(service.readText(current.file));
  await tick();
  old.gate.reject(Error("private late failure"));
  await tick();
  assert.equal(service.state().active, 1);
  assert.equal(service.state().waiting, 1);
  assert.equal(service.state().reservedBytes, 7);
  assert.equal(service.state().failed, 0);
  service.cancelAll(); current.settle(); await currentResult; await tick();
});
