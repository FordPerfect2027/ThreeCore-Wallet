import { mountPeriodPanel } from "/examples/period-panel.js";
import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";
import { collectPeriod } from "/src/period-reader.js";
import { periodSession, context, ACCOUNT, OTHER, THIRD } from "/test/helpers/period-fixtures.js";

const accounts = { DAT: ACCOUNT, EMA: OTHER, CAWELON: THIRD };
let failNextHistory = false;
const reconciliation = mountReconciliationPanel({ document, parent: document.querySelector("#period-reconciliation") });
const panel = mountPeriodPanel({ document, parent: document.querySelector("#period-demo"),
  getContext: agent => context(agent, 84532, accounts[agent]),
  read: async (agent, plan, options) => {
    const fixture = periodSession(plan, { async before(method, [request]) {
      await new Promise(resolve => setTimeout(resolve, 20));
      if (failNextHistory && method === "logs" && request.fromBlock !== "31") {
        failNextHistory = false;
        document.querySelector("#demo-notice").textContent = "模擬通信を1回失敗させました。取得済みの控えを保存・再開できます。";
        throw Error("Synthetic one-time failure");
      }
    } });
    return collectPeriod(fixture.session, plan, options);
  },
  stageWorkspace: (workspace, agent) => reconciliation.stageCollected(workspace, agent),
});
function fillExample() {
  for (const [name, value] of [["earlier", "30"], ["later", "42"], ["window-size", "5"]]) {
    const input = document.querySelector(".period-" + name);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
document.querySelector("#period-example").addEventListener("click", fillExample);
document.querySelector("#period-failure").addEventListener("click", () => {
  failNextHistory = true;
  document.querySelector("#demo-notice").textContent = "次の途中区間で1回だけ模擬通信を失敗させます。再開後は正常に応答します。";
});
fillExample();
window.addEventListener("pagehide", () => { panel.dispose(); reconciliation.dispose(); }, { once: true });
