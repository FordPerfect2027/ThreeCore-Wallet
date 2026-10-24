import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { captureFileSource, inspectReadPacket, snapshotFileChunk, openFileStream } from "../src/file-read-source.js";
import { bytes, code, streamFile, tick } from "./helpers/file-boundary-fixtures.js";

test("file source: size and stream captured once without evaluating fallback", () => {
  const calls = { size: 0, stream: 0, fallback: 0 };
  const stream = () => {};
  const file = {
    get size() { calls.size++; return 2; },
    get stream() { calls.stream++; return stream; },
    get arrayBuffer() { calls.fallback++; throw Error("unused"); },
  };
  const result = captureFileSource(file, 10);
  assert.equal(result.size, 2);
  assert.equal(result.stream, stream);
  assert.equal(result.file, file);
  assert.equal(result.arrayBuffer, null);
  assert.deepEqual(calls, { size: 1, stream: 1, fallback: 0 });
});

for (const size of [0, -1, 0.5, NaN, Infinity, "1", 11, undefined, null, 1n]) {
  test("file source: invalid size blocks method getter " + String(size), () => {
    let inspected = false;
    assert.throws(() => captureFileSource({ size, get stream() { inspected = true; } }, 10), code("FILE_SIZE"));
    assert.equal(inspected, false);
  });
}

for (const value of [undefined, null, 0, false, "stream", {}]) {
  test("file source: optional stream fallback " + String(value), () => {
    const arrayBuffer = () => {};
    const file = { size: 1, stream: value, arrayBuffer };
    const captured = captureFileSource(file, 1);
    assert.equal(captured.stream, null);
    assert.equal(captured.arrayBuffer, arrayBuffer);
  });
}

test("file source: callable but broken stream cannot downgrade", () => {
  let fallbacks = 0;
  const captured = captureFileSource({ size: 1, stream() { throw Error("broken"); },
    arrayBuffer() { fallbacks++; } }, 1);
  assert.throws(() => openFileStream(captured, () => {}));
  assert.equal(fallbacks, 0);
});

for (const packet of [null, undefined, false, 1, "packet", [], {}, { done: 1 },
  { done: "false", value: bytes("a") }, { done: false }, { done: true, value: bytes("a") },
  Object.create({ done: true }), Object.create({ done: false, value: bytes("a") })]) {
  test("file packet: malformed structure " + String(packet), () => {
    assert.throws(() => inspectReadPacket(packet), code("FILE_READ"));
  });
}

for (const key of ["done", "value"]) {
  test("file packet: accessor not executed for " + key, () => {
    let hits = 0;
    const packet = { done: false, value: bytes("a") };
    Object.defineProperty(packet, key, { get() { hits++; throw Error("private"); } });
    assert.throws(() => inspectReadPacket(packet), code("FILE_READ"));
    assert.equal(hits, 0);
  });
}

test("file packet: terminal packets allow omitted or undefined value", () => {
  assert.deepEqual(inspectReadPacket({ done: true }), { done: true, value: undefined });
  assert.deepEqual(inspectReadPacket({ done: true, value: undefined }), { done: true, value: undefined });
  const packet = Object.create(null);
  packet.done = false;
  packet.value = bytes("x");
  assert.equal(inspectReadPacket(packet).value, packet.value);
});

test("file packet: unrelated getters are not executed or copied", () => {
  let hits = 0;
  const packet = { done: false, value: bytes("a"), get debug() { hits++; return "private"; } };
  assert.deepEqual(Object.keys(inspectReadPacket(packet)), ["done", "value"]);
  assert.equal(hits, 0);
});

test("file chunk: snapshots only the selected view with independent storage", () => {
  const original = bytes("_ABC_");
  const view = original.subarray(1, 4);
  const result = snapshotFileChunk(view, 3);
  original.fill(0);
  assert.equal(new TextDecoder().decode(result), "ABC");
  assert.notEqual(result.buffer, original.buffer);
  assert.equal(result.byteOffset, 0);
});

test("file chunk: own property overrides cannot fabricate lengths or buffers", () => {
  const original = bytes("abc");
  for (const key of ["byteLength", "byteOffset", "buffer"]) {
    Object.defineProperty(original, key, { get() { throw Error("spoof"); } });
  }
  assert.equal(new TextDecoder().decode(snapshotFileChunk(original, 3)), "abc");
  assert.throws(() => snapshotFileChunk(original, 2), code("FILE_SIZE"));
});

