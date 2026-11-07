import { createPortfolioHistory } from "/src/portfolio-history.js";
import { createHistoryRecovery } from "/src/history-recovery.js";
import { mountHistoryFiles } from "/examples/history-files.js";
import { mountHistoryRecovery } from "/examples/history-recovery-panel.js";

const assert = (condition, message) => { if (!condition) throw Error(message); };
const turn = () => new Promise(resolve => setTimeout(resolve, 20));
function observation(block) {
  return { agent: "DAT", account: "0x" + "11".repeat(20), chainId: 84532,
    siteOrigin: location.origin, connectionEpoch: 1, blockNumber: block,
    blockHash: "0x" + "ab".repeat(32), nativeBalanceBaseUnits: "9007199254740993",
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: true,
      balanceBaseUnits: "123456789012345678901234567890", notice: null }],
    readOnly: true, securityAudit: false };
}
function fixture(kind) {
  const parent = document.createElement("section");
  document.querySelector("#grid").append(parent);
  const history = createPortfolioHistory();
  history.merge([observation("1"), observation("2")]);
  const recovery = kind === "recovery" ? createHistoryRecovery(history) : null;
  const delivered = [];
  let receive = ({ prepared }) => { delivered.push(prepared); return true; };
  const download = input => receive(input);
  const panel = recovery
    ? mountHistoryRecovery({ document, parent, agent: "DAT", recovery,
      onRestore() { throw Error("Export must not restore history"); },
      onCopyArchive() { throw Error("Export must not stage a restore"); }, download })
    : mountHistoryFiles({ document, parent, agent: "DAT",
      getArchive: () => history.exportText(), getRevision: () => history.state().revision,
      onImportText() { throw Error("Export must not import history"); }, download });
  if (recovery) { recovery.remove(0, history.state().revision); panel.refresh(); }
  const find = name => parent.querySelector(".history-" + name);
  const status = find(recovery ? "recovery-status" : "file-status");
  const save = find(recovery ? "recovery-save" : kind === "subset" ? "file-save-subset" : "file-save");
  const review = () => {
    if (kind === "subset") {
      find("filter-maximum").value = "1";
      find("filter-maximum").dispatchEvent(new Event("input", { bubbles: true }));
      find("filter-run").click();
      assert(!save.disabled, "Explicit subset review must enable its download");
    }
  };
  review();
  return { history, recovery, panel, parent, delivered, find, status, save, review,
    receive(callback) { receive = callback; },
    accept() { receive = ({ prepared }) => { delivered.push(prepared); return true; }; },
    dispose() { panel.dispose(); recovery?.dispose(); parent.remove(); } };
}
const started = text => /ダウンロード.*開始/.test(text);

export function registerHistoryDownloadBoundaryUITests(test) {
  for (const kind of ["full", "subset", "recovery"]) {
    test("history: download boundary: " + kind + " refusal preserves records and permits an explicit retry", () => {
      const f = fixture(kind);
      try {
        if (kind === "full") {
          f.save.click();
          assert(f.delivered.length === 1, "Previous successful handoff must be exercised");
          f.history.add(observation("3")); f.panel.invalidate();
        }
        const before = f.history.exportText(), previousDeliveries = f.delivered.length;
        const previousRecovery = f.recovery?.exportText();
        f.receive(() => false); f.save.click();
        assert(f.delivered.length === previousDeliveries, "Refusal cannot create a delivered payload");
        assert(!started(f.status.textContent), "Refused download must not announce a successful handoff");
        assert(f.history.exportText() === before, "Refusal must preserve exact current archive bytes");
        if (f.recovery) assert(f.recovery.exportText() === previousRecovery, "Recovery archive must remain available");
        else assert(f.find("backup-state").textContent.includes("まだファイルとして"), "Current full archive must remain unconfirmed");
        f.accept(); f.review(); f.save.click();
        assert(f.delivered.length === previousDeliveries + 1, "A new explicit retry must deliver once");
        assert(started(f.status.textContent), "Successful retry must report the handoff");
        const rows = JSON.parse(f.delivered.at(-1).text).reports;
        assert(rows.length === (kind === "full" ? 3 : kind === "subset" ? 1 : 2), "Correct collection must be exported");
        assert(rows[0].snapshot.nativeBalanceBaseUnits === "9007199254740993", "Export must preserve exact integer strings");
        assert(f.history.exportText() === before, "Retry cannot mutate current records");
      } finally { f.dispose(); }
    });
    test("history: download boundary: " + kind + " rejected asynchronous handoff is contained", async () => {
      const f = fixture(kind);
      try {
        const before = f.history.exportText();
        let calls = 0;
        f.receive(() => { calls++; return Promise.reject(Error("Synthetic history download failure")); });
        f.save.click();
        await turn(); // The global suite rejects any unhandledrejection event.
        assert(calls === 1, "The rejected handoff must be exercised exactly once");
        assert(f.delivered.length === 0, "Rejected callback must not count as a delivered file");
        assert(!started(f.status.textContent), "Asynchronous receipt must not publish success");
        assert(!f.status.textContent.includes("Synthetic history"), "Internal callback detail must stay out of UI");
        assert(f.history.exportText() === before, "Current records must remain byte-identical");
        if (f.recovery) assert(f.recovery.state().hasBackup, "Pre-change archive must remain available");
      } finally { f.dispose(); }
    });
  }
  for (const kind of ["full", "recovery"]) {
    test("history: download boundary: " + kind + " disposal during handoff suppresses late success", () => {
      const f = fixture(kind);
      try {
        const before = f.history.exportText();
        let calls = 0;
        f.receive(() => { calls++; f.panel.dispose(); return true; });
        f.save.click();
        assert(calls === 1, "The stopped handoff must be exercised once");
        assert(!f.status.isConnected, "Disposed status must be detached from the document");
        assert(!started(f.status.textContent), "A stopped panel must not publish a late success");
        assert(f.history.exportText() === before, "Stopping export must preserve current archive bytes");
        if (f.recovery) assert(f.recovery.state().hasBackup, "Stopping export cannot discard recovery data");
      } finally { f.dispose(); }
    });
  }
}
