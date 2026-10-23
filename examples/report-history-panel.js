import { createReportHistoryStorage } from "../src/report-history-storage.js";
import { createPeriodLibraryStorage } from "../src/period-library-storage.js";
import { reportSourcesText } from "../src/report-history-sources.js";
import { reportContinuityText } from "../src/report-history-continuity.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { queryReportHistory } from "../src/report-history-query.js";
import { historyErrorText, historyReviewText, historyReportText, REPORT_LIMITATION } from "../src/report-history-view.js";
import { reportStatusText } from "../src/period-report-view.js";
import { periodReportComparisonText } from "../src/period-report-comparison.js";

export function mountReportHistoryPanel({ document, parent, getReport, stageReport,
  storage = createReportHistoryStorage(), sourceStorage = createPeriodLibraryStorage(), now, createId,
  download = file => downloadHistory(file, document) } = {}) {
  const nodes = {}, cleanup = [];
  let disposed = false, state = null, lastSelection = null, lastDocument = null;
  const host = document.createElement("section");
  host.className = "report-history-panel";
  host.setAttribute("aria-label", "PC内の報告履歴");
  parent.append(host); nodes.panel = host;
  function make(tag, name, text, target = host) {
    const element = document.createElement(tag); element.className = "report-history-" + name;
    if (text !== undefined) element.textContent = text;
    target.append(element); nodes[name] = element; return element;
  }
  function button(name, text, target) {
    const element = make("button", name, text, target); element.type = "button"; return element;
  }
  function field(name, text, type, target) {
    const label = make("label", name + "-label", text, target);
    const element = make(type === "textarea" ? "textarea" : "input", name, undefined, label);
    if (type !== "textarea") element.type = type;
    return element;
  }
  function option(select, value, label) {
    const element = document.createElement("option"); element.value = value; element.textContent = label; select.append(element);
  }
  function chooser(name, text, choices, target) {
    const label = make("label", name + "-label", text, target), select = make("select", name, undefined, label);
    choices.forEach(([value, caption]) => option(select, value, caption));
    if (choices.length) select.value = choices[0][0];
    return select;
  }
  make("p", "eyebrow", "THREECORE / SAVED REPORTS");
  make("h2", "heading", "報告を残して、後から確かめる");
  make("p", "intro", "作成した3トークンの期間レポートをPC内に保存します。名前・メモを付け、以前の報告と比較できます。");
  make("p", "notice", "保存先はこのブラウザーと接続先URLごとに分かれます。別のPCやポートには自動で移りません。JSONも保全してください。");
  const actions = make("div", "actions");
  button("refresh", "PC内の報告履歴を読み込む", actions);
  button("cancel", "履歴の処理を中止", actions);
  const status = make("p", "status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  make("p", "capacity");

  const filters = make("div", "filters");
  chooser("archive-filter", "保管状態", [["active", "通常の報告"], ["archived", "非表示保管"], ["all", "すべて"]], filters);
  chooser("status-filter", "検証状態", [["all", "すべて"], ["arithmetic-agreement", "計算一致"], ["attention", "確認が必要"], ["incomplete", "未完了"]], filters);
  chooser("agent-filter", "含まれるトークン", [["all", "すべて"], ["DAT", "DAT"], ["EMA", "EMA"], ["CAWELON", "CAWELON"]], filters);
  chooser("order", "並び順", [["newest", "保存が新しい順"], ["oldest", "保存が古い順"], ["name", "保存名順"], ["created", "報告作成日時順"]], filters);
  field("search", "保存名・メモ・アドレスを検索", "search", filters).maxLength = 100;
  field("tag-filter", "タグで絞り込み（完全一致）", "text", filters).maxLength = 24;
  make("p", "count");
  chooser("selected", "確認する報告", [["", "選択しない"]]);
  const selected = make("section", "selected-details");
  make("h3", "selected-title", "選択中の報告", selected);
  make("p", "selection-note", "", selected);
  make("pre", "selected-text", "", selected);
  const selectedActions = make("div", "selected-actions", undefined, selected);
  button("open", "この報告を開く前に確認", selectedActions);
  button("archive", "非表示保管へ移す", selectedActions);
  button("restore", "通常の一覧に戻す", selectedActions);
  button("inspect-sources", "元の期間の控えと照合", selectedActions);
  make("pre", "sources-text", "", selected);

  const editor = make("section", "editor");
  make("h3", "editor-heading", "保存名とメモ", editor);
  field("label", "保存名（60文字以内）", "text", editor).maxLength = 60;
  nodes.label.value = "期間レポート";
  field("note", "メモ（500文字以内・秘密情報は入力しない）", "textarea", editor).maxLength = 500;
  field("tags", "タグ（英小文字・数字・ハイフン、カンマ区切りで6個まで）", "text", editor).maxLength = 149;
  const editActions = make("div", "edit-actions", undefined, editor);
  button("save", "表示中の期間レポートを保存する前に確認", editActions);
  button("annotate", "選択した報告の名前・メモを更新", editActions);
  make("p", "edit-note", "名前・メモを更新しても、報告の元データは変更しません。", editor);

  const review = make("section", "review");
  make("h3", "review-heading", "適用前の確認", review);
  make("pre", "review-text", "", review);
  field("skip-conflicts", "競合する報告を除外し、既存の記録を保持する", "checkbox", review);
  button("apply", "確認した内容を適用", review);

  const comparison = make("details", "comparison");
  make("summary", "comparison-title", "保存した2つの報告を比較", comparison);
  chooser("baseline", "比較元の報告（保管中も含む）", [["", "選択しない"]], comparison);
  button("compare", "比較元から選択中の報告への違いを表示", comparison);
  make("pre", "comparison-text", "", comparison);
  make("p", "comparison-note", REPORT_LIMITATION, comparison);

  const backup = make("section", "backup");
  make("h3", "backup-heading", "ファイルにも保全する", backup);
  field("export-ack", "公開アドレス・残高・履歴・メモを含むファイルをPCに保存することを確認しました", "checkbox", backup);
  const exports = make("div", "exports", undefined, backup);
  button("backup-json", "全報告のバックアップJSON", exports);
  button("selected-json", "選択した報告のJSON", exports);
  button("csv", "絞り込んだ一覧CSV", exports);
  make("p", "backup-note", "全報告JSONは非表示保管も含みます。単独の報告JSONに履歴のメモは含まれません。CSVは復元には使えません。いずれも暗号化されません。", backup);
  field("file", "報告履歴のバックアップJSONから追加復元（最大96 MiB）", "file", backup).accept = ".json,application/json";
  make("p", "restore-note", "復元は追加だけです。既存の証拠・メモを上書きせず、重複・競合を表示します。", backup);

  const query = () => ({ archive: nodes["archive-filter"].value, status: nodes["status-filter"].value,
    agent: nodes["agent-filter"].value, order: nodes.order.value,
    search: nodes.search.value, tag: nodes["tag-filter"].value });
  const annotations = () => ({ label: nodes.label.value, note: nodes.note.value,
    tags: nodes.tags.value.trim() ? nodes.tags.value.split(",").map(value => value.trim()) : [] });
  function renderList() {
    nodes.selected.replaceChildren(); option(nodes.selected, "", "選択しない");
    let visible = [];
    try {
      const result = queryReportHistory(state.document, query()); visible = result.rows;
      nodes.count.textContent = result.matched + "/" + result.count + "件を表示";
      nodes.capacity.textContent = "通常 " + result.active + "件 / 非表示保管 " + result.archived + "件 / 残り " + result.remaining +
        "件 · " + (result.bytes / 1024).toFixed(1) + " KiB（上限12件・64 MiB）";
      for (const row of visible) option(nodes.selected, row.id, row.label + " · " + reportStatusText(row.status));
    } catch {
      nodes.count.textContent = "検索条件を確認してください。";
    }
    const current = state.document.entries.find(entry => entry.id === state.selectedId);
    if (current && !visible.some(row => row.id === current.id)) option(nodes.selected, current.id, "選択中（絞り込み対象外）: " + current.label);
    nodes.selected.value = state.selectedId ?? "";
    nodes["selection-note"].textContent = current ? "保存名: " + current.label + (current.archived ? "（非表示保管）" : "") +
      " / 保存日時: " + current.savedAt + " / メモ: " + (current.note || "なし") : "";
  }
  function render(value) {
    if (disposed) return;
    state = value; host.setAttribute("aria-busy", String(value.busy));
    status.textContent = value.error ? historyErrorText(value.error) : value.message;
    status.setAttribute("data-error", String(Boolean(value.error)));
    const entry = value.document.entries.find(row => row.id === value.selectedId);
    if (lastSelection !== value.selectedId || lastDocument !== value.document) {
      lastSelection = value.selectedId; lastDocument = value.document; nodes["export-ack"].checked = false;
      nodes.baseline.replaceChildren(); option(nodes.baseline, "", "選択しない");
      for (const row of value.document.entries) option(nodes.baseline, row.id, row.label + (row.archived ? "（非表示保管）" : ""));
      if (entry) {
        nodes.label.value = entry.label; nodes.note.value = entry.note; nodes.tags.value = entry.tags.join(", ");
      }
      nodes["selected-text"].textContent = entry ? historyReportText(entry.report) : "";
    }
    nodes.baseline.value = value.baselineId ?? "";
    selected.hidden = !entry;
    nodes.refresh.disabled = value.busy;
    nodes.cancel.disabled = !value.busy && !value.review;
    for (const name of ["selected", "baseline", "save", "file", "label", "note", "tags"]) nodes[name].disabled = value.busy || !value.loaded;
    for (const name of ["archive-filter", "status-filter", "agent-filter", "order", "search", "tag-filter"]) nodes[name].disabled = value.busy || !value.loaded;
    for (const name of ["open", "annotate"]) nodes[name].disabled = value.busy || !value.loaded || !entry;
    nodes.archive.disabled = value.busy || !value.loaded || !entry || entry.archived;
    nodes.restore.disabled = value.busy || !value.loaded || !entry || !entry.archived;
    nodes.compare.disabled = value.busy || !value.loaded || !entry || !value.baselineId || value.baselineId === value.selectedId;
    nodes["comparison-text"].textContent = [periodReportComparisonText(value.comparison),
      reportContinuityText(value.comparison?.continuity)].filter(Boolean).join("\n\n");
    nodes["inspect-sources"].disabled = value.busy || !value.loaded || !entry || !value.canInspectSources;
    nodes["sources-text"].textContent = reportSourcesText(value.sourceInspection);
    review.hidden = !value.review;
    nodes["review-text"].textContent = historyReviewText(value.review);
    const merge = value.review?.kind === "merge";
    nodes["skip-conflicts-label"].hidden = !merge || value.review.plan.conflicts.length === 0;
    nodes["skip-conflicts"].checked = Boolean(merge && value.review.skipConflicts);
    nodes["skip-conflicts"].disabled = value.busy;
    nodes.apply.disabled = value.busy || !value.loaded || !value.review || Boolean(merge &&
      (value.review.plan.capacityExceeded || (value.review.plan.conflicts.length && !value.review.skipConflicts)));
    nodes["export-ack"].disabled = value.busy || !value.loaded;
    for (const name of ["backup-json", "selected-json", "csv"]) nodes[name].disabled = value.busy || !value.loaded ||
      !nodes["export-ack"].checked || (name === "selected-json" && !entry);
    renderList();
  }
  const controller = createReportHistoryController({ storage, getReport, stageReport,
    readSources: sourceStorage ? () => sourceStorage.read() : null, onChange: render,
    ...(now ? { now } : {}), ...(createId ? { createId } : {}) });
  function listen(name, event, callback) {
    nodes[name].addEventListener(event, callback); cleanup.push(() => nodes[name].removeEventListener(event, callback));
  }
  listen("refresh", "click", () => { void controller.refresh(); });
  listen("cancel", "click", controller.cancel);
  listen("selected", "change", () => controller.select(nodes.selected.value || null));
  listen("baseline", "change", () => controller.select(nodes.baseline.value || null, true));
  listen("save", "click", () => controller.prepareSave(annotations()));
  listen("annotate", "click", () => { void controller.annotate(annotations()); });
  listen("open", "click", controller.prepareOpen);
  listen("archive", "click", () => { void controller.archive(true); });
  listen("restore", "click", () => { void controller.archive(false); });
  listen("compare", "click", controller.compare);
  listen("inspect-sources", "click", () => { void controller.inspectSources(); });
  listen("skip-conflicts", "change", () => controller.setSkipConflicts(nodes["skip-conflicts"].checked));
  listen("apply", "click", () => { void controller.applyReview(); });
  for (const name of ["label", "note", "tags"]) listen(name, "input", controller.invalidateReview);
  for (const name of ["archive-filter", "status-filter", "agent-filter", "order", "search", "tag-filter"]) {
    listen(name, ["search", "tag-filter"].includes(name) ? "input" : "change", renderList);
  }
  listen("export-ack", "change", () => render(controller.state));
  for (const [name, format] of [["backup-json", "backup"], ["selected-json", "selected"], ["csv", "csv"]]) {
    listen(name, "click", () => { void controller.exportFile(format, nodes["export-ack"].checked, download, query()); });
  }
  listen("file", "change", () => {
    const file = nodes.file.files?.[0]; nodes.file.value = "";
    if (file) void controller.importFile(file);
  });
  render(controller.state);
  return Object.freeze({ getState: () => controller.state,
    dispose() {
      if (disposed) return;
      disposed = true; controller.dispose(); sourceStorage?.close(); cleanup.forEach(remove => remove()); host.remove();
    },
  });
}

function downloadHistory(file, document) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
  const link = document.createElement("a");
  try { link.href = url; link.download = file.filename; document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
