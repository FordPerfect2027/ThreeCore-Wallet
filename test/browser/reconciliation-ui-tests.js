import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";
import { mountWalletDemo } from "/examples/wallet-demo.js";
import { prepareReconciliationFile, decodeReconciliationFile } from "/src/reconciliation-file.js";
import { prepareTokenIdentityFile } from "/src/token-identity-report.js";
import { prepareTransferArchive } from "/src/transfer-archive-file.js";
import { prepareVaultFile } from "/src/transfer-vault-file.js";
import { vaultBundle } from "/src/transfer-vault-model.js";
import { reconciliationKey } from "/src/reconciliation-model.js";
import { workspace, scenario, previewWorkspace, deferred, event, record, archive } from "/test/helpers/reconciliation-fixtures.js";

const assert = (value, message = "Reconciliation assertion failed") => { if (!value) throw Error(message); };
async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 5000) throw Error("Reconciliation UI timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function panel(options = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const files = [];
  const mounted = mountReconciliationPanel({ document, parent,
    readObservation: agent => scenario(agent).earlier,
    readArchive: agent => scenario(agent).archive,
    download: file => files.push(file), ...options });
  const q = name => parent.querySelector(".reconciliation-" + name);
  return {
    mounted, parent, q, files,
    click(name) { assert(!q(name).disabled, "Disabled control: " + name); q(name).click(); },
    input(name, value, type = "change") { q(name).value = value; q(name).dispatchEvent(new Event(type, { bubbles: true })); },
    check() { q("ack").checked = true; q("ack").dispatchEvent(new Event("change", { bubbles: true })); },
    async file(text, kind = "workspace") {
      this.input("import-kind", kind);
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], "synthetic.json", { type: "application/json" }));
      q("file").files = transfer.files;
      q("file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
}

