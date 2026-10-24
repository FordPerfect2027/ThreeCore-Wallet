import test from "node:test";
import assert from "node:assert/strict";
import { readSecurityFileText, readFormatFileText, FILE_SECURITY_LIMIT } from "../src/security-file.js";

const bytes = text => new TextEncoder().encode(text);
const errorCode = code => error => error.code === code;
function streamFile(parts, size = parts.reduce((sum, value) => sum + value.byteLength, 0)) {
  let reads = 0, cancelled = 0, released = 0;
  return {
    size,
    stream: () => ({ getReader: () => ({
      async read() { return reads < parts.length ? { done: false, value: parts[reads++] } : { done: true }; },
      async cancel() { cancelled++; },
      releaseLock() { released++; },
    }) }),
    metrics: () => ({ reads, cancelled, released }),
  };
}

test("streamed UTF-8 spans arbitrary byte boundaries without replacement", async () => {
  const text = '{"label":"あ🚀é"}', data = bytes(text);
  const file = streamFile([...data].map(value => Uint8Array.of(value)));
  assert.equal(await readSecurityFileText(file), text);
  assert.equal(file.metrics().released, 1);
  assert.equal(file.metrics().cancelled, 0);
});

test("native File uses its stream without invoking arrayBuffer fallback", async () => {
  const file = new File(['{"ok":true}'], 'safe.json');
  Object.defineProperty(file, "arrayBuffer", { value() { throw Error("Do not use fallback"); } });
  assert.equal(await readSecurityFileText(file), '{"ok":true}');
});

test("fallback accepts exactly the declared ArrayBuffer bytes", async () => {
  const data = bytes("abc");
  assert.equal(await readSecurityFileText({ size: 3, arrayBuffer: async () => data.buffer }), "abc");
});

for (const size of [0, -1, NaN, Infinity, "3", FILE_SECURITY_LIMIT + 1]) {
  test("declared invalid size is refused before calling readers: " + size, async () => {
    let calls = 0;
    await assert.rejects(readSecurityFileText({ size, arrayBuffer() { calls++; } }), errorCode("FILE_SIZE"));
    assert.equal(calls, 0);
  });
}

test("excess actual stream bytes stop reading and cancel the source", async () => {
  const file = streamFile([bytes("ab"), bytes("cd"), bytes("ef")], 3);
  await assert.rejects(readSecurityFileText(file), errorCode("FILE_SIZE"));
  assert.equal(file.metrics().reads, 2);
  assert.equal(file.metrics().cancelled, 1);
  assert.equal(file.metrics().released, 1);
});

test("truncated stream is never silently accepted", async () => {
  await assert.rejects(readSecurityFileText(streamFile([bytes("ab")], 3)), errorCode("FILE_SIZE"));
});

test("declared size is captured once rather than read again after asynchronous I/O", async () => {
  const file = streamFile([bytes("abc")]);
  let count = 0;
  Object.defineProperty(file, "size", { get() { return ++count === 1 ? 3 : 900; } });
  assert.equal(await readSecurityFileText(file), "abc");
  assert.equal(count, 1);
});

