import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectCheckpointCollection, formatCheckpointInspection, parseCheckpointArguments,
  runCheckpointInspection } from "../scripts/check-checkpoint-collection.js";
import { prepareCheckpointCollection } from "../src/checkpoint-transfer.js";
import { preparedDraft, stored } from "./helpers/checkpoint-fixtures.js";
import { ACCOUNTS } from "./helpers/workspace-fixtures.js";

const validWorkspace = await preparedDraft();
async function withFile(content, run, filename = "collection.json") {
  const directory = await mkdtemp(join(tmpdir(), "threecore-checkpoint-test-"));
  const path = join(directory, filename);
  try {
    await writeFile(path, content);
    return await run(path);
  } finally {
    // Only this test's newly-created, resolved temp directory is ever removed.
    const target = resolve(directory);
    assert.equal(target.startsWith(resolve(tmpdir()) + sep), true);
    assert.match(directory, /threecore-checkpoint-test-/);
    await rm(directory, { recursive: true, force: true });
  }
}
async function packed(count = 2) {
  const input = stored(count, validWorkspace.text);
  if (count) {
    input.entries[0].label = "PRIVATE LABEL NOT FOR REPORT";
    input.entries[0].archived = true;
  }
  return (await prepareCheckpointCollection(input)).text;
}

test("offline inspector verifies outer and all inner checksums", async () => {
  await withFile(await packed(3), async path => {
    const report = await inspectCheckpointCollection(path);
    assert.equal(report.checksumVerified, true);
    assert.equal(report.nestedChecksumsVerified, 3);
    assert.equal(report.activeCount, 2);
    assert.equal(report.archivedCount, 1);
    assert.equal(report.snapshots.length, 3);
    for (const snapshot of report.snapshots) {
      assert.equal(snapshot.configuredCards, 3);
      assert.equal(snapshot.historicalObservations, 3);
      assert.deepEqual(snapshot.agents.map(agent => agent.agent), ["DAT", "EMA", "CAWELON"]);
    }
    assert.equal(report.restored, false);
    assert.equal(report.networkAccess, false);
    assert.equal(report.currentBalanceVerified, false);
    assert.equal(report.ownershipVerified, false);
    assert.equal(report.independentSecurityAudit, false);
  });
});

test("inspection leaves original file bytes and modification time unchanged", async () => {
  const text = await packed();
  await withFile(text, async path => {
    const before = await stat(path);
    await inspectCheckpointCollection(path);
    assert.equal(await readFile(path, "utf8"), text);
    assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  });
});

test("routine JSON and readable report omit names, IDs, addresses and balances", async () => {
  await withFile(await packed(), async path => {
    const report = await inspectCheckpointCollection(path);
    const rendered = formatCheckpointInspection(report);
    for (const text of [JSON.stringify(report), rendered]) {
      assert.doesNotMatch(text, /PRIVATE LABEL/);
      assert.doesNotMatch(text, /balanceBaseUnits/);
      assert.doesNotMatch(text, /11111111-2222-4333/);
      for (const account of ACCOUNTS) assert.equal(text.includes(account), false);
    }
    assert.match(rendered, /No restore/);
    assert.match(rendered, /does not prove authenticity/);
  });
});

test("empty collection report is honest about zero verified workspace files", async () => {
  await withFile(await packed(0), async path => {
    const report = await inspectCheckpointCollection(path);
    assert.equal(report.nestedChecksumsVerified, 0);
    assert.equal(report.activeCount + report.archivedCount, 0);
    assert.deepEqual(report.snapshots, []);
  });
});

test("inspection results are immutable", async () => {
  await withFile(await packed(1), async path => {
    const report = await inspectCheckpointCollection(path);
    assert.throws(() => report.snapshots.push({}), TypeError);
    assert.throws(() => { report.snapshots[0].agents[0].chainId = 1; }, TypeError);
  });
});