export function registerReconciliationUITests(test) {
  test("reconciliation: starts without automatic reads or calculations", async () => {
    let reads = 0;
    const f = panel({ readObservation: () => { reads++; return null; } });
    try {
      assert(reads === 0);
      assert(f.q("result-DAT").textContent.includes("まだ照合していません"));
      assert(f.q("review").hidden);
      assert(f.q("export-text").disabled);
      assert(f.q("file").accept.includes(".json"));
      assert(f.q("status").getAttribute("aria-live") === "polite");
    } finally { f.dispose(); }
  });

  test("reconciliation: card capture is staged and never applied automatically", async () => {
    const f = panel();
    try {
      f.click("capture-earlier");
      assert(!f.q("review").hidden);
      assert(f.q("input-earlier").textContent === "未登録");
      assert(f.q("ack").parentElement.hidden);
      f.click("apply");
      assert(f.q("input-earlier").textContent.includes("block 30"));
      assert(f.q("review").hidden);
      assert(!f.q("undo").disabled);
    } finally { f.dispose(); }
  });

  test("reconciliation: replacement checkbox resets for every new review", async () => {
    const f = panel({ initial: workspace() });
    try {
      f.click("remove-earlier");
      assert(f.q("apply").disabled);
      assert(!f.q("ack").parentElement.hidden);
      f.check();
      assert(!f.q("apply").disabled);
      f.click("cancel");
      f.click("remove-later");
      assert(!f.q("ack").checked);
      assert(f.q("apply").disabled);
    } finally { f.dispose(); }
  });

  test("reconciliation: native JSON import, disposal and fresh-panel restore preserve all slots", async () => {
    const first = panel({ initial: previewWorkspace() });
    let text;
    try {
      first.click("export-json");
      await waitFor(() => first.files.length === 1);
      text = first.files[0].text;
      assert(first.q("export-status").textContent.includes("開始済み"));
    } finally { first.dispose(); }
    const second = panel();
    try {
      await second.file(text);
      assert(second.q("input-earlier").textContent === "未登録");
      second.click("apply");
      assert(reconciliationKey(second.mounted.getWorkspace()) === reconciliationKey(previewWorkspace()));
      second.click("calculate");
      assert(second.q("result-DAT").textContent.includes("計算が一致"));
      assert(second.q("result-EMA").textContent.includes("差額: 2 EMA"));
      assert(second.q("result-CAWELON").textContent.includes("未取得: 37 ～ 39"));
    } finally { second.dispose(); }
  });

  test("reconciliation: corrupt native File does not replace existing observations", async () => {
    const f = panel({ initial: workspace() });
    try {
      const before = reconciliationKey(f.mounted.getWorkspace());
      const parsed = JSON.parse((await prepareReconciliationFile(previewWorkspace())).text);
      parsed.digest = "0".repeat(64);
      await f.file(JSON.stringify(parsed));
      assert(f.q("status").textContent.includes("検査値が一致しません"));
      assert(f.q("review").hidden);
      assert(reconciliationKey(f.mounted.getWorkspace()) === before);
    } finally { f.dispose(); }
  });

  for (const agent of ["DAT", "EMA", "CAWELON"]) test("reconciliation: selected " + agent + " imports both observations and archive", async () => {
    const f = panel();
    try {
      f.input("agent", agent);
      const slot = scenario(agent);
      for (const part of ["earlier", "later"]) {
        await f.file((await prepareTokenIdentityFile(slot[part])).text, part);
        f.click("apply");
      }
      await f.file((await prepareTransferArchive(slot.archive)).text, "archive");
      f.click("apply");
      f.click("calculate");
      assert(f.q("result-" + agent).textContent.includes("計算が一致"));
      assert(f.mounted.getWorkspace().slots.filter(slot => slot.earlier).length === 1);
    } finally { f.dispose(); }
  });

  test("reconciliation: vault import shows archive removals before replacing", async () => {
    const f = panel({ initial: previewWorkspace() });
    try {
      const bundle = vaultBundle([null, scenario("EMA").archive, null]);
      await f.file((await prepareVaultFile(bundle)).text, "vault");
      assert(f.q("review-text").textContent.includes("DAT・履歴: 削除"));
      assert(f.q("apply").disabled);
      f.check();
      f.click("apply");
      assert(f.mounted.getWorkspace().slots[0].archive === null);
      assert(f.mounted.getWorkspace().slots[0].earlier !== null);
    } finally { f.dispose(); }
  });

  test("reconciliation: clearing token and undo/redo invalidate old results", async () => {
    const f = panel({ initial: previewWorkspace() });
    try {
      f.click("calculate");
      f.input("agent", "EMA");
      f.click("clear");
      f.check();
      f.click("apply");
      assert(f.q("result-EMA").textContent.includes("まだ照合していません"));
      assert(f.q("export-summary").disabled);
      f.click("undo");
      f.click("calculate");
      assert(f.q("result-EMA").textContent.includes("差額: 2 EMA"));
      f.click("redo");
      assert(f.q("input-earlier").textContent === "未登録");
    } finally { f.dispose(); }
  });

  test("reconciliation: filters search and paginate rows without changing calculations", async () => {
    const slot = scenario();
    slot.archive = archive([record(30, 42, Array.from({ length: 60 }, (_, index) => event({ amountBaseUnits: "1" }, index)))]);
    const f = panel({ initial: workspace([slot]) });
    try {
      f.click("calculate");
      const result = f.q("result-DAT").textContent;
      assert(f.q("event-rows").children.length === 25);
      f.click("next");
      assert(f.q("pagination").textContent.includes("2 / 3"));
      f.input("search", "not found", "input");
      assert(f.q("event-rows").children.length === 0);
      assert(f.q("pagination").textContent.includes("0件"));
      f.input("search", "", "input");
      f.input("direction", "outgoing");
      assert(f.q("event-rows").children.length === 0);
      assert(f.q("result-DAT").textContent === result);
    } finally { f.dispose(); }
  });

  test("reconciliation: selected gap memo reports manual ranges, no automatic reads", async () => {
    let reads = 0;
    const f = panel({ initial: previewWorkspace(), readArchive: () => { reads++; return null; } });
    try {
      f.click("calculate");
      f.input("agent", "CAWELON");
      assert(f.q("windows").textContent.includes("37 ～ 39"));
      assert(f.q("windows").textContent.includes("手動"));
      assert(reads === 0);
    } finally { f.dispose(); }
  });

  test("reconciliation: all reports download while filters remain display-only", async () => {
    const f = panel({ initial: previewWorkspace() });
    try {
      f.click("calculate");
      f.input("filter-agent", "EMA");
      assert(f.q("event-rows").children.length === 2);
      for (const kind of ["json", "summary", "events", "text"]) {
        const count = f.files.length;
        f.click("export-" + kind);
        await waitFor(() => f.files.length > count);
      }
      assert((await decodeReconciliationFile(f.files[0].text)).workspace.slots.length === 3);
      assert(f.files[2].text.includes('"DAT"'));
      assert(f.files[2].text.includes('"CAWELON"'));
      assert(f.files[3].text.includes("未取得: 37 ～ 39"));
    } finally { f.dispose(); }
  });

  test("reconciliation: cancel prevents a late import from reopening review", async () => {
    const gate = deferred();
    const f = panel({ controllerOptions: { readFile: async () => gate.promise } });
    try {
      const pending = f.file("{}");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "true");
      f.click("cancel");
      gate.resolve(previewWorkspace());
      await pending;
      await new Promise(resolve => setTimeout(resolve, 0));
      assert(f.q("review").hidden);
      assert(f.q("input-earlier").textContent === "未登録");
    } finally { f.dispose(); }
  });

  test("reconciliation: disposal during crypto preparation cannot initiate download", async () => {
    const gate = deferred();
    const f = panel({ initial: workspace(), controllerOptions: { prepareFile: async () => gate.promise } });
    f.click("export-json");
    f.dispose();
    gate.resolve({ text: "{}", filename: "late.json" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(f.files.length === 0);
    assert(!f.parent.isConnected);
  });

  test("reconciliation: native hidden elements stay hidden despite global label styles", async () => {
    const f = panel();
    try {
      f.click("capture-earlier");
      assert(getComputedStyle(f.q("ack").parentElement).display === "none");
      f.click("cancel");
      assert(getComputedStyle(f.q("review")).display === "none");
      assert(getComputedStyle(f.q("events")).display === "none");
    } finally { f.dispose(); }
  });

  test("reconciliation: main wallet integration mounts and cleans up without requesting accounts", async () => {
    let requests = 0;
    const app = mountWalletDemo({ document, eventTarget: new EventTarget(), siteOrigin: location.origin,
      getLegacyProvider: () => undefined,
      createSession: () => { requests++; throw Error("unexpected wallet session"); },
    });
    try {
      const host = document.querySelector(".reconciliation-host");
      assert(host !== null);
      host.querySelector(".reconciliation-capture-earlier").click();
      assert(host.querySelector(".reconciliation-status").textContent.includes("記録がありません"));
      assert(requests === 0);
    } finally { app.dispose(); }
    assert(document.querySelector(".reconciliation-host") === null);
  });

  test("reconciliation: main wallet cards supply all three token observations and histories", async () => {
    const app = mountWalletDemo({ document, eventTarget: new EventTarget(), siteOrigin: location.origin,
      getLegacyProvider: () => undefined });
    const inputFile = (target, text) => {
      const files = new DataTransfer();
      files.items.add(new File([text], "synthetic.json", { type: "application/json" }));
      target.files = files.files;
      target.dispatchEvent(new Event("change", { bubbles: true }));
    };
    try {
      const recon = document.querySelector(".reconciliation-panel");
      const q = name => recon.querySelector(".reconciliation-" + name);
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        const slot = scenario(agent);
        const card = document.querySelector('[data-agent="' + agent + '"]');
        for (const [selector, value] of [[".account", slot.earlier.account], [".chain", "8453"], [".token", slot.earlier.tokenAddress]]) {
          card.querySelector(selector).value = value;
          card.querySelector(selector).dispatchEvent(new Event(selector === ".chain" ? "change" : "input", { bubbles: true }));
        }
        q("agent").value = agent;
        q("agent").dispatchEvent(new Event("change", { bubbles: true }));
        for (const part of ["earlier", "later"]) {
          inputFile(card.querySelector(".identity-file"), (await prepareTokenIdentityFile(slot[part])).text);
          await waitFor(() => card.querySelector(".identity-details").textContent.includes(slot[part].blockNumber));
          q("capture-" + part).click();
          assert(!q("apply").disabled, "Capture review absent for " + agent + "/" + part);
          q("apply").click();
        }
        inputFile(card.querySelector(".transfer-archive-file"), (await prepareTransferArchive(slot.archive)).text);
        await waitFor(() => !card.querySelector(".transfer-archive-apply").disabled);
        card.querySelector(".transfer-archive-apply").click();
        q("capture-archive").click();
        assert(!q("apply").disabled, "Archive capture absent for " + agent);
        q("apply").click();
      }
      q("calculate").click();
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        assert(q("result-" + agent).textContent.includes("計算が一致"), q("result-" + agent).textContent);
      }
      assert(q("evidence").textContent.includes("取得サイト"));
      assert(q("ledger").textContent.includes("推定残高"));
    } finally { app.dispose(); }
  });

  test("reconciliation: block and gap exports include selected evidence without performing reads", async () => {
    const f = panel({ initial: previewWorkspace() });
    try {
      f.click("calculate");
      f.input("agent", "CAWELON");
      assert(f.q("ledger").textContent.includes("未取得期間 1"));
      assert(f.q("evidence").textContent.includes("period-2"));
      for (const kind of ["ledger", "windows"]) {
        const count = f.files.length;
        f.click("export-" + kind);
        await waitFor(() => f.files.length > count);
      }
      assert(f.files[0].text.includes('"opening_implied_base_units"'));
      assert(f.files[1].text.includes('"37","39","0","false"'));
    } finally { f.dispose(); }
  });

  test("reconciliation: selecting another token cancels pending import and stale review", async () => {
    const gate = deferred();
    const f = panel({ controllerOptions: { readFile: async () => gate.promise } });
    try {
      const pending = f.file("{}");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "true");
      f.input("agent", "EMA");
      gate.resolve(previewWorkspace());
      await pending;
      assert(f.q("review").hidden);
      assert(f.q("agent").value === "EMA");
      assert(f.q("input-earlier").textContent === "未登録");
    } finally { f.dispose(); }
  });
}
