import test from "node:test";
import assert from "node:assert/strict";
import { readAllowanceFile, prepareAllowanceFile, ALLOWANCE_FILE_LIMIT } from "../src/allowance-file.js";
import { readAllowanceBundle, prepareAllowanceBundle, captureAllowanceBundle, ALLOWANCE_BUNDLE_LIMIT } from "../src/allowance-bundle.js";
import { readTokenIdentityFile, prepareTokenIdentityFile, IDENTITY_FILE_LIMIT } from "../src/token-identity-report.js";
import { readTransferArchive, prepareTransferArchive, TRANSFER_ARCHIVE_FILE_LIMIT } from "../src/transfer-archive-file.js";
import { readVaultCollection, prepareVaultCollection, VAULT_COLLECTION_LIMIT } from "../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { record } from "./helpers/allowance-fixtures.js";
import { observation } from "./helpers/identity-fixtures.js";
import { archiveFor, saveOperation } from "./helpers/vault-fixtures.js";
import { bytes, tick, streamFile, stalledFile } from "./helpers/file-boundary-fixtures.js";
import { walletFileReadService } from "../src/file-read-service.js";

const agents = ["DAT", "EMA", "CAWELON"];
const cases = [
  { name: "allowance", read: readAllowanceFile, limit: ALLOWANCE_FILE_LIMIT,
    size: "ALLOWANCE_FILE_SIZE", readCode: "ALLOWANCE_FILE_READ", encoding: "ALLOWANCE_FILE_ENCODING",
    prepare: agent => prepareAllowanceFile("observation", record({}, agent)) },
  { name: "allowance bundle", read: readAllowanceBundle, limit: ALLOWANCE_BUNDLE_LIMIT,
    size: "ALLOWANCE_FILE_SIZE", readCode: "ALLOWANCE_FILE_READ", encoding: "ALLOWANCE_FILE_ENCODING",
    prepare: () => prepareAllowanceBundle(captureAllowanceBundle(agents.map(agent => record({}, agent)))) },
  { name: "identity", read: readTokenIdentityFile, limit: IDENTITY_FILE_LIMIT,
    size: "IDENTITY_FILE_SIZE", readCode: "IDENTITY_FILE_READ", encoding: "IDENTITY_FILE_ENCODING",
    prepare: agent => prepareTokenIdentityFile(observation({}, agent)) },
  { name: "transfer archive", read: readTransferArchive, limit: TRANSFER_ARCHIVE_FILE_LIMIT,
    size: "TRANSFER_ARCHIVE_FILE_SIZE", readCode: "TRANSFER_FILE_READ", encoding: "TRANSFER_FILE_ENCODING",
    prepare: agent => prepareTransferArchive(archiveFor(agent)) },
  { name: "vault collection", read: readVaultCollection, limit: VAULT_COLLECTION_LIMIT,
    size: "TRANSFER_VAULT_COLLECTION_SIZE", readCode: "TRANSFER_FILE_READ", encoding: "TRANSFER_FILE_ENCODING",
    prepare: () => prepareVaultCollection(mutateVaultDocument(emptyVaultDocument(), 0, saveOperation())) },
];

