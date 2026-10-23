import { mountPeriodPanel } from "/examples/period-panel.js";
import { mountPeriodLibraryPanel } from "/examples/period-library-panel.js";
import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";
import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { collectPeriod } from "/src/period-reader.js";
import { checkpoint, plan, periodSession, context, ACCOUNT, OTHER, THIRD } from "/test/helpers/period-fixtures.js";

// This preview never opens the production period-library database.
const storage = createPeriodLibraryStorage({ name: "threecore-demo-period-library-v1" });
const accounts = { DAT: ACCOUNT, EMA: OTHER, CAWELON: THIRD };
const notice = document.querySelector("#demo-notice");
const reconciliation = mountReconciliationPanel({
  document, parent: document.querySelector("#comparison-area"),
});
const period = mountPeriodPanel({
  document, parent: document.querySelector("#period-area"),
  getContext: agent => context(agent, 84532, accounts[agent]),
  read: async (agent, selected, config) => {
    const fixture = periodSession(selected, {
      async before() { await new Promise(resolve => setTimeout(resolve, 10)); },
    });
    return collectPeriod(fixture.session, selected, config);
  },
  stageWorkspace: (workspace, agent) => reconciliation.stageCollected(workspace, agent),
});
const library = mountPeriodLibraryPanel({
  document, parent: document.querySelector("#library-area"), storage,
  getCheckpoint: () => period.getCheckpoint(),
  stageCheckpoint: (draft, options) => period.stageSaved(draft, options),
});
for (const [agent, count, blocked] of [["DAT", 3, false], ["EMA", 5, false], ["CAWELON", 2, true]]) {
  document.querySelector("#example-" + agent.toLowerCase()).addEventListener("click", () => {
    const selected = plan({}, context(agent, 84532, accounts[agent]));
    if (period.stageSaved(checkpoint(count, selected), { requiresNewPlan: blocked })) {
      notice.textContent = agent + "の模擬控えを確認候補にしました。下の期間画面で内容を確認して反映してください。";
      document.querySelector("#period-area").scrollIntoView({ block: "start" });
    } else notice.textContent = "進行中の処理があるため、例を切り替えられませんでした。";
  });
}
window.addEventListener("pagehide", () => {
  library.dispose();
  period.dispose();
  reconciliation.dispose();
}, { once: true });
