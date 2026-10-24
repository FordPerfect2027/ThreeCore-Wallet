import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bytes, tick, code, streamFile, fallbackFile, outcome, deferred } from "./helpers/file-boundary-fixtures.js";

const failures = [
  { name: "ordinary Error", value: () => Error("private marker") },
  { name: "string", value: () => "private marker" },
  { name: "null", value: () => null },
  { name: "proxy", value: () => new Proxy({}, { get() { throw Error("nested private marker"); } }) },
];

for (const stage of ["size", "stream getter", "stream call", "getReader getter", "getReader call",
  "cancel getter", "release getter", "read getter", "read call"]) {
  for (const failure of failures) {
    test(`file fault: ${stage} sanitizes ${failure.name} and unwinds setup`, async t => {
      const service = fixture(t);
      const input = streamFile([bytes("x")]);
      const broken = () => { throw failure.value(); };
      switch (stage) {
        case "size": Object.defineProperty(input.file, "size", { get: broken }); break;
        case "stream getter": Object.defineProperty(input.file, "stream", { get: broken }); break;
        case "stream call": input.file.stream = broken; break;
        case "getReader getter": Object.defineProperty(input.stream, "getReader", { get: broken }); break;
        case "getReader call": input.stream.getReader = broken; break;
        case "cancel getter": Object.defineProperty(input.reader, "cancel", { get: broken }); break;
        case "release getter": Object.defineProperty(input.reader, "releaseLock", { get: broken }); break;
        case "read getter": Object.defineProperty(input.reader, "read", { get: broken }); break;
        case "read call": input.reader.read = broken; break;
      }
      await assert.rejects(service.readText(input.file), code("FILE_READ"));
      assert.equal(service.state().active, 0);
      assert.equal(service.state().reservedBytes, 0);
      assert.equal(service.state().completed, 0);
      assert(!JSON.stringify(service.state()).includes("private"));
      if (stage === "cancel getter") assert.equal(input.calls.release, 1);
      if (stage === "release getter") assert.equal(input.calls.cancel, 1);
      if (["read getter", "read call"].includes(stage)) {
        assert.equal(input.calls.cancel, 1);
        assert.equal(input.calls.release, 1);
      }
    });
  }
}

for (const cleanup of ["cancel", "releaseLock"]) {
  for (const asynchronous of [false, true]) {
    test(`file fault: cleanup ${cleanup}/${asynchronous} cannot hide encoding failure`, async t => {
      const service = fixture(t);
      const input = streamFile([Uint8Array.of(0xff)]);
      input.reader[cleanup] = () => {
        if (asynchronous) return Promise.reject(Error("private cleanup"));
        throw Error("private cleanup");
      };
      await assert.rejects(service.readText(input.file), code("FILE_ENCODING"));
      await tick();
      assert.equal(service.state().failed, 1);
      assert.equal(service.state().completed, 0);
      if (cleanup === "cancel") assert.equal(input.calls.release, 1);
      if (cleanup === "releaseLock") assert.equal(input.calls.cancel, 1);
    });
  }
}

test("file fault: failing cancel getter still releases a real native reader", async t => {
  const service = fixture(t);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("x")); controller.close(); } });
  const reader = stream.getReader();
  Object.defineProperty(reader, "cancel", { get() { throw Error("broken cancel getter"); } });
  await assert.rejects(service.readText({ size: 1, stream: () => ({ getReader: () => reader }) }), code("FILE_READ"));
  assert.equal(stream.locked, false);
  assert.equal(service.state().active, 0);
});

test("file fault: method getters are read once, cleanup uses the captured identity", async t => {
  const service = fixture(t);
  const input = streamFile([bytes("ok")]);
  const hits = { cancel: 0, releaseLock: 0, read: 0 };
  for (const key of Object.keys(hits)) {
    const original = input.reader[key];
    Object.defineProperty(input.reader, key, { get() {
      hits[key]++;
      if (hits[key] > 1) throw Error("second getter");
      return original;
    } });
  }
  assert.equal(await service.readText(input.file), "ok");
  assert.deepEqual(hits, { cancel: 1, releaseLock: 1, read: 1 });
  assert.equal(input.calls.release, 1);
});

test("file fault: invalid stream object cannot escape through fallback", async t => {
  const service = fixture(t);
  for (const value of [null, undefined, false, 42, "stream", {}, { getReader: 1 }]) {
    let fallbacks = 0;
    await assert.rejects(service.readText({ size: 1, stream: () => value,
      arrayBuffer() { fallbacks++; return bytes("x").buffer; } }), code("FILE_READ"));
    assert.equal(fallbacks, 0);
    assert.equal(service.state().active, 0);
  }
});

test("file fault: fallback getter failure is sanitized before admission", async t => {
  const service = fixture(t);
  const file = { size: 1, get arrayBuffer() { throw Error("private disk path"); } };
  await assert.rejects(service.readText(file), code("FILE_READ"));
  assert.equal(service.state().accepted, 0);
  assert.equal(service.state().rejected, 1);
});

test("file fault: invalid fallback result is a size failure, not a decoded value", async t => {
  const service = fixture(t);
  for (const value of [null, undefined, {}, "ok", new Uint8Array(2), new SharedArrayBuffer(2)]) {
    await assert.rejects(service.readBytes({ size: 2, arrayBuffer: () => value }), code("FILE_SIZE"));
    assert.equal(service.state().active, 0);
  }
  assert.equal(service.state().completed, 0);
});

test("file fault: successful result does not depend on a later cleanup rejection", async t => {
  const service = fixture(t);
  const cleanup = deferred();
  const input = streamFile([bytes("ok")], { onRelease: () => cleanup.promise });
  const result = await service.readText(input.file);
  cleanup.reject(Error("late private cleanup")); await tick();
  assert.equal(result, "ok");
  assert.equal(service.state().completed, 1);
  assert.equal(service.state().failed, 0);
});

test("file fault: late packet getters are never inspected after cancellation", async t => {
  const service = fixture(t);
  const gate = deferred();
  const input = streamFile([], { size: 1, onRead: () => gate.promise });
  const pending = outcome(service.readText(input.file));
  await tick(); service.cancelAll(); await pending;
  let hits = 0;
  gate.resolve({ get done() { hits++; throw Error("private late packet"); },
    get value() { hits++; return bytes("x"); } });
  await tick();
  assert.equal(hits, 0);
  assert.equal(service.state().active, 0);
  assert.equal(service.state().completed, 0);
});

test("file fault: revoked proxies cannot become read results or diagnostics", async t => {
  const service = fixture(t);
  const revocable = Proxy.revocable({ done: true }, {});
  revocable.revoke();
  const input = streamFile([], { size: 1, onRead: () => revocable.proxy });
  await assert.rejects(service.readText(input.file), code("FILE_READ"));
  assert.equal(service.state().active, 0);
  assert.equal(await service.readText(fallbackFile().file), "ok");
});
