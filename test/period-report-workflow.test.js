import test from "node:test";
import assert from "node:assert/strict";
import { collectPeriod } from "../src/period-reader.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "../src/period-report-file.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import { createPeriodReportInput } from "../src/period-report-model.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { comparePeriodReports } from "../src/period-report-comparison.js";
import { queryPeriodReportEvents } from "../src/period-report-query.js";
import { periodReportCSV, periodReportHTML } from "../src/period-report-export.js";
import { periodSession } from "./helpers/period-fixtures.js";
import { AGENTS, ACCOUNTS, entry, library, selection, context, plan, checkpoint,
  LATER, TIME, reportInput, memoryStorage, fileFrom, id, clone } from "./helpers/period-report-fixtures.js";

async function collectedLibrary(chainId) {
  const entries = [], sessions = [];
  for (let index = 0; index < AGENTS.length; index++) {
    const agent = AGENTS[index], selected = plan({}, context(agent, chainId, ACCOUNTS[index]));
    const fixture = periodSession(selected); sessions.push(fixture);
    const draft = await collectPeriod(fixture.session, selected);
    entries.push(entry(index + 1, { label: agent + " collected", draft }));
  }
  return { source: library(entries, 3), sessions };
}

for (const chainId of [8453, 84532]) {
  test("acquisition to library to report to restored JSON on chain " + chainId, async () => {
    const { source, sessions } = await collectedLibrary(chainId);
    const libraryFile = await preparePeriodLibraryFile(source);
    const recovered = (await decodePeriodLibraryFile(libraryFile.text)).document;
    const input = createPeriodReportInput(recovered, selection(), "Collected report", LATER);
    const report = analyzePeriodReport(input);
    assert.equal(report.status, "arithmetic-agreement");
    assert.equal(report.selectedCount, 3);
    assert.equal(report.chainId, chainId);
    assert.equal(report.eventCount, 6);
    const reportFile = await preparePeriodReportFile(input);
    const restored = await decodePeriodReportFile(reportFile.text);
    assert.deepEqual(analyzePeriodReport(restored.input), report);
    for (const session of sessions) {
      assert.ok(session.calls.some(row => row[0] === "logs"));
      assert.ok(session.calls.every(row => ["block", "code", "metadata", "native", "balance", "logs"].includes(row[0])));
    }
    const callsBefore = sessions.map(session => session.calls.length);
    periodReportCSV(restored.input); periodReportHTML(restored.input);
    for (const agent of AGENTS) queryPeriodReportEvents(restored.input, { agent, direction: "all", search: "", page: 0 });
    assert.deepEqual(sessions.map(session => session.calls.length), callsBefore);
  });
}

test("actual collected evidence can be read through the controller without touching its provider", async () => {
  const { source, sessions } = await collectedLibrary(84532);
  const calls = sessions.map(value => value.calls.length), store = memoryStorage(source);
  const controller = createPeriodReportController({ storage: store.storage, now: () => LATER });
  await controller.refresh();
  for (const [agent, value] of Object.entries(selection())) controller.select(agent, value);
  controller.prepare("End-to-end"); await controller.applyReview();
  const files = [];
  for (const format of ["json", "csv", "html"]) await controller.exportFile(format, true, file => files.push(file));
  assert.equal(files.length, 3);
  assert.deepEqual(sessions.map(value => value.calls.length), calls);
  assert.ok(store.calls.every(row => row[0] === "read"));
  assert.equal(controller.state.report.status, "arithmetic-agreement");
  controller.dispose();
});

test("newly collected checkpoint can be compared with preserved partial evidence", async () => {
  const selected = plan({}, context("DAT", 84532, ACCOUNTS[0]));
  const session = periodSession(selected), snapshots = [];
  const complete = await collectPeriod(session.session, selected, { onCheckpoint: value => snapshots.push(value) });
  assert.ok(snapshots.length >= 5);
  const partial = snapshots.find(value => value.records.length === 1);
  const before = reportInput({ changes: { DAT: { draft: partial } } });
  const after = reportInput({ changes: { DAT: { draft: complete } } });
  const comparison = comparePeriodReports(before, after);
  assert.equal(comparison.slots[0].kind, "continued");
  assert.equal(comparison.slots[0].eventChanges.added, 1);
  assert.equal(comparison.slots[0].eventChanges.unchanged, 1);
  assert.equal(before.slots[0].entry.draft.records.length, 1);
  assert.equal(analyzePeriodReport(after).status, "arithmetic-agreement");
});

test("reported snapshot does not pretend to detect a later live reorg", async () => {
  const { source, sessions } = await collectedLibrary(84532);
  const input = createPeriodReportInput(source, selection(), "Historical only", LATER);
  const first = analyzePeriodReport(input);
  sessions[0].hashes.set("42", "0x" + "ff".repeat(32));
  const calls = sessions[0].calls.length;
  const after = analyzePeriodReport(input);
  assert.deepEqual(after, first);
  assert.equal(after.liveChainRechecked, false);
  assert.equal(sessions[0].calls.length, calls);
});

test("known reorg restriction survives collection backup then report backup", async () => {
  const { source } = await collectedLibrary(84532), quarantined = clone(source);
  quarantined.entries[1].requiresNewPlan = true;
  const libraryDecoded = await decodePeriodLibraryFile((await preparePeriodLibraryFile(quarantined)).text);
  const input = createPeriodReportInput(libraryDecoded.document, selection(), "Restricted", LATER);
  const reportDecoded = await decodePeriodReportFile((await preparePeriodReportFile(input)).text);
  const report = analyzePeriodReport(reportDecoded.input);
  assert.equal(report.slots[1].status, "requires-new-plan");
  assert.equal(report.status, "attention");
  assert.equal(report.allArithmeticAgreement, false);
});

test("report import works after the original library is unavailable", async () => {
  const { source } = await collectedLibrary(84532);
  const input = createPeriodReportInput(source, selection(), "Portable", LATER);
  const file = await preparePeriodReportFile(input);
  let reads = 0;
  const controller = createPeriodReportController({ storage: {
    read: async () => { reads++; throw Error("No original database"); }, close() {},
  } });
  await controller.importFile(fileFrom(file.text));
  assert.equal(controller.state.report, null);
  await controller.applyReview();
  assert.equal(controller.state.report.title, "Portable");
  assert.equal(controller.state.report.status, "arithmetic-agreement");
  assert.equal(reads, 0);
  controller.dispose();
});

test("comparison review and cancellation preserve the accepted original report", async () => {
  const { source } = await collectedLibrary(84532);
  const input = createPeriodReportInput(source, selection(), "Accepted", LATER);
  const controller = createPeriodReportController({ storage: memoryStorage(source).storage });
  await controller.importFile(fileFrom((await preparePeriodReportFile(input)).text));
  await controller.applyReview(); const original = controller.state.input;
  const revised = clone(input); revised.slots[0].entry.draft.later.balanceBaseUnits = "1";
  await controller.importFile(fileFrom((await preparePeriodReportFile(revised)).text));
  assert.equal(controller.state.review.comparison.slots[0].kind, "changed-evidence");
  controller.cancel();
  assert.equal(controller.state.input, original);
  assert.equal(controller.state.report.status, "arithmetic-agreement");
  assert.equal(controller.state.review, null);
  controller.dispose();
});
