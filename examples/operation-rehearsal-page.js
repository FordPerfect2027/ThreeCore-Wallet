import { decodeRehearsal, encodeRehearsal, evaluateRehearsal, parseRehearsalUnits,
  formatRehearsalUnits, REHEARSAL_LIMIT, REHEARSAL_SCHEMA_V2 } from "../src/operation-rehearsal.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { rehearsalCsv } from "../src/operation-rehearsal-ledger.js";
import { createRehearsalWorkspace, decodeRehearsalWorkspace, encodeRehearsalWorkspace,
  reportRehearsalWorkspace, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { offerWalletDownload } from "./export-download.js";

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

export function mountOperationRehearsal(document, download = offerWalletDownload) {
  const get = name => document.getElementById(name);
  let current = null, candidate = null, revision = 0, disposed = false;
  const ledger = createRehearsalWorkspace(get("agent").value);
  let appendReview = null, workspaceReview = null;
  const listeners = [];
  const listen = (name, type, handler) => {
    get(name).addEventListener(type, handler);
    listeners.push(() => get(name).removeEventListener(type, handler));
  };
  function cancelAppend() {
    revision++; workspaceReview = null; get("workspace-apply").disabled = true;
    get("workspace-preview").textContent = "";
    appendReview = null; ledger.cancel(); get("append-confirm").disabled = true;
    get("append-summary").textContent = "";
  }
  function clear(message = "入力が変わりました。もう一度試算してください。", keepLedger = false) {
    revision++; current = null; candidate = null;
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
  }
  function show(data, keepLedger = false) {
    const report = evaluateRehearsal(data);
    encodeRehearsal(data);
    const formatted = value => formatRehearsalUnits(value, data.asset.decimals) + " " + data.asset.symbol;
    clear(undefined, true);
    if (!keepLedger) data = ledger.reset(data);
    current = data;
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
      " / 入力された対象: " + data.policy.origin + " / " + data.policy.spender;
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
    try {
      const data = current;
      download({ document, prepared: { text: encodeRehearsal(data),
        filename: "ThreeCore-" + data.agent + "-operation-rehearsal.json", mimeType: "application/json" } });
      get("status").textContent = "保存を開始しました。ファイルには仮の入力と記録が含まれます。";
    } catch { get("status").textContent = "保存を開始できませんでした。もう一度お試しください。"; }
  });
  listen("csv-save", "click", () => {
    if (disposed || !current) return;
    try {
      download({ document, prepared: { text: rehearsalCsv(current),
        filename: "ThreeCore-" + current.agent + "-rehearsal-ledger.csv", mimeType: "text/csv" } });
      get("status").textContent = "CSVの保存を開始しました。金額は最小単位です。表計算ソフトには文字列として読み込んでください。";
    } catch { get("status").textContent = "CSVの保存を開始できませんでした。"; }
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
    get("file").value = "";
    clear("ファイルを確認しています。", true); const own = revision;
    try {
      if (!file || file.size > REHEARSAL_LIMIT || file.size < 1) throw new Error("File size");
      const text = await file.text();
      if (disposed || own !== revision) return;
      const data = decodeRehearsal(text); const report = evaluateRehearsal(data);
      if (data.asset.symbol !== "SIM" || data.asset.decimals !== 6)
        throw new Error("This page uses fictional SIM units with six decimals");
      if (disposed || own !== revision) return;
      candidate = data; get("apply").disabled = false;
      get("preview").textContent = data.agent + " / " + data.asset.symbol + " / " + report.rows.length +
        "件の仮の記録。表示する場合は「確認した記録を表示」を押してください。";
      get("status").textContent = "読み込み内容を確認してください。まだ表示に反映していません。";
    } catch {
      if (disposed || own !== revision) return;
      clear("ファイルを確認できませんでした。この画面で保存した128 KiB以内の試算JSONを選んでください。", true);
    }
  });
  listen("apply", "click", () => {
    if (disposed || !candidate) return;
    const data = candidate; candidate = null; show(data);
  });
  listen("cancel", "click", () => { clear("読み込み・表示をクリアしました。"); get("file").value = ""; });
  listen("workspace-save", "click", () => {
    if (disposed) return;
    const data = ledger.snapshot(); if (!data.ledgers.length) return;
    try {
      download({ document, prepared: { text: encodeRehearsalWorkspace(data),
        filename: "ThreeCore-operation-workspace.json", mimeType: "application/json" } });
      get("workspace-status").textContent = "3トークン分の保存を開始しました。作成済みの確定した試算履歴だけが含まれます。";
    } catch { get("workspace-status").textContent = "一括保存を開始できませんでした。"; }
  });
  listen("workspace-file", "change", async () => {
    if (disposed) return;
    const file = get("workspace-file").files?.[0]; get("workspace-file").value = "";
    clear("一括ファイルを確認しています。現在の履歴は保持しています。", true);
    const own = revision;
    try {
      if (!file || file.size < 1 || file.size > REHEARSAL_WORKSPACE_LIMIT) throw new Error("File size");
      const text = await file.text(); if (disposed || own !== revision) return;
      const data = decodeRehearsalWorkspace(text);
      if (data.ledgers.some(item => item.asset.symbol !== "SIM" || item.asset.decimals !== 6)) throw new Error("SIM required");
      if (disposed || own !== revision) return;
      workspaceReview = ledger.previewRestore(data);
      get("workspace-preview").textContent = workspaceReview.after.rows.map(row => row.agent + ": " +
        (row.present ? row.recordCount + "件に置換" : "未作成に戻す")).join(" / ") +
        "。表示対象: " + data.activeAgent + "。復旧すると3トークンの現在の履歴をまとめて置き換え、取り消し履歴は消えます。まだ反映していません。";
      get("workspace-apply").disabled = false;
      get("workspace-status").textContent = "一括復旧する内容を確認してください。必要なら現在の履歴を先に一括保存できます。";
    } catch {
      if (disposed || own !== revision) return;
      clear("一括ファイルを確認できませんでした。現在の履歴は保持しています。", true);
      get("workspace-status").textContent = "512 KiB以内の一括試算JSONを選んでください。履歴は変更していません。";
    }
  });
  listen("workspace-apply", "click", () => {
    if (disposed || !workspaceReview) return;
    try {
      const data = ledger.restore(workspaceReview);
      get("agent").value = ledger.state().activeAgent;
      if (data) show(data, true); else clear("選択中の対象は未作成です。", true);
      get("workspace-status").textContent = "一括復旧して全記録を再計算しました。取り消し履歴は新しく開始します。";
    } catch { cancelAppend(); get("workspace-status").textContent = "一括ファイルを再度選んで確認してください。"; }
  });
  listen("workspace-cancel", "click", () => {
    if (disposed) return;
    clear("一括読込を取り消しました。", true);
    const data = ledger.state().current; if (data) show(data, true);
    get("workspace-status").textContent = "一括読込を取り消しました。現在の履歴は保持しています。";
  });
  renderWorkspace();
  return Object.freeze({ dispose() {
    if (disposed) return; disposed = true; clear("表示を終了しました。"); ledger.dispose();
    get("workspace-rows").textContent = ""; get("workspace-save").disabled = true;
    get("workspace-status").textContent = "表示を終了しました。";
    for (const remove of listeners) remove();
  } });
}

if (typeof document !== "undefined" && document.getElementById("calculate")) {
  let page = mountOperationRehearsal(document);
  window.addEventListener("pagehide", () => { page?.dispose(); page = null; });
  window.addEventListener("pageshow", () => { if (!page) page = mountOperationRehearsal(document); });
}
