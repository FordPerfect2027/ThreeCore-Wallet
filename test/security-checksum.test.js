import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { sha256Hex } from "../src/security-data.js";
const input = new TextEncoder().encode("abc");
const zero = "0".repeat(64);
const failed = error => error.code === "CHECKSUM_FAILED";
test("SHA-256 known answer retains exactly 64 lowercase hex digits", async () => {
  assert.equal(await sha256Hex(input), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
test("native buffer length takes precedence over an accessor", async () => {
  const buffer = new ArrayBuffer(32); let reads = 0;
  Object.defineProperty(buffer, "byteLength", { get() { reads++; throw Error(); } });
  assert.equal(await sha256Hex(input, { digest: async () => buffer }), zero); assert.equal(reads, 0);
});
test("cross-realm ArrayBuffer is accepted using its native slot", async () => {
  const buffer = runInNewContext("new ArrayBuffer(32)");
  assert.equal(await sha256Hex(input, { digest: async () => buffer }), zero);
});
test("detached digest result is rejected", async () => {
  const buffer = new ArrayBuffer(32); structuredClone(buffer, { transfer: [buffer] });
  await assert.rejects(sha256Hex(input, { digest: async () => buffer }), failed);
});
for (const result of [new Uint8Array(32), new SharedArrayBuffer(32), 32, "0".repeat(32), { length: 32 }, new ArrayBuffer(31), new ArrayBuffer(33)]) {
  test("reject non-WebCrypto or incorrect-size digest result: " + Object.prototype.toString.call(result), async () => {
    await assert.rejects(sha256Hex(input, { digest: async () => result }), failed);
  });
}
test("rejected and throwing digest implementations reveal no adapter details", async () => {
  for (const digest of [() => { throw Error("synthetic detail"); }, async () => { throw Error("synthetic detail"); }]) {
    await assert.rejects(sha256Hex(input, { digest }), error => error.code === "CHECKSUM_FAILED" && error.message === "CHECKSUM_FAILED");
  }
});
test("the digest callback is captured once", async () => {
  let reads = 0; const subtle = { get digest() { reads++; return reads === 1 ? function() {
    assert.equal(this, subtle); return new ArrayBuffer(32);
  } : undefined; } };
  assert.equal(await sha256Hex(input, subtle), zero); assert.equal(reads, 1);
});
