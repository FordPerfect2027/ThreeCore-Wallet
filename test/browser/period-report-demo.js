import { mountPeriodReportPanel } from "/examples/period-report-panel.js";
import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { reportLibrary, entry, id, checkpoint, plan, context, THIRD, clone } from "/test/helpers/period-report-fixtures.js";

const name = "threecore-demo-period-report-v1";
const report = mountPeriodReportPanel({ document, parent: document.querySelector("#report-area"),
  storage: createPeriodLibraryStorage({ name }) });
const writer = createPeriodLibraryStorage({ name });
const seed = document.querySelector("#seed"), message = document.querySelector("#demo-message");
seed.addEventListener("click", async () => {
  seed.disabled = true;
  try {
    const standard = reportLibrary().entries;
    const mismatch = clone(standard[1]);
    mismatch.id = id(12); mismatch.label = "EMA 差額ありの例";
    mismatch.draft.later.balanceBaseUnits = "109000000000000000000";
    const partial = entry(13, { label: "CAWELON 取得途中の例",
      draft: checkpoint(3, plan({}, context("CAWELON", 84532, THIRD))) });
    const current = await writer.read();
    await writer.change(current.revision, { kind: "import", entries: [...standard, mismatch, partial] });
    message.textContent = "模擬の控え5件を用意しました。保存一覧を読み込み、各トークンの記録を選んでください。";
  } catch {
    message.textContent = "模擬記録を追加できませんでした。既存の控えは消していません。";
  } finally { seed.disabled = false; }
});
window.addEventListener("pagehide", () => { report.dispose(); writer.close(); }, { once: true });
