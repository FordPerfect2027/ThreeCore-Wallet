import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportHistoryFile, decodeReportHistoryFile, prepareHistoryImportInspectionFile } from "../src/report-history-file.js";
import { selectHistoryEntries } from "../src/report-history-model.js";
import { parseHistorySubsetArgs, runHistorySubsetExport } from "../scripts/export-report-history-subset.js";
import { parseHistoryInspectionArgs, runHistoryImportInspection } from "../scripts/inspect-report-history-import.js";
import { sampleHistory, historyDocument, historyRecord, clone, id } from "./helpers/report-history-fixtures.js";

const root = new URL("../", import.meta.url);
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 20000 });
test("standalone subset exports reproduce annotated selection and filter results without changing source files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "threecore-history-subset-"));
  try {
    const source = sampleHistory(), original = (await prepareReportHistoryFile(source)).text, path = join(directory, "source.json"); await writeFile(path, original);
    for (const [args, entries] of [[["--id", id(104)], [source.entries[3]]], [["--archive", "archived"], [source.entries[3]]], [["--tag", "partial"], [source.entries[2]]]]) {
      const result = run("scripts/export-report-history-subset.js", [path, ...args]); assert.equal(result.status, 0, result.stderr);
      const decoded = await decodeReportHistoryFile(result.stdout); assert.deepEqual(decoded.document.entries, entries); assert.equal(result.stderr, "");
    }
    const empty = run("scripts/export-report-history-subset.js", [path, "--search", "nothing"]); assert.equal(empty.status, 1); assert.equal(empty.stdout, "");
    assert.match(empty.stderr, /PERIOD_HISTORY_EMPTY_SELECTION/); assert.equal(await readFile(path, "utf8"), original);
    const invalid = JSON.parse(original); invalid.document.entries[0].note = "altered"; await writeFile(path, JSON.stringify(invalid));
    const rejected = run("scripts/export-report-history-subset.js", [path, "--id", id(104)]); assert.equal(rejected.status, 1); assert.equal(rejected.stdout, ""); assert.match(rejected.stderr, /PERIOD_CHECKSUM/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("offline import inspection matches shared receipts and selection excludes a conflict without overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "threecore-history-inspection-"));
  try {
    const before = historyDocument([historyRecord(1)]), conflict = clone(historyRecord(1)); conflict.report.title = "Changed evidence";
    const incoming = historyDocument([conflict, historyRecord(2)]), a = join(directory, "before.json"), b = join(directory, "incoming.json");
    const aText = (await prepareReportHistoryFile(before)).text, bText = (await prepareReportHistoryFile(incoming)).text; await writeFile(a, aText); await writeFile(b, bText);
    const blocked = run("scripts/inspect-report-history-import.js", [a, b, "--json"]); assert.equal(blocked.status, 2, blocked.stderr);
    assert.equal(blocked.stdout, (await prepareHistoryImportInspectionFile(before, incoming)).text);
    const selected = selectHistoryEntries(incoming, [id(102)]), allowed = run("scripts/inspect-report-history-import.js", [a, b, "--id", id(102), "--json"]);
    assert.equal(allowed.status, 0, allowed.stderr); assert.equal(allowed.stdout, (await prepareHistoryImportInspectionFile(before, selected)).text);
    assert.equal(JSON.parse(allowed.stdout).incomingCount, 1); assert.equal(JSON.parse(allowed.stdout).automaticallyApplied, false);
    assert.equal(await readFile(a, "utf8"), aText); assert.equal(await readFile(b, "utf8"), bText);
    await writeFile(b, Buffer.from([0xff, 0xfe])); const bad = run("scripts/inspect-report-history-import.js", [a, b, "--json"]);
    assert.equal(bad.status, 1); assert.equal(bad.stdout, ""); assert.ok(!bad.stderr.includes(directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("both offline tools reject ambiguous flags and document their read-only output limits", async () => {
  for (const args of [[], ["source.json"], ["source.json", "--id", id(101), "--archive", "all"], ["source.json", "--archive", "all", "--archive", "active"], ["source.json", "--id", id(101), "--id", id(101)], ["source.json", "--execute", "yes"]]) assert.throws(() => parseHistorySubsetArgs(args));
  for (const args of [[], ["a.json"], ["a.json", "b.json", "--id"], ["a.json", "b.json", "--json", "--json"], ["a.json", "b.json", "--apply"]]) assert.throws(() => parseHistoryInspectionArgs(args));
  for (const tool of [runHistorySubsetExport, runHistoryImportInspection]) {
    let out = "", err = ""; const io = { stdout: { write: text => { out += text; } }, stderr: { write: text => { err += text; } } };
    assert.equal(await tool(["--help"], io), 0); assert.match(out, /No network/); assert.equal(err, "");
    out = ""; assert.equal(await tool(["PRIVATE-missing.json", "--archive", "all"], io), 1); assert.equal(out, ""); assert.ok(!err.includes("PRIVATE-missing"));
  }
});
