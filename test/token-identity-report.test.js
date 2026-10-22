import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { prepareTokenIdentityFile, decodeTokenIdentityFile, readTokenIdentityFile,
  encodeTokenObservation, decodeTokenObservation, IDENTITY_FILE_LIMIT } from "../src/token-identity-report.js";
import { observation, code, fileFor, clone, deferred } from "./helpers/identity-fixtures.js";

const bytes = text => new TextEncoder().encode(text);
async function editedFile(edit) {
  const original = await prepareTokenIdentityFile(observation());
  const value = JSON.parse(original.text);
  edit(value);
  return bytes(JSON.stringify(value));
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`${agent} ${chainId} file round trip preserves exact units and provenance limits`, async () => {
      const input = observation({}, agent, chainId);
      const prepared = await prepareTokenIdentityFile(input);
      const result = await decodeTokenIdentityFile(bytes(prepared.text));
      assert.deepEqual(result.observation, input);
      assert.equal(result.digest, prepared.digest);
      assert.equal(result.checksumVerified, true);
      assert.equal(result.authenticated, false);
      assert.equal(prepared.containsPublicAccount, true);
      assert.equal(prepared.byteLength, bytes(prepared.text).byteLength);
      assert.equal(prepared.filename, `ThreeCore-${agent}-identity-42.json`);
      assert.equal(Object.isFrozen(result.observation.metadata), true);
    });
  }
}

test("plain observation round trip includes no execution permissions", () => {
  const text = encodeTokenObservation(observation());
  const parsed = decodeTokenObservation(text);
  assert.equal(parsed.readOnly, true);
  assert.equal(parsed.securityAudit, false);
  assert.equal("sign" in parsed, false);
  assert.equal("send" in parsed, false);
});

test("checksum is independently reproducible over the canonical observation", async () => {
  const input = observation();
  const prepared = await prepareTokenIdentityFile(input);
  const result = await webcrypto.subtle.digest("SHA-256", bytes(encodeTokenObservation(input)));
  assert.equal(prepared.digest, Buffer.from(result).toString("hex"));
});

for (const [field, change] of [
  ["balance", value => { value.observation.balanceBaseUnits = "2"; }],
  ["native", value => { value.observation.nativeBalanceBaseUnits = "2"; }],
  ["block", value => { value.observation.blockNumber = "43"; }],
  ["name", value => { value.observation.metadata.name = "Fake DAT"; }],
  ["digest", value => { value.digest = "0".repeat(64); }],
]) {
  test("changed " + field + " fails checksum instead of loading", async () => {
    await assert.rejects(decodeTokenIdentityFile(await editedFile(change)), code("IDENTITY_CHECKSUM"));
  });
}

for (const [label, edit, expected] of [
  ["schema", value => { value.schema = "other"; }, "IDENTITY_FILE_SCHEMA"],
  ["algorithm", value => { value.algorithm = "MD5"; }, "IDENTITY_FILE_SCHEMA"],
  ["digest uppercase", value => { value.digest = value.digest.toUpperCase(); }, "IDENTITY_FILE_SCHEMA"],
  ["digest absent", value => { delete value.digest; }, "IDENTITY_SHAPE"],
  ["unknown field", value => { value.approved = true; }, "IDENTITY_SHAPE"],
  ["audit claim", value => { value.observation.securityAudit = true; }, "IDENTITY_SCHEMA"],
  ["catalog version", value => { value.observation.catalogVersion = "stale"; }, "IDENTITY_SCHEMA"],
  ["approval property", value => { value.observation.approve = true; }, "IDENTITY_SHAPE"],
]) {
  test("file rejects " + label, async () => {
    await assert.rejects(decodeTokenIdentityFile(await editedFile(edit)), code(expected));
  });
}

test("reordered JSON keys do not cause a false corruption result", async () => {
  const prepared = await prepareTokenIdentityFile(observation());
  const document = JSON.parse(prepared.text);
  document.observation = Object.fromEntries(Object.entries(document.observation).reverse());
  const reordered = JSON.stringify(document);
  const result = await decodeTokenIdentityFile(bytes(reordered));
  assert.equal(result.digest, prepared.digest);
});

test("edited and rechecksummed data is not called authenticated", async () => {
  const row = observation({ balanceBaseUnits: "2" });
  const prepared = await prepareTokenIdentityFile(row);
  const result = await decodeTokenIdentityFile(bytes(prepared.text));
  assert.equal(result.observation.balanceBaseUnits, "2");
  assert.equal(result.authenticated, false);
});

