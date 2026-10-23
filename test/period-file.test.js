import test from "node:test";
import assert from "node:assert/strict";
import { preparePeriodFile, decodePeriodFile, readPeriodFile, PERIOD_FILE_LIMIT } from "../src/period-file.js";
import { periodDraftKey } from "../src/period-draft.js";
import { checkpoint, fileFrom, clone, code, plan, context } from "./helpers/period-fixtures.js";

for (let stage = 0; stage <= 5; stage++) {
  test("file round-trip retains exactly the completed prefix: " + stage, async () => {
    const before = checkpoint(stage);
    const prepared = await preparePeriodFile(before);
    const result = await readPeriodFile(fileFrom(prepared.text));
    assert.equal(periodDraftKey(result.draft), periodDraftKey(before));
    assert.match(result.digest, /^[0-9a-f]{64}$/);
    assert.equal(result.checksumVerified, true);
    assert.equal(result.authenticated, false);
    assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.text).byteLength);
    assert.equal(prepared.containsPublicAccounts, true);
  });
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("download filename contains the selected token: " + agent, async () => {
    const value = await preparePeriodFile(checkpoint(5, plan({}, context(agent))));
    assert.equal(value.filename, `ThreeCore-period-${agent}.json`);
    assert.equal(value.mimeType, "application/json;charset=utf-8");
  });
}

test("checksum covers endpoint balances, plan and record content", async () => {
  const prepared = await preparePeriodFile(checkpoint());
  for (const mutate of [
    value => { value.draft.earlier.balanceBaseUnits = "1"; },
    value => { value.draft.records[0].events[0].amountBaseUnits = "1"; },
    value => { value.draft.earlier.connectionEpoch = 77; },
  ]) {
    const envelope = JSON.parse(prepared.text);
    mutate(envelope);
    await assert.rejects(decodePeriodFile(JSON.stringify(envelope)), code("PERIOD_CHECKSUM"));
  }
});

test("JSON whitespace changes do not affect canonical digest", async () => {
  const prepared = await preparePeriodFile(checkpoint());
  const compact = JSON.stringify(JSON.parse(prepared.text));
  assert.equal((await decodePeriodFile(compact)).digest, prepared.digest);
});

test("different checkpoint contents produce different digests", async () => {
  const values = await Promise.all([0, 1, 2, 3, 4, 5].map(count => preparePeriodFile(checkpoint(count))));
  assert.equal(new Set(values.map(value => value.digest)).size, 6);
});

for (const patch of [{ schema: "v2" }, { algorithm: "MD5" }, { digest: "" }, { digest: "F".repeat(64) }, { digest: null }]) {
  test("unsupported checksum envelope fails: " + JSON.stringify(patch), async () => {
    const value = JSON.parse((await preparePeriodFile(checkpoint())).text);
    await assert.rejects(decodePeriodFile(JSON.stringify({ ...value, ...patch })), code("PERIOD_FILE_SCHEMA"));
  });
}

test("unrecognized top-level data is rejected", async () => {
  const value = JSON.parse((await preparePeriodFile(checkpoint())).text);
  await assert.rejects(decodePeriodFile(JSON.stringify({ ...value, walletPassword: "not-a-secret" })), code("PERIOD_SHAPE"));
});

for (const text of ["{", "null", "[]", "false", "<html>error</html>"]) {
  test("non-envelope input is rejected: " + text, async () => {
    await assert.rejects(decodePeriodFile(text));
  });
}

for (const name of ["data.txt", "../data.json", "C:\\data.json", "a\n.json", "a".repeat(181) + ".json"]) {
  test("invalid filename rejected before reading: " + JSON.stringify(name), async () => {
    let reads = 0;
    await assert.rejects(readPeriodFile({ name, size: 10, arrayBuffer() { reads++; } }), code("PERIOD_FILENAME"));
    assert.equal(reads, 0);
  });
}

for (const size of [0, -1, 1.2, PERIOD_FILE_LIMIT + 1, NaN, Infinity, "10"]) {
  test("invalid declared size rejected before buffer allocation: " + String(size), async () => {
    let reads = 0;
    await assert.rejects(readPeriodFile({ name: "a.json", size, arrayBuffer() { reads++; } }), code("PERIOD_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}

test("actual buffer size must match file metadata", async () => {
  const file = fileFrom((await preparePeriodFile(checkpoint())).text);
  await assert.rejects(readPeriodFile({ ...file, size: file.size - 1 }), code("PERIOD_FILE_SIZE"));
  await assert.rejects(readPeriodFile({ ...file, arrayBuffer: async () => new Uint8Array(file.size) }), code("PERIOD_FILE_SIZE"));
});

test("file read failures are sanitized", async () => {
  await assert.rejects(readPeriodFile({ name: "a.json", size: 10, arrayBuffer() { throw Error("private path"); } }), code("PERIOD_FILE_READ"));
});

test("invalid UTF-8 cannot be silently replaced", async () => {
  await assert.rejects(readPeriodFile({ name: "a.json", size: 2,
    arrayBuffer: async () => new Uint8Array([0xc0, 0xaf]).buffer }), code("PERIOD_FILE_ENCODING"));
});

test("uppercase extension and a UTF-8 BOM from local tools are accepted", async () => {
  const text = (await preparePeriodFile(checkpoint())).text;
  const result = await readPeriodFile(fileFrom("\ufeff" + text, "DATA.JSON"));
  assert.equal(periodDraftKey(result.draft), periodDraftKey(checkpoint()));
});

for (const subtle of [null, {}, { digest: async () => new ArrayBuffer(31) }, { digest: async () => "x" },
  { digest: async () => { throw Error("not supported"); } }]) {
  test("crypto failure is explicit, not a skipped integrity check", async () => {
    await assert.rejects(preparePeriodFile(checkpoint(), { subtle }), code("PERIOD_CRYPTO"));
  });
}

test("inputs are detached before an asynchronous checksum calculation", async () => {
  const source = clone(checkpoint());
  const original = periodDraftKey(source);
  const promise = preparePeriodFile(source);
  source.earlier.balanceBaseUnits = "1";
  const result = await decodePeriodFile((await promise).text);
  assert.equal(periodDraftKey(result.draft), original);
});

test("text limit is enforced before parsing", async () => {
  await assert.rejects(decodePeriodFile(" ".repeat(PERIOD_FILE_LIMIT + 1)), code("PERIOD_FILE_SIZE"));
});

test("valid new checksums are explicitly not a claim of trustworthy authorship", async () => {
  const altered = clone(checkpoint());
  altered.earlier.balanceBaseUnits = "1";
  const result = await decodePeriodFile((await preparePeriodFile(altered)).text);
  assert.equal(result.draft.earlier.balanceBaseUnits, "1");
  assert.equal(result.authenticated, false);
});
