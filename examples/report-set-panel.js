import { offerWalletDownload } from "./export-download.js";
import { createReportHistoryStorage } from "../src/report-history-storage.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { queryReportHistory } from "../src/report-history-query.js";
import { querySetDiagnostics, diagnosticText } from "../src/report-set-diagnostics.js";
import { mountReportSetTimeline } from "./report-set-timeline-panel.js";
import { SET_LIMITATION, SET_SEGMENTS, setErrorText, setSummaryText,
  setTokenText, setSourcesText } from "../src/report-set-view.js";

export function mountReportSetPanel({ document, parent,
  storage = createReportHistoryStorage(), now,
  download = file => downloadSet(file, document) } = {}) {
  const nodes = {}, listeners = [], choices = new Map();
  let controller, state, disposed = false, lastDocument = null, lastResult = null;
  let queryDocument = null, queryKey = null, queryRows = [];
  let diagnosticInput = null, diagnosticKey = null, diagnosticRows = null;
  let timelinePanel = null;
  const host = document.createElement("section");
  host.className = "report-set-panel";
  host.setAttribute("aria-label", "複数の保存報告の期間確認");
  parent.append(host);
  nodes.panel = host;

  function make(tag, name, text, target = host) {
    const element = document.createElement(tag);
    element.className = "report-set-" + name;
    if (text !== undefined) element.textContent = text;
    target.append(element);
    nodes[name] = element;
    return element;
  }
  function button(name, text, target) {
    const element = make("button", name, text, target);
    element.type = "button";
    return element;
  }
  function field(name, text, type, target) {
    const label = make("label", name + "-label", text, target);
    const element = make("input", name, undefined, label);
    element.type = type;
    if (type === "checkbox") element.checked = false;
    return element;
  }
  function select(name, text, options, target) {
    const label = make("label", name + "-label", text, target);
    const element = make("select", name, undefined, label);
    options.forEach(([value, caption]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = caption;
      element.append(option);
    });
    element.value = options[0][0];
    return element;
  }
  function listen(element, type, callback) {
    element.addEventListener(type, callback);
    listeners.push(() => element.removeEventListener(type, callback));
  }

  make("p", "eyebrow", "THREECORE / PERIOD REVIEW");
  make("h2", "heading", "複数の報告を、期間で見渡す");
  make("p", "intro", "保存済みの報告を選び、DAT・EMA・CAWELONそれぞれの期間の抜け・重複・境界を確認します。");
  make("p", "notice", "元の履歴を変更しません。作成した確認セットはJSONでPCに保存できます。");
  const actions = make("div", "actions");
  button("refresh", "確認用の報告一覧を読み込む", actions);
  button("cancel", "確認セットの処理を中止", actions);
  const status = make("p", "status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const selectionSection = make("div", "selection-section");
  make("h3", "selection-heading", "1. 確認する報告を選ぶ", selectionSection);
  field("title", "確認セットの名前（60文字以内）", "text", selectionSection).value = "ThreeCore 期間のまとめ確認";
  nodes.title.maxLength = 60;
  const filters = make("div", "filters", undefined, selectionSection);
  select("archive", "保管状態で絞り込み", [["active", "通常の報告"], ["archived", "非表示保管"], ["all", "すべて"]], filters);
  select("status-filter", "状態で絞り込み", [["all", "すべて"], ["arithmetic-agreement", "計算一致"],
    ["attention", "確認が必要"], ["incomplete", "未完了"]], filters);
  field("search", "保存名・メモ・アドレスで探す", "search", filters).maxLength = 100;
  make("p", "count", "一覧は未読込みです。", selectionSection);
  const choiceActions = make("div", "choice-actions", undefined, selectionSection);
  button("select-visible", "表示中の報告を選択に追加", choiceActions);
  button("clear-selection", "選択をすべて外す", choiceActions);
  const choiceList = make("div", "choices", undefined, selectionSection);
  choiceList.setAttribute("role", "group");
  choiceList.setAttribute("aria-label", "確認セットに含める報告");
  make("p", "selection-count", "選択 0件", selectionSection);
  make("p", "selection-help", "絞り込みは表示だけを変えます。非表示の報告も、選択を外すまで対象に残ります。", selectionSection);
  button("prepare", "選択した報告の期間を確認", selectionSection);

  const review = make("section", "review");
  make("h3", "review-heading", "2. 作成前の確認", review);
  make("pre", "review-text", "", review);
  button("apply", "確認したセットを表示", review);
  const result = make("section", "result");
  make("h3", "result-heading", "3. 期間と証拠の確認結果", result);
  make("pre", "summary", "", result);
  make("p", "origin", "", result);
  const cards = make("div", "cards", undefined, result);
  const timelineHost = make("div", "timeline-host", undefined, result);
  const checks = make("section", "checks", undefined, result);
  make("h4", "checks-heading", "次に確認する箇所", checks);
  make("p", "checks-help", "どの報告の、どの範囲を調べるかを表示します。元の証拠を自動修正する操作はありません。", checks);
  const checkFilters = make("div", "check-filters", undefined, checks);
  checkFilters.className += " report-set-filters";
  select("check-agent", "確認箇所のトークン", [["all", "すべて"], ["DAT", "DAT"], ["EMA", "EMA"], ["CAWELON", "CAWELON"]], checkFilters);
  select("check-severity", "確認箇所の種類", [["all", "すべて"], ["conflict", "証拠の食い違い"],
    ["missing", "不足している記録"], ["review", "内容の確認"], ["information", "補足"]], checkFilters);
  field("check-search", "確認箇所を保存名・ブロック番号で探す", "search", checkFilters).maxLength = 100;
  make("p", "check-count", "", checks);
  const checkList = make("div", "check-list", undefined, checks);
  const detail = make("details", "details", undefined, result);
  make("summary", "details-heading", "計画の範囲を一覧で見る", detail);
  const ranges = make("div", "ranges", undefined, detail);
  button("inspect", "現在の保存履歴と照合", result);
  make("pre", "inspection", "", result);
  make("p", "limitation", SET_LIMITATION, result);

  const exports = make("section", "export-section", undefined, result);
  make("h4", "export-heading", "確認セットをPCへ保存", exports);
  field("notes", "説明用HTML・CSVに保存メモを含める", "checkbox", exports);
  field("short-addresses", "説明用HTML・CSVのアドレスを短縮する", "checkbox", exports).checked = true;
  make("p", "privacy", "HTML・CSVは説明用の要約です。短縮表示は匿名化ではありません。保存名は常に含みます。", exports);
  field("ack", "JSONには全アドレス・残高・履歴・メモが含まれ、暗号化されないことを確認しました", "checkbox", exports);
  make("p", "json-help", "上のメモ・短縮設定はJSONには適用されません。JSONは元の証拠を含む再読込み用です。", exports);
  const exportButtons = make("div", "export-actions", undefined, exports);
  button("json", "確認セットJSONを保存", exportButtons);
  button("html", "説明用HTMLを保存", exportButtons);
  button("csv", "計画範囲CSVを保存", exportButtons);

  const restore = make("section", "restore");
  make("h3", "restore-heading", "保存した確認セットを開く", restore);
  field("file", "確認セットのJSONを選ぶ（最大96 MiB）", "file", restore).accept = ".json,application/json";
  make("p", "restore-help", "JSONを検証し、元の記録から再計算します。適用前に確認できます。報告履歴への追加・上書きは行いません。", restore);

  const query = () => ({ archive: nodes.archive.value, status: nodes["status-filter"].value, search: nodes.search.value });
  function filtered() {
    const key = JSON.stringify(query());
    if (queryDocument !== state.document || queryKey !== key) {
      const rows = queryReportHistory(state.document, query()).rows;
      queryDocument = state.document;
      queryKey = key;
      queryRows = rows;
    }
    return queryRows;
  }

  function showDiagnostics() {
    if (!state?.input) {
      checkList.replaceChildren();
      nodes["check-count"].textContent = "";
      return;
    }
    const options = { agent: nodes["check-agent"].value,
      severity: nodes["check-severity"].value, search: nodes["check-search"].value };
    const key = JSON.stringify(options);
    try {
      if (diagnosticInput !== state.input || diagnosticKey !== key) {
        diagnosticRows = querySetDiagnostics(state.input, options);
        diagnosticInput = state.input;
        diagnosticKey = key;
      }
      checkList.replaceChildren();
      nodes["check-count"].textContent = diagnosticRows.count === 0 ?
        "この選択内では追加確認箇所は見つかりませんでした。現在のチェーン状態の保証ではありません。" :
        diagnosticRows.matched + "/" + diagnosticRows.count + "箇所を表示（絞り込みは確認結果を変えません）";
      for (const item of diagnosticRows.items) {
        const detail = document.createElement("details");
        detail.className = "report-set-check-item";
        detail.setAttribute("data-severity", item.severity);
        const summary = document.createElement("summary");
        summary.textContent = item.title + (item.agents.length ? " / " + item.agents.join("・") : "");
        const body = document.createElement("pre");
        body.textContent = diagnosticText(item);
        detail.append(summary, body);
        if (item.observations.length) {
          const observations = document.createElement("details");
          const caption = document.createElement("summary");
          caption.textContent = "保存したハッシュ・値を確認する";
          const values = document.createElement("pre");
          values.textContent = diagnosticText(item, { shortAddresses: false, includeObservations: true });
          observations.append(caption, values);
          detail.append(observations);
        }
        checkList.append(detail);
      }
    } catch {
      checkList.replaceChildren();
      nodes["check-count"].textContent = "確認箇所の検索条件を確認してください。";
    }
  }
  function showChoices() {
    let rows = [];
    try {
      rows = filtered();
      nodes.count.textContent = rows.length + "/" + state.document.entries.length + "件を表示";
    } catch {
      nodes.count.textContent = "検索条件を確認してください。";
    }
    const visible = new Set(rows.map(row => row.id));
    for (const [id, choice] of choices) {
      choice.label.hidden = !visible.has(id);
      choice.checkbox.checked = state.selection.includes(id);
      choice.checkbox.disabled = state.busy || !state.loaded;
    }
    const hidden = state.selection.filter(id => !visible.has(id)).length;
    nodes["selection-count"].textContent = "選択 " + state.selection.length + "件（絞り込み対象外 " + hidden + "件）";
    nodes["select-visible"].disabled = state.busy || !state.loaded || !rows.length;
  }
  function buildChoices() {
    choices.clear();
    choiceList.replaceChildren();
    for (const entry of state.document.entries) {
      const label = document.createElement("label");
      label.className = "report-set-choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = entry.id;
      checkbox.className = "report-set-choice-check";
      checkbox.setAttribute("aria-label", entry.label + (entry.archived ? "（非表示保管）" : "") + "を選択");
      const caption = document.createElement("span");
      caption.textContent = entry.label + (entry.archived ? "（非表示保管）" : "") + " / 作成 " + entry.report.createdAt;
      label.append(checkbox, caption);
      choiceList.append(label);
      checkbox.addEventListener("change", () => {
        if (disposed) return;
        const selected = state.selection.filter(id => id !== entry.id);
        if (checkbox.checked) selected.push(entry.id);
        controller.select(selected);
      });
      choices.set(entry.id, { label, checkbox });
    }
  }
  function buildResult(value) {
    timelinePanel?.dispose();
    timelinePanel = null;
    cards.replaceChildren();
    ranges.replaceChildren();
    if (!value) return;
    timelinePanel = mountReportSetTimeline({ document, parent: timelineHost, input: state.input });
    for (const token of value.tokens) {
      const card = document.createElement("article");
      card.className = "report-set-card";
      card.setAttribute("data-agent", token.agent);
      card.setAttribute("data-state", token.continuous ? "continuous" : "review");
      const heading = document.createElement("h4");
      heading.textContent = token.agent;
      const body = document.createElement("pre");
      body.textContent = setTokenText(token);
      card.append(heading, body);
      cards.append(card);
      for (const group of token.groups) {
        const caption = document.createElement("h4");
        caption.textContent = token.agent + " / Chain " + group.context.chainId + " / " + group.context.account;
        ranges.append(caption);
        const table = document.createElement("table");
        table.className = "report-set-table";
        const head = document.createElement("tr");
        for (const text of ["計画範囲 (開始, 終了]", "ブロック数", "状態", "報告数"]) {
          const th = document.createElement("th");
          th.textContent = text;
          th.setAttribute("scope", "col");
          head.append(th);
        }
        const thead = document.createElement("thead");
        thead.append(head); table.append(thead);
        const tbody = document.createElement("tbody");
        for (const segment of group.segments) {
          const tr = document.createElement("tr");
          for (const text of [segment.start + " → " + segment.end, segment.blocks, SET_SEGMENTS[segment.kind], segment.reportIds.length]) {
            const td = document.createElement("td");
            td.textContent = String(text);
            tr.append(td);
          }
          tbody.append(tr);
        }
        table.append(tbody);
        ranges.append(table);
      }
    }
  }
  function render(value) {
    if (disposed) return;
    state = value;
    host.setAttribute("aria-busy", String(value.busy));
    status.textContent = value.error ? setErrorText(value.error) : value.message;
    status.setAttribute("data-error", String(Boolean(value.error)));
    if (lastDocument !== value.document) {
      lastDocument = value.document;
      buildChoices();
    }
    if (lastResult !== value.result) {
      lastResult = value.result;
      buildResult(value.result);
      nodes.ack.checked = false;
      showDiagnostics();
    }
    nodes.refresh.disabled = value.busy;
    nodes.cancel.disabled = !value.busy && !value.review;
    for (const name of ["archive", "status-filter", "search", "title"]) nodes[name].disabled = value.busy || !value.loaded;
    nodes["clear-selection"].disabled = value.busy || !value.loaded || !value.selection.length;
    nodes.prepare.disabled = value.busy || !value.loaded || !value.selection.length;
    nodes.apply.disabled = value.busy || !value.review;
    nodes.file.disabled = value.busy;
    review.hidden = !value.review;
    nodes["review-text"].textContent = value.review ? [
      "出所: " + (value.review.origin === "file" ? "確認セットJSON" : "PC内の保存履歴"),
      ...value.review.input.entries.map(entry => "・" + entry.label + (entry.archived ? "（非表示保管）" : "")),
      setSummaryText(value.review.result),
      ...value.review.result.tokens.map(token => setTokenText(token)),
      value.input ? "現在の確認結果は、適用したときに置き換わります。" : "",
    ].filter(Boolean).join("\n") : "";
    result.hidden = !value.result;
    nodes.summary.textContent = setSummaryText(value.result);
    nodes.origin.textContent = value.result ? "出所: " + (value.origin === "file" ? "確認セットJSON" : "PC内の保存履歴") +
      " / この結果は作成した時点で固定されています。" : "";
    nodes.inspection.textContent = setSourcesText(value.inspection);
    nodes.inspect.disabled = value.busy || !value.result;
    for (const name of ["ack", "notes", "short-addresses"]) nodes[name].disabled = value.busy || !value.result;
    for (const name of ["check-agent", "check-severity", "check-search"]) nodes[name].disabled = value.busy || !value.result;
    for (const name of ["json", "html", "csv"]) nodes[name].disabled = value.busy || !value.result || !nodes.ack.checked;
    showChoices();
  }

  controller = createReportSetController({ storage, onChange: render, ...(now ? { now } : {}) });
  listen(nodes.refresh, "click", () => { void controller.refresh(); });
  listen(nodes.cancel, "click", controller.cancel);
  listen(nodes.title, "input", controller.invalidateReview);
  for (const name of ["archive", "status-filter", "search"]) listen(nodes[name], name === "search" ? "input" : "change", showChoices);
  for (const name of ["check-agent", "check-severity", "check-search"]) {
    listen(nodes[name], name === "check-search" ? "input" : "change", showDiagnostics);
  }
  listen(nodes["select-visible"], "click", () => {
    try { controller.select([...new Set([...state.selection, ...filtered().map(row => row.id)])]); }
    catch { nodes.count.textContent = "検索条件を確認してください。"; }
  });
  listen(nodes["clear-selection"], "click", () => controller.select([]));
  listen(nodes.prepare, "click", () => controller.prepare(nodes.title.value));
  listen(nodes.apply, "click", () => { void controller.applyReview(); });
  listen(nodes.inspect, "click", () => { void controller.inspectSources(); });
  listen(nodes.ack, "change", () => render(controller.state));
  for (const format of ["json", "html", "csv"]) {
    listen(nodes[format], "click", () => { void controller.exportFile(format, nodes.ack.checked, download,
      { includeNotes: nodes.notes.checked, shortAddresses: nodes["short-addresses"].checked }); });
  }
  listen(nodes.file, "change", () => {
    const file = nodes.file.files?.[0];
    nodes.file.value = "";
    if (file) void controller.importFile(file);
  });
  render(controller.state);
  return Object.freeze({ getState: () => controller.state,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      timelinePanel?.dispose();
      listeners.forEach(remove => remove());
      choices.clear();
      host.remove();
    } });
}

function downloadSet(file, document) {
  return offerWalletDownload({ document, prepared: file });
}