for (const content of ["", "{bad", "null", "[]", "{}", "not json"]) {
  test("inspector rejects invalid backup content " + JSON.stringify(content), async () => {
    await withFile(content, path => assert.rejects(inspectCheckpointCollection(path)));
  });
}

test("inspector rejects a syntactically valid collection with a damaged checksum", async () => {
  const value = JSON.parse(await packed());
  value.entries[0].archived = false;
  await withFile(JSON.stringify(value), async path => {
    await assert.rejects(inspectCheckpointCollection(path), error => error.code === "CHECKPOINT_TRANSFER_CHECKSUM");
  });
});

test("inspector uses fatal UTF-8 decoding", async () => {
  await withFile(new Uint8Array([0xff, 0xfe]), path => assert.rejects(inspectCheckpointCollection(path)));
});

test("inspector rejects non-JSON extensions before opening", async () => {
  await withFile(await packed(), path => assert.rejects(inspectCheckpointCollection(path)), "backup.txt");
});

test("inspector accepts upper-case JSON extension", async () => {
  await withFile(await packed(), async path => {
    assert.equal((await inspectCheckpointCollection(path)).checksumVerified, true);
  }, "backup.JSON");
});

test("inspector rejects a directory named as a JSON file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "threecore-checkpoint-test-"));
  const child = join(directory, "folder.json");
  try {
    await mkdir(child);
    await assert.rejects(inspectCheckpointCollection(child));
  } finally {
    assert.match(directory, /threecore-checkpoint-test-/);
    await rm(directory, { recursive: true, force: true });
  }
});

test("argument parser accepts a spaced path without splitting it", () => {
  assert.deepEqual(parseCheckpointArguments(["--file", "folder with spaces/backup.json", "--json"]),
    { filename: "folder with spaces/backup.json", json: true });
});

for (const args of [[], ["--file"], ["--file", ""], ["--file", "--json"], ["file.json"],
  ["--file", "file.json", "--write"], ["--file", "file.json", "--json", "extra"], [null]]) {
  test("CLI rejects ambiguous arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseCheckpointArguments(args));
  });
}

test("help performs no file read and reports the read-only workflow", async () => {
  const output = [], errors = [];
  assert.equal(await runCheckpointInspection(["--help"], {
    output: text => output.push(text), error: text => errors.push(text),
  }), 0);
  assert.match(output.join("\n"), /Read-only/);
  assert.deepEqual(errors, []);
});

test("CLI JSON mode prints one machine-readable successful report", async () => {
  await withFile(await packed(), async path => {
    const output = [], errors = [];
    assert.equal(await runCheckpointInspection(["--file", path, "--json"], {
      output: text => output.push(text), error: text => errors.push(text),
    }), 0);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]).snapshots.length, 2);
    assert.equal(errors.length, 0);
  });
});

test("CLI error output does not reveal filesystem paths or file contents", async () => {
  const output = [], errors = [];
  assert.equal(await runCheckpointInspection(["--file", "private-owner-identifier/absent.json"], {
    output: text => output.push(text), error: text => errors.push(text),
  }), 1);
  assert.deepEqual(output, []);
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0], /private-owner-identifier/);
});

test("standalone command returns success and failure exit codes", async () => {
  await withFile(await packed(1), async path => {
    const success = spawnSync(process.execPath, ["scripts/check-checkpoint-collection.js", "--file", path, "--json"],
      { cwd: resolve("."), encoding: "utf8", windowsHide: true });
    assert.equal(success.status, 0);
    assert.equal(JSON.parse(success.stdout).nestedChecksumsVerified, 1);
    await writeFile(path, "{}");
    const failure = spawnSync(process.execPath, ["scripts/check-checkpoint-collection.js", "--file", path],
      { cwd: resolve("."), encoding: "utf8", windowsHide: true });
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /inspection failed/);
    assert.equal(failure.stdout, "");
  });
});

