import test from "node:test";
import assert from "node:assert/strict";
import { checksumFormats, checksumReaders } from "./helpers/public-checksum-fixtures.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
for (const [name, prepare, code] of checksumFormats) {
  test(`${name}: pre-cancelled output preparation does not hash`, async () => {
    const aborter = new AbortController(); aborter.abort(); let calls = 0;
    await assert.rejects(prepare({ signal: aborter.signal, subtle: { digest() { calls++; return new ArrayBuffer(32); } } }), error => error.code === code);
    assert.equal(calls, 0);
  });
  test(`${name}: cancellation ends a running checksum wait`, async () => {
    const gate = deferred(), started = deferred(), aborter = new AbortController(); let settled = false;
    const pending = prepare({ signal: aborter.signal, subtle: { digest() { started.resolve(); return gate.promise; } } })
      .then(() => { settled = true; return null; }, error => { settled = true; return error.code; });
    try {
      await started.promise; aborter.abort(); await tick();
      assert.equal(settled, true); assert.equal(await pending, code);
    } finally { gate.resolve(new ArrayBuffer(32)); await pending; await tick(); }
  });
}

for (const [name, prepare, code] of checksumFormats.filter(([name]) => checksumReaders[name])) {
  test(`${name}: decoding cancellation ends the checksum wait`, async () => {
    const prepared = await prepare({}), text = typeof prepared === "string" ? prepared : prepared.text;
    const gate = deferred(), started = deferred(), aborter = new AbortController(); let settled = false;
    const pending = checksumReaders[name](text, { signal: aborter.signal, subtle: { digest() { started.resolve(); return gate.promise; } } })
      .then(() => { settled = true; return null; }, error => { settled = true; return error.code; });
    try {
      await started.promise; aborter.abort(); await tick();
      assert.equal(settled, true); assert.equal(await pending, code);
    } finally { gate.resolve(new ArrayBuffer(32)); await pending; await tick(); }
  });
}
