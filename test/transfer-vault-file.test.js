import test from "node:test";
import assert from "node:assert/strict";
import { prepareVaultFile, decodeVaultFile, readVaultFile, readLegacyVaultInput, VAULT_FILE_LIMIT, VAULT_FILE_SCHEMA } from "../src/transfer-vault-file.js";
import { vaultBundle, vaultKey } from "../src/transfer-vault-model.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { fileFromText, code, clone } from "./helpers/transfer-fixtures.js";
import { bundleFor, archiveFor } from "./helpers/vault-fixtures.js";

test("vault JSON round-trip preserves all three accounts, chains and exact amounts", async () => {
  const input = bundleFor(), prepared = await prepareVaultFile(input);
  const result = await decodeVaultFile(prepared.text);
  assert.equal(vaultKey(result.bundle), vaultKey(input));
  assert.equal(prepared.byteLength, new TextEncoder().encode(prepared.text).length);
  assert.equal(prepared.filename, "ThreeCore-transfer-vault.json");
  assert.equal(prepared.authenticated, false);
  assert.equal(result.authenticated, false);
  assert.match(result.digest, /^[a-f0-9]{64}$/);
});

for (const agents of [["DAT"], ["EMA"], ["CAWELON"], ["DAT", "CAWELON"]]) {
  test("vault JSON preserves missing slots " + agents.join(","), async () => {
    const source = bundleFor(agents);
    const result = await readVaultFile(fileFromText((await prepareVaultFile(source)).text));
    assert.deepEqual(result.bundle, source);
  });
}

test("canonical export remains stable despite input key order", async () => {
  const source = bundleFor();
  const reordered = { slots: source.slots, completeHistory: false, readOnly: true, schema: source.schema };
  assert.equal((await prepareVaultFile(source)).text, (await prepareVaultFile(reordered)).text);
});

test("changing a valid raw integer without its checksum is detected", async () => {
  const prepared = await prepareVaultFile(bundleFor());
  const damaged = JSON.parse(prepared.text);
  damaged.bundle.slots[0].archive.records[0].events[0].amountBaseUnits = "2";
  await assert.rejects(decodeVaultFile(JSON.stringify(damaged)), code("TRANSFER_CHECKSUM_MISMATCH"));
});

test("a recomputed checksum is not presented as source authentication", async () => {
  const source = clone(bundleFor());
  source.slots[0].archive.records[0].events[0].amountBaseUnits = "2";
  const result = await decodeVaultFile((await prepareVaultFile(source)).text);
  assert.equal(result.authenticated, false);
  assert.equal(result.bundle.slots[0].archive.records[0].events[0].amountBaseUnits, "2");
});

const modifications = [
  ["wrong schema", value => { value.schema = "threecore.workspace.v1"; }, "TRANSFER_VAULT_FILE_SCHEMA"],
  ["wrong algorithm", value => { value.algorithm = "MD5"; }, "TRANSFER_VAULT_FILE_SCHEMA"],
  ["short digest", value => { value.digest = "abc"; }, "TRANSFER_VAULT_FILE_SCHEMA"],
  ["uppercase digest", value => { value.digest = "F".repeat(64); }, "TRANSFER_VAULT_FILE_SCHEMA"],
  ["wrong digest", value => { value.digest = "0".repeat(64); }, "TRANSFER_CHECKSUM_MISMATCH"],
  ["extra field", value => { value.seed = "never"; }, "TRANSFER_SHAPE"],
  ["missing slot", value => { value.bundle.slots.pop(); }, "TRANSFER_VAULT_SLOTS"],
  ["complete history assertion", value => { value.bundle.completeHistory = true; }, "TRANSFER_VAULT_SCHEMA"],
];
for (const [name, change, expected] of modifications) {
  test("vault file refuses " + name, async () => {
    const prepared = await prepareVaultFile(bundleFor());
    const value = JSON.parse(prepared.text);
    change(value);
    await assert.rejects(decodeVaultFile(JSON.stringify(value)), code(expected));
  });
}

