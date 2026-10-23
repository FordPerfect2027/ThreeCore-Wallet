import test from "node:test";
import assert from "node:assert/strict";
import { TRANSFER_FILE_LIMIT, decodeTransferFile, encodeTransferFile, prepareTransferDownload, readTransferFile } from "../src/transfer-file.js";
import { validateTransferSnapshot } from "../src/transfer-codec.js";
import { code, context, event, fileFromText, snapshot } from "./helpers/transfer-fixtures.js";

test("transfer file: JSON export and import preserve exact records", async () => {
  const input = snapshot();
  const text = await encodeTransferFile(input);
  const result = await decodeTransferFile(text);
  assert.deepEqual(result.snapshot, validateTransferSnapshot(input));
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.authenticated, false);
});

test("transfer file: formatting does not alter canonical checksum", async () => {
  const text = await encodeTransferFile(snapshot());
  const compact = JSON.stringify(JSON.parse(text));
  assert.deepEqual(await decodeTransferFile(text), await decodeTransferFile(compact));
});

test("transfer file: valid shape with changed amount fails original checksum", async () => {
  const raw = JSON.parse(await encodeTransferFile(snapshot()));
  raw.payload.events[0].amountBaseUnits = "1";
  await assert.rejects(decodeTransferFile(JSON.stringify(raw)), code("TRANSFER_CHECKSUM_MISMATCH"));
});

test("transfer file: corrupted digest fails even when payload is unchanged", async () => {
  const raw = JSON.parse(await encodeTransferFile(snapshot()));
  raw.digest = "0".repeat(64);
  await assert.rejects(decodeTransferFile(JSON.stringify(raw)), code("TRANSFER_CHECKSUM_MISMATCH"));
});

test("transfer file: checksum is not an authenticity claim", async () => {
  const invented = snapshot({ events: [event({ amountBaseUnits: "999" })] });
  const result = await decodeTransferFile(await encodeTransferFile(invented));
  assert.equal(result.authenticated, false);
  assert.equal(result.snapshot.independentVerification, false);
});

for (const patch of [{ schema: "unknown" }, { algorithm: "MD5" }, { digest: "xyz" }, { digest: 123 }]) {
  test("transfer file: rejects incompatible envelope " + JSON.stringify(patch), async () => {
    const raw = { ...JSON.parse(await encodeTransferFile(snapshot())), ...patch };
    await assert.rejects(decodeTransferFile(JSON.stringify(raw)), code("TRANSFER_FILE_SCHEMA"));
  });
}

test("transfer file: unknown envelope keys are rejected", async () => {
  const raw = JSON.parse(await encodeTransferFile(snapshot()));
  raw.instructions = "connect a wallet";
  await assert.rejects(decodeTransferFile(JSON.stringify(raw)), code("TRANSFER_SHAPE"));
});

for (const text of ["", " ".repeat(TRANSFER_FILE_LIMIT + 1), null, 123]) {
  test("transfer file: bounded text " + String(text).slice(0, 10), async () => {
    await assert.rejects(decodeTransferFile(text), code("TRANSFER_FILE_SIZE"));
  });
}

test("transfer file: byte limit applies to non-ASCII data too", async () => {
  await assert.rejects(decodeTransferFile("界".repeat(180000)), code("TRANSFER_FILE_SIZE"));
});

test("transfer file: maximum normal snapshot fits the documented cap", async () => {
  const text = await encodeTransferFile(snapshot({ events: Array.from({ length: 500 }, (_, index) => event({}, index)) }));
  assert.ok(new TextEncoder().encode(text).length < TRANSFER_FILE_LIMIT);
  assert.equal((await decodeTransferFile(text)).snapshot.events.length, 500);
});

test("transfer file: validates File bytes rather than trusting declared size", async () => {
  const text = await encodeTransferFile(snapshot());
  const file = fileFromText(text, { size: 1 });
  await assert.rejects(readTransferFile(file), code("TRANSFER_FILE_SIZE"));
});

test("transfer file: invalid UTF-8 cannot be silently replaced", async () => {
  const bytes = new Uint8Array([0xc3, 0x28]);
  await assert.rejects(readTransferFile({ name: "broken.json", size: 2, arrayBuffer: async () => bytes.buffer }),
    code("TRANSFER_FILE_ENCODING"));
});

test("transfer file: file read failure has a local error code", async () => {
  await assert.rejects(readTransferFile({ name: "broken.json", size: 1, arrayBuffer: async () => { throw Error("disk error"); } }),
    code("TRANSFER_FILE_READ"));
});

for (const name of ["file.csv", "../file.json", "C:\\file.json", "file\n.json", "x".repeat(181) + ".json"]) {
  test("transfer file: rejects unsafe filename " + name.slice(0, 18), async () => {
    await assert.rejects(readTransferFile(fileFromText("{}", { name })), code("TRANSFER_FILE_NAME"));
  });
}

test("transfer file: SHA-256 unavailable or failed never downgrades to unchecked import", async () => {
  await assert.rejects(encodeTransferFile(snapshot(), { subtle: null }), code("TRANSFER_CRYPTO_UNAVAILABLE"));
  await assert.rejects(encodeTransferFile(snapshot(), { subtle: { digest: async () => { throw Error(); } } }), code("TRANSFER_CRYPTO_FAILED"));
  await assert.rejects(encodeTransferFile(snapshot(), { subtle: { digest: async () => new ArrayBuffer(16) } }), code("TRANSFER_CRYPTO_FAILED"));
});

test("transfer file: prepared JSON has deterministic context-scoped name", async () => {
  const result = await prepareTransferDownload(snapshot());
  assert.equal(result.filename, "ThreeCore-DAT-8453-11111111-transfers-30-42.json");
  assert.equal(result.byteLength, new TextEncoder().encode(result.text).length);
  assert.equal(result.mimeType, "application/json;charset=utf-8");
  assert.equal((await readTransferFile(fileFromText(result.text))).snapshot.context.agent, "DAT");
});

test("transfer file: CSV and text exports do not require crypto or provider", async () => {
  const csv = await prepareTransferDownload(snapshot(), "csv", { subtle: null });
  const text = await prepareTransferDownload(snapshot(), "txt", { subtle: null });
  assert.match(csv.filename, /\.csv$/);
  assert.match(csv.text, /amount_base_units/);
  assert.match(text.text, /現在のチェーン状態は未確認/);
  assert.equal(text.authenticated, false);
});

test("transfer file: unknown export type cannot choose a path or executable suffix", async () => {
  await assert.rejects(prepareTransferDownload(snapshot(), "html"), code("TRANSFER_FILE_KIND"));
  await assert.rejects(prepareTransferDownload(snapshot(), "../x"), code("TRANSFER_FILE_KIND"));
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    test(`transfer file: round-trip ${agent} ${chainId}`, async () => {
      const input = snapshot({}, context(agent, chainId));
      const result = await readTransferFile(fileFromText(await encodeTransferFile(input)));
      assert.equal(result.snapshot.context.agent, agent);
      assert.equal(result.snapshot.context.chainId, chainId);
    });
  }
}
