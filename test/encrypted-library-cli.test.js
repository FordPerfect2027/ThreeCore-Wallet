import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectEncryptedLibraryFile } from "../scripts/check-encrypted-library.js";
import { prepareEncryptedArchive, ENCRYPTED_ARCHIVE_LIMIT } from "../src/encrypted-library-archive.js";
import { library } from "./helpers/encrypted-library-fixtures.js";

const exec = promisify(execFile);
async function fixture(t) {
  const root = resolve(tmpdir());
  const directory = await mkdtemp(join(root, "threecore-library-cli-"));
  t.after(async () => {
    if (!resolve(directory).startsWith(root + sep)) throw Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, file: join(directory, "archive.json") };
}

test("offline check validates archive without changing its bytes", async t => {
  const f = await fixture(t), prepared = await prepareEncryptedArchive(await library([1,2]));
  await writeFile(f.file, prepared.text);
  const result = await inspectEncryptedLibraryFile(f.file);
  assert.equal(result.ok, true);
  assert.equal(result.encryptedFiles, 2);
  assert.equal(result.passwordChecked, false);
  assert.equal(result.workspaceDecrypted, false);
  assert.equal(result.imported, false);
  assert.equal(await readFile(f.file, "utf8"), prepared.text);
  assert(!JSON.stringify(result).includes('"ciphertext":'));
  assert(!JSON.stringify(result).includes(f.file));
});

for (const [name, bytes] of [
  ["empty", ""], ["plaintext", "private account details"], ["bad-json", "{"],
  ["invalid-utf8", new Uint8Array([0xff, 0xfe, 0x7b])],
]) {
  test("offline check refuses " + name + " without echoing data", async t => {
    const f = await fixture(t);
    await writeFile(f.file, bytes);
    const result = await inspectEncryptedLibraryFile(f.file);
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result).sort(), ["code", "ok"]);
    assert(!JSON.stringify(result).includes("private"));
  });
}

test("offline check refuses a directory and a missing file safely", async t => {
  const f = await fixture(t);
  assert.equal((await inspectEncryptedLibraryFile(f.directory)).ok, false);
  const result = await inspectEncryptedLibraryFile(f.file);
  assert.equal(result.ok, false);
  assert(!JSON.stringify(result).includes(f.file));
});

test("oversized file is rejected before content is read", async t => {
  const f = await fixture(t);
  await writeFile(f.file, "");
  await truncate(f.file, ENCRYPTED_ARCHIVE_LIMIT + 1);
  assert.deepEqual(await inspectEncryptedLibraryFile(f.file), { ok: false, code: "LIBRARY_FORMAT" });
});

test("command prints a bounded summary and successful exit status", async t => {
  const f = await fixture(t);
  await writeFile(f.file, (await prepareEncryptedArchive(await library([1]))).text);
  const result = await exec(process.execPath, ["scripts/check-encrypted-library.js", f.file]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.encryptedFiles, 1);
  assert.equal(result.stderr, "");
});

test("command failure uses nonzero exit without revealing private content or file path", async t => {
  const f = await fixture(t);
  await writeFile(f.file, "PRIVATE INPUT");
  try {
    await exec(process.execPath, ["scripts/check-encrypted-library.js", f.file]);
    assert.fail("expected nonzero status");
  } catch (error) {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).ok, false);
    assert(!error.stdout.includes("PRIVATE INPUT"));
    assert(!error.stdout.includes(f.file));
    assert.equal(error.stderr, "");
  }
});

for (const args of [[], ["--password=secret"], ["one", "two"]]) {
  test("command usage rejects unsupported argument forms " + args.length, async () => {
    try {
      await exec(process.execPath, ["scripts/check-encrypted-library.js", ...args]);
      assert.fail("expected usage error");
    } catch (error) {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /^Usage:/);
      assert(!error.stderr.includes("secret"));
      assert.equal(error.stdout, "");
    }
  });
}
