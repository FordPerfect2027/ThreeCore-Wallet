import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { decodeRehearsal, encodeRehearsal, evaluateRehearsal, parseRehearsalUnits,
  formatRehearsalUnits, REHEARSAL_LIMIT, REHEARSAL_SCHEMA_V2 } from "../src/operation-rehearsal.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { rehearsalCsv } from "../src/operation-rehearsal-ledger.js";
import { decodeRehearsalWorkspace, encodeRehearsalWorkspace,
  reportRehearsalWorkspace, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { offerWalletDownload } from "./export-download.js";
import { compareRehearsalWorkspaces, encodeRehearsalComparison } from "../src/operation-rehearsal-comparison.js";
import { reportRehearsalOverview, filterRehearsalOverview, encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { mountRehearsalScenarioPanel } from "./operation-rehearsal-scenario-panel.js";
import { mountRehearsalReviewPanel } from "./operation-rehearsal-review-panel.js";
import { mountRehearsalScenarioSetPanel } from "./operation-rehearsal-scenario-set-panel.js";
import { mountRehearsalCheckPanel } from "./operation-rehearsal-check-panel.js";
import { mountRehearsalRecordsPanel } from "./operation-rehearsal-records-panel.js";
import { createRehearsalSession } from "../src/operation-rehearsal-session.js";
import { mountRehearsalSessionPanel } from "./operation-rehearsal-session-panel.js";

const REASONS = Object.freeze({
  PAUSED: "新規利用の停止中", REUSED_OPERATION: "同じ操作の再利用", UNLISTED_ORIGIN: "対象外のサイト",
  UNLISTED_SPENDER: "対象外の契約", ZERO_PRINCIPAL: "元本が0", PER_OPERATION_LIMIT: "1回の上限超過",
  OUTSTANDING_LIMIT: "未決済元本の上限超過", INSUFFICIENT_BALANCE: "資金不足", RESERVE_FLOOR: "予備資金を下回る",
  LOSS_LIMIT: "全額損失時に損失上限を超える", NO_OPEN_POSITION: "対応する未決済記録がない",
  INSUFFICIENT_FEE_BALANCE: "費用の資金不足", BALANCE_OVERFLOW: "金額の上限超過",
  WRONG_AGENT: "対象トークンが異なる", WRONG_CHAINID: "ネットワークが異なる", WRONG_ACCOUNT: "口座が異なる",
  REJECTED_RECORDS: "条件に合わない記録あり", UNSETTLED_POSITIONS: "未決済の記録あり",
  NO_NET_PROFIT: "累計の利益なし", NO_AVAILABLE_CASH: "予備資金を除く資金なし",
  ENTRY_FEE_LIMIT: "開始費用の上限超過", EXIT_FEE_LIMIT: "決済費用の上限超過",
  EXIT_FEE_RESERVE_EXCEEDED: "確保した決済費用を超える", REUSED_RESERVATION: "予約IDの再利用",
  ZERO_RESERVATION: "予約額が0", ALLOCATION_LIMIT: "予約できる還元額を超える",
  NO_RESERVATION: "取消対象の予約がない", ALLOCATION_OVERCOMMITTED: "現在の利益に対して予約額が過大",
});
const KINDS = { open: "投入", settle: "決済", deposit: "追加資金", withdraw: "資金引出し", reserve: "還元予約", release: "予約取消" };
const FIELD_POLICY = { maximum: "maxPerOperation", "outstanding-limit": "maxOutstanding",
  reserve: "reserveFloor", "loss-limit": "lossLimit" };
const REVIEW_FIELDS = Object.freeze({ chainId: "ネットワーク番号", account: "記録上の口座", assetAddress: "資産の契約アドレス",
  symbol: "資産名", decimals: "小数桁数", origin: "記録上のサイト", spender: "記録上の利用先契約", schema: "記録の形式",
  openingBalance: "開始時の資金", maxPerOperation: "1回の元本上限", maxOutstanding: "未決済元本の上限",
  reserveFloor: "予備資金", lossLimit: "損失上限", buybackBps: "仮の還元割合", paused: "新しい利用の停止",
  maxEntryFee: "開始費用の上限", maxExitFee: "決済費用の上限" });
const REVIEW_ACTIONS = Object.freeze({ absent: "未作成のまま", added: "復旧する", removed: "履歴を消去する",
  unchanged: "内容は同じ", replaced: "置き換える" });

export function mountOperationRehearsal(document, download = offerWalletDownload) {
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope();
  const get = name => document.getElementById(name);
  let current = null, candidate = null, revision = 0, disposed = false;
  const session = createRehearsalSession(get("agent").value), ledger = session.workspace;
  let scenarioSetPanel = null;
  const scenarioPanel = mountRehearsalScenarioPanel(document, { download, reasons: REASONS, kinds: KINDS,
    onChange: () => scenarioSetPanel?.sourceChanged() });
  scenarioSetPanel = mountRehearsalScenarioSetPanel(document, { download, store: session.cases, getComparison: () => scenarioPanel.comparison() });
  const reportReviewPanel = mountRehearsalReviewPanel(document, { download });
  const checkPanel = mountRehearsalCheckPanel(document, { download, reasons: REASONS });
  const recordsPanel = mountRehearsalRecordsPanel(document, { download, reasons: REASONS, kinds: KINDS });
  const sessionPanel = mountRehearsalSessionPanel(document, { session, download,
    renderWorkspaceComparison: comparison => renderComparisonDetails(comparison, get("session-workspace-details")),
    onRestored: () => {get("agent").value=ledger.state().activeAgent;const input=ledger.state().current;
      if(input)show(input,true);else clear("選択中の対象は未作成です。",true);scenarioSetPanel.refresh();} });
  let appendReview = null, workspaceReview = null, workspaceComparison = null;
  let workspacePhase = "idle", workspaceSource = "";
  const listeners = [];
  const listen = (name, type, handler) => {
    get(name).addEventListener(type, handler);
    listeners.push(() => get(name).removeEventListener(type, handler));
  };
  function cancelAppend() {
    fileReader.cancel(); get("file").setAttribute("aria-busy", "false");
    revision++; workspaceReview = null; get("workspace-apply").disabled = true;
    workspaceComparison = null; get("workspace-review-save").disabled = true;
    get("workspace-review-status").textContent = ""; get("workspace-details").textContent = "";
    get("workspace-preview").textContent = "";
    get("workspace-changes").textContent = ""; get("workspace-comparison").hidden = true;
    get("workspace-source").textContent = ""; workspaceSource = "";
    if (workspacePhase !== "idle") setWorkspaceStage("idle",
      "入力・表示が変わりました。復旧する場合は保存した記録をもう一度選んでください。");
    appendReview = null; ledger.cancel(); get("append-confirm").disabled = true;
    get("append-summary").textContent = "";
  }
  function setWorkspaceStage(phase, message) {
    workspacePhase = phase;
    const captions = { idle: "1 / 3 — 保存した記録を選ぶ", reading: "1 / 3 — 記録を確認中",
      review: "2 / 3 — 選択できています。次は復旧ボタンを押してください", complete: "3 / 3 — 復旧が完了しました",
      error: "読み込めませんでした — 現在の履歴は変更していません" };
    get("workspace-stage").textContent = captions[phase];
    get("workspace-stage").setAttribute("data-stage", phase);
    get("workspace-status").textContent = message;
    get("workspace-file").setAttribute("aria-busy", String(phase === "reading"));
    if (["review", "complete", "error"].includes(phase)) get("workspace-stage").focus?.();
  }
  function beginWorkspaceRead(source) {
    cancelAppend(); candidate = null; get("apply").disabled = true; get("preview").textContent = "";
    workspaceSource = source; get("workspace-source").textContent = "確認する記録: " + source;
    get("workspace-file-note").textContent = "";
    setWorkspaceStage("reading", "現在の履歴を表示したまま確認しています。まだ置き換えていません。");
    return revision;
  }
  function reviewWorkspaceText(text) {
    const data = decodeRehearsalWorkspace(text);
    if (data.ledgers.some(item => item.asset.symbol !== "SIM" || item.asset.decimals !== 6))
      throw Object.assign(new Error("SIM required"), { code: "SIM_REQUIRED" });
    workspaceComparison = compareRehearsalWorkspaces(ledger.snapshot(), data);
    workspaceReview = ledger.previewRestore(data);
    get("workspace-changes").textContent = "";
    const count = row => row.present ? row.recordCount + "件" : "未作成";
    for (let i = 0; i < workspaceReview.after.rows.length; i++) {
      const before = workspaceReview.before.rows[i], after = workspaceReview.after.rows[i];
      const action = REVIEW_ACTIONS[workspaceComparison.rows[i].action];
      const tr = document.createElement("tr");
      for (const value of [after.agent, count(before), count(after), action]) {
        const td = document.createElement("td"); td.textContent = value; tr.append(td);
      }
      get("workspace-changes").append(tr);
    }
    get("workspace-comparison").hidden = false;
    renderComparisonDetails(workspaceComparison);
    get("workspace-review-save").disabled = false;
    get("workspace-preview").textContent = workspaceReview.after.rows.map(row => row.agent + ": " +
      (row.present ? row.recordCount + "件に置換" : "未作成に戻す")).join(" / ") +
      "。表示対象: " + data.activeAgent + "。復旧すると3トークンの現在の履歴をまとめて置き換え、取り消し履歴は消えます。まだ反映していません。";
    get("workspace-apply").disabled = false;
    setWorkspaceStage("review", "上の一覧は現在の履歴です。下の変更内容を確認し、「確認した3トークンの履歴を復旧」を押してください。必要なら現在の履歴を先に一括保存できます。");
  }
  function renderComparisonDetails(comparison, root = get("workspace-details")) {
    root.textContent = "";
    const note = document.createElement("p"); note.className = "small";
    note.textContent = "ファイルに記載された情報同士の照合です。実際の口座・ネットワーク・契約の正しさは確認していません。「内容は同じ」は書式を除いた入力内容の一致です。" +
      (comparison.selectedAgentChanged ? " 復旧後の表示対象: " + comparison.inputs.before.activeAgent + " → " + comparison.inputs.after.activeAgent + "。" : "");
    root.append(note);
    for (const row of comparison.rows) {
      if (!row.before && !row.after) continue;
      const details = document.createElement("details"); details.className = "review-detail";
      const heading = document.createElement("summary");
      heading.textContent = row.agent + "の照合詳細 — " + REVIEW_ACTIONS[row.action]; details.append(heading);
      const intro = document.createElement("p"); intro.className = "small";
      intro.textContent = "記録の追加 " + row.eventChanges.added.length + "件 / 削除 " + row.eventChanges.removed.length +
        "件 / 同じIDの内容変更 " + row.eventChanges.modified.length + "件 / 共通する記録の順序変更: " +
        (row.eventChanges.orderChanged ? "あり" : "なし") + "。";
      details.append(intro);
      if (row.before && row.after && row.contextChanges.length) {
        const changed = document.createElement("p"); changed.className = "comparison-note";
        changed.textContent = "変わる項目: " + row.contextChanges.map(item => REVIEW_FIELDS[item.field]).join("・") + "。";
        details.append(changed);
      }
      if (row.before && row.after && !row.sameAccountingContext) {
        const different = document.createElement("p"); different.className = "comparison-note";
        different.textContent = "口座・ネットワーク・資産のいずれかが異なります。異なる対象の金額を合算・差し引きしていません。";
        details.append(different);
      }
      function table(caption, entries) {
        const wrap = document.createElement("div"); wrap.className = "table-wrap";
        const table = document.createElement("table"), title = document.createElement("caption"); title.textContent = caption; table.append(title);
        const head = document.createElement("tr");
        for (const label of ["確認する項目", "現在", "復旧後"]) { const cell = document.createElement("th"); cell.setAttribute("scope", "col"); cell.textContent = label; head.append(cell); }
        table.append(head);
        for (const entry of entries) {
          const tr = document.createElement("tr");
          for (const value of entry) { const cell = document.createElement("td"); cell.textContent = value; tr.append(cell); }
          table.append(tr);
        }
        wrap.append(table); details.append(wrap);
      }
      const contextValue = (summary, key) => summary ? String(summary.context[key]) : "未作成";
      table("口座・ネットワーク・資産・利用先", ["chainId", "account", "assetAddress", "symbol", "decimals", "origin", "spender", "schema"]
        .map(key => [REVIEW_FIELDS[key], contextValue(row.before, key), contextValue(row.after, key)]));
      const policyValue = (value, key, summary) => {
        if (!summary) return "未作成";
        if (value === null) return "この形式には項目なし";
        if (key === "paused") return value ? "停止" : "停止していない";
        if (key === "buybackBps") return formatRehearsalUnits(String(value), 2) + "%";
        return formatRehearsalUnits(value, summary.context.decimals) + " " + summary.context.symbol;
      };
      if (row.policyChanges.length) table("変わる利用条件", row.policyChanges.map(change => [REVIEW_FIELDS[change.field],
        policyValue(change.before, change.field, row.before), policyValue(change.after, change.field, row.after)]));
      else { const unchanged = document.createElement("p"); unchanged.textContent = "利用条件の変更はありません。"; details.append(unchanged); }
      if (row.after) {
        const findings = document.createElement("p"); findings.className = "small";
        findings.textContent = "復旧後の試算: 条件外の記録 " + row.after.rejectedRecords + "件、未決済 " + row.after.openPositions +
          "件、利益を超える予約: " + (row.after.allocationOvercommitted ? "あり" : "なし") + "。実行の許可を示すものではありません。";
        details.append(findings);
      }
      for (const [key, label] of [["added", "追加する記録ID"], ["removed", "削除する記録ID"], ["modified", "内容が変わる記録ID"]]) {
        const ids = row.eventChanges[key]; if (!ids.length) continue;
        const p = document.createElement("p"); p.className = "small";
        p.textContent = label + ": " + ids.slice(0, 8).join(", ") + (ids.length > 8 ? " ほか" + (ids.length - 8) + "件（全件は照合資料に含まれます）" : "");
        details.append(p);
      }
      root.append(details);
    }
  }
  function workspaceReadFailed(error) {
    const reason = describeFileReadError(error, "512 KiB") ?? {
      FILE_TOO_LARGE: "記録が大きすぎます。一括ファイルは512 KiB以内、各トークンの記録は128 KiB以内です。",
      EMPTY_INPUT: "記録が空です。保存した一括JSONの全文を指定してください。",
      INVALID_JSON: "JSONの内容を読み取れません。一括保存したファイルの全文を指定してください。",
      DUPLICATE_AGENT: "同じトークンの記録が重複しています。一括保存した元のファイルを選び直してください。",
      SIM_REQUIRED: "この画面で扱えるのは小数6桁の練習用SIMの記録です。",
      SIMULATION_REQUIRED: "一括試算の形式ではありません。単体の記録は下の「保存した記録を選ぶ」から読み込んでください。",
    }[error?.code] ?? "この一括試算の記録を確認できませんでした。一括保存した元のファイルを選び直してください。";
    cancelAppend();
    setWorkspaceStage("error", reason + " 現在の履歴は保持しています。");
  }
  function clear(message = "入力が変わりました。もう一度試算してください。", keepLedger = false) {
    revision++; current = null; candidate = null;
    scenarioPanel.refresh(null);
    cancelAppend(); if (!keepLedger) ledger.clear();
    get("save").disabled = true; get("apply").disabled = true;
    for (const name of ["csv-save", "append-preview", "undo"]) get(name).disabled = true;
    for (const name of ["metrics", "rows", "allocation-note", "context", "preview", "ledger-details"]) get(name).textContent = "";
    get("status").textContent = message;
    renderWorkspace();
  }
  function renderWorkspace() {
    const report = reportRehearsalWorkspace(ledger.snapshot());
    get("workspace-rows").textContent = "";
    for (const row of report.rows) {
      const tr = document.createElement("tr");
      const money = value => formatRehearsalUnits(value, row.report.asset.decimals) + " " + row.report.asset.symbol;
      const cells = row.present ? [row.agent, row.recordCount + "件", money(row.report.realizedPnl),
        money(row.report.reservedAllocations), money(row.report.proposedOwnTokenBuybackBudget)]
        : [row.agent, "未作成", "—", "—", "—"];
      for (const value of cells) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
      get("workspace-rows").append(tr);
    }
    get("workspace-save").disabled = report.presentAgents === 0;
    renderOverview();
    recordsPanel.refresh(ledger.snapshot());
  }
  function renderOverview() {
    const report = reportRehearsalOverview(ledger.snapshot());
    const agent = get("overview-agent").value || "all", kind = get("overview-kind").value || "all";
    const entries = filterRehearsalOverview(report, agent, kind);
    get("overview-cards").textContent = "";
    get("overview-rows").textContent = "";
    get("overview-save-status").textContent = "";
    get("overview-save").disabled = !report.inputs.ledgers.length;
    for (const row of report.rows) {
      const card = document.createElement("article"); card.className = "overview-card";
      const title = document.createElement("h3"); title.textContent = row.agent; card.append(title);
      const status = document.createElement("p");
      status.textContent = row.present ? "履歴 " + row.recordCount + "件 · 未決済 " + row.openPositions +
        "件 · 還元予約 " + row.reservations + "件 · 条件外 " + row.rejectedRecords + "件" : "未作成 — 残高・件数は未確認";
      card.append(status);
      if (row.present) {
        if (row.allocationShortfall !== "0") {
          const warning = document.createElement("p"); warning.className = "blocked";
          warning.textContent = "利益に対する予約超過: " + formatRehearsalUnits(row.allocationShortfall, row.context.asset.decimals) + " " + row.context.asset.symbol;
          card.append(warning);
        }
        const details = document.createElement("details"), summary = document.createElement("summary"), context = document.createElement("p");
        summary.textContent = row.agent + "の記録条件"; context.className = "small";
        context.textContent = "ネットワーク " + row.context.chainId + " / 口座 " + row.context.account +
          " / 資産 " + row.context.asset.symbol + " (" + row.context.asset.address + ") / サイト " + row.context.origin +
          " / 利用先契約 " + row.context.spender;
        details.append(summary, context); card.append(details);
      }
      get("overview-cards").append(card);
    }
    const labels = { position: "未決済", reservation: "還元予約", rejected: "条件外" };
    for (const entry of entries) {
      const tr = document.createElement("tr");
      const money = value => formatRehearsalUnits(value, entry.context.asset.decimals) + " " + entry.context.asset.symbol;
      const description = entry.kind === "position" ? "元本 " + money(entry.amount) + " / 確保した決済費用 " + money(entry.exitFeeReserve)
        : entry.kind === "reservation" ? "予約額 " + money(entry.amount)
        : entry.reasons.map(code => REASONS[code] ?? code).join("・") + "（計上なし）";
      const source = entry.recordNumber + "番目: " + entry.recordId + " / " + KINDS[entry.eventKind] +
        (entry.kind === "rejected" ? " / 記録の対象 " + entry.eventContext.agent + " / ネットワーク " + entry.eventContext.chainId +
          " / 口座 " + entry.eventContext.account : "");
      for (const value of [entry.agent, labels[entry.kind], entry.id, description, source]) {
        const td = document.createElement("td"); td.textContent = value; tr.append(td);
      }
      if (entry.kind === "rejected") tr.className = "blocked";
      get("overview-rows").append(tr);
    }
    const present = report.rows.filter(row => row.present && (agent === "all" || row.agent === agent));
    get("overview-status").textContent = !present.length ? "この対象の履歴は未作成です。0件の確認結果ではありません。"
      : entries.length ? "表示 " + entries.length + "件。確定した試算履歴から再計算しています。"
      : "この絞り込みに該当する記録は0件です。実行許可や安全性の判定ではありません。";
  }
  function show(data, keepLedger = false) {
    const report = evaluateRehearsal(data);
    encodeRehearsal(data);
    const formatted = value => formatRehearsalUnits(value, data.asset.decimals) + " " + data.asset.symbol;
    clear(undefined, true);
    if (!keepLedger) data = ledger.reset(data);
    current = data;
    scenarioPanel.refresh(data);
    get("agent").value = data.agent;
    get("opening").value = formatRehearsalUnits(data.openingBalance, data.asset.decimals);
    for (const [field, key] of Object.entries(FIELD_POLICY))
      get(field).value = formatRehearsalUnits(data.policy[key], data.asset.decimals);
    get("allocation").value = formatRehearsalUnits(String(data.policy.buybackBps), 2);
    get("paused").checked = data.policy.paused;
    get("entry-limit").value = formatRehearsalUnits(data.policy.maxEntryFee ?? "3000000", 6);
    get("exit-limit").value = formatRehearsalUnits(data.policy.maxExitFee ?? "5000000", 6);
    const firstOpen = data.events.find(event => event.kind === "open");
    const firstClose = data.events.find(event => event.kind === "settle");
    for (const [field, value] of [["principal", firstOpen?.principal ?? "0"],
      ["entry-fee", firstOpen?.fee ?? "0"], ["returned", firstClose?.grossReturn ?? "0"],
      ["exit-fee", firstClose?.fee ?? "0"], ["exit-reserve", firstOpen?.exitFeeReserve ?? "2000000"]])
      get(field).value = formatRehearsalUnits(value, data.asset.decimals);
    for (const [label, value] of [["手元資金", report.cash], ["未決済元本", report.outstanding],
      ["累計実現損益", report.realizedPnl], ["費用合計", report.fees],
      ["確保した決済費用", report.reservedExitFees], ["予約済みの還元額", report.reservedAllocations],
      ["予約を除く手元資金", report.availableCash], ["利益を超える予約額", report.allocationShortfall]]) {
      const item = document.createElement("div"); item.className = "metric";
      const caption = document.createElement("span"); caption.textContent = label;
      const number = document.createElement("strong"); number.textContent = formatted(value);
      item.append(caption, number); get("metrics").append(item);
    }
    for (const row of report.rows) {
      const tr = document.createElement("tr");
      const cells = [KINDS[row.kind] + " / " + row.id,
        row.withinEnteredLimits ? "仮の条件内" : row.reasons.map(code => REASONS[code] ?? "条件不一致").join("・"),
        formatted(row.cash), formatted(row.outstanding), formatted(row.realizedPnl),
        formatted(row.reservedExitFees), formatted(row.reservedAllocations)];
      for (const value of cells) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
      tr.className = row.withinEnteredLimits ? "passed" : "blocked";
      get("rows").append(tr);
    }
    get("allocation-note").textContent = report.allocationBlockers.length
      ? "追加で予約できる自トークン買戻し額: 0 — " + report.allocationBlockers.map(code => REASONS[code]).join("・")
      : "追加で予約できる自トークン買戻し額: " + formatted(report.proposedOwnTokenBuybackBudget) + "（実行されません）";
    get("context").textContent = data.agent + " / チェーン " + data.chainId + " / 仮の口座 " + data.account +
      " / 入力された対象: " + data.policy.origin + " / " + data.policy.spender +
      " / 記録上の資産: " + data.asset.symbol + " / " + data.asset.address;
    get("status").textContent = report.rows.some(row => !row.withinEnteredLimits)
      ? "条件に合わない記録を見送り、その理由を表示しました。見送った記録は資金・損益に加えていません。"
      : "試算が完了しました。元本・費用・損益の計算は整合しています。すべて入力に基づく仮の結果です。";
    get("save").disabled = false;
    get("csv-save").disabled = false;
    get("append-preview").disabled = data.schema !== REHEARSAL_SCHEMA_V2;
    get("undo").disabled = !ledger.state().canUndo;
    get("ledger-details").textContent = (data.schema === REHEARSAL_SCHEMA_V2 ? "新形式 / " : "旧形式（追記不可・形式を保って保存） / ") +
      data.events.length + "件。未決済ID: " + (report.positions.map(item => item.operationId).join(", ") || "なし") +
      "。予約ID: " + (report.reservations.map(item => item.reservationId + "=" + formatted(item.amount)).join(", ") || "なし") +
      "。取り消せる追記: " + ledger.state().undoCount + "件。";
    renderWorkspace();
  }
  function fromFields(pending) {
    // Editable forms always create a fresh fictional six-decimal SIM scenario.
    const data = JSON.parse(encodeRehearsal(rehearsalExampleV2(get("agent").value, pending ? "pending" : "profit")));
    const units = name => parseRehearsalUnits(get(name).value, 6);
    data.openingBalance = units("opening");
    for (const [field, key] of Object.entries(FIELD_POLICY)) data.policy[key] = units(field);
    const allocation = BigInt(parseRehearsalUnits(get("allocation").value, 2));
    if (allocation > 10000n) throw new Error("Invalid allocation");
    data.policy.buybackBps = Number(allocation); data.policy.paused = get("paused").checked;
    data.policy.maxEntryFee = units("entry-limit"); data.policy.maxExitFee = units("exit-limit");
    data.events[0].principal = units("principal"); data.events[0].fee = units("entry-fee");
    data.events[0].exitFeeReserve = units("exit-reserve");
    if (!pending) { data.events[1].grossReturn = units("returned"); data.events[1].fee = units("exit-fee"); }
    return data;
  }
  function calculate(pending) {
    if (disposed) return;
    try { const data = fromFields(pending); show(data); }
    catch { clear("入力を確認してください。金額は0以上・小数6桁まで、還元割合は0〜100%です。"); }
  }
  for (const name of ["opening", ...Object.keys(FIELD_POLICY), "allocation", "principal", "entry-fee", "returned", "exit-fee",
    "entry-limit", "exit-limit", "exit-reserve"])
    listen(name, "input", () => clear());
  for (const name of ["paused", "scenario"]) listen(name, "change", () => clear());
  listen("agent", "change", () => {
    if (disposed) return;
    const name = get("agent").value;
    clear("この対象にはまだ履歴がありません。例を表示するか、記録を読み込んでください。", true);
    const data = ledger.select(name);
    if (data) show(data, true);
    renderWorkspace();
  });
  listen("calculate", "click", () => calculate(false));
  listen("pending", "click", () => calculate(true));
  listen("example", "click", () => { if (!disposed) show(rehearsalExampleV2(get("agent").value, get("scenario").value)); });
  listen("save", "click", () => {
    if (disposed || !current) return;
    const own=revision; try {
      const data = current;
      offerDownload({ document, prepared: { text: encodeRehearsal(data),
        filename: "ThreeCore-" + data.agent + "-operation-rehearsal.json", mimeType: "application/json" } });if(disposed||own!==revision)return;
      get("status").textContent = "保存を開始しました。ファイルには仮の入力と記録が含まれます。";
    } catch {if(disposed||own!==revision)return; get("status").textContent = "保存を開始できませんでした。もう一度お試しください。"; }
  });
  listen("csv-save", "click", () => {
    if (disposed || !current) return;
    const own=revision; try {
      offerDownload({ document, prepared: { text: rehearsalCsv(current),
        filename: "ThreeCore-" + current.agent + "-rehearsal-ledger.csv", mimeType: "text/csv" } });if(disposed||own!==revision)return;
      get("status").textContent = "CSVの保存を開始しました。金額は最小単位です。表計算ソフトには文字列として読み込んでください。";
    } catch {if(disposed||own!==revision)return; get("status").textContent = "CSVの保存を開始できませんでした。"; }
  });
  for (const name of ["append-reference", "append-amount", "append-fee", "append-exit-reserve"])
    listen(name, "input", cancelAppend);
  listen("append-kind", "change", cancelAppend);
  listen("append-preview", "click", () => {
    cancelAppend(); if (disposed || !current || current.schema !== REHEARSAL_SCHEMA_V2) return;
    try {
      const kind = get("append-kind").value, reference = get("append-reference").value;
      const units = name => parseRehearsalUnits(get(name).value, 6);
      let serial = current.events.length + 1;
      while (current.events.some(event => event.id === "step-" + serial)) serial++;
      const event = { id: "step-" + serial, kind, agent: current.agent, chainId: current.chainId, account: current.account };
      if (kind === "open") Object.assign(event, { operationId: reference, origin: current.policy.origin,
        spender: current.policy.spender, principal: units("append-amount"), fee: units("append-fee"), exitFeeReserve: units("append-exit-reserve") });
      if (kind === "settle") Object.assign(event, { operationId: reference, grossReturn: units("append-amount"), fee: units("append-fee") });
      if (["deposit", "withdraw", "reserve"].includes(kind)) event.amount = units("append-amount");
      if (["reserve", "release"].includes(kind)) event.reservationId = reference;
      appendReview = ledger.preview(event);
      const money = value => formatRehearsalUnits(value, 6) + " SIM";
      get("append-summary").textContent = KINDS[kind] + " / " + event.id + " — " +
        (appendReview.accepted ? "仮の条件内。" : "見送り: " + appendReview.reasons.map(code => REASONS[code]).join("・") +
          "。追記すると見送り記録が残り、還元予約は停止します。") +
        " 手元資金 " + money(appendReview.before.cash) + " → " + money(appendReview.after.cash) +
        "、累計損益 " + money(appendReview.before.realizedPnl) + " → " + money(appendReview.after.realizedPnl) +
        "、予約済み還元 " + money(appendReview.before.reservedAllocations) + " → " + money(appendReview.after.reservedAllocations) +
        "。まだ履歴には反映していません。";
      get("append-confirm").disabled = false;
    } catch { cancelAppend(); get("append-summary").textContent = "追記内容を確認してください。IDは英数字・ハイフン・下線で64文字まで、履歴は200件までです。"; }
  });
  listen("append-confirm", "click", () => {
    if (disposed || !appendReview) return;
    try { const next = ledger.commit(appendReview); show(next, true); }
    catch { cancelAppend(); get("status").textContent = "追記内容をもう一度確認してください。"; }
  });
  listen("append-cancel", "click", cancelAppend);
  listen("undo", "click", () => {
    if (disposed) return;
    try { show(ledger.undo(), true); get("status").textContent = "直前の追記を取り消し、予約と損益も再計算しました。"; }
    catch { get("status").textContent = "取り消せる追記がありません。"; }
  });
  listen("file", "change", async () => {
    if (disposed) return;
    const file = get("file").files?.[0];
    if (!file) return;
    get("file").value = "";
    clear("ファイルを確認しています（最大30秒）。", true); const own = revision;
    get("file").setAttribute("aria-busy", "true");
    try {
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_LIMIT });
      if (disposed || own !== revision) return;
      const data = decodeRehearsal(text); const report = evaluateRehearsal(data);
      if (data.asset.symbol !== "SIM" || data.asset.decimals !== 6)
        throw new Error("This page uses fictional SIM units with six decimals");
      if (disposed || own !== revision) return;
      candidate = data; get("apply").disabled = false;
      get("preview").textContent = data.agent + " / " + data.asset.symbol + " / " + report.rows.length +
        "件の仮の記録。表示する場合は「確認した記録を表示」を押してください。";
      get("status").textContent = "読み込み内容を確認してください。まだ表示に反映していません。";
    } catch (error) {
      if (disposed || own !== revision) return;
      clear((describeFileReadError(error, "128 KiB") ?? "ファイルを確認できませんでした。この画面で保存した128 KiB以内の試算JSONを選んでください。") + " 現在の履歴は保持しています。", true);
    } finally { if (!disposed && own === revision) get("file").setAttribute("aria-busy", "false"); }
  });
  listen("apply", "click", () => {
    if (disposed || !candidate) return;
    const data = candidate; candidate = null; show(data);
  });
  listen("cancel", "click", () => { clear("読み込み・表示をクリアしました。"); get("file").value = ""; });
  listen("workspace-save", "click", () => {
    if (disposed) return;
    const data = ledger.snapshot(); if (!data.ledgers.length) return;
    const own=revision; try {
      offerDownload({ document, prepared: { text: encodeRehearsalWorkspace(data),
        filename: "ThreeCore-operation-workspace.json", mimeType: "application/json" } });if(disposed||own!==revision)return;
      get("workspace-status").textContent = "3トークン分の保存を開始しました。作成済みの確定した試算履歴だけが含まれます。";
    } catch {if(disposed||own!==revision)return; get("workspace-status").textContent = "一括保存を開始できませんでした。"; }
  });
  for (const name of ["overview-agent", "overview-kind"]) listen(name, "change", () => {
    if (!disposed) renderOverview();
  });
  listen("overview-save", "click", () => {
    if (disposed) return;
    const data = ledger.snapshot(); if (!data.ledgers.length) return;
    const own=revision; try {
      offerDownload({ document, prepared: { text: encodeRehearsalOverview(data),
        filename: "ThreeCore-workspace-overview.json", mimeType: "application/json" } });if(disposed||own!==revision)return;
      get("overview-save-status").textContent = "全対象の確認一覧と元の入力記録の保存を開始しました。絞り込みに関係なく全件を含みます。復旧用ファイルは一括保存を使ってください。";
    } catch {if(disposed||own!==revision)return; get("overview-save-status").textContent = "確認一覧を保存できませんでした。現在の履歴は保持しています。"; }
  });
  listen("workspace-file", "change", async () => {
    if (disposed) return;
    const file = get("workspace-file").files?.[0];
    if (!file) return;
    get("workspace-file").value = ""; get("workspace-text").value = "";
    const name = typeof file.name === "string" ? file.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 160) : "一括ファイル";
    const own = beginWorkspaceRead(name || "一括ファイル");
    try {
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > REHEARSAL_WORKSPACE_LIMIT)
        throw Object.assign(new Error("File size"), { code: file.size === 0 ? "EMPTY_INPUT" : "FILE_TOO_LARGE" });
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_WORKSPACE_LIMIT }); if (disposed || own !== revision) return;
      reviewWorkspaceText(text);
    } catch (error) {
      if (disposed || own !== revision) return;
      workspaceReadFailed(error);
    }
  });
  listen("workspace-review-save", "click", () => {
    if (disposed || !workspaceReview || !workspaceComparison) return;
    const own=revision; try {
      offerDownload({ document, prepared: { text: encodeRehearsalComparison(workspaceComparison.inputs.before, workspaceComparison.inputs.after),
        filename: "ThreeCore-workspace-comparison.json", mimeType: "application/json" } });if(disposed||own!==revision)return;
      get("workspace-review-status").textContent = "照合資料の保存を開始しました。復旧前と復旧後の入力記録を含みます。履歴にはまだ反映していません。";
    } catch {if(disposed||own!==revision)return; get("workspace-review-status").textContent = "照合資料を保存できませんでした。復旧内容は確認待ちのままです。"; }
  });
  listen("workspace-file", "cancel", () => {
    if (!disposed) get("workspace-file-note").textContent = "ファイルの選択を取り消しました。現在の履歴と確認待ちの内容は変更していません。";
  });
  listen("workspace-text", "input", () => {
    if (disposed) return;
    cancelAppend(); candidate = null; get("apply").disabled = true; get("preview").textContent = "";
  });
  listen("workspace-text-review", "click", () => {
    if (disposed) return;
    const text = get("workspace-text").value;
    get("workspace-text").value = ""; get("workspace-file").value = "";
    beginWorkspaceRead("貼り付けた一括記録");
    try {
      if (!text.trim()) throw Object.assign(new Error("Empty input"), { code: "EMPTY_INPUT" });
      reviewWorkspaceText(text);
    } catch (error) { workspaceReadFailed(error); }
  });
  listen("workspace-apply", "click", () => {
    if (disposed || !workspaceReview) return;
    try {
      const source = workspaceSource;
      const counts = workspaceReview.after.rows.map(row => row.agent + ": " + (row.present ? row.recordCount + "件" : "未作成")).join(" / ");
      const data = ledger.restore(workspaceReview);
      get("agent").value = ledger.state().activeAgent;
      if (data) show(data, true); else clear("選択中の対象は未作成です。", true);
      get("workspace-text").value = "";
      get("workspace-receipt").textContent = "直前の復旧: " + source + " — " + counts + "。全記録を再計算しました。";
      setWorkspaceStage("complete", "上の一覧に復旧済みの履歴を表示しています。取り消し履歴は新しく開始します。必要な履歴は一括保存してください。");
    } catch { cancelAppend(); get("workspace-status").textContent = "一括ファイルを再度選んで確認してください。"; }
  });
  listen("workspace-cancel", "click", () => {
    if (disposed) return;
    clear("一括読込を取り消しました。", true);
    const data = ledger.state().current; if (data) show(data, true);
    get("workspace-text").value = ""; get("workspace-file").value = "";
    setWorkspaceStage("idle", "一括読込を取り消しました。現在の履歴は保持しています。");
  });
  renderWorkspace();
  setWorkspaceStage("idle", "保存した記録を選ぶと、復旧前に変更内容を確認できます。自動保存は行いません。");
  return Object.freeze({ dispose() {
    if (disposed) return; disposed = true; sessionPanel.dispose(); clear("表示を終了しました。"); ledger.dispose();
    scenarioPanel.dispose();
    scenarioSetPanel.dispose();
    reportReviewPanel.dispose();
    checkPanel.dispose();
    recordsPanel.dispose();
    session.dispose();
    get("workspace-rows").textContent = ""; get("workspace-save").disabled = true;
    get("workspace-status").textContent = "表示を終了しました。";
    for (const name of ["workspace-receipt", "workspace-source", "workspace-stage", "workspace-file-note"]) get(name).textContent = "";
    get("workspace-text").value = ""; get("workspace-file").value = "";
    for (const name of ["overview-cards", "overview-rows", "overview-status", "overview-save-status"]) get(name).textContent = "";
    get("overview-save").disabled = true;
    for (const remove of listeners) remove();
  } });
}

if (typeof document !== "undefined" && document.getElementById("calculate")) {
  let page = mountOperationRehearsal(document);
  window.addEventListener("pagehide", () => { page?.dispose(); page = null; });
  window.addEventListener("pageshow", () => { if (!page) page = mountOperationRehearsal(document); });
}
