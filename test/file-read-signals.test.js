import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bytes, tick, code, outcome, signalAdapter, stalledFile, streamFile, fallbackFile } from "./helpers/file-boundary-fixtures.js";

for (const stream of [true, false]) {
  test("file signal: abort rejects locally while retaining unresolved source " + stream, async t => {
    const service = fixture(t);
    const input = stalledFile({ stream, size: 2 });
    const abort = signalAdapter();
    const pending = outcome(service.readText(input.file, { signal: abort.signal }));
    await tick(); abort.abort();
    assert.deepEqual(await pending, { code: "FILE_CANCELLED" });
    assert.equal(service.state().retained, 1);
    assert.equal(abort.calls.remove, 1);
    assert.equal(abort.callbacks.size, 0);
    input.settle(); await tick();
    assert.equal(service.state().active, 0);
    assert.equal(service.state().cancelled, 1);
  });
}

test("file signal: already aborted adapter never exposes file metadata", async t => {
  const service = fixture(t);
  const abort = signalAdapter({ aborted: true });
  let reads = 0;
  const file = new Proxy({}, { get() { reads++; throw Error("file inspected"); } });
  await assert.rejects(service.readText(file, { signal: abort.signal }), code("FILE_CANCELLED"));
  assert.equal(reads, 0);
  assert.equal(abort.calls.add, 0);
  assert.equal(abort.calls.remove, 0);
});

for (const invalid of [{}, { aborted: 1 }, { aborted: false, addEventListener() {} },
  { aborted: false, removeEventListener() {} }, false, 1, "signal"]) {
  test("file signal: malformed adapter is refused before source IO " + JSON.stringify(invalid), async t => {
    const service = fixture(t);
    const input = fallbackFile();
    await assert.rejects(service.readText(input.file, { signal: invalid }), code("FILE_OPTIONS"));
    assert.equal(input.calls(), 0);
  });
}

test("file signal: abort during registration prevents initial dispatch", async t => {
  const service = fixture(t);
  const abort = signalAdapter({ addEventListener(type, callback) { callback(); } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file, { signal: abort.signal }), code("FILE_CANCELLED"));
  assert.equal(input.calls(), 0);
  assert.equal(abort.calls.remove, 1);
  assert.equal(service.state().active, 0);
});

test("file signal: registration may synchronously change aborted without dispatch", async t => {
  const service = fixture(t);
  const abort = signalAdapter({ addEventListener() { this.aborted = true; } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file, { signal: abort.signal }), code("FILE_CANCELLED"));
  assert.equal(input.calls(), 0);
  assert.equal(abort.calls.remove, 1);
});

test("file signal: throwing registration still attempts captured cleanup", async t => {
  const service = fixture(t);
  const abort = signalAdapter({ addEventListener() { throw Error("private listener"); } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file, { signal: abort.signal }), code("FILE_READ"));
  assert.equal(input.calls(), 0);
  assert.equal(abort.calls.remove, 1);
  assert.equal(service.state().active, 0);
});

test("file signal: rejecting registration is consumed and stops the job", async t => {
  const service = fixture(t);
  const abort = signalAdapter({ addEventListener() { return Promise.reject(Error("registration")); } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file, { signal: abort.signal }), code("FILE_READ"));
  await tick();
  assert.equal(input.calls(), 0);
  assert.equal(abort.calls.remove, 1);
});

for (const cleanup of [() => { throw Error("private cleanup"); }, () => Promise.reject(Error("private cleanup"))]) {
  test("file signal: successful read survives failing listener cleanup " + String(cleanup), async t => {
    const service = fixture(t);
    const abort = signalAdapter({ removeEventListener: cleanup });
    assert.equal(await service.readText(fallbackFile("kept").file, { signal: abort.signal }), "kept");
    abort.abort(); await tick();
    assert.equal(service.state().completed, 1);
    assert.equal(service.state().cancelled, 0);
  });
}

test("file signal: cleanup method is captured before adapter mutation", async t => {
  const service = fixture(t);
  const abort = signalAdapter();
  const input = stalledFile();
  const pending = outcome(service.readText(input.file, { signal: abort.signal }));
  await tick();
  abort.signal.removeEventListener = () => { throw Error("replacement"); };
  abort.abort(); await pending;
  assert.equal(abort.calls.remove, 1);
  input.settle(); await tick();
});

test("file signal: stale abort after success cannot alter state", async t => {
  const service = fixture(t);
  let callback;
  const abort = signalAdapter({ addEventListener(type, listener) { callback = listener; } });
  assert.equal(await service.readText(fallbackFile().file, { signal: abort.signal }), "ok");
  callback(); callback();
  assert.equal(service.state().completed, 1);
  assert.equal(service.state().cancelled, 0);
  assert.equal(abort.calls.remove, 1);
});

test("file signal: repeated abort and stop result in one cleanup", async t => {
  const service = fixture(t);
  const abort = signalAdapter();
  const input = stalledFile();
  const pending = outcome(service.readText(input.file, { signal: abort.signal }));
  await tick();
  abort.abort(); abort.abort(); service.cancelAll(); service.dispose();
  assert.deepEqual(await pending, { code: "FILE_CANCELLED" });
  input.settle(); await tick();
  assert.equal(input.calls.cancel, 1);
  assert.equal(input.calls.release, 1);
  assert.equal(abort.calls.remove, 1);
  assert.equal(service.state().cancelled, 1);
});

test("file signal: aborted property failure is sanitized", async t => {
  const service = fixture(t);
  const abort = signalAdapter();
  Object.defineProperty(abort.signal, "aborted", { get() { throw Error("private abort"); } });
  await assert.rejects(service.readText(fallbackFile().file, { signal: abort.signal }), code("FILE_READ"));
  assert.equal(service.state().accepted, 0);
});

test("file signal: real AbortController cancels a native ReadableStream", async t => {
  const service = fixture(t);
  let cancelled = 0;
  const native = new ReadableStream({ cancel() { cancelled++; } });
  const abort = new AbortController();
  const pending = outcome(service.readBytes({ size: 1, stream: () => native }, { signal: abort.signal }));
  await tick(); abort.abort();
  assert.deepEqual(await pending, { code: "FILE_CANCELLED" });
  await tick();
  assert.equal(cancelled, 1);
  assert.equal(native.locked, false);
  assert.equal(service.state().active, 0);
});

test("file signal: abort while source getter executes prevents reader acquisition", async t => {
  const service = fixture(t);
  const abort = new AbortController();
  const f = streamFile([bytes("x")]);
  const old = f.file.stream;
  f.file.stream = () => { abort.abort(); return old(); };
  await assert.rejects(service.readBytes(f.file, { signal: abort.signal }), code("FILE_CANCELLED"));
  assert.equal(f.calls.getReader, 0);
  assert.equal(f.calls.read, 0);
});
