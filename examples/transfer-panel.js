import { createTransferController } from "../src/transfer-controller.js";
import { DIRECTION_LABELS, TRANSFER_DIRECTIONS, queryTransfers, transferComparisonText, transferSummaryText } from "../src/transfer-view.js";
import { transferErrorText, transferProgressText } from "../src/transfer-messages.js";
import { mountTransferArchivePanel } from "./transfer-archive-panel.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { planTransferWindow } from "../src/transfer-window.js";

/** DOM rendering uses text nodes exclusively, including all file/provider values. */
export function mountTransferPanel({ document, parent, getContext, read, onCancel = () => {}, onStateChange = () => {},
  download = defaultDownload, subtle }) {
  const cleanup = [];
  let disposed = false;
  let previewId = null;
  let page = 0;
  let lastSnapshot = null;
  let currentState;
  let archivePanel;
  function node(tag, suffix, text = "") {
    const element = document.createElement(tag);
    element.className = "transfer-" + suffix;
    element.textContent = text;
    return element;
  }
  function listen(element, event, callback) {
    element.addEventListener(event, callback);
    cleanup.push(() => element.removeEventListener(event, callback));
  }
  function button(suffix, text) {
    const element = node("button", suffix, text);
    element.type = "button";
    return element;
  }
  function input(suffix, label, initial, type = "text") {
    const wrapper = node("label", suffix + "-label", label);
    const element = node("input", suffix);
    element.type = type;
    element.value = initial;
    element.autocomplete = "off";
    element.spellcheck = false;
    wrapper.append(element);
    return { wrapper, element };
  }
  const host = node("section", "panel");
  const heading = node("h3", "heading", "送受信履歴を確認");
  const help = node("p", "help", "登録済みのトークンの履歴を、指定した期間だけ参照します。送金や承認の操作は行いません。");
  const bounds = node("div", "bounds");
  const start = input("from", "開始ブロック（空欄なら直近）", "");
  const end = input("to", "終了ブロック（空欄なら最新）", "");
  const lookback = input("lookback", "直近のブロック数（最大2,000）", "250", "number");
  lookback.element.min = "1";
  lookback.element.max = "2000";
  lookback.element.step = "1";
  start.element.inputMode = "numeric";
  end.element.inputMode = "numeric";
  bounds.append(start.wrapper, end.wrapper, lookback.wrapper);
  const actions = node("div", "actions");
  const inspect = button("read", "送受信履歴を取得");
  const cancel = button("cancel", "中止");
  const clear = button("clear", "記録表示をクリア");
  actions.append(inspect, cancel, clear);
  const status = node("p", "status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const summary = node("pre", "summary");
  const windowActions = node("div", "window-actions");
  const windowButtons = [["pin", "表示中の期間を入力欄に固定"], ["previous", "一つ前の期間を入力"],
    ["narrow", "期間を半分に絞る"], ["latest", "最新の期間を入力"]].map(([action, label]) => {
    const element = button("window-" + action, label);
    windowActions.append(element);
    return { action, element };
  });
  const windowStatus = node("p", "window-status");
  windowStatus.setAttribute("aria-live", "polite");
  const filters = node("div", "filters");
  const directionLabel = node("label", "direction-label", "履歴の種類");
  const direction = node("select", "direction");
  for (const value of TRANSFER_DIRECTIONS) {
    const option = node("option", "direction-option", DIRECTION_LABELS[value]);
    option.value = value;
    direction.append(option);
  }
  direction.value = "all";
  directionLabel.append(direction);
  const search = input("search", "公開アドレス・取引ハッシュ・ブロックで検索", "");
  search.element.maxLength = 100;
  const orderLabel = node("label", "order-label", "表示順");
  const order = node("select", "order");
  for (const [value, text] of [["newest", "新しい順"], ["oldest", "古い順"]]) {
    const option = node("option", "order-option", text);
    option.value = value;
    order.append(option);
  }
  order.value = "newest";
  orderLabel.append(order);
  filters.append(directionLabel, search.wrapper, orderLabel);
  const paging = node("div", "paging");
  const previous = button("previous", "前の10件");
  const next = button("next", "次の10件");
  const counter = node("span", "counter");
  paging.append(previous, counter, next);
  const rows = node("ol", "rows");
  const files = node("details", "files");
  files.append(node("summary", "files-title", "履歴を保存・再読み込み・比較"));
  const privacy = node("p", "privacy", "保存ファイルには公開アドレスと履歴が含まれます。共有先に注意してください。チェックサムは改変の有無を調べる補助で、内容の真正性を保証しません。");
  const exportActions = node("div", "export-actions");
  const exports = ["json", "csv", "txt"].map(kind => {
    const element = button("save-" + kind, ({ json: "JSONを保存", csv: "CSVを保存", txt: "概要を保存" })[kind]);
    exportActions.append(element);
    return { kind, element };
  });
  const importTargetLabel = node("label", "import-target-label", "読み込み先");
  const importTarget = node("select", "import-target");
  for (const [value, text] of [["snapshot", "表示する記録"], ["baseline", "比較元の記録"]]) {
    const option = node("option", "import-target-option", text);
    option.value = value;
    importTarget.append(option);
  }
  importTarget.value = "snapshot";
  importTargetLabel.append(importTarget);
  const file = input("file", "保存した履歴JSON（最大512 KiB）", "", "file");
  file.element.accept = ".json,application/json";
  const preview = node("pre", "preview");
  const apply = button("apply", "確認した記録を表示に反映");
  const baseline = button("baseline", "今の記録を比較元にする");
  const compare = button("compare", "比較元との差分を確認");
  const comparison = node("pre", "comparison");
  files.append(privacy, exportActions, importTargetLabel, file.wrapper, preview, apply, baseline, compare, comparison);
  host.append(heading, help, bounds, actions, status, summary, windowActions, windowStatus, filters, paging, rows, files);
  parent.append(host);

  function renderRows(state) {
    rows.replaceChildren();
    previous.disabled = true;
    next.disabled = true;
    counter.textContent = "";
    if (!state.snapshot) return;
    let view;
    try {
      view = queryTransfers(state.snapshot, {
        direction: direction.value, search: search.element.value, order: order.value, page, pageSize: 10,
      });
    } catch {
      counter.textContent = "検索条件を確認してください。";
      return;
    }
    page = view.query.page;
    counter.textContent = `${view.matched}件 / ${page + 1}ページ目（全${view.pages}ページ）`;
    previous.disabled = !view.hasPrevious;
    next.disabled = !view.hasNext;
    if (!view.rows.length) {
      rows.append(node("li", "empty", "この表示条件で該当する記録はありません。"));
      return;
    }
    for (const row of view.rows) {
      const item = node("li", "row");
      item.append(node("strong", "row-heading", DIRECTION_LABELS[row.direction] + " · " + row.formattedAmount + " " + state.snapshot.metadata.symbol));
      item.append(node("pre", "row-details", [
        "ブロック: " + row.blockNumber + " / イベント番号: " + row.logIndex,
        "送信元: " + row.from,
        "送信先: " + row.to,
        "取引: " + row.transactionHash,
        "最小単位: " + row.amountBaseUnits,
      ].join("\n")));
      rows.append(item);
    }
  }
  function render(state) {
    currentState = state;
    if (lastSnapshot !== state.snapshot) page = 0;
    lastSnapshot = state.snapshot;
    const busy = ["reading", "loading", "preparing"].includes(state.phase);
    const ready = state.phase === "ready" && Boolean(state.snapshot);
    host.setAttribute("aria-busy", String(busy));
    inspect.disabled = busy;
    cancel.disabled = !busy && !state.preview;
    file.element.disabled = busy;
    importTarget.disabled = busy;
    for (const { element } of exports) element.disabled = !ready;
    for (const { action, element } of windowButtons) {
      element.disabled = !ready || (action === "previous" && state.snapshot.range.fromBlock === "0") ||
        (action === "narrow" && state.snapshot.range.fromBlock === state.snapshot.range.toBlock);
    }
    if (!state.snapshot) windowStatus.textContent = "";
    baseline.disabled = !ready;
    compare.disabled = !ready || !state.baseline;
    apply.disabled = !state.preview;
    previewId = state.preview?.id ?? null;
    if (state.error) status.textContent = transferErrorText(state.error);
    else if (state.phase === "reading") status.textContent = transferProgressText(state.progress);
    else if (state.phase === "loading") status.textContent = "ファイルを確認しています。";
    else if (state.phase === "preparing") status.textContent = "保存ファイルを準備しています。";
    else if (state.phase === "preview") status.textContent = "口座と期間を確認してから反映してください。";
    else if (state.phase === "cancelled") status.textContent = "中止しました。";
    else if (state.snapshot) status.textContent = state.provenance === "live" ? "履歴の読み取りが完了しました。" : "保存ファイルの記録を表示しています。";
    else status.textContent = "まだ履歴を取得していません。";
    summary.textContent = state.snapshot ? transferSummaryText(state.snapshot, state.provenance) : "";
    preview.textContent = state.preview ? transferSummaryText(state.preview.snapshot, "imported") +
      "\n読み込み先: " + (state.preview.target === "baseline" ? "比較元" : "表示する記録") : "";
    comparison.textContent = state.comparison ? transferComparisonText(state.comparison) :
      state.baseline ? "比較元: " + state.baseline.range.fromBlock + " ～ " + state.baseline.range.toBlock : "";
    renderRows(state);
    archivePanel?.refresh();
    onStateChange(state);
  }
  const controller = createTransferController({ getContext, read, onChange: render, subtle });
  archivePanel = mountTransferArchivePanel({ document, parent: host, getContext, download, subtle,
    getSnapshot: () => controller.state.phase === "ready" ? controller.state.snapshot : null,
    onSelect: async snapshot => {
      const selectedState = controller.state;
      const text = await encodeTransferFile(snapshot, { subtle });
      if (disposed || controller.state !== selectedState) return;
      const bytes = new TextEncoder().encode(text);
      await controller.stageFile({ name: "saved-transfer-record.json", size: bytes.byteLength,
        arrayBuffer: async () => bytes.slice().buffer });
    },
  });
  listen(inspect, "click", () => controller.inspect({
    fromBlock: start.element.value.trim() || null,
    toBlock: end.element.value.trim() || null,
    lookback: Number(lookback.element.value),
  }));
  listen(cancel, "click", () => { controller.cancel(); onCancel(); });
  listen(clear, "click", () => { controller.invalidate(); onCancel(); });
  for (const { action, element } of windowButtons) listen(element, "click", () => {
    try {
      const request = planTransferWindow(controller.state.snapshot, action);
      start.element.value = request.fromBlock ?? "";
      end.element.value = request.toBlock ?? "";
      lookback.element.value = String(request.lookback);
      controller.cancel();
      onCancel();
      windowStatus.textContent = "入力欄の期間を変更しました。新しい履歴は「送受信履歴を取得」を押すと確認できます。";
    } catch (error) { windowStatus.textContent = transferErrorText(error?.code); }
  });
  for (const field of [start.element, end.element, lookback.element]) {
    listen(field, "input", () => { controller.cancel(); onCancel(); });
  }
  for (const field of [direction, search.element, order]) {
    listen(field, field === search.element ? "input" : "change", () => { page = 0; renderRows(currentState); });
  }
  listen(previous, "click", () => { page--; renderRows(currentState); });
  listen(next, "click", () => { page++; renderRows(currentState); });
  listen(file.element, "change", () => {
    const selected = file.element.files?.[0];
    file.element.value = "";
    if (selected) controller.stageFile(selected, importTarget.value);
  });
  listen(importTarget, "change", () => controller.cancel());
  listen(apply, "click", () => controller.applyImport(previewId));
  listen(baseline, "click", () => controller.keepBaseline());
  listen(compare, "click", () => controller.compare());
  for (const { kind, element } of exports) listen(element, "click", async () => {
    const prepared = await controller.prepare(kind);
    if (!prepared || disposed) return;
    try { await download(prepared, document); }
    catch { if (!disposed) status.textContent = "ファイルを保存できませんでした。保存先の設定を確認してください。"; }
  });
  render(controller.state);
  return Object.freeze({
    invalidate() { controller.invalidate(); archivePanel.invalidate(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const stop of cleanup) stop();
      controller.dispose();
      archivePanel.dispose();
      host.remove();
    },
  });
}

function defaultDownload(prepared, document) {
  const blob = new Blob([prepared.text], { type: prepared.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = prepared.filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
