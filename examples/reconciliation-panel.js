import { offerWalletDownload } from "./export-download.js";
import { reconciliationLedgerText, reconciliationEvidenceText } from "../src/reconciliation-ledger.js";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { RECONCILIATION_AGENTS } from "../src/reconciliation-model.js";
import { formatReconciliationAmount } from "../src/reconciliation-engine.js";
import { queryReconciliationEvents, suggestReconciliationWindows } from "../src/reconciliation-query.js";
import {
  RECONCILIATION_NOTICE, RECONCILIATION_STORAGE_NOTICE, reconciliationPartText,
  reconciliationReviewText, reconciliationTokenText, RECONCILIATION_STATUS,
} from "../src/reconciliation-view.js";

export function mountReconciliationPanel({
  document, parent, initial, readObservation, readArchive, download = file => downloadFile(file, document),
  controllerOptions = {},
}) {
  const cleanup = [];
  let disposed = false;
  let controller;
  let displayedReview = null;
  let currentState;
  let page = 0;
  let lastRevision = -1;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(name, text) {
    const node = element("button", "reconciliation-" + name, text);
    node.type = "button";
    return node;
  }

  function field(name, labelText, choices) {
    const label = element("label", "reconciliation-field");
    const caption = element("span", "", labelText);
    const node = element(choices ? "select" : "input", "reconciliation-" + name);
    node.setAttribute("aria-label", labelText);
    if (choices) {
      for (const [value, text] of choices) {
        const option = element("option", "", text);
        option.value = value;
        node.append(option);
      }
      node.value = choices[0][0];
    }
    label.append(caption, node);
    return { label, node };
  }

  function listen(node, event, fn) {
    node.addEventListener(event, fn);
    cleanup.push(() => node.removeEventListener(event, fn));
  }

  const host = element("section", "reconciliation-panel");
  host.setAttribute("aria-label", "残高と履歴の照合");
  host.append(element("h2", "", "残高と履歴の照合"),
    element("p", "reconciliation-notice", RECONCILIATION_NOTICE),
    element("p", "reconciliation-storage-notice", RECONCILIATION_STORAGE_NOTICE));
  const selected = field("agent", "照合に入れるトークン", RECONCILIATION_AGENTS.map(agent => [agent, agent]));
  const sources = element("div", "reconciliation-actions");
  const earlier = button("capture-earlier", "カードの残高を比較前に入れる");
  const later = button("capture-later", "カードの残高を比較後に入れる");
  const archive = button("capture-archive", "カードの履歴を入れる");
  sources.append(selected.label, earlier, later, archive);
  host.append(element("h3", "", "1. 記録を選ぶ"), sources,
    element("p", "", "カードで取得した記録を使います。ここではウォレットへの接続や読み取りを実行しません。前と後には別のブロックの残高を入れてください。"));

  const importKind = field("import-kind", "読み込むファイルの種類", [
    ["workspace", "照合データ全体"], ["earlier", "比較前の残高（トークン確認JSON）"],
    ["later", "比較後の残高（トークン確認JSON）"], ["archive", "送受信履歴アーカイブ"],
    ["snapshot", "送受信履歴1期間"], ["vault", "3トークンの履歴管理JSON"],
  ]);
  const file = field("file", "照合用のJSONファイル");
  file.node.type = "file";
  file.node.accept = ".json,application/json";
  const imports = element("div", "reconciliation-actions");
  imports.append(importKind.label, file.label);
  host.append(imports);

  const inputs = element("div", "reconciliation-inputs");
  const inputText = {};
  const removeButtons = {};
  for (const [part, name] of [["earlier", "比較前の残高"], ["later", "比較後の残高"], ["archive", "送受信履歴"]]) {
    const box = element("div", "reconciliation-input");
    inputText[part] = element("pre", "reconciliation-input-" + part);
    removeButtons[part] = button("remove-" + part, name + "を外す");
    box.append(element("h4", "", name), inputText[part], removeButtons[part]);
    inputs.append(box);
  }
  host.append(inputs);
  const clear = button("clear", "選択中のトークンを空にする");
  const undo = button("undo", "照合の変更を元に戻す");
  const redo = button("redo", "照合の変更をやり直す");
  const history = element("div", "reconciliation-actions");
  history.append(clear, undo, redo);
  host.append(history);

  const reviewBox = element("section", "reconciliation-review");
  reviewBox.hidden = true;
  const reviewText = element("pre", "reconciliation-review-text");
  const acknowledgement = field("ack", "置き換え・削除される記録を確認しました");
  acknowledgement.node.type = "checkbox";
  acknowledgement.node.checked = false;
  const apply = button("apply", "確認した内容を照合に適用");
  const cancel = button("cancel", "取り込みを取り消す");
  reviewBox.append(element("h3", "", "2. 変更内容の確認"), reviewText, acknowledgement.label, apply);
  host.append(reviewBox, cancel);

  const calculate = button("calculate", "現在の記録を照合する");
  const status = element("p", "reconciliation-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  host.append(element("h3", "", "3. 結果を見る"), calculate, status);
  const results = element("div", "reconciliation-results");
  const resultText = {};
  const resultSummary = {};
  for (const agent of RECONCILIATION_AGENTS) {
    const box = element("article", "reconciliation-result");
    box.setAttribute("data-reconciliation-agent", agent);
    const verdict = element("p", "reconciliation-verdict");
    const amounts = element("dl", "reconciliation-amounts");
    const coverage = element("p", "reconciliation-coverage-summary");
    const details = element("details", "reconciliation-result-details");
    resultText[agent] = element("pre", "reconciliation-result-" + agent);
    details.append(element("summary", "", agent + "の記録と計算の詳細"), resultText[agent]);
    resultSummary[agent] = { box, verdict, amounts, coverage };
    box.append(element("h4", "", agent), verdict, amounts, coverage, details);
    results.append(box);
  }
  host.append(results);
  const windows = element("pre", "reconciliation-windows");
  host.append(element("h3", "", "未取得期間の確認用メモ"), windows);

  const ledger = element("pre", "reconciliation-ledger");
  const evidence = element("pre", "reconciliation-evidence");
  const evidenceDetails = element("details", "reconciliation-evidence-details");
  evidenceDetails.append(element("summary", "", "選択中のトークンの元記録を確認"), evidence);
  host.append(element("h3", "", "ブロックごとの履歴集計"), ledger, evidenceDetails);

  const eventSection = element("section", "reconciliation-events");
  const filterAgent = field("filter-agent", "イベントのトークン", [["all", "すべて"], ...RECONCILIATION_AGENTS.map(agent => [agent, agent])]);
  const direction = field("direction", "イベントの方向", [
    ["all", "すべて"], ["incoming", "受取"], ["outgoing", "送出"], ["self", "自分宛"], ["mint", "発行"], ["burn", "焼却"],
  ]);
  const search = field("search", "取引ハッシュ・アドレス・ブロックを検索");
  search.node.type = "search";
  search.node.maxLength = 160;
  const filters = element("div", "reconciliation-actions");
  filters.append(filterAgent.label, direction.label, search.label);
  const table = element("table", "reconciliation-event-table");
  const caption = element("caption", "", "照合区間内のイベント（トークン順、その中で古い順）");
  const head = element("thead");
  const titles = element("tr");
  for (const name of ["トークン / block", "方向", "金額", "増減", "履歴からの推定残高", "取引 / log"]) {
    const th = element("th", "", name);
    th.scope = "col";
    titles.append(th);
  }
  head.append(titles);
  const tbody = element("tbody", "reconciliation-event-rows");
  table.append(caption, head, tbody);
  const scroll = element("div", "reconciliation-table-scroll");
  scroll.append(table);
  const pagination = element("p", "reconciliation-pagination");
  const previous = button("previous", "照合イベントの前のページ");
  const next = button("next", "照合イベントの次のページ");
  eventSection.append(element("h3", "", "照合に使ったイベント"), filters, scroll, pagination, previous, next);
  host.append(eventSection);

  const exports = element("div", "reconciliation-actions");
  const exportButtons = {};
  for (const [kind, text] of [["json", "照合データを保存"], ["text", "照合結果をテキスト保存"],
    ["summary", "照合結果をCSV保存"], ["events", "全照合イベントをCSV保存"], ["ledger", "ブロック集計をCSV保存"], ["windows", "未取得期間メモをCSV保存"]]) {
    exportButtons[kind] = button("export-" + kind, text);
    exports.append(exportButtons[kind]);
  }
  const exportStatus = element("p", "reconciliation-export-status");
  host.append(element("h3", "", "4. ファイルに保存する"), exports, exportStatus,
    element("p", "", "JSONには元の記録と公開アドレスを含みます。CSVは全トークン・全方向が対象で、上の表示フィルターは適用しません。検査値は出所や内容の正しさを保証しません。"));
  parent.append(host);

  function renderEvents(state) {
    tbody.replaceChildren();
    eventSection.hidden = !state.report;
    if (!state.report) return;
    try {
      const found = queryReconciliationEvents(state.workspace, {
        agent: filterAgent.node.value, direction: direction.node.value, search: search.node.value, page,
      });
      page = found.page;
      for (const row of found.rows) {
        const tr = element("tr");
        tr.setAttribute("title", RECONCILIATION_STATUS[row.status]);
        for (const value of [row.agent + " / " + row.blockNumber, row.direction,
          formatReconciliationAmount(row.amountBaseUnits, row.decimals),
          formatReconciliationAmount(row.deltaBaseUnits, row.decimals),
          formatReconciliationAmount(row.impliedBalanceBaseUnits, row.decimals),
          row.transactionHash + " / " + row.logIndex]) tr.append(element("td", "", value));
        tbody.append(tr);
      }
      pagination.textContent = `${found.total}件 / ${page + 1} / ${found.pages}ページ（1ページ25件）`;
      previous.disabled = state.busy || page === 0;
      next.disabled = state.busy || page + 1 >= found.pages;
    } catch {
      pagination.textContent = "検索条件を確認してください。";
      previous.disabled = true;
      next.disabled = true;
    }
  }

  function render(state) {
    if (disposed) return;
    currentState = state;
    host.setAttribute("aria-busy", state.busy ? "true" : "false");
    if (state.revision !== lastRevision) { page = 0; lastRevision = state.revision; }
    selected.node.value = state.agent;
    const slot = state.workspace.slots.find(value => value.agent === state.agent);
    for (const part of ["earlier", "later", "archive"]) {
      inputText[part].textContent = reconciliationPartText(part, slot[part]);
      removeButtons[part].disabled = state.busy || slot[part] === null;
    }
    for (const node of [earlier, later, archive, clear, calculate, file.node, importKind.node]) node.disabled = state.busy;
    clear.disabled = state.busy || [slot.earlier, slot.later, slot.archive].every(value => value === null);
    undo.disabled = state.busy || !state.canUndo;
    redo.disabled = state.busy || !state.canRedo;
    if (displayedReview !== state.review) {
      displayedReview = state.review;
      acknowledgement.node.checked = false;
    }
    reviewBox.hidden = !state.review;
    reviewText.textContent = reconciliationReviewText(state.review);
    acknowledgement.label.hidden = !state.review?.requiresReplacementAcknowledgement;
    apply.disabled = state.busy || !state.review ||
      (state.review.requiresReplacementAcknowledgement && !acknowledgement.node.checked);
    cancel.disabled = !state.review && !state.busy;
    status.textContent = state.message;
    status.setAttribute("data-error", state.error ? "true" : "false");
    for (const agent of RECONCILIATION_AGENTS) {
      const row = state.report?.slots.find(value => value.agent === agent);
      resultText[agent].textContent = row ? reconciliationTokenText(row) : "まだ照合していません。";
      const summary = resultSummary[agent];
      summary.box.setAttribute("data-result-status", row?.status ?? "pending");
      summary.verdict.textContent = row ? RECONCILIATION_STATUS[row.status] : "まだ照合していません。";
      summary.amounts.replaceChildren();
      if (row?.totals) {
        for (const [name, value] of [["残高の増減", row.totals.observedDeltaBaseUnits],
          ["履歴による増減", row.totals.netTransferBaseUnits], ["説明できない差額", row.totals.residualBaseUnits]]) {
          summary.amounts.append(element("dt", "", name), element("dd", "",
            formatReconciliationAmount(value, row.totals.decimals) + " " + row.totals.symbol));
        }
      }
      summary.coverage.textContent = row?.coverage ? (row.coverage.missingBlocks === "0"
        ? "この比較区間の未取得期間: なし（全履歴の保証ではありません）"
        : "未取得: " + row.coverage.missingBlocks + "ブロック。差額が0でも履歴は不足しています。")
        : row ? "前後の残高と記録の条件を、詳細で確認してください。" : "前後の記録を入れて照合してください。";
    }
    const plan = state.report ? suggestReconciliationWindows(state.workspace, state.agent) : null;
    windows.textContent = !plan?.available ? "前後の残高が比較できる状態で照合すると表示します。" : plan.windows.length
      ? `${state.agent}: カード側で次の範囲を手動で読み取り、履歴に追加できます。\n` +
        plan.windows.map(range => `${range.fromBlock} ～ ${range.toBlock}`).join("\n") +
        `\n表示した範囲以外に残る未取得ブロック: ${plan.remainingBlocks}\nこの画面は読み取りや接続を実行しません。`
      : "この照合区間内に未取得期間はありません。履歴全体の正しさや完全性は未確認です。";
    for (const [kind, node] of Object.entries(exportButtons)) node.disabled = state.busy || (kind !== "json" && !state.report);
    exportStatus.textContent = state.exportedCurrent ? "現在の照合データの保存を開始済みです。ダウンロード先を確認してください。"
      : "現在の照合データは、まだこの画面からJSON保存していません。";
    ledger.textContent = state.report ? reconciliationLedgerText(state.workspace, state.agent) : "照合すると表示します。";
    evidence.textContent = reconciliationEvidenceText(state.workspace, state.agent);
    renderEvents(state);
  }

  controller = createReconciliationController({ ...controllerOptions, ...(initial ? { initial } : {}),
    readObservation, readArchive, onStateChange: render });
  listen(selected.node, "change", () => controller.selectAgent(selected.node.value));
  for (const [node, part] of [[earlier, "earlier"], [later, "later"], [archive, "archive"]]) listen(node, "click", () => controller.capture(part));
  for (const [part, node] of Object.entries(removeButtons)) listen(node, "click", () => controller.remove(part));
  listen(clear, "click", () => controller.remove());
  listen(undo, "click", () => controller.travel("undo"));
  listen(redo, "click", () => controller.travel("redo"));
  listen(apply, "click", () => controller.apply(acknowledgement.node.checked));
  listen(acknowledgement.node, "change", () => render(controller.state));
  listen(cancel, "click", () => controller.cancel());
  listen(calculate, "click", () => controller.calculate());
  listen(importKind.node, "change", () => controller.cancel());
  listen(file.node, "change", () => {
    const selectedFile = file.node.files?.[0];
    file.node.value = "";
    if (selectedFile) void controller.importFile(selectedFile, importKind.node.value);
  });
  for (const node of [filterAgent.node, direction.node]) listen(node, "change", () => { page = 0; renderEvents(currentState); });
  listen(search.node, "input", () => { page = 0; renderEvents(currentState); });
  listen(previous, "click", () => { page--; renderEvents(currentState); });
  listen(next, "click", () => { page++; renderEvents(currentState); });
  for (const [kind, node] of Object.entries(exportButtons)) listen(node, "click", () => { void controller.exportFile(kind, download); });
  render(controller.state);
  return Object.freeze({
    getWorkspace: () => controller.state.workspace,
    stageCollected(workspace, agent) {
      const next = { ...controller.state.workspace, slots: controller.state.workspace.slots.map(slot =>
        slot.agent === agent ? workspace.slots.find(value => value.agent === agent) : slot) };
      return controller.propose(next);
    },
    invalidateSources: () => controller.invalidateSources(),
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanup.forEach(stop => stop());
      controller.dispose();
      host.remove();
    },
  });
}

function downloadFile(file, document) {
  return offerWalletDownload({ document, prepared: file });
}
