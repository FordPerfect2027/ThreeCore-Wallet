import { decodeRehearsal, encodeRehearsal, evaluateRehearsal, parseRehearsalUnits,
  formatRehearsalUnits, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { rehearsalExample } from "../src/operation-rehearsal-examples.js";
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
});
const KINDS = { open: "投入", settle: "決済", deposit: "追加資金", withdraw: "資金引出し" };
const FIELD_POLICY = { maximum: "maxPerOperation", "outstanding-limit": "maxOutstanding",
  reserve: "reserveFloor", "loss-limit": "lossLimit" };

export function mountOperationRehearsal(document, download = offerWalletDownload) {
  const get = name => document.getElementById(name);
  let current = null, candidate = null, revision = 0, disposed = false;
  const listeners = [];
  const listen = (name, type, handler) => {
    get(name).addEventListener(type, handler);
    listeners.push(() => get(name).removeEventListener(type, handler));
  };
  function clear(message = "入力が変わりました。もう一度試算してください。") {
    revision++; current = null; candidate = null;
    get("save").disabled = true; get("apply").disabled = true;
    for (const name of ["metrics", "rows", "allocation-note", "context", "preview"]) get(name).textContent = "";
    get("status").textContent = message;
  }
  function show(data) {
    const report = evaluateRehearsal(data);
    const formatted = value => formatRehearsalUnits(value, data.asset.decimals) + " " + data.asset.symbol;
    clear();
    current = data;
    get("agent").value = data.agent;
    get("opening").value = formatRehearsalUnits(data.openingBalance, data.asset.decimals);
    for (const [field, key] of Object.entries(FIELD_POLICY))
      get(field).value = formatRehearsalUnits(data.policy[key], data.asset.decimals);
    get("allocation").value = formatRehearsalUnits(String(data.policy.buybackBps), 2);
    get("paused").checked = data.policy.paused;
    const firstOpen = data.events.find(event => event.kind === "open");
    const firstClose = data.events.find(event => event.kind === "settle");
    for (const [field, value] of [["principal", firstOpen?.principal ?? "0"],
      ["entry-fee", firstOpen?.fee ?? "0"], ["returned", firstClose?.grossReturn ?? "0"],
      ["exit-fee", firstClose?.fee ?? "0"]])
      get(field).value = formatRehearsalUnits(value, data.asset.decimals);
    for (const [label, value] of [["手元資金", report.cash], ["未決済元本", report.outstanding],
      ["累計実現損益", report.realizedPnl], ["費用合計", report.fees]]) {
      const item = document.createElement("div"); item.className = "metric";
      const caption = document.createElement("span"); caption.textContent = label;
      const number = document.createElement("strong"); number.textContent = formatted(value);
      item.append(caption, number); get("metrics").append(item);
    }
    for (const row of report.rows) {
      const tr = document.createElement("tr");
      const cells = [KINDS[row.kind] + " / " + row.id,
        row.withinEnteredLimits ? "仮の条件内" : row.reasons.map(code => REASONS[code] ?? "条件不一致").join("・"),
        formatted(row.cash), formatted(row.outstanding), formatted(row.realizedPnl)];
      for (const value of cells) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
      tr.className = row.withinEnteredLimits ? "passed" : "blocked";
      get("rows").append(tr);
    }
    get("allocation-note").textContent = report.allocationBlockers.length
      ? "自トークン買戻しへの配分試算: 0 — " + report.allocationBlockers.map(code => REASONS[code]).join("・")
      : "自トークン買戻しへの配分試算: " + formatted(report.proposedOwnTokenBuybackBudget) + "（実行されません）";
    get("context").textContent = data.agent + " / チェーン " + data.chainId + " / 仮の口座 " + data.account +
      " / 入力された対象: " + data.policy.origin + " / " + data.policy.spender;
    get("status").textContent = report.rows.some(row => !row.withinEnteredLimits)
      ? "条件に合わない記録を見送り、その理由を表示しました。見送った記録は資金・損益に加えていません。"
      : "試算が完了しました。元本・費用・損益の計算は整合しています。すべて入力に基づく仮の結果です。";
    get("save").disabled = false;
  }
  function fromFields(pending) {
    // Editable forms always create a fresh fictional six-decimal SIM scenario.
    const data = JSON.parse(encodeRehearsal(rehearsalExample(get("agent").value, pending ? "pending" : "profit")));
    const units = name => parseRehearsalUnits(get(name).value, 6);
    data.openingBalance = units("opening");
    for (const [field, key] of Object.entries(FIELD_POLICY)) data.policy[key] = units(field);
    const allocation = BigInt(parseRehearsalUnits(get("allocation").value, 2));
    if (allocation > 10000n) throw new Error("Invalid allocation");
    data.policy.buybackBps = Number(allocation); data.policy.paused = get("paused").checked;
    data.events[0].principal = units("principal"); data.events[0].fee = units("entry-fee");
    if (!pending) { data.events[1].grossReturn = units("returned"); data.events[1].fee = units("exit-fee"); }
    return data;
  }
  function calculate(pending) {
    if (disposed) return;
    try { const data = fromFields(pending); show(data); }
    catch { clear("入力を確認してください。金額は0以上・小数6桁まで、還元割合は0〜100%です。"); }
  }
  for (const name of ["opening", ...Object.keys(FIELD_POLICY), "allocation", "principal", "entry-fee", "returned", "exit-fee"])
    listen(name, "input", () => clear());
  for (const name of ["paused", "agent", "scenario"]) listen(name, "change", () => clear());
  listen("calculate", "click", () => calculate(false));
  listen("pending", "click", () => calculate(true));
  listen("example", "click", () => { if (!disposed) show(rehearsalExample(get("agent").value, get("scenario").value)); });
  listen("save", "click", () => {
    if (disposed || !current) return;
    try {
      const data = current;
      download({ document, prepared: { text: encodeRehearsal(data),
        filename: "ThreeCore-" + data.agent + "-operation-rehearsal.json", mimeType: "application/json" } });
      get("status").textContent = "保存を開始しました。ファイルには仮の入力と記録が含まれます。";
    } catch { get("status").textContent = "保存を開始できませんでした。もう一度お試しください。"; }
  });
  listen("file", "change", async () => {
    if (disposed) return;
    const file = get("file").files?.[0];
    get("file").value = "";
    clear("ファイルを確認しています。"); const own = revision;
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
      clear("ファイルを確認できませんでした。この画面で保存した128 KiB以内の試算JSONを選んでください。");
    }
  });
  listen("apply", "click", () => {
    if (disposed || !candidate) return;
    const data = candidate; candidate = null; show(data);
  });
  listen("cancel", "click", () => { clear("読み込み・表示をクリアしました。"); get("file").value = ""; });
  return Object.freeze({ dispose() { if (disposed) return; disposed = true; clear("表示を終了しました。"); for (const remove of listeners) remove(); } });
}

if (typeof document !== "undefined" && document.getElementById("calculate")) {
  let page = mountOperationRehearsal(document);
  window.addEventListener("pagehide", () => { page?.dispose(); page = null; });
  window.addEventListener("pageshow", () => { if (!page) page = mountOperationRehearsal(document); });
}
