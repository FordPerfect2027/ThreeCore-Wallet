import test from "node:test";
import assert from "node:assert/strict";
import { inspectExportPayload } from "../src/export-payload.js";
import { createBrowserExportResource } from "../examples/export-resource.js";
import { createExportGuard } from "../src/export-guard.js";
import { prepareHistoryDownload } from "../src/history-file.js";
import { prepareWalletSetupFile } from "../src/wallet-setup-file.js";
import { prepareWorkspaceFile } from "../src/workspace-file.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { prepareAllowanceFile } from "../src/allowance-file.js";
import { prepareAllowanceBundle, captureAllowanceBundle } from "../src/allowance-bundle.js";
import { prepareTransferDownload } from "../src/transfer-file.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { preparePeriodFile } from "../src/period-file.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { periodReportCSV, periodReportHTML } from "../src/period-report-export.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { reportHistoryCSV } from "../src/report-history-query.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { reportSetCSV, reportSetHTML } from "../src/report-set-export.js";
import { archive, observation as historyObservation } from "./helpers/history-fixtures.js";
import { setup } from "./helpers/setup-fixtures.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { observation } from "./helpers/identity-fixtures.js";
import { record, targets } from "./helpers/allowance-fixtures.js";
import { snapshot, context } from "./helpers/transfer-fixtures.js";
import { archiveFor, bundleFor } from "./helpers/vault-fixtures.js";
import { previewWorkspace } from "./helpers/reconciliation-fixtures.js";
import { checkpoint } from "./helpers/period-fixtures.js";
import { sampleLibrary } from "./helpers/period-library-fixtures.js";
import { reportInput } from "./helpers/period-report-fixtures.js";
import { sampleHistory } from "./helpers/report-history-fixtures.js";
import { sequenceSet } from "./helpers/report-set-fixtures.js";
import { browserFixture } from "./helpers/export-fixtures.js";

const formats = [
  ["wallet-settings", () => prepareWalletSetupFile(setup())],
  ["workspace", () => prepareWorkspaceFile(bundle())],
  ["allowance-bundle", () => prepareAllowanceBundle(captureAllowanceBundle(
    ["DAT", "EMA", "CAWELON"].map(agent => record({}, agent))))],
  ["transfer-vault", () => prepareVaultFile(bundleFor())],
  ["reconciliation", () => prepareReconciliationFile(previewWorkspace())],
  ["period-checkpoint", () => preparePeriodFile(checkpoint())],
  ["period-library", () => preparePeriodLibraryFile(sampleLibrary())],
  ["period-report-json", () => preparePeriodReportFile(reportInput())],
  ["period-report-csv", () => periodReportCSV(reportInput())],
  ["period-report-html", () => periodReportHTML(reportInput())],
  ["report-history-json", () => prepareReportHistoryFile(sampleHistory())],
  ["report-history-csv", () => reportHistoryCSV(sampleHistory())],
  ["report-set-json", () => prepareReportSetFile(sequenceSet())],
  ["report-set-csv", () => reportSetCSV(sequenceSet())],
  ["report-set-html", () => reportSetHTML(sequenceSet())],
];
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  formats.push([agent + "-history", () => prepareHistoryDownload(archive([
    historyObservation("42", { agent }),
  ]), agent, 1)]);
  formats.push([agent + "-identity", () => prepareTokenIdentityFile(observation({}, agent))]);
  formats.push([agent + "-targets", () => prepareAllowanceFile("targets", targets(agent))]);
  formats.push([agent + "-allowance", () => prepareAllowanceFile("observation", record({}, agent))]);
  formats.push([agent + "-archive", () => prepareTransferArchive(archiveFor(agent))]);
  for (const kind of ["json", "csv", "txt"]) {
    formats.push([agent + "-transfers-" + kind, () => prepareTransferDownload(snapshot({}, context(agent)), kind)]);
  }
}

for (const [name, generate] of formats) {
  test("existing generated export passes guarded transport unchanged: " + name, async () => {
    const input = await generate();
    const before = JSON.stringify(input);
    const checked = inspectExportPayload(input);
    assert.equal(checked.text, input.text);
    assert.equal(checked.filename, input.filename);
    assert.equal(checked.byteLength, Buffer.byteLength(input.text, "utf8"));
    const f = browserFixture();
    const guard = createExportGuard({ now: f.clock.now, schedule: f.clock.schedule,
      unschedule: f.clock.unschedule,
      createResource: (payload, current) => createBrowserExportResource(f.document, payload, current),
    });
    const receipt = guard.offer(input);
    assert.equal(receipt.offered, true);
    assert.equal(receipt.downloadComplete, false);
    assert.deepEqual(new Uint8Array(await f.blobs[0].arrayBuffer()), new TextEncoder().encode(input.text));
    assert.equal(f.anchors[0].download, input.filename);
    assert.equal(f.body.children.length, 0);
    assert.equal(JSON.stringify(input), before);
    guard.clear();
    assert.equal(f.liveURLs.size, 0);
    assert.equal(guard.state().reservedBytes, 0);
  });
}

test("HTML report boundary keeps escaped application text and original CSP", () => {
  const source = reportInput();
  const input = { ...source, title: '<img src=x onerror="synthetic">' };
  const exported = periodReportHTML(input);
  const result = inspectExportPayload(exported);
  assert.equal(result.kind, "html");
  assert(result.text.includes("&lt;img"));
  assert(!result.text.includes('<img src=x'));
  assert(result.text.includes("Content-Security-Policy"));
});

test("CSV and HTML export byte declarations remain exact for Japanese report titles", () => {
  const source = reportInput();
  for (const exportFile of [periodReportCSV, periodReportHTML]) {
    const file = exportFile({ ...source, title: "期間の確認と保存" });
    const checked = inspectExportPayload(file);
    assert.equal(checked.byteLength, Buffer.byteLength(file.text));
  }
});

test("checksum and authenticity metadata are not copied into transport status", async () => {
  const file = await prepareWorkspaceFile(bundle());
  const checked = inspectExportPayload(file);
  assert.equal(checked.digest, undefined);
  assert.equal(checked.authenticated, undefined);
  assert.equal(checked.encrypted, undefined);
  assert.equal(checked.text, file.text);
});
