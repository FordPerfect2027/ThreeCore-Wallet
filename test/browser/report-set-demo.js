import { mountReportSetPanel } from "/examples/report-set-panel.js";
import { createReportHistoryStorage } from "/src/report-history-storage.js";
import { demoSetHistory, AFTER } from "/test/helpers/report-set-fixtures.js";

const name = "threecore-demo-report-set-v1";
const panel = mountReportSetPanel({ document, parent: document.querySelector("#set-area"),
  storage: createReportHistoryStorage({ name }), now: () => AFTER });
const writer = createReportHistoryStorage({ name });
const seed = document.querySelector("#seed"), message = document.querySelector("#demo-message");
seed.addEventListener("click", async () => {
  seed.disabled = true;
  try {
    const current = await writer.read();
    await writer.change(current.revision, { kind: "merge", document: demoSetHistory(), skipConflicts: false });
    message.textContent = "模擬報告7件を用意しました。下の一覧読込みボタンを押し、「報告 1・2・3」を選ぶと期間のつながりを確認できます。";
  } catch {
    message.textContent = "模擬報告を追加できませんでした。既存の保存記録は上書きしていません。";
  } finally { seed.disabled = false; }
});
window.addEventListener("pagehide", () => { panel.dispose(); writer.close(); }, { once: true });
