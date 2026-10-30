import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { checksumFormats as formats } from "./helpers/public-checksum-fixtures.js";
for (const [name, prepare, code] of formats) {
  test(`${name}: digest accessor failure is sanitized`, async () => {
    const subtle = { get digest() { throw Error("synthetic adapter detail"); } };
    const expected = code === "TRANSFER_CRYPTO_FAILED" ? "TRANSFER_CRYPTO_UNAVAILABLE" : code;
    await assert.rejects(prepare({ subtle }), error => error.code === expected && !error.message.includes("synthetic adapter"));
  });
  test(`${name}: capture each digest method once and retain its receiver`, async () => {
    let reads = 0, calls = 0;
    const subtle = { get digest() { reads++; return function(...args) {
      calls++; assert.equal(this, subtle); return webcrypto.subtle.digest(...args);
    }; } };
    await prepare({ subtle }); assert.ok(calls > 0); assert.equal(reads, calls);
  });
  test(`${name}: reject a fake digest length`, async () => {
    const value = new ArrayBuffer(31);
    Object.defineProperty(value, "byteLength", { value: 32 });
    await assert.rejects(prepare({ subtle: { digest: async () => value } }), error => error.code === code);
  });
  test(`${name}: reject array-like digest results`, async () => {
    await assert.rejects(prepare({ subtle: { digest: async () => ({ length: 32 }) } }), error => error.code === code);
  });
}
