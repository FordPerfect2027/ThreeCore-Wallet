import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bytes, code, tick, deferred, outcome } from "./helpers/file-boundary-fixtures.js";

for (const mode of ["readText", "readBytes"]) {
  test("file native: chunked pull stream is unlocked on successful completion " + mode, async t => {
    const service = fixture(t);
    const chunks = [bytes("DAT"), bytes(" EMA"), bytes(" CAWELON")];
    let index = 0, cancelled = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel() { cancelled++; },
    });
    const result = await service[mode]({ size: 15, stream: () => stream });
    assert.equal(mode === "readText" ? result : new TextDecoder().decode(result), "DAT EMA CAWELON");
    assert.equal(index, 3);
    assert.equal(cancelled, 0);
    assert.equal(stream.locked, false);
    assert.equal(service.state().active, 0);
  });

  test("file native: errored stream cannot be mistaken for EOF " + mode, async t => {
    const service = fixture(t);
    const stream = new ReadableStream({ start(controller) { controller.error(Error("private file error")); } });
    await assert.rejects(service[mode]({ size: 1, stream: () => stream }), code("FILE_READ"));
    assert.equal(stream.locked, false);
    assert.equal(service.state().failed, 1);
    assert.equal(service.state().completed, 0);
  });

  test("file native: rejection from underlying pull is sanitized " + mode, async t => {
    const service = fixture(t);
    const stream = new ReadableStream({ pull() { return Promise.reject(Error("private pull")); } });
    await assert.rejects(service[mode]({ size: 1, stream: () => stream }), code("FILE_READ"));
    await tick();
    assert.equal(stream.locked, false);
    assert.equal(service.state().active, 0);
  });

  test("file native: a read lock held elsewhere is preserved " + mode, async t => {
    const service = fixture(t);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("x")); controller.close(); } });
    const owner = stream.getReader();
    await assert.rejects(service[mode]({ size: 1, stream: () => stream }), code("FILE_READ"));
    assert.equal(stream.locked, true);
    assert.deepEqual((await owner.read()).value, bytes("x"));
    owner.releaseLock();
    assert.equal(stream.locked, false);
  });

  test("file native: underlying cancellation rejection cannot escape " + mode, async t => {
    const service = fixture(t);
    let cancelCalls = 0;
    const stream = new ReadableStream({ cancel() { cancelCalls++; return Promise.reject(Error("private cancel")); } });
    const abort = new AbortController();
    const result = outcome(service[mode]({ size: 1, stream: () => stream }, { signal: abort.signal }));
    await tick(); abort.abort();
    assert.deepEqual(await result, { code: "FILE_CANCELLED" });
    await tick();
    assert.equal(cancelCalls, 1);
    assert.equal(stream.locked, false);
    assert.equal(service.state().active, 0);
  });

  test("file native: oversized first chunk cancels before another read " + mode, async t => {
    const service = fixture(t);
    let cancelled = 0;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("too large")); },
      cancel() { cancelled++; } });
    await assert.rejects(service[mode]({ size: 2, stream: () => stream }), code("FILE_SIZE"));
    assert.equal(cancelled, 1);
    assert.equal(stream.locked, false);
    assert.equal(service.state().completed, 0);
  });

  test("file native: a closed empty stream mismatches nonempty declaration " + mode, async t => {
    const service = fixture(t);
    const stream = new ReadableStream({ start(controller) { controller.close(); } });
    await assert.rejects(service[mode]({ size: 1, stream: () => stream }), code("FILE_SIZE"));
    assert.equal(stream.locked, false);
    assert.equal(service.state().failed, 1);
  });
}

test("file native: binary byte stream has exact content across automatic chunking", async t => {
  const service = fixture(t);
  const expected = Uint8Array.from({ length: 130_001 }, (_, i) => (i * 31) % 256);
  const file = new File([expected], "synthetic-binary.json");
  const result = await service.readBytes(file);
  assert.deepEqual(result, expected);
  assert.notEqual(result.buffer, expected.buffer);
  assert.equal(service.state().completed, 1);
});

test("file native: fatal UTF-8 state carries across 64 KiB chunk boundary", async t => {
  const service = fixture(t);
  const content = "a".repeat(65535) + "🔐" + "b".repeat(65536);
  const file = new File([content], "synthetic-large.json");
  assert.equal(await service.readText(file), content);
  assert.equal(service.state().completed, 1);
});

test("file native: a Blob slice reads only its bounded range", async t => {
  const service = fixture(t);
  const blob = new Blob(["prefix|DAT EMA CAWELON|suffix"]);
  const selected = blob.slice(7, 22);
  assert.equal(selected.size, 15);
  assert.equal(await service.readText(selected), "DAT EMA CAWELON");
  assert.equal(await blob.text(), "prefix|DAT EMA CAWELON|suffix");
});

test("file native: byte stream BYOB implementation still works with default reader", async t => {
  const service = fixture(t);
  let sent = false;
  const stream = new ReadableStream({ type: "bytes", pull(controller) {
    if (sent) { controller.close(); return; }
    sent = true;
    controller.enqueue(bytes("ok"));
  } });
  assert.equal(await service.readText({ size: 2, stream: () => stream }), "ok");
  assert.equal(stream.locked, false);
});

test("file native: completion of delayed cancellation cannot cancel a later file", async t => {
  const service = fixture(t);
  const cancellation = deferred();
  let cancelCalls = 0;
  const old = new ReadableStream({ cancel() { cancelCalls++; return cancellation.promise; } });
  const first = outcome(service.readText({ size: 1, stream: () => old }));
  await tick(); service.cancelAll(); await first;
  await tick();
  const current = await service.readText(new File(["next"], "synthetic.json"));
  cancellation.resolve(); await tick();
  assert.equal(current, "next");
  assert.equal(cancelCalls, 1);
  assert.equal(service.state().completed, 1);
  assert.equal(service.state().cancelled, 1);
});
