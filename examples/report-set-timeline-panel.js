import { reportSetTimeline, timelineCellLabel, timelineCellText,
  TIMELINE_NOTICE, historyCoverageSummaryText, historyCoverageCellText, reportSetMissingHistoryQueue, missingHistoryQueueText,
  missingHistoryPageRange } from "../src/report-set-timeline.js";
import { shortSetAddress } from "../src/report-set-view.js";
import { validateReportSet } from "../src/report-set-model.js";
import { consumeCallback } from "../src/security-callback.js";

/** Owns only its rendered nodes. Selecting a cell has no storage/provider effects. */
export function mountReportSetTimeline({ document, parent, input, onQueueSelection }) {
  const snapshot = validateReportSet(input);
  const model = reportSetTimeline(snapshot);
  const host = document.createElement("section");
  host.className = "report-set-timeline";
  host.setAttribute("aria-label", "ブロック順の期間一覧");
  const heading = document.createElement("h4");
  heading.textContent = "区間を選んで、含まれる報告を確認";
  const notice = document.createElement("p");
  notice.textContent = TIMELINE_NOTICE;
  host.append(heading, notice);
  const listeners = [];
  const queuePanels = [];
  let disposed = false;

  for (const agent of model.missingAgents) {
    const missing = document.createElement("p");
    missing.className = "report-set-timeline-missing";
    missing.textContent = agent + ": 選択した報告に期間の記録がありません。";
    host.append(missing);
  }

  for (const group of model.groups) {
    const section = document.createElement("section");
    section.className = "report-set-timeline-group";
    const title = document.createElement("h5");
    title.textContent = group.agent + " / Chain " + group.context.chainId +
      " / " + shortSetAddress(group.context.account);
    const row = document.createElement("div");
    row.className = "report-set-timeline-row";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", title.textContent + " の区間");
    const detail = document.createElement("pre");
    detail.className = "report-set-timeline-detail";
    detail.setAttribute("role", "status");
    detail.setAttribute("aria-live", "polite");
    detail.textContent = "上の区間を選ぶと、該当する報告と確認点を表示します。";
    const buttons = [];

    group.cells.forEach((cell, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "report-set-timeline-cell";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", timelineCellLabel(cell));
      button.setAttribute("data-tone", cell.tone);
      button.setAttribute("data-cell", cell.id);
      const number = document.createElement("span");
      number.className = "report-set-timeline-number";
      number.textContent = "区間 " + cell.number + " / " + cell.kindLabel;
      const range = document.createElement("strong");
      range.textContent = cell.start + " → " + cell.end;
      const length = document.createElement("span");
      length.textContent = cell.blocks + "ブロック" +
        (cell.tone === "conflict" ? " / 食い違いあり" : cell.tone === "review" ? " / 要確認" : "");
      button.append(number, range, length);
      const choose = () => {
        if (disposed) return;
        buttons.forEach(element => element.setAttribute("aria-pressed", String(element === button)));
        detail.textContent = timelineCellText(cell);
      };
      const keydown = event => {
        if (disposed || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
          Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
        buttons[target].focus();
      };
      button.addEventListener("click", choose);
      button.addEventListener("keydown", keydown);
      listeners.push(() => {
        button.removeEventListener("click", choose);
        button.removeEventListener("keydown", keydown);
      });
      buttons.push(button);
      row.append(button);
    });
    section.append(title, row, detail);
    const coverage = document.createElement("details");
    coverage.className = "report-set-history-coverage";
    const coverageTitle = document.createElement("summary");
    coverageTitle.textContent = "保存済み履歴範囲と、記録がない区間を確認";
    const coverageSummary = document.createElement("p");
    coverageSummary.className = "report-set-history-coverage-summary";
    coverageSummary.textContent = historyCoverageSummaryText(group.historyCoverage);
    const coverageNotice = document.createElement("p");
    coverageNotice.textContent = "下の範囲は両端を含みます。保存された問い合わせ記録の範囲を数えます。取得元による省略や、記録の前後の履歴は未確認です。";
    const coverageRow = document.createElement("div");
    coverageRow.className = "report-set-timeline-row";
    coverageRow.setAttribute("role", "group");
    coverageRow.setAttribute("aria-label", title.textContent + " の保存済み履歴範囲");
    const coverageDetail = document.createElement("pre");
    coverageDetail.className = "report-set-history-coverage-detail";
    coverageDetail.setAttribute("role", "status"); coverageDetail.setAttribute("aria-live", "polite");
    coverageDetail.textContent = "区間を選ぶと、元の保存記録と確認点を表示します。";
    const coverageButtons = [];
    for (const cell of group.historyCoverage.cells) {
      const button = document.createElement("button"); button.type = "button";
      button.className = "report-set-history-coverage-cell";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("data-kind", cell.kind);
      button.setAttribute("data-review", String(cell.needsReview));
      button.textContent = cell.fromBlock + " ～ " + cell.toBlock + " / " +
        ({ recorded: "履歴記録あり", pending: "履歴記録なし", unplanned: "計画なし" }[cell.kind]) + (cell.needsReview ? " / 要確認" : "");
      const choose = () => {
        if (disposed) return;
        coverageButtons.forEach(element => element.setAttribute("aria-pressed", String(element === button)));
        coverageDetail.textContent = historyCoverageCellText(cell);
      };
      button.addEventListener("click", choose);
      listeners.push(() => button.removeEventListener("click", choose));
      coverageButtons.push(button); coverageRow.append(button);
    }
    coverage.append(coverageTitle, coverageSummary, coverageNotice, coverageRow, coverageDetail);
    const queuePanel = missingQueuePanel(document, group, snapshot, listeners, () => disposed, onQueueSelection);
    queuePanels.push(queuePanel); coverage.append(queuePanel.host);
    section.append(coverage);
    host.append(section);
  }
  parent.append(host);
  return Object.freeze({
    setBusy(value) { if (!disposed) queuePanels.forEach(panel => panel.setBusy(value === true)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.forEach(remove => remove());
      host.remove();
    },
  });
}


/** A local proposal, never an execution control. Source is the mounted immutable set. */
function missingQueuePanel(document, group, input, listeners, isDisposed, onQueueSelection) {
  const host = document.createElement("section"); host.className = "report-set-history-queue";
  const heading = document.createElement("h6"); heading.textContent = "記録がない区間の読み取り予定（10回分ずつ）";
  const notice = document.createElement("p");
  notice.textContent = "表示中の保存資料だけを基に予定を作ります。この操作でWalletの読み取りは始まりません。保存済みで要確認の区間は、この予定の対象外です。";
  const field = (tag, name, text) => {
    const label = document.createElement("label"); label.textContent = text;
    const element = document.createElement(tag); element.className = "report-set-history-queue-" + name;
    label.append(element); host.append(label); return element;
  };
  host.append(heading, notice);
  const kind = field("select", "kind", "予定に含める範囲");
  for (const [value, text] of [["pending", "計画内で履歴記録なし"], ["unplanned", "計画と計画の間の空白"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; kind.append(option);
  }
  kind.value = "pending";
  const size = field("input", "size", "1回のブロック数（1～2,000）"); size.type = "number"; size.min = "1"; size.max = "2000"; size.step = "1"; size.value = "2000";
  const page = field("input", "page", "ページ番号"); page.type = "text"; page.inputMode = "numeric"; page.value = "1";
  const button = (name, text) => { const node = document.createElement("button"); node.type = "button"; node.className = "report-set-history-queue-" + name; node.textContent = text; host.append(node); return node; };
  const show = button("show", "10回分の予定を表示"), previous = button("previous", "前の10回分"), next = button("next", "次の10回分");
  previous.disabled = true; next.disabled = true;
  const output = document.createElement("pre"); output.className = "report-set-history-queue-output";
  output.setAttribute("role", "status"); output.setAttribute("aria-live", "polite");
  output.textContent = "範囲と1回のブロック数を選んで、予定を表示してください。"; host.append(output);
  const windowChoice = typeof onQueueSelection === "function" ? field("select", "window", "未取得の控えとして保存する範囲") : null;
  const choose = windowChoice ? button("choose", "この範囲を下の保存対象にする") : null;
  let result = null, busy = false;
  const selectedWindow = () => !result || !windowChoice ? null : windowChoice.value === "page" ? missingHistoryPageRange(result) :
    result.items.find(row => row.number === windowChoice.value);
  const listen = (node, event, action) => { node.addEventListener(event, action); listeners.push(() => node.removeEventListener(event, action)); };
  const notifySelection = selection => { if (!isDisposed() && typeof onQueueSelection === "function") consumeCallback(() => onQueueSelection(selection, group.id)); };
  const resetSelection = () => {
    if (!windowChoice) return;
    windowChoice.replaceChildren(); const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "区間を選んでください";
    windowChoice.append(placeholder); windowChoice.value = ""; notifySelection(null);
  };
  const sync = () => {
    if (isDisposed()) return;
    for (const node of [kind, size, page, show]) node.disabled = busy;
    previous.disabled = busy || !result || result.query.page === "0";
    next.disabled = busy || !result || BigInt(result.query.page) + 1n >= BigInt(result.pageCount);
    if (windowChoice) {
      windowChoice.disabled = busy || !result?.items.length;
      choose.disabled = busy || !selectedWindow();
    }
  };
  const clear = () => {
    if (isDisposed() || busy) return;
    result = null; resetSelection(); sync();
    output.textContent = "条件を変更しました。予定を表示し直してください。";
  };
  const render = () => {
    if (isDisposed() || busy) return;
    result = null; resetSelection(); sync();
    try {
      if (!/^[1-9][0-9]{0,77}$/.test(page.value) || !/^[1-9][0-9]{0,3}$/.test(size.value)) throw Error();
      result = reportSetMissingHistoryQueue(input, { groupId: group.id, kind: kind.value, windowSize: Number(size.value), page: (BigInt(page.value) - 1n).toString() });
      output.textContent = missingHistoryQueueText(result);
      if (windowChoice && missingHistoryPageRange(result)) {
        const option = document.createElement("option"); option.value = "page";
        option.textContent = "このページ全体（連続した " + result.items.length + "区間 / " + result.pageBlocks + "ブロック）"; windowChoice.append(option);
      }
      if (windowChoice) for (const row of result.items) {
        const option = document.createElement("option"); option.value = row.number;
        option.textContent = row.number + ". " + row.fromBlock + " ～ " + row.toBlock + "（" + row.blocks + "ブロック）"; windowChoice.append(option);
      }
    } catch { output.textContent = "条件を確認してください。1回1～2,000ブロックで、存在するページ番号を指定します。"; }
    sync();
  };
  listen(show, "click", render);
  listen(kind, "change", () => { if (isDisposed()) return; page.value = "1"; clear(); });
  listen(size, "input", () => { if (isDisposed()) return; page.value = "1"; clear(); });
  listen(page, "input", clear);
  for (const [node, step] of [[previous, -1n], [next, 1n]]) listen(node, "click", () => {
    if (isDisposed() || !result || node.disabled) return;
    page.value = (BigInt(result.query.page) + step + 1n).toString(); render();
  });
  if (windowChoice) {
    listen(windowChoice, "change", () => { if (isDisposed() || busy) return; notifySelection(null); sync(); });
    listen(choose, "click", () => {
      if (isDisposed() || busy || !result) return;
      const window = selectedWindow();
      if (!window) return;
      notifySelection(Object.freeze({ query: result.query, context: result.context, window }));
    });
    resetSelection();
  }
  sync();
  return Object.freeze({ host, setBusy(value) { busy = value; sync(); } });
}
