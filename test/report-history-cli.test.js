import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { parseHistoryArgs, inspectHistoryPath, runHistoryCheck } from "../scripts/check-report-history.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { historyDocument, historyRecord, sampleHistory, reportInput } from "./helpers/report-history-fixtures.js";

async function temporary(callback) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-history-test-"));
  try { await callback(directory); }
  finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + "threecore-history-test-")) throw Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  }
}
async function save(directory, input = historyDocument([historyRecord()])) {
  const path = join(directory, "history.json");
  await writeFile(path, (await prepareReportHistoryFile(input)).text, "utf8"); return path;
}
function output() {
  let stdout = "", stderr = "";
  return { streams: { stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } },
    get stdout() { return stdout; }, get stderr() { return stderr; } };
}

test("history CLI accepts either option order and uppercase JSON extension", () => {
  assert.deepEqual(parseHistoryArgs(["--json", "HISTORY.JSON", "--require-agreement"]),
    { path: "HISTORY.JSON", json: true, requireAgreement: true });
  assert.deepEqual(parseHistoryArgs(["a.json"]), { path: "a.json", json: false, requireAgreement: false });
});
for (const args of [[], ["--json"], ["file.txt"], ["a.json", "b.json"], ["a.json", "--unknown"],
  ["a.json", "--json", "--json"], ["a.json", "--require-agreement", "--require-agreement"], ["-file.json"], [null]]) {
  test("history CLI rejects ambiguous arguments " + JSON.stringify(args), () => assert.throws(() => parseHistoryArgs(args)));
}
test("CLI validates a real file read-only and returns exact status counts", () => temporary(async directory => {
  const path = await save(directory, sampleHistory()), bytes = await readFile(path);
  const result = await inspectHistoryPath(path);
  assert.equal(result.count, 4); assert.equal(result.archived, 1);
  assert.deepEqual(result.statuses, { "arithmetic-agreement": 2, attention: 1, incomplete: 1 });
  assert.equal(result.allArithmeticAgreement, false);
  assert.equal(result.checksumVerified, true); assert.equal(result.authenticated, false);
  assert.equal(result.liveChainRechecked, false); assert.equal(result.securityAudit, false);
  assert.deepEqual(await readFile(path), bytes);
}));
test("CLI output omits labels, notes, account addresses and amounts", () => temporary(async directory => {
  const row = historyRecord(1, { label: "DO_NOT_PRINT_NAME", note: "DO_NOT_PRINT_NOTE" });
  const path = await save(directory, historyDocument([row])), sink = output();
  assert.equal(await runHistoryCheck([path, "--json"], sink.streams), 0);
  for (const text of [row.label, row.note, row.report.slots[0].entry.draft.plan.context.account, "107000000000000000000"]) {
    assert.equal(sink.stdout.includes(text), false);
  }
  assert.equal(sink.stderr, "");
}));
test("strict CLI accepts all-report agreement", () => temporary(async directory => {
  const path = await save(directory), sink = output();
  assert.equal(await runHistoryCheck([path, "--require-agreement"], sink.streams), 0);
  assert.match(sink.stdout, /Checksum verified/);
}));
for (const kind of ["empty", "incomplete", "archived-incomplete"]) {
  test("strict CLI refuses " + kind + " as complete evidence", () => temporary(async directory => {
    const document = kind === "empty" ? historyDocument() : historyDocument([historyRecord(1, {
      archived: kind === "archived-incomplete", report: reportInput({ counts: [2, 5, 5] }),
    })]);
    const path = await save(directory, document), sink = output();
    assert.equal(await runHistoryCheck([path, "--require-agreement"], sink.streams), 2);
    assert.match(sink.stderr, /^PERIOD_HISTORY_CLI_NO_AGREEMENT/);
    assert.equal(await runHistoryCheck([path], output().streams), 0);
  }));
}
test("CLI rejects corrupt and invalid UTF-8 files with no source contents in errors", () => temporary(async directory => {
  const path = join(directory, "history.json");
  for (const contents of [Buffer.from("private bad JSON"), Buffer.from([255, 255])]) {
    await writeFile(path, contents); const sink = output();
    assert.equal(await runHistoryCheck([path], sink.streams), 1);
    assert.equal(sink.stderr.includes("private bad JSON"), false); assert.equal(sink.stdout, "");
  }
}));
test("CLI rejects missing, empty and directory paths without disclosing paths", () => temporary(async directory => {
  const missing = join(directory, "private-missing.json"), empty = join(directory, "empty.json"), folder = join(directory, "folder.json");
  await writeFile(empty, ""); await mkdir(folder);
  for (const path of [missing, empty, folder]) {
    const sink = output(); assert.equal(await runHistoryCheck([path], sink.streams), 1);
    assert.equal(sink.stderr.includes(directory), false);
  }
}));
test("real CLI process uses correct exit status and machine-readable JSON", () => temporary(async directory => {
  const path = await save(directory), process = spawnSync(globalThis.process.execPath,
    ["scripts/check-report-history.js", path, "--json", "--require-agreement"], { encoding: "utf8" });
  assert.equal(process.status, 0, process.stderr);
  assert.equal(JSON.parse(process.stdout).count, 1);
  assert.equal(process.stderr, "");
}));
