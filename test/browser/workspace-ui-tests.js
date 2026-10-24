import { encodeWorkspace, workspaceFromDraft } from "/src/workspace-format.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { prepareWorkspaceFile } from "/src/workspace-file.js";
import { backupHeader, prepareEncryptedEnvelope } from "/src/secure-backup-format.js";

const AGENTS = ["DAT", "EMA", "CAWELON"];
const ACCOUNTS = ["11", "22", "33"].map(pair => "0x" + pair.repeat(20));
const TOKEN = "0x" + "44".repeat(20);
const assert = (condition, message) => { if (!condition) throw Error(message); };
const q = name => document.querySelector(".workspace-" + name);
const card = (agent, selector) => document.querySelector('[data-agent="' + agent + '"] ' + selector);
const input = (element, value, event = "input") => {
  element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true }));
};
function check(name, value = true) {
  q(name).checked = value;
  q(name).dispatchEvent(new Event("change", { bubbles: true }));
}
function history(index, block) {
  const store = createPortfolioHistory();
  if (block !== null) store.add({
    agent: AGENTS[index], account: ACCOUNTS[index], chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1,
    blockNumber: block, blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: String(16 + index),
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: String(42 + index), notice: null }],
    readOnly: true, securityAudit: false,
  });
  return store.exportText();
}
function draft(block = "10") {
  return AGENTS.map((agent, index) => ({ agent, account: ACCOUNTS[index], chainId: 84532,
    tokenAddress: TOKEN, tokens: TOKEN, history: history(index, block) }));
}
function payload(block = "10") { return encodeWorkspace(workspaceFromDraft(draft(block))); }
function review(text = payload()) {
  input(q("json"), text);
  q("preview").click();
}
function apply() { check("confirmed"); q("apply").click(); }
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Workspace UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export function registerWorkspaceUITests(test) {
  test("workspace: page protection during encrypted handoff keeps plaintext erased", async () => {
    const parent = document.createElement("section");
    document.querySelector("#grid").append(parent);
    const lifecycle = new EventTarget();
    let current = draft(), armed = false, reads = 0, protectedNow = false, writes = 0;
    const panel = mountWorkspacePanel({ document, parent,
      readDraft() {
        if (armed && ++reads === 2) {
          armed = false; lifecycle.dispatchEvent(new Event("pagehide")); protectedNow = true;
        }
        return current;
      }, writeDraft(value) { writes++; current = value; },
      download() { throw Error("Handoff must not download"); },
      secureOptions: { eventTarget: lifecycle, controllerOptions: {
        decrypt: async () => ({ workspace: workspaceFromDraft(draft("30")), text: payload("30") }),
      } },
    });
    const secure = name => parent.querySelector(".secure-backup-" + name);
    try {
      review(payload("20")); apply();
      const header = backupHeader(new Uint8Array(16).fill(7), new Uint8Array(12).fill(8));
      const encrypted = prepareEncryptedEnvelope(header, new Uint8Array(48).fill(9));
      const files = new DataTransfer();
      files.items.add(new File([encrypted.text], "encrypted.json", { type: "application/json" }));
      secure("file").files = files.files;
      secure("file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !secure("decrypt").disabled);
      input(secure("restore-password"), "synthetic only purple moons");
      secure("decrypt").click();
      await waitFor(() => !secure("stage").disabled);
      armed = true;
      secure("stage").click();
      assert(protectedNow, "Protection did not interrupt the handoff");
      assert(q("json").value === "", "Erased decrypted data returned to the input");
      assert(q("apply").disabled && secure("stage").disabled, "Stopped handoff can still apply");
      assert(writes === 1, "Protection unexpectedly restored a backup");
    } finally { panel.dispose(); parent.remove(); }
  });

  for (const mode of ["cancel", "dispose"]) {
    test(`workspace: ${mode} during the final export snapshot prevents a download`, async () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      const current = draft(), downloads = [];
      let armed = false, stopped = false;
      const panel = mountWorkspacePanel({ document, parent,
        readDraft() {
          if (armed) {
            armed = false;
            if (mode === "cancel") q("cancel").click(); else panel.dispose();
            stopped = true;
          }
          return current;
        },
        writeDraft() { throw Error("Export must not write"); },
        download: ({ prepared }) => downloads.push(prepared),
      });
      const status = q("status");
      try {
        q("save").click();
        armed = true;
        await waitFor(() => stopped);
        assert(downloads.length === 0, "Cancelled export reached the download adapter");
        if (mode === "cancel") {
          assert(status.textContent.includes("取り消しました"), "Late success replaced cancellation");
          q("save").click();
          await waitFor(() => !q("save").disabled);
          assert(downloads.length === 1, "Explicit later save did not recover");
          assert(q("backup-status").textContent.includes("PCへの保存完了を確認"), "Unverified disk completion claimed");
        } else assert(parent.children.length === 0, "Disposed panel returned");
      } finally { panel.dispose(); parent.remove(); }
    });
  }

  test("workspace: cancellation inside a download adapter preserves the stop notice", async () => {
    const parent = document.createElement("section");
    document.querySelector("#grid").append(parent);
    let offers = 0;
    const panel = mountWorkspacePanel({ document, parent, readDraft: () => draft(),
      writeDraft() { throw Error("Export must not write"); },
      download() { offers++; q("cancel").click(); },
    });
    try {
      q("save").click();
      await waitFor(() => offers === 1);
      assert(q("status").textContent.includes("取り消しました"), "Stop notice replaced by stale success");
      assert(!q("backup-status").textContent.includes("開始済み"), "Interrupted export marked current");
      assert(!q("save").disabled, "Cancelled job left controls locked");
    } finally { panel.dispose(); parent.remove(); }
  });

  for (const source of ["stage", "file"]) {
    test(`workspace: ${source} cancelled during undo inspection cannot revive old plaintext`, async () => {
      const parent = document.createElement("section");
      document.querySelector("#grid").append(parent);
      let current = draft(), armed = false, stopped = false, writes = 0;
      const panel = mountWorkspacePanel({ document, parent,
        readDraft() {
          if (armed) {
            armed = false; q("cancel").click();
            q("json").value = "new unfinished local input";
            stopped = true;
          }
          return current;
        },
        writeDraft(value) { writes++; current = value; },
        download() { throw Error("Import must not download"); },
      });
      try {
        review(payload("20")); apply();
        assert(writes === 1, "Expected an existing undo checkpoint");
        if (source === "stage") {
          armed = true;
          assert(panel.stageText(payload("30")) === false, "Cancelled stage reported success");
        } else {
          const prepared = await prepareWorkspaceFile(workspaceFromDraft(draft("30")));
          const files = new DataTransfer();
          files.items.add(new File([prepared.text], "workspace.json", { type: "application/json" }));
          q("file").files = files.files;
          q("file").dispatchEvent(new Event("change", { bubbles: true }));
          armed = true;
          await waitFor(() => stopped);
        }
        assert(stopped, "Expected callback interruption");
        assert(q("json").value === "new unfinished local input", "Late plaintext overwrote input");
        assert(q("status").textContent.includes("取り消しました"), "Cancelled import reported ready");
        assert(q("apply").disabled && !q("confirmed").checked, "Old authority remained usable");
        assert(writes === 1, "Import performed an extra write");
      } finally { panel.dispose(); parent.remove(); }
    });
  }

  for (const mode of ["restore", "undo"]) {
    test(`workspace: ${mode} cancelled by provider cleanup rolls all three cards back`, async make => {
      let expectedChain = "0x2105", armed = false, cancelled = false;
      const f = make(args => args.method === "eth_chainId" ? expectedChain : undefined);
      const originalRemove = f.provider.removeListener;
      f.provider.removeListener = function (...args) {
        originalRemove.apply(this, args);
        if (armed && !cancelled) { cancelled = true; q("cancel").click(); }
      };
      const snapshot = () => AGENTS.map(agent => ({
        agent, account: card(agent, ".account").value, chain: card(agent, ".chain").value,
        token: card(agent, ".token").value, tokens: card(agent, ".portfolio-tokens").value,
        history: card(agent, ".history-list").textContent,
      }));
      if (mode === "undo") { review(); apply(); expectedChain = "0x14a34"; }
      await f.connect();
      const before = JSON.stringify(snapshot());
      const calls = f.calls.length;
      if (mode === "undo") { q("undo-preview").click(); check("undo-confirmed"); }
      else { review(); check("confirmed"); }
      armed = true;
      q(mode === "undo" ? "undo-apply" : "apply").click();
      assert(cancelled, "Provider cleanup did not cancel the restore");
      assert(q("status").textContent.includes("操作前へ戻しました"), "Cancellation reported as success");
      assert(JSON.stringify(snapshot()) === before, "A partial or cancelled restore survived");
      assert(f.field(".read").disabled, "Rollback must not restore connection permission");
      assert(f.calls.length === calls, "Rollback requested wallet access");
      assert(q("apply").disabled && q("undo-apply").disabled, "Cancelled confirmation remained usable");
      if (mode === "undo") assert(!q("undo-preview").disabled, "Earlier undo point was lost");
    });
  }

  test("workspace: interrupted restore with failed rollback exposes the original recovery copy", () => {
    const parent = document.createElement("section");
    document.querySelector("#grid").append(parent);
    let current = draft(), writes = 0;
    const before = JSON.stringify(current), downloads = [];
    const panel = mountWorkspacePanel({ document, parent, readDraft: () => current,
      writeDraft(value) {
        if (++writes > 1) throw Error("Synthetic unavailable target");
        current = value; q("cancel").click();
      }, download: ({ prepared }) => downloads.push(prepared) });
    try {
      review(payload("20")); apply();
      assert(q("status").textContent.includes("操作前の控え"), "Recovery instruction absent");
      assert(q("preview").disabled && q("apply").disabled, "Unsafe retry still enabled");
      assert(!q("recovery").disabled, "Recovery copy unavailable");
      q("recovery").click();
      assert(downloads.length === 1, "Expected one explicit recovery export");
      assert(JSON.stringify(JSON.parse(downloads[0].text).entries) === before, "Original recovery data changed");
      assert(writes === 2, "Unexpected retry after failed rollback");
    } finally { panel.dispose(); parent.remove(); }
  });

  test("workspace: initial panel does not request wallets or persist anything", make => {
    const f = make();
    assert(f.calls.length === 0, "no RPC");
    assert(q("apply").disabled, "review needed");
    assert(!q("replace").checked, "merge by default");
    assert(q("overview").textContent === "", "no fake observations");
  });

  test("workspace: preview is complete before any card changes", make => {
    make();
    review();
    assert(card("EMA", ".account").value === "", "EMA not yet changed");
    assert(q("detail").textContent.includes("CAWELON"), "all cards in review");
    assert(q("detail").textContent.includes("保存履歴: 0 → 1件"), "incoming history count");
    assert(q("apply").disabled, "explicit acknowledgement required");
  });

  test("workspace: confirmed restore fills all three cards without wallet calls", make => {
    const f = make();
    review();
    apply();
    AGENTS.forEach((agent, index) => {
      assert(card(agent, ".account").value === ACCOUNTS[index], agent + " address");
      assert(card(agent, ".chain").value === "84532", agent + " network");
      assert(card(agent, ".token").value === TOKEN, agent + " single token");
      assert(card(agent, ".portfolio-tokens").value === TOKEN, agent + " token list");
      assert(card(agent, ".history-list").children.length === 1, agent + " history");
      assert(card(agent, ".read").disabled, agent + " not connected");
    });
    assert(f.calls.length === 0, "no automatic provider calls");
  });

  test("workspace: changing an existing connected configuration disconnects it", async make => {
    const f = make();
    await f.connect();
    const calls = f.calls.length;
    review();
    apply();
    assert(f.field(".read").disabled, "connection invalidated");
    assert(!f.output().includes("接続済み"), "no stale connection label");
    assert(f.calls.length === calls, "restore does not request wallet");
  });

  test("workspace: restoring only histories leaves existing connection untouched", async make => {
    const f = make();
    await f.connect();
    const calls = f.calls.length;
    check("settings", false);
    review();
    apply();
    assert(f.output().includes("接続済み"), "unchanged connection retained");
    assert(f.field(".chain").value === "8453", "current network retained");
    assert(card("EMA", ".account").value === "", "unassigned EMA retained");
    assert(f.calls.length === calls, "no provider calls for history");
  });

  test("workspace: merge retains earlier history on every card", make => {
    make();
    review(payload("10"));
    apply();
    review(payload("20"));
    apply();
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 2, agent + " merged");
  });

  test("workspace: repeated restore deduplicates observations", make => {
    make();
    review();
    apply();
    review();
    apply();
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 1, agent + " deduplicated");
    assert(q("status").textContent.includes("変更はありません"), "no-op reported");
  });

  test("workspace: replacement cannot remove records without deletion confirmation", make => {
    make();
    review();
    apply();
    check("replace");
    review(payload(null));
    check("confirmed");
    q("apply").click();
    assert(q("apply").disabled, "deletion confirmation required");
    assert(card("DAT", ".history-list").children.length === 1, "history preserved");
    check("removal");
    q("apply").click();
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 0, agent + " explicitly replaced");
  });

  test("workspace: undo restores the preceding history and configuration", make => {
    make();
    review();
    apply();
    q("undo-preview").click();
    assert(q("undo-detail").textContent.includes("履歴: 1 → 0件"), "undo review");
    check("undo-confirmed");
    q("undo-apply").click();
    assert(card("EMA", ".account").value === "", "blank EMA restored");
    assert(card("DAT", ".chain").value === "8453", "original chain restored");
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 0, "original history restored");
  });

  test("workspace: editing a card cancels old review", make => {
    make();
    review();
    check("confirmed");
    input(card("EMA", ".account"), ACCOUNTS[2]);
    assert(q("apply").disabled, "review cancelled by form input");
    assert(q("detail").textContent === "", "stale summary removed");
  });

  test("workspace: editing token lists cancels old review", make => {
    make();
    review();
    input(card("DAT", ".portfolio-tokens"), TOKEN);
    assert(q("apply").disabled, "review invalidated");
    assert(!q("confirmed").checked, "confirmation removed");
  });

  test("workspace: an edit after restore disables direct undo and retains recovery option", make => {
    make();
    review();
    apply();
    input(card("EMA", ".account"), "unfinished");
    assert(q("undo-preview").disabled, "cannot overwrite new work");
    assert(!q("recovery").disabled, "original data still available");
  });

  test("workspace: setup-panel restore invalidates workspace review", make => {
    make();
    review();
    const json = document.querySelector(".wallet-setup-json");
    input(json, JSON.stringify({ schema: "threecore-wallet-setup-v1",
      entries: AGENTS.map((agent, index) => ({ agent, account: ACCOUNTS[index], chainId: 84532 })) }));
    document.querySelector(".wallet-setup-preview").click();
    const confirm = document.querySelector(".wallet-setup-confirm");
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    document.querySelector(".wallet-setup-apply").click();
    assert(q("apply").disabled, "workspace review cancelled");
  });

  test("workspace: conflict rejects the complete import without partial history", make => {
    make();
    review();
    apply();
    const value = JSON.parse(payload());
    value.entries[2].history.reports[0].snapshot.nativeBalanceBaseUnits = "999";
    review(JSON.stringify(value));
    assert(q("status").textContent.includes("矛盾"), "conflict explained");
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 1, "every card retained");
  });

  test("workspace: malicious address input cannot render markup", make => {
    make();
    const value = JSON.parse(payload());
    value.entries[0].account = '<img src="x" onerror="bad()">';
    review(JSON.stringify(value));
    assert(q("apply").disabled, "no malicious import");
    assert(document.querySelector(".workspace-panel img") === null, "no markup injected");
  });

  test("workspace: readable overview separates unknown history from live balances", make => {
    make();
    review();
    apply();
    q("inspect").click();
    assert(q("overview").textContent.includes("過去の観測値"), "historical label");
    assert(q("overview").textContent.includes("0.000000000000000016"), "exact ETH display");
    assert(q("overview").textContent.includes("合算しません"), "no invalid aggregate");
  });

  test("workspace: settings-only restore does not remove saved history", make => {
    make();
    review();
    apply();
    check("histories", false);
    check("replace");
    review(payload(null));
    apply();
    for (const agent of AGENTS) assert(card(agent, ".history-list").children.length === 1, "history exclusion respected");
  });

  test("workspace: disposal removes the panel and retained buttons cannot write", make => {
    const f = make();
    review();
    check("confirmed");
    const applyButton = q("apply");
    f.app.dispose();
    applyButton.click();
    assert(document.querySelector(".workspace-panel") === null, "panel removed");
    assert(f.calls.length === 0, "retained button inert");
  });

  // Real DOM file input and Web Crypto, using synthetic local state only.
  async function isolated(action) {
    const parent = document.createElement("section");
    document.querySelector("#grid").append(parent);
    let current = draft();
    const downloads = [];
    const panel = mountWorkspacePanel({ document, parent,
      readDraft: () => current, writeDraft: value => { current = value; },
      download: ({ prepared }) => downloads.push(prepared) });
    try {
      await action({ current: () => current, downloads,
        choose(file) {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          q("file").files = transfer.files;
          q("file").dispatchEvent(new Event("change"));
        } });
    } finally { panel.dispose(); parent.remove(); }
  }

  test("workspace: actual browser Blob save and file import preserve all observations", async () => {
    await isolated(async ({ downloads, choose, current }) => {
      q("save").click();
      await waitFor(() => downloads.length === 1);
      const saved = downloads[0];
      assert(saved.filename.endsWith(".json"), "JSON file");
      choose(new File([saved.text], "backup.json", { type: "application/json" }));
      await waitFor(() => q("status").textContent.includes("破損確認が一致"));
      q("preview").click();
      apply();
      assert(current().every(row => JSON.parse(row.history).reports.length === 1), "all histories retained");
    });
  });

  test("workspace: browser file checksum failure leaves cards unchanged", async () => {
    await isolated(async ({ choose, current }) => {
      const file = await prepareWorkspaceFile(workspaceFromDraft(draft()));
      const changed = JSON.parse(file.text);
      changed.digest = "0".repeat(64);
      choose(new File([JSON.stringify(changed)], "backup.json"));
      await waitFor(() => q("status").textContent.includes("破損確認が一致しません"));
      assert(q("apply").disabled, "no apply after corrupt file");
      assert(current()[0].account === ACCOUNTS[0], "current data untouched");
    });
  });

  test("workspace: a cancelled browser file read cannot revive old preview", async () => {
    await isolated(async ({ choose }) => {
      const saved = await prepareWorkspaceFile(workspaceFromDraft(draft()));
      review();
      choose(new File([saved.text], "backup.json"));
      q("cancel").click();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert(q("apply").disabled, "old apply remains disabled");
      assert(!q("confirmed").checked, "old confirmation removed");
    });
  });

  test("workspace: local text report export does not pretend to be current blockchain data", async () => {
    await isolated(async ({ downloads }) => {
      q("save-summary").click();
      assert(downloads.length === 1, "text saved");
      assert(downloads[0].text.includes("現在の残高・接続・所有・安全性を証明しません"), "limits preserved");
      assert(downloads[0].mimeType.startsWith("text/plain"), "readable text");
    });
  });
}