for (const text of ["", " ", "{", "null", "[]", "42", "not json"]) {
  test("vault refuses invalid JSON envelope " + JSON.stringify(text), async () => {
    await assert.rejects(decodeVaultFile(text));
  });
}

test("empty bundles are not exported as if they contained a backup", async () => {
  await assert.rejects(prepareVaultFile(vaultBundle()), code("TRANSFER_VAULT_EMPTY"));
});

for (const subtle of [null, {}, { digest: async () => { throw Error("private details"); } },
  { digest: async () => new Uint8Array(32) }, { digest: async () => new ArrayBuffer(31) }]) {
  test("vault export refuses unavailable or invalid cryptography " + String(subtle), async () => {
    await assert.rejects(prepareVaultFile(bundleFor(), { subtle }), error => /^TRANSFER_CRYPTO_/.test(error.code));
  });
}

for (const name of ["../file.json", "x\\file.json", "file.txt", "x\u0000.json", "a".repeat(181) + ".json", null]) {
  test("vault file name is bounded and local " + String(name), async () => {
    let reads = 0;
    await assert.rejects(readVaultFile({ name, size: 1, arrayBuffer: async () => { reads++; return new ArrayBuffer(1); } }), code("TRANSFER_FILE_NAME"));
    assert.equal(reads, 0);
  });
}

for (const size of [0, -1, 0.5, Infinity, "12", VAULT_FILE_LIMIT + 1]) {
  test("vault advertised size fails before file read " + String(size), async () => {
    let reads = 0;
    await assert.rejects(readVaultFile({ name: "file.json", size, arrayBuffer: async () => { reads++; return new ArrayBuffer(1); } }), code("TRANSFER_VAULT_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}

test("vault checks actual byte length and fatal UTF-8 decoding", async () => {
  await assert.rejects(readVaultFile({ name: "file.json", size: 1, arrayBuffer: async () => new ArrayBuffer(2) }), code("TRANSFER_VAULT_FILE_SIZE"));
  await assert.rejects(readVaultFile({ name: "file.json", size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }), code("TRANSFER_FILE_ENCODING"));
  await assert.rejects(readVaultFile({ name: "file.json", size: 1, arrayBuffer: async () => { throw Error("private path"); } }), code("TRANSFER_FILE_READ"));
});

test("vault UTF-8 byte limit cannot be bypassed with multibyte text", async () => {
  await assert.rejects(decodeVaultFile("あ".repeat(Math.floor(VAULT_FILE_LIMIT / 3) + 1)), code("TRANSFER_VAULT_FILE_SIZE"));
});

test("vault allows uppercase JSON extension and optional UTF-8 BOM", async () => {
  const text = (await prepareVaultFile(bundleFor())).text;
  const result = await readVaultFile(fileFromText("\ufeff" + text, { name: "History.JSON" }));
  assert.deepEqual(result.bundle, bundleFor());
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("legacy single-period compatibility " + agent, async () => {
    const original = archiveFor(agent);
    const text = await encodeTransferFile(original.records[0]);
    assert.deepEqual(await readLegacyVaultInput(fileFromText(text), "snapshot"), original);
  });
  test("legacy period-archive compatibility " + agent, async () => {
    const original = archiveFor(agent);
    const text = (await prepareTransferArchive(original)).text;
    assert.deepEqual(await readLegacyVaultInput(fileFromText(text), "archive"), original);
  });
}

test("legacy parser is explicit rather than guessing by file contents", async () => {
  const file = fileFromText((await prepareVaultFile(bundleFor())).text);
  await assert.rejects(readLegacyVaultInput(file, "automatic"), code("TRANSFER_VAULT_FILE_KIND"));
  await assert.rejects(readLegacyVaultInput(file, "snapshot"));
  await assert.rejects(readLegacyVaultInput(file, "archive"));
});