for (const data of [[0xc3], [0xff], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
  test("invalid UTF-8 fails closed: " + data.join(","), async () => {
    await assert.rejects(readSecurityFileText(streamFile(data.map(x => Uint8Array.of(x)))), errorCode("FILE_ENCODING"));
  });
}

test("streamed BOM follows the established file decoder behavior", async () => {
  const data = bytes("\ufeff{}");
  assert.equal(await readSecurityFileText(streamFile([data.slice(0, 2), data.slice(2)])), "{}");
});

test("a stream that never settles is bounded by the overall deadline", async () => {
  let cancelled = 0;
  const file = { size: 1, stream: () => ({ getReader: () => ({
    read: () => new Promise(() => {}), cancel() { cancelled++; }, releaseLock() {},
  }) }) };
  await assert.rejects(readSecurityFileText(file, { timeoutMs: 10 }), errorCode("FILE_TIMEOUT"));
  assert.ok(cancelled >= 1);
});

test("abort settles a pending stream without waiting for the provider", async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let cancel = 0;
  const file = { size: 1, stream: () => ({ getReader: () => ({
    read() { started(); return new Promise(() => {}); },
    cancel() { cancel++; }, releaseLock() {},
  }) }) };
  const pending = readSecurityFileText(file, { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, errorCode("FILE_CANCELLED"));
  assert.ok(cancel >= 1);
});

test("already aborted input does not touch file properties", async () => {
  const controller = new AbortController(); controller.abort();
  let accesses = 0;
  const file = new Proxy({}, { get() { accesses++; throw Error(); } });
  await assert.rejects(readSecurityFileText(file, { signal: controller.signal }), errorCode("FILE_CANCELLED"));
  assert.equal(accesses, 0);
});

test("late fallback fulfillment cannot resume a canceled read", async () => {
  let resolve;
  const deferred = new Promise(yes => { resolve = yes; });
  const controller = new AbortController();
  const pending = readSecurityFileText({ size: 1, arrayBuffer: () => deferred }, { signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, errorCode("FILE_CANCELLED"));
  resolve(bytes("x").buffer);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("late fallback rejection after timeout is consumed", async () => {
  let reject;
  const deferred = new Promise((yes, no) => { reject = no; });
  const pending = readSecurityFileText({ size: 1, arrayBuffer: () => deferred }, { timeoutMs: 5 });
  await assert.rejects(pending, errorCode("FILE_TIMEOUT"));
  reject(Error("late internal detail"));
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("reader errors do not disclose internal messages", async () => {
  const file = { size: 1, arrayBuffer() { throw Error("private path /hidden/key"); } };
  await assert.rejects(readSecurityFileText(file), error => error.message === "FILE_READ");
});

test("a broken stream cannot downgrade to arrayBuffer", async () => {
  let calls = 0;
  const file = { size: 1, stream: () => null, arrayBuffer() { calls++; return bytes("x").buffer; } };
  await assert.rejects(readSecurityFileText(file), errorCode("FILE_READ"));
  assert.equal(calls, 0);
});

test("non-byte stream packets cannot become text", async () => {
  const file = streamFile(["abc"], 3);
  await assert.rejects(readSecurityFileText(file), errorCode("FILE_READ"));
});

test("invalid fallback values are classified as size failures", async () => {
  for (const value of [null, bytes("x"), "x", {}]) {
    await assert.rejects(readSecurityFileText({ size: 1, arrayBuffer: async () => value }), errorCode("FILE_SIZE"));
  }
});

test("cleanup failures cannot turn a rejected read into a success", async () => {
  const file = { size: 1, stream: () => ({ getReader: () => ({
    async read() { throw Error(); }, cancel() { throw Error(); }, releaseLock() { throw Error(); },
  }) }) };
  await assert.rejects(readSecurityFileText(file), errorCode("FILE_READ"));
});

test("format adapter retains existing size and encoding error names", async () => {
  const options = { maxBytes: 5, fail: code => { throw Object.assign(Error(code), { code }); },
    sizeCode: "FORMAT_SIZE", readCode: "FORMAT_READ", encodingCode: "FORMAT_ENCODING" };
  await assert.rejects(readFormatFileText(streamFile([bytes("123456")]), options), errorCode("FORMAT_SIZE"));
  await assert.rejects(readFormatFileText(streamFile([Uint8Array.of(255)]), options), errorCode("FORMAT_ENCODING"));
  await assert.rejects(readFormatFileText({ size: 1, arrayBuffer() { throw Error(); } }, options), errorCode("FORMAT_READ"));
});

for (const options of [{ maxBytes: 0 }, { maxBytes: FILE_SECURITY_LIMIT + 1 }, { timeoutMs: 0 },
  { timeoutMs: Infinity }, { timeoutMs: 120_001 }, { signal: {} }]) {
  test("invalid file reader policy is rejected: " + JSON.stringify(options), async () => {
    await assert.rejects(readSecurityFileText(streamFile([bytes("x")]), options), errorCode("FILE_OPTIONS"));
  });
}
