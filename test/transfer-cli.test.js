import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inspectTransferFiles, parseTransferCheckOptions, runTransferCheck } from "../scripts/check-transfer-file.js";
import { addTransferArchiveRecord } from "../src/transfer-archive.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { code, snapshot } from "./helpers/transfer-fixtures.js";

async function temporary(run) {
  const root = resolve(tmpdir());
  const directory = await mkdtemp(join(root, "threecore-transfer-check-"));
  try { return await run(directory); }
  finally {
    assert.equal(dirname(resolve(directory)), root);
    assert.ok(directory.startsWith(join(root, "threecore-transfer-check-")));
    await rm(directory, { recursive: true, force: true });
  }
}

test("transfer CLI: argument parser supports snapshot, baseline and archive explicitly", () => {
  assert.deepEqual(parseTransferCheckOptions(["file.json", "--json"]), { file: "file.json", baseline: null, archive: false, json: true });
  assert.deepEqual(parseTransferCheckOptions(["--baseline", "old.json", "new.json"]), { file: "new.json", baseline: "old.json", archive: false, json: false });
  assert.equal(parseTransferCheckOptions(["--archive", "all.json"]).archive, true);
});

for (const args of [[], ["--json"], ["a", "b"], ["a", "--json", "--json"], ["a", "--unknown"],
  ["a", "--baseline"], ["a", "--baseline", "--json"], ["a", "--archive", "--baseline", "b"], [null], "a"]) {
  test("transfer CLI: malformed arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseTransferCheckOptions(args), code("TRANSFER_CLI_ARGUMENTS"));
  });
}

test("transfer CLI: validates downloaded file without modifying it", async () => {
  await temporary(async directory => {
    const file = join(directory, "observed.json");
    const text = await encodeTransferFile(snapshot());
    await writeFile(file, text);
    const result = await inspectTransferFiles(parseTransferCheckOptions([file]));
    assert.equal(result.assessment.events, 1);
    assert.equal(result.checksumVerified, true);
    assert.equal(result.authenticated, false);
    assert.equal(result.walletRequests, 0);
    assert.equal(result.networkRequests, 0);
    assert.equal(result.filesModified, 0);
    assert.equal(await readFile(file, "utf8"), text);
  });
});

test("transfer CLI: offline comparison shows added events", async () => {
  await temporary(async directory => {
    const old = join(directory, "old.json"), next = join(directory, "new.json");
    await writeFile(old, await encodeTransferFile(snapshot({ events: [] })));
    await writeFile(next, await encodeTransferFile(snapshot()));
    const result = await inspectTransferFiles(parseTransferCheckOptions([next, "--baseline", old]));
    assert.equal(result.comparison.added.length, 1);
    assert.match(result.text, /追加 1件/);
  });
});

test("transfer CLI: archive inspection reports requested coverage", async () => {
  await temporary(async directory => {
    const file = join(directory, "archive.json");
    await writeFile(file, (await prepareTransferArchive(addTransferArchiveRecord(null, snapshot()))).text);
    const result = await inspectTransferFiles(parseTransferCheckOptions([file, "--archive"]));
    assert.equal(result.assessment.records, 1);
    assert.equal(result.assessment.requestedBlocks, "13");
    assert.equal(result.assessment.completeHistory, false);
  });
});

test("transfer CLI: JSON report can be parsed without status text mixed in", async () => {
  await temporary(async directory => {
    const file = join(directory, "file.json");
    await writeFile(file, await encodeTransferFile(snapshot()));
    let output = "", errors = "";
    const status = await runTransferCheck([file, "--json"], { write: value => { output += value; } }, { write: value => { errors += value; } });
    assert.equal(status, 0);
    assert.equal(errors, "");
    assert.equal(JSON.parse(output).assessment.events, 1);
  });
});

test("transfer CLI: invalid JSON prints a bounded code, not its contents", async () => {
  await temporary(async directory => {
    const file = join(directory, "bad.json");
    await writeFile(file, "private arbitrary content");
    let output = "", errors = "";
    const status = await runTransferCheck([file], { write: value => { output += value; } }, { write: value => { errors += value; } });
    assert.equal(status, 1);
    assert.equal(output, "");
    assert.match(errors, /TRANSFER_FILE_JSON/);
    assert.ok(!errors.includes("private arbitrary content"));
  });
});

test("transfer CLI: missing files fail without exposing full path", async () => {
  await temporary(async directory => {
    let errors = "";
    const status = await runTransferCheck([join(directory, "missing.json")], { write: () => assert.fail("unexpected output") },
      { write: value => { errors += value; } });
    assert.equal(status, 1);
    assert.ok(!errors.includes(directory));
  });
});

test("transfer CLI: directories and files that exceed limits cannot be inspected", async () => {
  await temporary(async directory => {
    await assert.rejects(inspectTransferFiles({ file: directory, archive: false, baseline: null }));
    const file = join(directory, "large.json");
    await writeFile(file, "x".repeat(524289));
    await assert.rejects(inspectTransferFiles({ file, archive: false, baseline: null }), code("TRANSFER_FILE_SIZE"));
  });
});