test("file bytes are copied before the digest starts", async () => {
  const prepared = await prepareTokenIdentityFile(observation());
  const input = bytes(prepared.text);
  const gate = deferred();
  const entered = deferred();
  const subtle = { async digest(...args) {
    entered.resolve();
    await gate.promise;
    return webcrypto.subtle.digest(...args);
  } };
  const pending = decodeTokenIdentityFile(input, { subtle });
  await entered.promise;
  input.fill(0);
  gate.resolve();
  assert.equal((await pending).observation.balanceBaseUnits, observation().balanceBaseUnits);
});

test("export input is captured before asynchronous checksum", async () => {
  const row = observation();
  const gate = deferred();
  const subtle = { async digest(...args) { await gate.promise; return webcrypto.subtle.digest(...args); } };
  const pending = prepareTokenIdentityFile(row, { subtle });
  row.balanceBaseUnits = "2";
  row.metadata.symbol = "FAKE";
  gate.resolve();
  const result = await decodeTokenIdentityFile(bytes((await pending).text));
  assert.equal(result.observation.metadata.symbol, "DAT");
  assert.equal(result.observation.balanceBaseUnits, observation().balanceBaseUnits);
});

for (const value of [new Uint8Array(), new Uint8Array(IDENTITY_FILE_LIMIT + 1), "{}", null, new ArrayBuffer(8)]) {
  test("bounded binary input required: " + String(value?.constructor?.name), async () => {
    await assert.rejects(decodeTokenIdentityFile(value), code("IDENTITY_FILE_SIZE"));
  });
}

test("malformed UTF-8 is rejected instead of replaced", async () => {
  await assert.rejects(decodeTokenIdentityFile(Uint8Array.from([0xff, 0xff])), code("IDENTITY_FILE_ENCODING"));
});

test("invalid JSON fails explicitly", async () => {
  await assert.rejects(decodeTokenIdentityFile(bytes("{")), code("IDENTITY_FILE_JSON"));
  assert.throws(() => decodeTokenObservation("{"), code("IDENTITY_FILE_JSON"));
});

for (const subtle of [null, {}, { digest: async () => { throw Error("unavailable"); } },
  { digest: async () => new ArrayBuffer(31) }, { digest: async () => new Uint8Array(32) }]) {
  test("invalid crypto facility is rejected", async () => {
    await assert.rejects(prepareTokenIdentityFile(observation(), { subtle }), code("IDENTITY_CRYPTO"));
  });
}

test("native File-style read checks actual byte length", async () => {
  const file = await fileFor();
  assert.equal((await readTokenIdentityFile(file)).observation.agent, "DAT");
  file.size++;
  await assert.rejects(readTokenIdentityFile(file), code("IDENTITY_FILE_SIZE"));
});

for (const name of ["", "backup.txt", "../backup.json", "C:\\backup.json", "bad\0.json", "x".repeat(241) + ".json"]) {
  test("filename rejected before loading: " + JSON.stringify(name), async () => {
    let calls = 0;
    const file = { name, size: 10, arrayBuffer: async () => { calls++; return new ArrayBuffer(10); } };
    await assert.rejects(readTokenIdentityFile(file), code("IDENTITY_FILENAME"));
    assert.equal(calls, 0);
  });
}

for (const size of [0, -1, NaN, Infinity, "10", 1.5, IDENTITY_FILE_LIMIT + 1]) {
  test("file size validated before arrayBuffer: " + String(size), async () => {
    let calls = 0;
    await assert.rejects(readTokenIdentityFile({ name: "file.json", size,
      arrayBuffer: async () => { calls++; return new ArrayBuffer(1); } }), code("IDENTITY_FILE_SIZE"));
    assert.equal(calls, 0);
  });
}

test("file read rejection is normalized", async () => {
  const file = await fileFor(observation(), { arrayBuffer: async () => { throw Error("Disk unavailable"); } });
  await assert.rejects(readTokenIdentityFile(file), code("IDENTITY_FILE_READ"));
});

test("text and numeric sizes do not bypass file limits", () => {
  assert.throws(() => decodeTokenObservation(" ".repeat(IDENTITY_FILE_LIMIT + 1)), code("IDENTITY_FILE_SIZE"));
  assert.throws(() => encodeTokenObservation({ ...clone(observation()), extra: true }), code("IDENTITY_SHAPE"));
});
