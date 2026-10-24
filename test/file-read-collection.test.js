import test from "node:test";
import assert from "node:assert/strict";
import { FILE_CHUNK_LIMIT } from "../src/file-read-policy.js";
import { fixture, bytes, tick, code, outcome, streamFile, fallbackFile, deferred } from "./helpers/file-boundary-fixtures.js";

const examples = ["plain JSON", "日本語の履歴", "🔐 DAT・EMA・CAWELON", "a\u0301🙂終", "\ufeff{\"a\":1}"];
for (const text of examples) {
  const data = bytes(text);
  for (let split = 0; split <= data.length; split++) {
    test(`file collection: exact UTF-8 split ${JSON.stringify(text)}/${split}`, async t => {
      const service = fixture(t);
      const parts = [data.slice(0, split), data.slice(split)];
      assert.equal(await service.readText(streamFile(parts).file), new TextDecoder().decode(data));
      assert.deepEqual(await service.readBytes(streamFile(parts).file), data);
      assert.equal(service.state().completed, 2);
    });
  }
}

for (const data of [[0xc3], [0xff], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
  [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x28, 0x8c, 0xbc], [0x80], [0xc0, 0xaf]]) {
  for (let split = 0; split <= data.length; split++) {
    test(`file collection: malformed UTF-8 across boundary ${data}/${split}`, async t => {
      const service = fixture(t);
      const parts = [Uint8Array.from(data.slice(0, split)), Uint8Array.from(data.slice(split))];
      await assert.rejects(service.readText(streamFile(parts).file), code("FILE_ENCODING"));
      // Byte format decoders are responsible for their own encoding vocabulary.
      assert.deepEqual(await service.readBytes(streamFile(parts).file), Uint8Array.from(data));
      assert.equal(service.state().failed, 1);
      assert.equal(service.state().completed, 1);
    });
  }
}

for (const mode of ["readText", "readBytes"]) {
  for (const declared of [1, 3]) {
    test(`file collection: actual size differs from declaration ${mode}/${declared}`, async t => {
      const service = fixture(t);
      const input = streamFile([bytes("ab")], { size: declared });
      await assert.rejects(service[mode](input.file), code("FILE_SIZE"));
      assert.equal(input.calls.cancel, 1);
      assert.equal(input.calls.release, 1);
      assert.equal(service.state().completed, 0);
    });
  }

  test("file collection: excessive zero chunks are bounded " + mode, async t => {
    const service = fixture(t, { now: () => 0 });
    const input = streamFile([], { size: 1, onRead: () => ({ done: false, value: new Uint8Array() }) });
    await assert.rejects(service[mode](input.file), code("FILE_SIZE"));
    assert.equal(input.calls.read, FILE_CHUNK_LIMIT + 1);
    assert.equal(input.calls.cancel, 1);
    assert.equal(service.state().active, 0);
  });

  test("file collection: bytes are copied before the source can reuse its buffer " + mode, async t => {
    const service = fixture(t);
    const reused = bytes("abc");
    const input = streamFile([], { size: 6, onRead(index) {
      if (index === 0) return { done: false, value: reused };
      if (index === 1) { reused.set(bytes("def")); return { done: false, value: reused }; }
      reused.fill(0);
      return { done: true };
    } });
    const result = await service[mode](input.file);
    assert.equal(mode === "readText" ? result : new TextDecoder().decode(result), "abcdef");
    assert.equal(input.calls.read, 3);
  });

  test("file collection: shared stream chunks are refused " + mode, async t => {
    const service = fixture(t);
    const shared = new Uint8Array(new SharedArrayBuffer(2));
    const input = streamFile([shared]);
    await assert.rejects(service[mode](input.file), code("FILE_READ"));
    assert.equal(service.state().completed, 0);
  });

  test("file collection: arbitrary rejection cannot leak source errors " + mode, async t => {
    const service = fixture(t);
    const input = streamFile([], { size: 1, onRead: () => Promise.reject({
      get code() { throw Error("secret exception"); }, message: "secret content",
    }) });
    await assert.rejects(service[mode](input.file), code("FILE_READ"));
    assert(!JSON.stringify(service.state()).includes("secret"));
  });
}

test("file collection: original bytes retain a BOM for established byte decoders", async t => {
  const service = fixture(t);
  const source = fallbackFile("\ufeffhello");
  const raw = await service.readBytes(source.file);
  assert.deepEqual([...raw.slice(0, 3)], [239, 187, 191]);
  assert.equal(await service.readText(source.file), "hello");
});

test("file collection: cancelling partial input suppresses every later chunk", async t => {
  const service = fixture(t);
  const gate = deferred();
  const input = streamFile([], { size: 4, onRead(index) {
    return index ? gate.promise : { done: false, value: bytes("ab") };
  } });
  const pending = outcome(service.readBytes(input.file));
  await tick(); service.cancelAll();
  assert.deepEqual(await pending, { code: "FILE_CANCELLED" });
  gate.resolve({ done: false, value: bytes("cd") }); await tick();
  assert.equal(input.calls.read, 2);
  assert.equal(service.state().completed, 0);
  assert.equal(service.state().active, 0);
});

test("file collection: rejected thenable is consumed and source cleaned", async t => {
  const service = fixture(t);
  const input = streamFile([], { size: 1, onRead() {
    return { get then() { throw Error("private thenable"); } };
  } });
  await assert.rejects(service.readText(input.file), code("FILE_READ"));
  assert.equal(input.calls.cancel, 1);
  assert.equal(input.calls.release, 1);
  await tick();
});

test("file collection: a multiply settled thenable cannot inject a second result", async t => {
  const service = fixture(t);
  const input = streamFile([], { size: 1, onRead(index) {
    if (index) return { done: true };
    return { then(resolve, reject) {
      resolve({ done: false, value: bytes("a") });
      resolve({ done: false, value: bytes("evil") });
      reject(Error("late"));
    } };
  } });
  assert.equal(await service.readText(input.file), "a");
  assert.equal(input.calls.read, 2);
  assert.equal(service.state().completed, 1);
});

test("file collection: native File uses streaming without consulting fallback", async t => {
  const service = fixture(t);
  const file = new File(["日本語🔐"], "synthetic.json");
  Object.defineProperty(file, "arrayBuffer", { get() { throw Error("fallback getter"); } });
  assert.equal(await service.readText(file), "日本語🔐");
  assert.deepEqual(await service.readBytes(file), bytes("日本語🔐"));
});

test("file collection: no filesystem path or content survives in aggregate status", async t => {
  const service = fixture(t);
  const input = fallbackFile("private contents");
  input.file.name = "private-wallet-backup.json";
  input.file.path = "C:/private/not-for-output.json";
  const snapshots = [];
  service.subscribe(value => snapshots.push(value));
  assert.equal(await service.readText(input.file), "private contents");
  const serialized = JSON.stringify(snapshots);
  assert(!serialized.includes("private"));
  assert(!serialized.includes("name"));
  assert(!serialized.includes("path"));
  assert(!serialized.includes("contents"));
});
