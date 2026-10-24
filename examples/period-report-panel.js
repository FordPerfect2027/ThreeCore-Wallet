import { offerWalletDownload } from "./export-download.js";
import { periodReportComparisonText } from "../src/period-report-comparison.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { createPeriodLibraryStorage } from "../src/period-library-storage.js";
import { PERIOD_REPORT_AGENTS } from "../src/period-report-model.js";
import { libraryEntryStatus } from "../src/period-library-model.js";
import { queryPeriodReportEvents } from "../src/period-report-query.js";
import { reportStatusText, reportIssueText, reportErrorText, reportSlotText,
  reportAmount, REPORT_LIMITATION } from "../src/period-report-view.js";

/** Text-only UI. Mounting neither connects a wallet nor opens its local database. */
export function mountPeriodReportPanel({ document, parent, storage = createPeriodLibraryStorage(),
  download = file => downloadReport(file, document), now } = {}) {
  const nodes = {}, cleanup = [];
  let disposed = false, state, lastDocument = null, lastInput = null, page = 0;
  function make(tag, name, text, container = host) {
    const node = document.createElement(tag); node.className = "period-report-" + name;
    if (text !== undefined) node.textContent = text;
    container?.append(node); nodes[name] = node; return node;
  }
  const host = make("section", "panel", undefined, null);
  host.setAttribute("aria-label", "3トークンの保存期間レポート"); parent.append(host);
  make("p", "eyebrow", "THREECORE / PERIOD REPORT");
  make("h2", "heading", "3つの記録を、一つの報告に");
  make("p", "intro", "保存したDAT・EMA・CAWELONの控えを選び、残高と履歴の関係を比較します。報告は選んだ時点の記録を固定したものです。");
  function button(name, text, container = host) {
    const node = make("button", name, text, container); node.type = "button"; return node;
  }
  function field(name, text, type = "text", container = host) {
    const label = make("label", name + "-label", text, container);
    const node = make("input", name, undefined, label); node.type = type; node.autocomplete = "off"; return node;
  }
  function chooser(name, text, container = host) {
    const label = make("label", name + "-label", text, container);
    return make("select", name, undefined, label);
  }
  function option(select, value, text) {
    const node = document.createElement("option"); node.value = value; node.textContent = text; select.append(node);
  }
  const actions = make("div", "actions");
  button("refresh", "報告用に保存一覧を読み込む", actions);
  button("cancel", "報告の処理を中止", actions);
  const status = make("p", "status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const selection = make("div", "selection");
  make("h3", "selection-title", "PC内の控えから報告を作る", selection);
  field("title", "報告名（60文字以内）", "text", selection).maxLength = 60;
  nodes.title.value = "ThreeCore 期間確認";
  for (const agent of PERIOD_REPORT_AGENTS) chooser("select-" + agent, agent + "の控え", selection);
  button("prepare", "選んだ記録で報告内容を確認", selection);
  const review = make("section", "review");
  make("h3", "review-heading", "作成前の確認", review);
  make("pre", "review-text", "", review);
  button("apply", "確認した内容で報告を作成", review);
  const result = make("section", "result");
  make("h3", "result-title", "", result);
  make("p", "result-status", "", result);
  make("p", "result-meta", "", result);
  make("p", "notice", REPORT_LIMITATION, result);
  make("ul", "issues", undefined, result);
  const cards = make("div", "cards", undefined, result);
  for (const agent of PERIOD_REPORT_AGENTS) {
    const card = make("article", "card-" + agent, undefined, cards);
    make("h4", "card-heading-" + agent, agent, card);
    make("p", "card-status-" + agent, "", card);
    make("p", "card-balance-" + agent, "", card);
    make("p", "card-difference-" + agent, "", card);
    const detail = make("details", "card-details-" + agent, undefined, card);
    make("summary", "card-summary-" + agent, "残高・取得状態の内訳", detail);
    make("pre", "card-text-" + agent, "", detail);
  }
  const conflicts = make("details", "conflicts", undefined, result);
  make("summary", "conflicts-title", "ブロックハッシュの不一致", conflicts);
  make("pre", "conflicts-text", "", conflicts);
  const events = make("details", "events", undefined, result);
  make("summary", "events-title", "計算に使ったTransfer履歴を見る", events);
  make("p", "events-note", "この表示の絞り込みで、上の残高や差額の計算結果は変わりません。", events);
  const filters = make("div", "filters", undefined, events);
  const agentFilter = chooser("event-agent", "履歴のトークン", filters);
  for (const agent of PERIOD_REPORT_AGENTS) option(agentFilter, agent, agent);
  agentFilter.value = "DAT";
  const direction = chooser("direction", "履歴の方向", filters);
  for (const [value, text] of [["all", "すべて"], ["incoming", "入金"], ["outgoing", "出金"], ["self", "同じアドレス間"]]) option(direction, value, text);
  direction.value = "all";
  field("search", "アドレス・取引ハッシュ・ブロックで検索", "text", filters).maxLength = 100;
  make("p", "event-count", "", events);
  const scroll = make("div", "table-scroll", undefined, events);
  const table = make("table", "table", undefined, scroll);
  make("caption", "caption", "保存した履歴（1ページ25件）", table);
  const header = make("thead", "thead", undefined, table), tr = document.createElement("tr");
  for (const label of ["ブロック / 方向", "数量 / 差引", "送信元 → 送信先", "取引ハッシュ"]) {
    const th = document.createElement("th"); th.scope = "col"; th.textContent = label; tr.append(th);
  }
  header.append(tr); make("tbody", "rows", undefined, table);
  const pager = make("div", "pager", undefined, events);
  button("previous", "前の25件", pager); button("next", "次の25件", pager);
  const exports = make("section", "exports", undefined, result);
  make("h4", "exports-title", "報告をファイルに保存", exports);
  field("export-ack", "公開アドレス・残高・履歴を含むファイルをPCに保存することを確認しました", "checkbox", exports);
  const exportActions = make("div", "export-actions", undefined, exports);
  button("json", "元の記録を含む報告JSON", exportActions);
  button("csv", "3トークンの要約CSV", exportActions);
  button("html", "印刷用の報告HTML", exportActions);
  make("p", "export-note", "JSONは再読込み用、CSV・HTMLは要約です。暗号化されていません。チェックサムは破損確認用です。", exports);
  const imports = make("section", "imports");
  field("file", "保存した報告JSONを開く（最大64 MiB）", "file", imports).accept = ".json,application/json";
  make("p", "import-note", "読み込んだ元データから再計算し、確認後に表示します。保存一覧への追加や現在のウォレットへの接続は行いません。", imports);

  function renderEvents() {
    nodes.rows.replaceChildren();
    if (!state?.input) return;
    try {
      const data = queryPeriodReportEvents(state.input, { agent: nodes["event-agent"].value,
        direction: nodes.direction.value, search: nodes.search.value, page });
      page = data.page;
      nodes["event-count"].textContent = `${data.matched}/${data.total}件 · ${data.page + 1}/${data.pages}ページ`;
      nodes.previous.disabled = state.busy || data.page === 0;
      nodes.next.disabled = state.busy || data.page + 1 >= data.pages;
      for (const row of data.rows) {
        const tr = document.createElement("tr");
        const direction = { incoming: "入金", outgoing: "出金", self: "同じアドレス間" }[row.direction];
        for (const text of [row.blockNumber + " / " + direction,
          reportAmount(row.amountBaseUnits) + " / " + reportAmount(row.deltaBaseUnits),
          row.from + " → " + row.to, row.transactionHash]) {
          const td = document.createElement("td"); td.textContent = text; tr.append(td);
        }
        nodes.rows.append(tr);
      }
    } catch {
      nodes["event-count"].textContent = "検索条件を確認してください。";
      nodes.previous.disabled = true; nodes.next.disabled = true;
    }
  }
  function render(value) {
    if (disposed) return;
    state = value; host.setAttribute("aria-busy", String(value.busy));
    status.textContent = value.error ? reportErrorText(value.error) : value.message;
    status.setAttribute("data-error", String(Boolean(value.error)));
    nodes.refresh.disabled = value.busy;
    nodes.cancel.disabled = !value.busy && !value.review;
    nodes.file.disabled = value.busy;
    nodes.prepare.disabled = value.busy || !value.loaded;
    nodes.title.disabled = value.busy;
    if (value.document !== lastDocument) {
      lastDocument = value.document;
      for (const agent of PERIOD_REPORT_AGENTS) {
        const select = nodes["select-" + agent]; select.replaceChildren();
        option(select, "", "選択しない");
        for (const entry of value.document.entries.filter(row => row.draft.plan.context.agent === agent)) {
          const plan = entry.draft.plan;
          const status = { complete: "取得済み", partial: "途中", blocked: "再取得" }[libraryEntryStatus(entry)];
          option(select, entry.id, `${entry.label} · ${plan.earlierBlock}→${plan.laterBlock} · chain ${plan.context.chainId} · ${status}${entry.archived ? " · 非表示保管" : ""}`);
        }
      }
    }
    for (const agent of PERIOD_REPORT_AGENTS) {
      nodes["select-" + agent].value = value.selection[agent] ?? "";
      nodes["select-" + agent].disabled = value.busy || !value.loaded;
    }
    review.hidden = !value.review;
    nodes.apply.disabled = value.busy || !value.review;
    nodes["review-text"].textContent = value.review ? [value.review.input.title,
      "出所: " + (value.review.origin === "history" ? "PC内の報告履歴" : value.review.origin === "file" ? "報告JSON（保存一覧には追加されません）" : "PC内の保存一覧"),
      reportStatusText(value.review.report.status),
      ...value.review.report.slots.map(slot => slot.agent + ": " + reportStatusText(slot.status) +
        (slot.plan ? " / chain " + slot.plan.context.chainId + " / " + slot.plan.earlierBlock + "→" + slot.plan.laterBlock + " / " + slot.plan.context.account : "")),
      ...value.review.report.issues.map(reportIssueText),
      periodReportComparisonText(value.review.comparison),
    ].join("\n") : "";
    result.hidden = !value.report;
    if (value.input !== lastInput) {
      lastInput = value.input; page = 0; nodes["export-ack"].checked = false;
      if (value.report) {
        const report = value.report;
        nodes["result-title"].textContent = report.title;
        nodes["result-status"].textContent = reportStatusText(report.status);
        nodes["result-status"].setAttribute("data-state", report.status);
        nodes["result-meta"].textContent = `出所: ${value.origin === "history" ? "PC内の報告履歴" : value.origin === "file" ? "報告JSON" : "PC内の保存一覧"} · 作成: ${report.createdAt} · ${report.selectedCount}/3トークン · ${report.eventCount}イベント（トークン別件数の合計）`;
        nodes.issues.replaceChildren();
        for (const code of [...report.issues, ...report.warnings]) {
          const li = document.createElement("li"); li.textContent = reportIssueText(code); nodes.issues.append(li);
        }
        for (const slot of report.slots) {
          nodes["card-status-" + slot.agent].textContent = reportStatusText(slot.status);
          nodes["card-balance-" + slot.agent].textContent = reportAmount(slot.arithmetic.laterBalanceBaseUnits) + " " + slot.agent;
          nodes["card-difference-" + slot.agent].textContent = "未説明の差: " + reportAmount(slot.arithmetic.totals?.residualBaseUnits);
          nodes["card-text-" + slot.agent].textContent = reportSlotText(slot);
        }
        nodes.conflicts.hidden = report.anchors.conflicts.length === 0 && report.anchors.invalidAgents.length === 0;
        nodes["conflicts-text"].textContent = [
          ...report.anchors.invalidAgents.map(agent => agent + ": 記録内のハッシュ不一致"),
          ...report.anchors.conflicts.map(row => `chain ${row.chainId}, block ${row.number}\n` +
            row.observations.map(observation => observation.agent + ": " + observation.hash).join("\n")),
        ].join("\n\n");
      }
    }
    for (const name of ["json", "csv", "html"]) nodes[name].disabled = value.busy || !value.input || !nodes["export-ack"].checked;
    for (const name of ["event-agent", "direction", "search", "export-ack"]) nodes[name].disabled = value.busy || !value.input;
    renderEvents();
  }
  const controller = createPeriodReportController({ storage, onChange: render, ...(now ? { now } : {}) });
  function listen(name, event, action) {
    nodes[name].addEventListener(event, action); cleanup.push(() => nodes[name].removeEventListener(event, action));
  }
  listen("refresh", "click", () => { void controller.refresh(); });
  listen("cancel", "click", controller.cancel);
  listen("prepare", "click", () => controller.prepare(nodes.title.value));
  listen("apply", "click", () => { void controller.applyReview(); });
  listen("title", "input", controller.invalidateReview);
  for (const agent of PERIOD_REPORT_AGENTS) listen("select-" + agent, "change", () => controller.select(agent, nodes["select-" + agent].value || null));
  listen("file", "change", () => {
    const file = nodes.file.files?.[0]; nodes.file.value = "";
    if (file) void controller.importFile(file);
  });
  listen("export-ack", "change", () => render(controller.state));
  for (const name of ["json", "csv", "html"]) listen(name, "click", () => { void controller.exportFile(name, nodes["export-ack"].checked, download); });
  for (const name of ["event-agent", "direction", "search"]) listen(name, name === "search" ? "input" : "change", () => { page = 0; renderEvents(); });
  listen("previous", "click", () => { page = Math.max(0, page - 1); renderEvents(); });
  listen("next", "click", () => { page++; renderEvents(); });
  render(controller.state);
  return Object.freeze({ getReport: () => controller.state.report, getInput: () => controller.state.input,
    stageHistory: controller.stageHistory,
    dispose() {
      if (disposed) return; disposed = true; controller.dispose(); cleanup.forEach(remove => remove()); host.remove();
    } });
}

function downloadReport(file, document) {
  return offerWalletDownload({ document, prepared: file });
}
