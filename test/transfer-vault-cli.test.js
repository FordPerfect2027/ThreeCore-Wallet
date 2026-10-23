import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { runVaultCheck, readBoundedVaultPath, parseVaultArgs } from "../scripts/check-transfer-vault.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { prepareVaultCollection } from "../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { bundleFor, saveOperation } from "./helpers/vault-fixtures.js";

async function local(run) {
  const root = resolve(tmpdir()), path = await mkdtemp(join(root, "threecore-vault-cli-"));
  try { await run(path); }
  finally {
    const verified = resolve(path);
    assert.ok(verified.startsWith(root + sep) && verified !== root);
    await rm(verified, { recursive: true, force: true });
  }
}
function sinks() {
  const result = { out: "", err: "" };
  return { result, stdout: { write: text => { result.out += text; } }, stderr: { write: text => { result.err += text; } } };
}

test("offline vault inspection returns exact token summaries and leaves file unchanged", async () => local(async root => {
  const path = join(root, "vault.json"), text = (await prepareVaultFile(bundleFor())).text;
  await writeFile(path, text);
  const before = await stat(path), output = sinks();
  assert.equal(await runVaultCheck([path, "--json"], output), 0);
  const parsed = JSON.parse(output.result.out);
  assert.equal(parsed.tokens.length, 3);
  assert.equal(parsed.checksumVerified, true);
  assert.equal(parsed.authenticated, false);
  assert.equal(parsed.tokens[0].receivedBaseUnits, "1000000000000000001");
  assert.equal(await readFile(path, "utf8"), text);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readdir(root), ["vault.json"]);
}));

test("offline collection inspection shows saved metadata without importing it", async () => local(async root => {
  const document = mutateVaultDocument(emptyVaultDocument(), 0, saveOperation());
  const path = join(root, "all.json");
  await writeFile(path, (await prepareVaultCollection(document)).text);
  const output = sinks();
  assert.equal(await runVaultCheck([path, "--collection", "--json"], output), 0);
  const parsed = JSON.parse(output.result.out);
  assert.equal(parsed.kind, "saved-collection");
  assert.equal(parsed.metadata.count, 1);
  assert.equal(parsed.metadata.revision, 0);
  assert.equal(parsed.records[0].tokens.length, 3);
}));

for (const options of [[], ["x.txt"], ["a.json", "b.json"], ["--send"], ["a.json", "--json", "--json"], ["--collection"], [null]]) {
  test("offline checker rejects ambiguous arguments " + JSON.stringify(options), async () => {
    const output = sinks();
    assert.equal(await runVaultCheck(options, output), 1);
    assert.match(output.result.err, /^VAULT_CLI_ARGUMENTS/);
    assert.equal(output.result.out, "");
  });
}

test("offline read cap and UTF-8 validation are enforced before decoding", async () => local(async root => {
  const path = join(root, "data.json");
  await writeFile(path, "a".repeat(11));
  await assert.rejects(readBoundedVaultPath(path, 10), /VAULT_CLI_FILE_SIZE/);
  await writeFile(path, new Uint8Array([255]));
  await assert.rejects(readBoundedVaultPath(path, 10));
  await assert.rejects(readBoundedVaultPath(root, 10), /VAULT_CLI_FILE_SIZE/);
}));

test("offline checker errors do not echo private paths or OS diagnostics", async () => {
  const output = sinks();
  assert.equal(await runVaultCheck([join(tmpdir(), "private-missing-vault-file.json")], output), 1);
  assert.match(output.result.err, /^VAULT_CLI_READ_FAILED/);
  assert.equal(output.result.err.includes("private-missing"), false);
});

test("offline checker reports corrupt checksum and cannot reinterpret collection as bundle", async () => local(async root => {
  const file = JSON.parse((await prepareVaultFile(bundleFor())).text);
  file.digest = "0".repeat(64);
  const path = join(root, "data.json");
  await writeFile(path, JSON.stringify(file));
  let output = sinks();
  assert.equal(await runVaultCheck([path], output), 1);
  assert.match(output.result.err, /^TRANSFER_CHECKSUM_MISMATCH/);
  await writeFile(path, (await prepareVaultCollection(mutateVaultDocument(emptyVaultDocument(), 0, saveOperation()))).text);
  output = sinks();
  assert.equal(await runVaultCheck([path], output), 1);
  assert.match(output.result.err, /^TRANSFER_/);
}));

test("offline text output includes limitations, not balance or safety claims", async () => local(async root => {
  const path = join(root, "data.json");
  await writeFile(path, (await prepareVaultFile(bundleFor())).text);
  const output = sinks();
  assert.equal(await runVaultCheck([path], output), 0);
  assert.match(output.result.out, /残高・損益・完全な取引履歴ではありません/);
  assert.match(output.result.out, /live chain state are unverified/);
}));
