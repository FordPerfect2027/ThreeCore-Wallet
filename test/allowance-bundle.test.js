import test from "node:test";
import assert from "node:assert/strict";
import { captureAllowanceBundle, validateAllowanceBundle, allowanceBundleKey,
  describeAllowanceBundle, prepareAllowanceBundle, decodeAllowanceBundle,
  readAllowanceBundle, ALLOWANCE_BUNDLE_LIMIT } from "../src/allowance-bundle.js";
import { prepareAllowanceFile } from "../src/allowance-file.js";
import { record, clone, code, deferred, OTHER } from "./helpers/allowance-fixtures.js";

const records = () => ["DAT", "EMA", "CAWELON"].map((agent, index) => {
  const value = record({}, agent, index === 1 ? 84532 : 8453);
  value.identity.account = "0x" + String(index + 1).repeat(40);
  value.identity.blockNumber = String(42 + index);
  return value;
});
const encode = text => new TextEncoder().encode(text);
async function file(bundle = captureAllowanceBundle(records()), changes = {}) {
  const prepared = await prepareAllowanceBundle(bundle);
  const bytes = encode(prepared.text);
  return { name: prepared.filename, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer, ...changes };
}
test("allowance bundle: capture deep frozen independent observations in token order", () => {
  const input = records().reverse();
  const bundle = captureAllowanceBundle(input);
  assert.deepEqual(bundle.records.map(r => r.identity.agent), ["DAT", "EMA", "CAWELON"]);
  assert(Object.isFrozen(bundle));
  assert(Object.isFrozen(bundle.records));
  assert(Object.isFrozen(bundle.records[0].rows[0]));
  assert.equal(bundle.atomicSnapshot, false);
  input[0].identity.account = OTHER;
  assert.notEqual(bundle.records[2].identity.account, OTHER);
});
test("allowance bundle: one JSON contains three independently verified records", async () => {
  const bundle = captureAllowanceBundle(records());
  const prepared = await prepareAllowanceBundle(bundle);
  const result = await decodeAllowanceBundle(encode(prepared.text));
  assert.deepEqual(result.bundle, bundle);
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
  assert.equal(prepared.byteLength, encode(prepared.text).length);
  assert.equal(prepared.filename, "ThreeCore-DAT-EMA-CAWELON-allowances.json");
  assert.equal(JSON.parse(prepared.text).files.length, 3);
});
test("allowance bundle: different record times and chains disclosed", () => {
  const text = describeAllowanceBundle(captureAllowanceBundle(records()));
  for (const fragment of ["DAT", "EMA", "CAWELON", "block 42", "block 43", "block 44",
    "Base Sepolia", "別々の時点", "同一ブロック", "置き換えません"]) assert(text.includes(fragment), fragment);
});
test("allowance bundle: reordered capture yields same canonical key", () => {
  assert.equal(allowanceBundleKey(captureAllowanceBundle(records())),
    allowanceBundleKey(captureAllowanceBundle(records().reverse())));
});
for (const input of [[], [record()], new Array(3), {}, null]) {
  test("allowance bundle: missing cards rejected " + JSON.stringify(input), () => {
    assert.throws(() => captureAllowanceBundle(input), code("ALLOWANCE_BUNDLE_RECORDS"));
  });
}
test("allowance bundle: duplicate token cannot stand in for a missing token", () => {
  assert.throws(() => captureAllowanceBundle([record(), record(), record({}, "EMA")]), code("ALLOWANCE_BUNDLE_RECORDS"));
});
for (const mutate of [
  b => { b.schema = "v2"; },
  b => { b.readOnly = false; },
  b => { b.atomicSnapshot = true; },
  b => { b.extra = "unknown"; },
  b => { b.records.extra = true; },
  b => { b.records[0].securityAudit = true; },
]) {
  test("allowance bundle: invalid claim/shape rejected " + mutate.toString(), () => {
    const bundle = clone(captureAllowanceBundle(records()));
    mutate(bundle);
    assert.throws(() => validateAllowanceBundle(bundle));
  });
}
test("allowance bundle: hostile array getter is never invoked", () => {
  const input = records();
  let reads = 0;
  Object.defineProperty(input, "0", { get() { reads++; return record(); } });
  assert.throws(() => captureAllowanceBundle(input), code("ALLOWANCE_BUNDLE_RECORDS"));
  assert.equal(reads, 0);
});
test("allowance bundle: inner record tampering rejected even with original outer checksum", async () => {
  const wrapper = JSON.parse((await prepareAllowanceBundle(captureAllowanceBundle(records()))).text);
  wrapper.files[0].payload.rows[0].allowanceBaseUnits = "99";
  await assert.rejects(decodeAllowanceBundle(encode(JSON.stringify(wrapper))), code("ALLOWANCE_CHECKSUM"));
});
test("allowance bundle: recomputed inner checksum still cannot replace one record unnoticed", async () => {
  const wrapper = JSON.parse((await prepareAllowanceBundle(captureAllowanceBundle(records()))).text);
  const changed = records()[0];
  changed.rows[0].allowanceBaseUnits = "99";
  wrapper.files[0] = JSON.parse((await prepareAllowanceFile("observation", changed)).text);
  await assert.rejects(decodeAllowanceBundle(encode(JSON.stringify(wrapper))), code("ALLOWANCE_CHECKSUM"));
});
test("allowance bundle: reordered wrapped files changes manifest checksum", async () => {
  const wrapper = JSON.parse((await prepareAllowanceBundle(captureAllowanceBundle(records()))).text);
  wrapper.files.reverse();
  await assert.rejects(decodeAllowanceBundle(encode(JSON.stringify(wrapper))), code("ALLOWANCE_CHECKSUM"));
});
test("allowance bundle: harmless JSON formatting changes remain readable", async () => {
  const prepared = await prepareAllowanceBundle(captureAllowanceBundle(records()));
  const wrapper = JSON.parse(prepared.text);
  wrapper.files[0].payload = Object.fromEntries(Object.entries(wrapper.files[0].payload).reverse());
  const result = await decodeAllowanceBundle(encode(JSON.stringify(wrapper)));
  assert.equal(result.digest, prepared.digest);
});
for (const change of [
  w => { w.algorithm = "MD5"; },
  w => { w.digest = "wrong"; },
  w => { w.schema = "other"; },
  w => { w.files.pop(); },
  w => { w.files.push(w.files[0]); },
  w => { w.files = {}; },
  w => { w.network = "mainnet"; },
]) {
  test("allowance bundle: wrapper mutation rejected " + change.toString(), async () => {
    const wrapper = JSON.parse((await prepareAllowanceBundle(captureAllowanceBundle(records()))).text);
    change(wrapper);
    await assert.rejects(decodeAllowanceBundle(encode(JSON.stringify(wrapper))));
  });
}
test("allowance bundle: targets file cannot masquerade as observation", async () => {
  const wrapper = JSON.parse((await prepareAllowanceBundle(captureAllowanceBundle(records()))).text);
  wrapper.files[0] = JSON.parse((await prepareAllowanceFile("targets", records()[0].targets)).text);
  await assert.rejects(decodeAllowanceBundle(encode(JSON.stringify(wrapper))), code("ALLOWANCE_BUNDLE_RECORDS"));
});
for (const input of [new Uint8Array(), new Uint8Array(ALLOWANCE_BUNDLE_LIMIT + 1), "{}", null]) {
  test("allowance bundle: bounds checked before parsing " + typeof input, async () => {
    await assert.rejects(decodeAllowanceBundle(input), code("ALLOWANCE_FILE_SIZE"));
  });
}
test("allowance bundle: UTF8 and JSON parse errors are distinct", async () => {
  await assert.rejects(decodeAllowanceBundle(new Uint8Array([0xff])), code("ALLOWANCE_FILE_ENCODING"));
  await assert.rejects(decodeAllowanceBundle(encode("{")), code("ALLOWANCE_FILE_JSON"));
});
test("allowance bundle: File-like read preserves historical observations", async () => {
  const result = await readAllowanceBundle(await file());
  assert.deepEqual(result.bundle.records, records());
});
for (const name of ["../test.json", "test\\path.json", "test.txt", "a\u0000.json", "x".repeat(241)]) {
  test("allowance bundle: invalid basename " + name.slice(0, 15), async () => {
    let reads = 0;
    const value = await file(undefined, { name, arrayBuffer() { reads++; } });
    await assert.rejects(readAllowanceBundle(value), code("ALLOWANCE_FILENAME"));
    assert.equal(reads, 0);
  });
}
test("allowance bundle: validates size before and after asynchronous read", async () => {
  const value = await file();
  value.size++;
  await assert.rejects(readAllowanceBundle(value), code("ALLOWANCE_FILE_SIZE"));
  value.size = ALLOWANCE_BUNDLE_LIMIT + 1;
  value.arrayBuffer = () => { throw Error("Should not read"); };
  await assert.rejects(readAllowanceBundle(value), code("ALLOWANCE_FILE_SIZE"));
});
test("allowance bundle: unreadable file yields finite read error", async () => {
  const value = await file(undefined, { arrayBuffer: async () => { throw Error("private path"); } });
  await assert.rejects(readAllowanceBundle(value), code("ALLOWANCE_FILE_READ"));
});
test("allowance bundle: caller edits during hashing do not alter captured content", async () => {
  const input = clone(captureAllowanceBundle(records()));
  const original = clone(input);
  const gate = deferred();
  const operation = prepareAllowanceBundle(input, {
    subtle: { async digest(algorithm, bytes) { await gate.promise; return crypto.subtle.digest(algorithm, bytes); } },
  });
  input.records[0].rows[0].allowanceBaseUnits = "123";
  gate.resolve();
  const result = await decodeAllowanceBundle(encode((await operation).text));
  assert.deepEqual(result.bundle, original);
});
test("allowance bundle: SHA256 does not authenticate a deliberately regenerated record", async () => {
  const input = records();
  input[0].rows[0].allowanceBaseUnits = "123";
  const result = await decodeAllowanceBundle(encode((await prepareAllowanceBundle(captureAllowanceBundle(input))).text));
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
});
test("allowance bundle: maximum bounded twenty-target records fit file size", async () => {
  const input = records();
  for (const row of input) {
    row.targets.targets = Array.from({ length: 20 }, (_, i) => ({
      address: "0x" + (i + 1).toString(16).padStart(40, "0"), label: "a".repeat(64),
    }));
    row.rows = row.targets.targets.map(target => ({
      spenderAddress: target.address, label: target.label, hasCode: true, codeError: null,
      allowanceBaseUnits: (2n ** 256n - 1n).toString(), allowanceError: null,
    }));
  }
  const prepared = await prepareAllowanceBundle(captureAllowanceBundle(input));
  assert(prepared.byteLength < ALLOWANCE_BUNDLE_LIMIT);
  const decoded = await decodeAllowanceBundle(encode(prepared.text));
  assert(decoded.bundle.records.every(r => r.rows.length === 20));
});
