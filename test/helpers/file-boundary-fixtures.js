import assert from "node:assert/strict";
import { createFileReadService } from "../../src/file-read-service.js";
import { SecurityFileError } from "../../src/file-read-policy.js";

export const bytes = value => new TextEncoder().encode(value);
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function code(expected) {
  return error => {
    assert(error instanceof SecurityFileError);
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    return true;
  };
}
export function outcome(promise) {
  return promise.then(value => ({ value }), error => ({ code: error.code }));
}
export function fakeClock(initial = 0) {
  let time = initial;
  let nextId = 1;
  const timers = new Map();
  const cleared = [];
  const options = {
    now: () => time,
    schedule(action, delay) {
      const id = nextId++;
      timers.set(id, { action, delay });
      return id;
    },
    unschedule(id) { cleared.push(id); timers.delete(id); },
  };
  return {
    options, timers, cleared,
    set(value) { time = value; },
    fire(id = timers.keys().next().value) {
      const timer = timers.get(id);
      timers.delete(id);
      timer?.action();
    },
  };
}
export function fixture(t, options = {}) {
  const service = createFileReadService(options);
  t.after(() => service.dispose());
  return service;
}
export function streamFile(chunks, { size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  name = "synthetic.json", onRead, onCancel, onRelease } = {}) {
  let index = 0;
  const calls = { stream: 0, getReader: 0, read: 0, cancel: 0, release: 0 };
  const reader = {
    read() {
      calls.read++;
      if (onRead) return onRead(index++, reader);
      return Promise.resolve(index < chunks.length ? { done: false, value: chunks[index++] } : { done: true });
    },
    cancel() { calls.cancel++; return onCancel?.(); },
    releaseLock() { calls.release++; return onRelease?.(); },
  };
  const stream = { getReader() { calls.getReader++; return reader; } };
  const file = { name, size, stream() { calls.stream++; return stream; } };
  return { file, calls, reader, stream };
}
export function fallbackFile(text = "ok") {
  const content = bytes(text);
  let calls = 0;
  return { file: { name: "synthetic.json", size: content.byteLength,
    arrayBuffer() { calls++; return Promise.resolve(content.buffer); } }, calls: () => calls };
}
export function stalledFile({ size = 1, stream = true } = {}) {
  const gate = deferred();
  const calls = { read: 0, cancel: 0, release: 0 };
  const file = { name: "synthetic.json", size };
  if (stream) file.stream = () => ({ getReader: () => ({
    read() { calls.read++; return gate.promise; },
    cancel() { calls.cancel++; },
    releaseLock() { calls.release++; },
  }) });
  else file.arrayBuffer = () => { calls.read++; return gate.promise; };
  return { file, calls, gate,
    settle() { gate.resolve(stream ? { done: true } : new ArrayBuffer(0)); } };
}
export function signalAdapter(overrides = {}) {
  const callbacks = new Set();
  const calls = { add: 0, remove: 0 };
  const signal = {
    aborted: false,
    addEventListener(type, callback, options) {
      assert.equal(this, signal);
      assert.equal(type, "abort");
      assert.equal(options.once, true);
      calls.add++;
      callbacks.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(this, signal);
      assert.equal(type, "abort");
      calls.remove++;
      callbacks.delete(callback);
    },
    ...overrides,
  };
  return { signal, calls, callbacks,
    abort() { signal.aborted = true; for (const callback of [...callbacks]) callback(); } };
}
