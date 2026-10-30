import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { collectPeriod } from "../src/period-reader.js";
import { readerSession } from "./helpers/identity-fixtures.js";
import { readerFixture, REQUEST } from "./helpers/transfer-fixtures.js";
import { fakeReader, targets } from "./helpers/allowance-fixtures.js";
import { periodSession, plan } from "./helpers/period-fixtures.js";

const readers = [
  { name: "identity", code: "IDENTITY_OPTIONS", make: readerSession, run: (f,o) => readTokenIdentity(f.session,o) },
  { name: "transfer", code: "TRANSFER_OPTIONS", make: readerFixture, run: (f,o) => readTransferSnapshot(f.session,REQUEST,o) },
  { name: "allowance", code: "ALLOWANCE_OPTIONS", make: fakeReader, run: (f,o) => readAllowanceSnapshot(f.session,targets(),o) },
  { name: "period", code: "PERIOD_OPTIONS", make: periodSession, run: (f,o) => collectPeriod(f.session,plan(),o) },
];

for (const entry of readers) {
  for (const field of ["onProgress", "signal", "timeoutMs"]) {
    test(`${entry.name} rejects ${field} accessor before any read`, async () => {
      const f = entry.make();
      let getters = 0;
      const options = {};
      Object.defineProperty(options, field, { enumerable: true, get() { getters++; return undefined; } });
      await assert.rejects(entry.run(f,options), error => error.code === entry.code);
      assert.equal(getters,0);
      assert.equal(f.calls.length,0);
    });
  }
  test(`${entry.name} reads captured options without invoking property get traps`, async () => {
    const f = entry.make();
    let gets = 0;
    const options = new Proxy({ timeoutMs: 1000 }, { get() { gets++; throw Error("live get"); } });
    assert.ok(await entry.run(f,options));
    assert.equal(gets,0);
  });
  test(`${entry.name} ignores unrelated option accessor without executing it`, async () => {
    const f = entry.make();
    let gets = 0;
    const options = { get unused() { gets++; throw Error("unrelated"); } };
    assert.ok(await entry.run(f,options));
    assert.equal(gets,0);
  });
}

for (const entry of readers.filter(value => ["transfer","period"].includes(value.name))) {
  test(`${entry.name} keeps accepted observer and removes original abort listener`, async () => {
    const f = entry.make();
    const abort = new AbortController();
    let originalCalls = 0, replacementCalls = 0;
    const options = { signal: abort.signal, onProgress() {
      originalCalls++;
      options.onProgress = () => { replacementCalls++; };
      options.signal = undefined;
    } };
    assert.equal(getEventListeners(abort.signal,"abort").length,0);
    assert.ok(await entry.run(f,options));
    assert.ok(originalCalls > 1);
    assert.equal(replacementCalls,0);
    assert.equal(getEventListeners(abort.signal,"abort").length,0);
  });
  test(`${entry.name} altered option signal cannot turn successful read into cleanup error`, async () => {
    const f = entry.make();
    const abort = new AbortController();
    const options = { signal: abort.signal, onProgress() { options.signal = {}; } };
    assert.ok(await entry.run(f,options));
    assert.equal(getEventListeners(abort.signal,"abort").length,0);
  });
}

test("period keeps accepted checkpoint callback throughout collection", async () => {
  const f = periodSession();
  let original = 0, replacement = 0;
  const options = { onCheckpoint() { original++; options.onCheckpoint = () => { replacement++; }; } };
  const result = await collectPeriod(f.session,plan(),options);
  assert.equal(original,2 + result.records.length);
  assert.equal(replacement,0);
});
