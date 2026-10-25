import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { createSecureBackupRunner } from "/src/secure-backup-runner.js";
import { encryptWorkspaceBackup } from "/src/secure-backup-crypto.js";
import { workspaceFromDraft } from "/src/workspace-format.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { manualTime } from "/test/helpers/secure-lifecycle-time.js";
export const PASSWORD = "synthetic browser lifecycle purple moon";
const clone = value => JSON.parse(JSON.stringify(value));
export function draft() {
  return ["DAT", "EMA", "CAWELON"].map((agent, index) => ({ agent,
    account: "0x" + String(index + 1).repeat(40), chainId: 84532,
    tokenAddress: "0x" + "4".repeat(40), tokens: "0x" + "4".repeat(40),
    history: createPortfolioHistory().exportText() }));
}
let encrypted;
export function sample() {
  encrypted ??= encryptWorkspaceBackup(workspaceFromDraft(draft()), PASSWORD);
  return encrypted;
}
export async function until(predicate) {
  const deadline = performance.now() + 20000;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error("Lifecycle browser action did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
export function fixture({ onUnschedule = () => {} } = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const time = manualTime();
  const runner = createSecureBackupRunner();
  let current = draft().map(row => ({ ...row, account: "" }));
  const writes = [], downloads = [];
  const panel = mountWorkspacePanel({ document, parent: host,
    readDraft: () => clone(current), writeDraft(value) { current = clone(value); writes.push(clone(value)); },
    download: value => downloads.push(value.prepared),
    secureOptions: { plaintextLifetimeMs: 100, deadlineOptions: { ...time.options,
      unschedule(id) { time.unschedule(id); onUnschedule(id); } },
      controllerOptions: { runner } } });
  const q = name => host.querySelector(".secure-backup-" + name);
  const w = name => host.querySelector(".workspace-" + name);
  function input(name, value) {
    q(name).value = value;
    q(name).dispatchEvent(new Event("input", { bubbles: true }));
  }
  function check(element, checked = true) {
    element.checked = checked;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  async function select() {
    const transfer = new DataTransfer();
    transfer.items.add(new File([(await sample()).text], "synthetic-backup.json", { type: "application/json" }));
    q("file").files = transfer.files;
    q("file").dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => !q("file").disabled);
  }
  async function unlock() {
    await select();
    input("restore-password", PASSWORD);
    q("decrypt").click();
    await until(() => !q("file").disabled);
  }
  return { host, time, runner, panel, q, w, writes, downloads, input, check, select, unlock,
    get current() { return clone(current); },
    dispose() { panel.dispose(); runner.dispose(); host.remove(); } };
}
