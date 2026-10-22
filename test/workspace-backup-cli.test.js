import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectWorkspaceBackup, formatBackupCheck, parseBackupArguments, runBackupCheck } from "../scripts/check-workspace-backup.js";
import { prepareWorkspaceFile } from "../src/workspace-file.js";
import { workspaceFromDraft } from "../src/workspace-format.js";
import { draft, ACCOUNTS, CONTRACTS } from "./helpers/workspace-fixtures.js";

async function fixture(run, value) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-backup-check-"));
  const filename = join(directory, "saved workspace.json");
  const prepared = await prepareWorkspaceFile(workspaceFromDraft(draft()));
  await writeFile(filename, value ?? prepared.text, "utf8");
  try {
    await run({ directory, filename, prepared });
  } finally {
    // Only this newly created temporary fixture directory is removed.
    await rm(directory, { recursive: true, force: true });
  }
}

test("offline backup check reads an actual file and leaves its bytes unchanged", async () => {
  await fixture(async ({ filename, prepared }) => {
    const before = await readFile(filename);
    const report = await inspectWorkspaceBackup(filename);
    assert.equal(report.byteLength, before.length);
    assert.equal(report.digest, prepared.digest);
    assert.equal(report.totalObservations, 3);
    assert.equal(report.configuredCards, 3);
    assert.equal(report.checksumVerified, true);
    assert.deepEqual(await readFile(filename), before);
  });
});

test("routine check reports omit wallet addresses and balances", async () => {
  await fixture(async ({ filename }) => {
    const report = await inspectWorkspaceBackup(filename);
    const text = formatBackupCheck(report) + JSON.stringify(report);
    for (const address of [...ACCOUNTS, ...CONTRACTS]) assert.ok(!text.includes(address));
    assert.equal(report.restored, false);
    assert.equal(report.currentBalanceVerified, false);
    assert.equal(report.ownershipVerified, false);
    assert.equal(report.independentSecurityAudit, false);
  });
});

test("CLI produces a parseable JSON result on explicit request", async () => {
  await fixture(async ({ filename }) => {
    const output = [];
    const errors = [];
    const code = await runBackupCheck(["--file", filename, "--json"], {
      output: value => output.push(value), error: value => errors.push(value),
    });
    assert.equal(code, 0);
    assert.equal(errors.length, 0);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]).schema, "threecore-backup-check-v1");
  });
});

test("CLI defaults to a readable report", async () => {
  await fixture(async ({ filename }) => {
    const output = [];
    const code = await runBackupCheck(["--file", filename], { output: value => output.push(value) });
    assert.equal(code, 0);
    for (const agent of ["DAT", "EMA", "CAWELON"]) assert.ok(output[0].includes(agent + ": chain"));
    assert.match(output[0], /No restoration or network access/);
  });
});

test("missing file produces a nonzero result without exposing its path", async () => {
  const messages = [];
  const code = await runBackupCheck(["--file", "private-directory/never-created.json"], {
    output: () => assert.fail("No successful output expected"), error: value => messages.push(value),
  });
  assert.equal(code, 1);
  assert.equal(messages.length, 1);
  assert.ok(!messages[0].includes("private-directory"));
});

test("checksum mismatch produces a failing exit status", async () => {
  await fixture(async ({ filename, prepared }) => {
    const corrupt = JSON.parse(prepared.text);
    corrupt.digest = "f".repeat(64);
    await writeFile(filename, JSON.stringify(corrupt));
    const messages = [];
    assert.equal(await runBackupCheck(["--file", filename], { error: value => messages.push(value) }), 1);
    assert.match(messages[0], /WORKSPACE_CHECKSUM/);
  });
});

test("empty backup is rejected", async () => {
  await fixture(async ({ filename }) => {
    await assert.rejects(inspectWorkspaceBackup(filename), /empty/);
  }, "");
});

test("invalid UTF-8 backup is rejected", async () => {
  await fixture(async ({ filename }) => {
    await writeFile(filename, Uint8Array.of(0xff, 0xfe, 0x81));
    await assert.rejects(inspectWorkspaceBackup(filename), { code: "WORKSPACE_FILE_ENCODING" });
  });
});

test("a directory ending in json is not treated as a backup", async () => {
  await fixture(async ({ directory }) => {
    const target = join(directory, "folder.json");
    await mkdir(target);
    await assert.rejects(inspectWorkspaceBackup(target));
  });
});

for (const filename of ["", "backup.txt", "backup.json.exe", "bad\0.json", null]) {
  test("offline checker validates explicit filename " + JSON.stringify(filename), async () => {
    await assert.rejects(inspectWorkspaceBackup(filename), /Choose one/);
  });
}

for (const args of [[], ["--json"], ["--file"], ["--file", "--json"],
  ["--file", "backup.json", "--restore"], ["--file", "a.json", "--json", "--extra"]]) {
  test("backup CLI rejects ambiguous arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseBackupArguments(args), /Usage/);
  });
}

test("help performs no file read", async () => {
  const messages = [];
  assert.deepEqual(parseBackupArguments(["--help"]), { help: true });
  assert.equal(await runBackupCheck(["--help"], { output: value => messages.push(value) }), 0);
  assert.equal(messages.length, 2);
});

test("returned check summary is detached and immutable", async () => {
  await fixture(async ({ filename }) => {
    const report = await inspectWorkspaceBackup(filename);
    assert.ok(Object.isFrozen(report));
    assert.ok(Object.isFrozen(report.cards));
    assert.ok(Object.isFrozen(report.cards[0]));
  });
});