for (const format of cases) {
  for (const agent of agents) {
    test(`file format: native File and legacy adapter agree ${format.name}/${agent}`, async () => {
      const prepared = await format.prepare(agent);
      const data = bytes(prepared.text);
      const legacy = { name: prepared.filename, size: data.length, arrayBuffer: async () => data.buffer };
      const expected = await format.read(legacy);
      const native = await format.read(new File([prepared.text], prepared.filename));
      assert.deepEqual(native, expected);
      assert.equal(native.authenticated, false);
      assert.equal(native.digest, prepared.digest);
      assert.equal(walletFileReadService.state().active, 0);
    });

    test(`file format: stream-only adapter preserves evidence ${format.name}/${agent}`, async () => {
      const prepared = await format.prepare(agent);
      const data = bytes(prepared.text);
      const pieces = [];
      for (let i = 0; i < data.length; i += 31) pieces.push(data.slice(i, i + 31));
      const input = streamFile(pieces, { name: prepared.filename });
      Object.defineProperty(input.file, "arrayBuffer", { get() { throw Error("fallback evaluated"); } });
      const result = await format.read(input.file);
      assert.equal(result.digest, prepared.digest);
      assert.equal(result.authenticated, false);
      assert.equal(input.calls.cancel, 0);
      assert.equal(input.calls.release, 1);
    });
  }

  test("file format: caller deadline passed through " + format.name, async () => {
    const input = stalledFile({ stream: false });
    const pending = format.read(input.file, { timeoutMs: 5 });
    await assert.rejects(pending, { code: format.readCode });
    assert.equal(walletFileReadService.state().retained, 1);
    input.settle(); await tick();
    assert.equal(walletFileReadService.state().active, 0);
  });

  test("file format: AbortSignal passed through " + format.name, async () => {
    const input = stalledFile();
    const abort = new AbortController();
    const pending = format.read(input.file, { signal: abort.signal });
    await tick(); abort.abort();
    await assert.rejects(pending, { code: format.readCode });
    assert.equal(input.calls.cancel, 1);
    assert.equal(input.calls.release, 1);
    assert.equal(walletFileReadService.state().retained, 1);
    input.settle(); await tick();
  });

  test("file format: oversize declaration cannot reach crypto " + format.name, async () => {
    let reads = 0, hashes = 0;
    const file = { name: "synthetic.json", size: format.limit + 1,
      arrayBuffer() { reads++; return new ArrayBuffer(1); } };
    await assert.rejects(format.read(file, { subtle: { digest() { hashes++; } } }), { code: format.size });
    assert.equal(reads, 0);
    assert.equal(hashes, 0);
  });

  test("file format: truncated bytes cannot reach crypto " + format.name, async () => {
    let hashes = 0;
    const input = streamFile([bytes("{")], { size: 2 });
    await assert.rejects(format.read(input.file, { subtle: { digest() { hashes++; } } }), { code: format.size });
    assert.equal(hashes, 0);
    assert.equal(input.calls.cancel, 1);
  });

  test("file format: malformed encoding keeps existing vocabulary " + format.name, async () => {
    let hashes = 0;
    const input = streamFile([Uint8Array.of(0xc3), Uint8Array.of(0x28)]);
    await assert.rejects(format.read(input.file, { subtle: { digest() { hashes++; } } }), { code: format.encoding });
    assert.equal(hashes, 0);
  });

  test("file format: late failure cannot release another import " + format.name, async () => {
    const input = stalledFile({ stream: false });
    const abort = new AbortController();
    const pending = format.read(input.file, { signal: abort.signal });
    await tick(); abort.abort();
    await assert.rejects(pending, { code: format.readCode });
    input.gate.reject(Error("private late failure")); await tick();
    assert.equal(walletFileReadService.state().active, 0);
    const prepared = await format.prepare("DAT");
    assert.equal((await format.read(new File([prepared.text], prepared.filename))).digest, prepared.digest);
  });

  test("file format: prior bytes and file object remain unchanged " + format.name, async () => {
    const prepared = await format.prepare("DAT");
    const source = bytes(prepared.text);
    const before = source.slice();
    const input = Object.freeze({ name: prepared.filename, size: source.length, arrayBuffer: async () => source.buffer });
    await format.read(input);
    assert.deepEqual(source, before);
    assert.equal(Object.keys(input).length, 3);
  });
}

test("file format: four different formats share a single admission limit", async () => {
  const inputs = cases.slice(0, 4).map(() => stalledFile({ stream: false }));
  const pending = inputs.map((input, i) => cases[i].read(input.file).catch(error => error.code));
  await tick();
  let reads = 0;
  await assert.rejects(readVaultCollection({ name: "collection.json", size: 2,
    arrayBuffer() { reads++; return bytes("{}").buffer; } }), { code: "TRANSFER_FILE_READ" });
  assert.equal(reads, 0);
  assert.equal(walletFileReadService.state().active, 4);
  walletFileReadService.cancelAll();
  assert.deepEqual(await Promise.all(pending), cases.slice(0, 4).map(item => item.readCode));
  inputs.forEach(input => input.settle()); await tick();
  assert.equal(walletFileReadService.state().active, 0);
});