for (const value of [null, {}, [], "bytes", new Int8Array(2), new Uint16Array(2),
  new Uint8ClampedArray(2), new DataView(new ArrayBuffer(2)), new ArrayBuffer(2),
  new Proxy(new Uint8Array(2), {})]) {
  test("file chunk: non Uint8Array rejected " + Object.prototype.toString.call(value), () => {
    assert.throws(() => snapshotFileChunk(value, 10), code("FILE_READ"));
  });
}

test("file chunk: cross realm native buffers and views pass brand checks", () => {
  const view = vm.runInNewContext("new Uint8Array([65, 66])");
  assert.deepEqual(snapshotFileChunk(view, 2), new Uint8Array([65, 66]));
  assert.deepEqual(snapshotFileChunk(view.buffer, 2, true), new Uint8Array([65, 66]));
});

test("file chunk: detached buffers fail without replacement data", () => {
  const buffer = new ArrayBuffer(2);
  const view = new Uint8Array(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  assert.throws(() => snapshotFileChunk(buffer, 2, true), code("FILE_SIZE"));
  assert.throws(() => snapshotFileChunk(view, 2), code("FILE_READ"));
});

test("file chunk: shared memory is rejected for both entry paths", () => {
  const buffer = new SharedArrayBuffer(2);
  assert.throws(() => snapshotFileChunk(buffer, 2, true), code("FILE_SIZE"));
  assert.throws(() => snapshotFileChunk(new Uint8Array(buffer), 2), code("FILE_READ"));
});

test("file chunk: fallback checks internal length before allocating a copy", () => {
  const buffer = new ArrayBuffer(4);
  Object.defineProperty(buffer, "byteLength", { value: 1 });
  assert.throws(() => snapshotFileChunk(buffer, 3, true), code("FILE_SIZE"));
  assert.equal(snapshotFileChunk(buffer, 4, true).length, 4);
});

test("file source: captured methods retain receiver after mutation", async () => {
  const f = streamFile([bytes("a")]);
  const originalRead = f.reader.read;
  f.reader.read = function () { assert.equal(this, f.reader); return originalRead.call(this); };
  const opened = openFileStream(captureFileSource(f.file, 1), () => {});
  f.reader.read = () => { throw Error("replaced read"); };
  f.reader.cancel = () => { throw Error("replaced cancel"); };
  f.reader.releaseLock = () => { throw Error("replaced release"); };
  assert.deepEqual((await opened.read()).value, bytes("a"));
  opened.cleanup(true);
  opened.cleanup(true);
  assert.equal(f.calls.cancel, 1);
  assert.equal(f.calls.release, 1);
});

test("file source: completed cleanup releases without cancellation", () => {
  const f = streamFile([bytes("a")]);
  const opened = openFileStream(captureFileSource(f.file, 1), () => {});
  opened.cleanup(false);
  opened.cleanup(true);
  assert.equal(f.calls.cancel, 0);
  assert.equal(f.calls.release, 1);
});

test("file source: asynchronous cleanup rejection cannot escape", async () => {
  const f = streamFile([bytes("a")], {
    onCancel: () => Promise.reject(Error("private cancel")),
    onRelease: () => Promise.reject(Error("private release")),
  });
  const opened = openFileStream(captureFileSource(f.file, 1), () => {});
  assert.doesNotThrow(() => opened.cleanup());
  await tick();
  assert.equal(f.calls.cancel, 1);
  assert.equal(f.calls.release, 1);
});

for (const key of ["read", "cancel", "releaseLock"]) {
  test("file source: invalid method " + key, () => {
    const f = streamFile([bytes("a")]);
    f.reader[key] = 123;
    assert.throws(() => openFileStream(captureFileSource(f.file, 1), () => {}), code("FILE_READ"));
    if (key !== "releaseLock") assert.equal(f.calls.release, 1);
    if (key !== "cancel") assert.equal(f.calls.cancel, 1);
  });
}

test("file source: invalidation after reader acquisition unwinds cleanup", () => {
  const f = streamFile([bytes("a")]);
  let checks = 0;
  assert.throws(() => openFileStream(captureFileSource(f.file, 1), () => {
    if (++checks === 3) throw Error("stopped");
  }));
  assert.equal(f.calls.read, 0);
  assert.equal(f.calls.cancel, 1);
  assert.equal(f.calls.release, 1);
});
