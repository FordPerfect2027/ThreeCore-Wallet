import { mountPeriodReportPanel } from "/examples/period-report-panel.js";
import { mountReportHistoryPanel } from "/examples/report-history-panel.js";
import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { sampleHistory, reportInput, reportLibrary, AFTER } from "/test/helpers/report-history-fixtures.js";

const name = "threecore-demo-report-history-v1";
const report = mountPeriodReportPanel({ document, parent: document.querySelector("#report-area"),
  storage: createPeriodLibraryStorage({ name: "threecore-demo-history-source-v1" }) });
const history = mountReportHistoryPanel({ document, parent: document.querySelector("#history-area"),
  storage: createReportHistoryStorage({ name }), getReport: report.getInput, stageReport: report.stageHistory,
  sourceStorage: createPeriodLibraryStorage({ name: "threecore-demo-history-source-v1" }),
  now: () => AFTER });
const writer = createReportHistoryStorage({ name });
const sourceWriter = createPeriodLibraryStorage({ name: "threecore-demo-history-source-v1" });
const seed = document.querySelector("#seed"), message = document.querySelector("#demo-message");
seed.addEventListener("click", async () => {
  seed.disabled = true;
  try {
    const current = await writer.read();
    await writer.change(current.revision, { kind: "merge", document: sampleHistory(), skipConflicts: false });
    const sources = await sourceWriter.read();
    await sourceWriter.change(sources.revision, { kind: "import", entries: reportLibrary().entries });
    message.textContent = "模擬の報告4件を用意しました。下の「PC内の報告履歴を読み込む」から確認できます。";
  } catch {
    message.textContent = "模擬報告を追加できませんでした。既存の記録は上書きしていません。";
  } finally { seed.disabled = false; }
});
document.querySelector("#prepare").addEventListener("click", () => {
  report.stageHistory(reportInput({ title: "新しい模擬レポート", counts: [5, 5, 3] }));
  message.textContent = "上の報告画面に新しい候補を用意しました。内容を確認して作成し、下の履歴へ保存できます。";
});
window.addEventListener("pagehide", () => { history.dispose(); report.dispose(); writer.close(); sourceWriter.close(); }, { once: true });
