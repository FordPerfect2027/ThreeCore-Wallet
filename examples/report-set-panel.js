import { compareReportSetEvents, reportSetEventRecheckRange } from "../src/report-set-engine.js";
import { offerWalletDownload } from "./export-download.js";
import { createReportHistoryStorage } from "../src/report-history-storage.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { queryReportHistory } from "../src/report-history-query.js";
import { querySetDiagnostics, diagnosticText } from "../src/report-set-diagnostics.js";
import { mountReportSetTimeline } from "./report-set-timeline-panel.js";
import { SET_LIMITATION, SET_SEGMENTS, setErrorText, setSummaryText,
  setTokenText, setSourcesText, setCheckReviewText, setComparisonText, setComparisonReviewText, setComparisonEvidenceReviewText, setEventComparisonText } from "../src/report-set-view.js";

export function mountReportSetPanel({ document, parent,
  storage = createReportHistoryStorage(), now,
  download = file => downloadSet(file, document) } = {}) {
  const nodes = {}, listeners = [], choices = new Map();
  let controller, state, disposed = false, lastDocument = null, lastResult = null;
  let queryDocument = null, queryKey = null, queryRows = [];
  let diagnosticInput = null, diagnosticKey = null, diagnosticRows = null;
  let timelinePanel = null;
  let queueSelection = null;
  let eventComparison = null, eventPage = 0;
  let eventRecheck = null, recheckModel = null, recheckPage = null;
  let lastReview = null, lastEvidenceReview = null;
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
  field("comparison-ack", "比較ファイルに確認セット名・保存名・変更点が入り、暗号化されないことを確認しました", "checkbox", review);
  button("comparison-json", "差し替え前後の比較をJSON保存", review);
  make("p", "comparison-help", "比較ファイルは元資料の代わりにはなりません。再計算できるよう、差し替え前と候補の確認セットJSONも保管してください。メモ本文・履歴・残高の値は比較ファイルに含めません。", review);
  field("comparison-file", "保存した比較JSONを照合", "file", review);
  nodes["comparison-file"].accept = ".json,application/json";
  make("pre", "comparison-review-output", "", review);
  button("comparison-review-json", "比較ファイルの照合結果を保存", review);
  field("comparison-evidence-ack", "証拠一式に両方の元資料の全アドレス・残高・履歴・メモが入り、暗号化されないことを確認しました", "checkbox", review);
  button("comparison-evidence-json", "両方の元資料と比較結果を一式で保存", review);
  make("p", "comparison-evidence-help", "一式は最大24 MiBです。上の表示用アドレス短縮・メモ設定は使いません。元資料は共通形式で書き直して保存するため、読み込んだファイルの空白などの並びは保持しません。", review);
  button("apply", "確認したセットを表示", review);
  const result = make("section", "result");
  make("h3", "result-heading", "3. 期間と証拠の確認結果", result);
  make("pre", "summary", "", result);
  make("p", "origin", "", result);
  const cards = make("div", "cards", undefined, result);
  const timelineHost = make("div", "timeline-host", undefined, result);
  const eventSection = make("section", "event-comparison", undefined, result);
  make("h4", "event-comparison-heading", "2つの報告の保存済み履歴を比較", eventSection);
  select("event-before", "資料A", [["", "報告を選んでください"]], eventSection);
  select("event-after", "資料B", [["", "別の報告を選んでください"]], eventSection);
  select("event-agent", "比較するトークン", [["DAT", "DAT"], ["EMA", "EMA"], ["CAWELON", "CAWELON"]], eventSection);
  button("event-compare", "両方が取得した範囲の履歴を比較", eventSection);
  make("pre", "event-output", setEventComparisonText(null), eventSection);
  button("event-previous", "前の50件", eventSection); button("event-next", "次の50件", eventSection);
  field("event-ack", "比較の全アドレス・イベントの値・ハッシュが暗号化されずに保存されることを確認しました", "checkbox", eventSection);
  button("event-json", "履歴の比較を全件JSON保存", eventSection);
  make("p", "event-help", "資料A・Bは選んだ順序です。新旧や信頼性の順ではありません。両方に保存した範囲だけを比較し、取得していない範囲を取引なしとは扱いません。保存メモ本文は含めません。下のアドレス短縮設定は使いません。", eventSection);
  select("event-recheck-choice", "確認し直す食い違い", [["", "比較結果から選んでください"]], eventSection);
  make("pre", "event-recheck-range", "", eventSection);
  field("event-recheck-ack", "選んだ範囲とアカウントの全アドレスを、新しい未取得の控えとして保存することを確認しました", "checkbox", eventSection);
  button("event-recheck-json", "この範囲を確認し直す未取得の控えを保存", eventSection);
  make("p", "event-recheck-help", "新しい控えに元の残高・履歴・比較の根拠は含めません。比較JSONも保管してください。期間読み取り画面で開き、対象を確認してから読み取りを開始できます。ここでは読み取りや元資料の修正を実行しません。", eventSection);
  const checks = make("section", "checks", undefined, result);
  make("h4", "checks-heading", "次に確認する箇所", checks);
  make("p", "checks-help", "どの報告の、どの範囲を調べるかを表示します。元の証拠を自動修正する操作はありません。", checks);
  const checkFilters = make("div", "check-filters", undefined, checks);
  checkFilters.className += " report-set-filters";
  select("check-agent", "確認箇所のトークン", [["all", "すべて"], ["DAT", "DAT"], ["EMA", "EMA"], ["CAWELON", "CAWELON"]], checkFilters);
  select("check-severity", "確認箇所の種類", [["all", "すべて"], ["conflict", "証拠の食い違い"],
    ["missing", "不足している記録"], ["review", "内容の確認"], ["information", "補足"]], checkFilters);
  field("check-search", "確認番号・保存名・資料ID・ブロック番号・ハッシュ・保存値で探す", "search", checkFilters).maxLength = 100;
  make("p", "check-search-help", "一部の文字列でも検索できます。check-番号は、この確認セット内で使う番号です。ハッシュ・保存値は確認箇所に添えられた観測値を探します。", checks);
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
  field("notes", "説明用HTML・計画範囲CSV・確認箇所に保存メモを含める", "checkbox", exports);
  field("short-addresses", "説明用HTML・CSV・確認箇所JSON・履歴範囲JSONのアドレスを短縮する", "checkbox", exports).checked = true;
  make("p", "privacy", "HTML・CSVは説明用の要約です。短縮表示は匿名化ではありません。保存名は常に含みます。", exports);
  field("ack", "保存ファイルに含まれる情報と、暗号化されないことを確認しました", "checkbox", exports);
  make("p", "json-help", "確認セットJSONは再読込み用で、全アドレス・残高・履歴・メモを含みます。上のメモ・短縮設定は適用されません。確認箇所JSONは説明用で、絞り込んだ箇所の保存値・ハッシュと元資料のチェックサムを含みます。", exports);
  const exportButtons = make("div", "export-actions", undefined, exports);
  button("json", "確認セットJSONを保存", exportButtons);
  button("html", "説明用HTMLを保存", exportButtons);
  button("csv", "計画範囲CSVを保存", exportButtons);
  button("coverage-json", "保存済み履歴範囲をJSON保存", exportButtons);
  button("coverage-csv", "保存済み履歴範囲をCSV保存", exportButtons);
  make("p", "coverage-export-help", "保存済み・未取得・計画外の範囲と、元記録の参照を保存します。アドレスの短縮設定を使い、メモ本文・残高・イベント本体は含めません。範囲の有無を示す説明用の資料で、全履歴の取得や取引がなかったことの証明ではありません。", exports);
  button("checks-csv", "絞り込んだ確認箇所をCSV保存", exportButtons);
  button("checks-json", "確認箇所と根拠の値をJSON保存", exportButtons);
  make("p", "checks-export-help", "確認箇所CSVには全体の件数を示す要約行と、条件に合う確認項目が入ります。該当0件でも全体の食い違いは残します。再読込み用の証拠ではありません。", exports);
  select("source-report", "個別に取り出す元レポート", [["", "元レポートを選んでください"]], exports);
  button("source-report-json", "選んだ元レポートをJSON保存", exports);
  make("p", "source-report-help", "元レポートJSONは期間レポート画面で再読込みできます。レポート内の全アドレス・履歴・メモを含み、上のメモ・短縮設定は適用されません。確認セットや保存一覧の付随情報は含めません。", exports);
  make("p", "queue-window-selection", "", exports);
  button("queue-window-json", "選んだ範囲を未取得の期間控えとして保存", exports);
  make("p", "queue-window-help", "予定の1区間、または連続したページ全体を保存対象に選べます。ファイルにはアカウントの全アドレスと期間が入り、残高・履歴は未取得です。期間読み取り画面で開くための新しい控えで、元の証拠は含みません。", exports);
  make("p", "queue-window-order", "期間読み取り画面では、開始・終了の残高を確認してから、古いブロックから順に履歴を読みます。ページ全体をまとめる場合、先頭から指定ブロック数ずつ区切り直すため、上の予定とは並び順や区切りが変わることがあります。読み取り開始は別の操作です。", exports);

  const checkReviewSection = make("section", "saved-check-review", undefined, result);
  make("h4", "saved-check-heading", "保存した確認箇所JSONを元資料と照合", checkReviewSection);
  make("p", "saved-check-help", "表示中の確認セットを元資料として再計算します。ファイル内の検索条件・表示設定を使い、元資料を書き換えません。", checkReviewSection);
  field("check-file", "照合する確認箇所JSONを選ぶ（最大4 MiB）", "file", checkReviewSection).accept = ".json,application/json";
  make("pre", "check-review-output", "", checkReviewSection);
  button("check-review", "最後に完了した照合結果をJSON保存", checkReviewSection);

  const evidenceSection = make("section", "comparison-evidence-section");
  make("h3", "comparison-evidence-heading", "保存した比較の証拠一式を検証する", evidenceSection);
  field("comparison-evidence-file", "比較の証拠一式JSONを選ぶ（最大24 MiB）", "file", evidenceSection).accept = ".json,application/json";
  make("pre", "comparison-evidence-output", "", evidenceSection);
  field("comparison-evidence-review-ack", "検証結果に元資料の識別値・件数・確認結果が入り、暗号化されないことを確認しました", "checkbox", evidenceSection);
  button("comparison-evidence-review-json", "最後に完了した証拠一式の検証結果を保存", evidenceSection);

  select("evidence-source-role", "検証した一式から取り出す元資料", [["", "差し替え前か候補かを選んでください"], ["before", "差し替え前の元資料"], ["after", "候補の元資料"]], evidenceSection);
  field("evidence-source-ack", "元資料の全アドレス・残高・履歴・メモが暗号化されずに保存されることを確認しました", "checkbox", evidenceSection);
  button("evidence-source-json", "選んだ元の確認セットJSONを取り出す", evidenceSection);
  make("p", "evidence-source-help", "検証した一式に実際に含まれる元資料を、そのまま保存します。表示中の確認セットへは取り込みません。比較結果が不一致でも、検査値を確認できた元資料は取り出せます。不一致の判定は変えません。", evidenceSection);

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

  let diagnosticQueryValid = false;
  const checkQuery = () => ({ agent: nodes["check-agent"].value, severity: nodes["check-severity"].value, search: nodes["check-search"].value });
  function showDiagnostics() {
    diagnosticQueryValid = false; nodes["checks-csv"].disabled = true; nodes["checks-json"].disabled = true;
    if (!state?.input) {
      checkList.replaceChildren();
      nodes["check-count"].textContent = "";
      return;
    }
    const options = checkQuery();
    const key = JSON.stringify(options);
    try {
      if (diagnosticInput !== state.input || diagnosticKey !== key) {
        diagnosticRows = querySetDiagnostics(state.input, options);
        diagnosticInput = state.input;
        diagnosticKey = key;
      }
      diagnosticQueryValid = true;
      nodes["checks-csv"].disabled = nodes["checks-json"].disabled = state.busy || !nodes.ack.checked;
      checkList.replaceChildren();
      nodes["check-count"].textContent = diagnosticRows.count === 0 ?
        "この選択内では追加確認箇所は見つかりませんでした。現在のチェーン状態の保証ではありません。" :
        diagnosticRows.matched + "/" + diagnosticRows.count + "箇所を表示（絞り込みは確認結果を変えません）";
      for (const item of diagnosticRows.items) {
        const detail = document.createElement("details");
        detail.className = "report-set-check-item";
        detail.setAttribute("data-severity", item.severity);
        detail.setAttribute("data-check-id", item.id);
        const summary = document.createElement("summary");
        summary.textContent = item.id + " / " + item.title + (item.agents.length ? " / " + item.agents.join("・") : "");
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
  function renderEventRecheck() {
    if (recheckModel !== eventComparison || recheckPage !== eventPage) {
      recheckModel = eventComparison; recheckPage = eventPage; eventRecheck = null; nodes["event-recheck-ack"].checked = false;
      nodes["event-recheck-choice"].replaceChildren();
      const options = [["", "比較結果から選んでください"]];
      if (eventComparison) {
        eventComparison.differences.slice(eventPage * 50, (eventPage + 1) * 50).forEach((row, index) => {
          options.push(["e:" + (eventPage * 50 + index + 1), "イベント " + (eventPage * 50 + index + 1) + " / " + row.transactionHash.slice(0, 12) + "… / log " + row.logIndex]);
        });
        eventComparison.anchorDifferences.forEach((row, index) => options.push(["b:" + (index + 1), "ブロックハッシュの食い違い / Block " + row.blockNumber]));
      }
      for (const [id, label] of options) { const option = document.createElement("option"); option.value = id; option.textContent = label; nodes["event-recheck-choice"].append(option); }
      nodes["event-recheck-choice"].value = "";
    }
    nodes["event-recheck-choice"].disabled = !!state?.busy || !eventComparison || !eventComparison.differences.length && !eventComparison.anchorDifferences.length;
    nodes["event-recheck-ack"].disabled = !!state?.busy || !eventRecheck;
    nodes["event-recheck-json"].disabled = !!state?.busy || !eventRecheck || !nodes["event-recheck-ack"].checked;
    nodes["event-recheck-range"].textContent = eventRecheck ? eventRecheck.context.agent + " / Chain " + eventRecheck.context.chainId + " / " + eventRecheck.context.account +
      "\n再確認する範囲: " + eventRecheck.fromBlock + " ～ " + eventRecheck.toBlock + "（両端を含む " + eventRecheck.blocks + "ブロック）" +
      "\n1回 " + eventRecheck.windowSize + "ブロック。残高・履歴は未取得です。" +
      (eventRecheck.includesInterveningBlocks ? "\n2つの観測位置の間にあるブロックも含みます。" : "") : "比較結果から1つ選ぶと、再確認する範囲を表示します。";
  }
  function renderEventComparison() {
    renderEventRecheck();
    for (const name of ["event-before", "event-after", "event-agent"]) nodes[name].disabled = !!state?.busy || !state?.input;
    nodes["event-compare"].disabled = !!state?.busy || !state?.input || !nodes["event-before"].value || !nodes["event-after"].value || nodes["event-before"].value === nodes["event-after"].value;
    nodes["event-previous"].disabled = !!state?.busy || !eventComparison || eventPage === 0;
    nodes["event-next"].disabled = !!state?.busy || !eventComparison || (eventPage + 1) * 50 >= eventComparison.differences.length;
    nodes["event-ack"].disabled = !!state?.busy || !eventComparison;
    nodes["event-json"].disabled = !!state?.busy || !eventComparison || !nodes["event-ack"].checked;
    nodes["event-output"].textContent = setEventComparisonText(eventComparison, eventPage);
  }
  function clearEventComparison() { eventComparison = null; eventPage = 0; nodes["event-ack"].checked = false; renderEventComparison(); }
  function buildResult(value) {
    timelinePanel?.dispose();
    timelinePanel = null;
    queueSelection = null;
    cards.replaceChildren();
    ranges.replaceChildren();
    nodes["source-report"].replaceChildren();
    for (const [id, label] of [["", "元レポートを選んでください"], ...(value?.reports ?? []).map(row => [row.id, row.label + " / " + row.id])]) {
      const option = document.createElement("option"); option.value = id; option.textContent = label; nodes["source-report"].append(option);
    }
    nodes["source-report"].value = "";
    for (const name of ["event-before", "event-after"]) {
      nodes[name].replaceChildren();
      for (const [id, label] of [["", "報告を選んでください"], ...(value?.reports ?? []).map(row => [row.id, row.label + " / " + row.id])]) {
        const option = document.createElement("option"); option.value = id; option.textContent = label; nodes[name].append(option);
      }
      nodes[name].value = "";
    }
    clearEventComparison();
    if (!value) return;
    timelinePanel = mountReportSetTimeline({ document, parent: timelineHost, input: state.input,
      onQueueSelection(selection, groupId) {
        if (disposed) return;
        if (selection === null && queueSelection?.query.groupId !== groupId) return;
        queueSelection = selection;
        nodes.ack.checked = false;
        render(controller.state);
      } });
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
    if (lastReview !== value.review) { lastReview = value.review; nodes["comparison-ack"].checked = false; nodes["comparison-evidence-ack"].checked = false; }
    if (lastEvidenceReview !== value.evidenceReview) { lastEvidenceReview = value.evidenceReview; nodes["comparison-evidence-review-ack"].checked = false; nodes["evidence-source-role"].value = ""; nodes["evidence-source-ack"].checked = false; }
    nodes["evidence-source-role"].disabled = value.busy || !value.evidenceReview;
    nodes["evidence-source-ack"].disabled = value.busy || !value.evidenceReview || !["before", "after"].includes(nodes["evidence-source-role"].value);
    nodes["evidence-source-json"].disabled = value.busy || !value.evidenceReview || !["before", "after"].includes(nodes["evidence-source-role"].value) || !nodes["evidence-source-ack"].checked;
    renderEventComparison();
    nodes["comparison-evidence-file"].disabled = value.busy;
    nodes["comparison-evidence-output"].textContent = setComparisonEvidenceReviewText(value.evidenceReview);
    nodes["comparison-evidence-review-ack"].disabled = value.busy || !value.evidenceReview;
    nodes["comparison-evidence-review-json"].disabled = value.busy || !value.evidenceReview || !nodes["comparison-evidence-review-ack"].checked;
    nodes["comparison-evidence-ack"].disabled = value.busy || !value.review?.comparison;
    nodes["comparison-evidence-json"].disabled = value.busy || !value.review?.comparison || !nodes["comparison-evidence-ack"].checked;
    nodes.refresh.disabled = value.busy;
    nodes.cancel.disabled = !value.busy && !value.review;
    for (const name of ["archive", "status-filter", "search", "title"]) nodes[name].disabled = value.busy || !value.loaded;
    nodes["clear-selection"].disabled = value.busy || !value.loaded || !value.selection.length;
    nodes.prepare.disabled = value.busy || !value.loaded || !value.selection.length;
    nodes.apply.disabled = value.busy || !value.review;
    nodes.file.disabled = value.busy;
    nodes["check-file"].disabled = value.busy || !value.input;
    nodes["check-review-output"].textContent = setCheckReviewText(value.checkReview);
    nodes["check-review"].disabled = value.busy || !value.checkReview || !nodes.ack.checked;
    nodes["source-report"].disabled = value.busy || !value.input;
    nodes["source-report-json"].disabled = value.busy || !nodes.ack.checked || !value.input?.entries.some(entry => entry.id === nodes["source-report"].value);
    nodes["queue-window-json"].disabled = value.busy || !value.input || !nodes.ack.checked || !queueSelection;
    nodes["queue-window-selection"].textContent = queueSelection ? "未取得の控えの保存対象: " + queueSelection.context.agent +
      " / Chain " + queueSelection.context.chainId + " / " + queueSelection.context.account + " / " +
      queueSelection.window.fromBlock + " ～ " + queueSelection.window.toBlock : "未取得の控えの保存対象: 選択なし";
    timelinePanel?.setBusy(value.busy);
    review.hidden = !value.review;
    nodes["comparison-ack"].disabled = value.busy || !value.review?.comparison;
    nodes["comparison-json"].disabled = value.busy || !value.review?.comparison || !nodes["comparison-ack"].checked;
    nodes["comparison-file"].disabled = value.busy || !value.review?.comparison;
    nodes["comparison-review-output"].textContent = setComparisonReviewText(value.comparisonReview);
    nodes["comparison-review-json"].disabled = value.busy || !value.comparisonReview || !nodes["comparison-ack"].checked;
    nodes["review-text"].textContent = value.review ? [
      "出所: " + (value.review.origin === "file" ? "確認セットJSON" : "PC内の保存履歴"),
      setComparisonText(value.review.comparison),
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
    for (const name of ["json", "html", "csv", "checks-csv", "checks-json", "coverage-json", "coverage-csv"]) nodes[name].disabled = value.busy || !value.result || !nodes.ack.checked || (name.startsWith("checks-") && !diagnosticQueryValid);
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
  listen(nodes["comparison-ack"], "change", () => render(controller.state));
  listen(nodes["comparison-json"], "click", () => { void controller.exportReviewComparison(nodes["comparison-ack"].checked, download); });
  listen(nodes["comparison-file"], "change", () => {
    const file = nodes["comparison-file"].files?.[0]; nodes["comparison-file"].value = "";
    if (file) void controller.reviewComparisonFile(file);
  });
  listen(nodes["comparison-review-json"], "click", () => { void controller.exportComparisonReview(nodes["comparison-ack"].checked, download); });
  listen(nodes["comparison-evidence-ack"], "change", () => render(controller.state));
  listen(nodes["comparison-evidence-json"], "click", () => { void controller.exportComparisonEvidence(nodes["comparison-evidence-ack"].checked, download); });
  listen(nodes["comparison-evidence-file"], "change", () => {
    const file = nodes["comparison-evidence-file"].files?.[0]; nodes["comparison-evidence-file"].value = "";
    if (file) void controller.reviewComparisonEvidenceFile(file);
  });
  listen(nodes["comparison-evidence-review-ack"], "change", () => render(controller.state));
  listen(nodes["comparison-evidence-review-json"], "click", () => { void controller.exportEvidenceReview(nodes["comparison-evidence-review-ack"].checked, download); });
  listen(nodes["evidence-source-role"], "change", () => { nodes["evidence-source-ack"].checked = false; render(controller.state); });
  listen(nodes["evidence-source-ack"], "change", () => render(controller.state));
  listen(nodes["evidence-source-json"], "click", () => { void controller.exportEvidenceSource(nodes["evidence-source-role"].value, nodes["evidence-source-ack"].checked, download); });
  for (const name of ["event-before", "event-after", "event-agent"]) listen(nodes[name], "change", clearEventComparison);
  listen(nodes["event-compare"], "click", () => {
    if (disposed || state.busy || !state.input) return;
    clearEventComparison();
    try { eventComparison = compareReportSetEvents(state.input, { beforeId: nodes["event-before"].value, afterId: nodes["event-after"].value, agent: nodes["event-agent"].value }); renderEventComparison(); }
    catch (error) { nodes["event-output"].textContent = setErrorText(error.code); }
  });
  listen(nodes["event-previous"], "click", () => { if (disposed || state.busy || !eventComparison || eventPage === 0) return; eventPage--; renderEventComparison(); });
  listen(nodes["event-next"], "click", () => { if (disposed || state.busy || !eventComparison || (eventPage + 1) * 50 >= eventComparison.differences.length) return; eventPage++; renderEventComparison(); });
  listen(nodes["event-ack"], "change", renderEventComparison);
  listen(nodes["event-json"], "click", () => { if (eventComparison) void controller.exportEventComparison(eventComparison.query, nodes["event-ack"].checked, download); });
  listen(nodes["event-recheck-choice"], "change", () => {
    if (disposed || state.busy) return;
    eventRecheck = null; nodes["event-recheck-ack"].checked = false;
    if (eventComparison && nodes["event-recheck-choice"].value) {
      try { eventRecheck = reportSetEventRecheckRange(state.input, eventComparison.query, nodes["event-recheck-choice"].value); }
      catch { /* Selection stays disabled until a valid saved discrepancy is chosen. */ }
    }
    renderEventRecheck();
  });
  listen(nodes["event-recheck-ack"], "change", renderEventRecheck);
  listen(nodes["event-recheck-json"], "click", () => { if (eventRecheck) void controller.exportEventRecheck(eventRecheck.query, eventRecheck.selection, nodes["event-recheck-ack"].checked, download); });
  listen(nodes.inspect, "click", () => { void controller.inspectSources(); });
  listen(nodes.ack, "change", () => render(controller.state));
  listen(nodes["check-review"], "click", () => { void controller.exportFile("check-review", nodes.ack.checked, download); });
  listen(nodes["source-report"], "change", () => render(controller.state));
  listen(nodes["source-report-json"], "click", () => { void controller.exportSourceReport(nodes["source-report"].value, nodes.ack.checked, download); });
  listen(nodes["queue-window-json"], "click", () => {
    if (queueSelection) void controller.exportMissingDraft(queueSelection.query, queueSelection.window.number, nodes.ack.checked, download);
  });
  for (const format of ["json", "html", "csv", "checks-csv", "checks-json", "coverage-json", "coverage-csv"]) {
    listen(nodes[format], "click", () => { void controller.exportFile(format, nodes.ack.checked, download,
      { includeNotes: nodes.notes.checked, shortAddresses: nodes["short-addresses"].checked }, format.startsWith("checks-") ? checkQuery() : undefined); });
  }
  listen(nodes.file, "change", () => {
    const file = nodes.file.files?.[0];
    nodes.file.value = "";
    if (file) void controller.importFile(file);
  });
  listen(nodes["check-file"], "change", () => {
    const file = nodes["check-file"].files?.[0];
    nodes["check-file"].value = "";
    if (file) void controller.reviewCheckFile(file);
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
