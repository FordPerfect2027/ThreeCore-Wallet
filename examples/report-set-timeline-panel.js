import { reportSetTimeline, timelineCellLabel, timelineCellText,
  TIMELINE_NOTICE, historyCoverageSummaryText, historyCoverageCellText } from "../src/report-set-timeline.js";
import { shortSetAddress } from "../src/report-set-view.js";

/** Owns only its rendered nodes. Selecting a cell has no storage/provider effects. */
export function mountReportSetTimeline({ document, parent, input }) {
  const model = reportSetTimeline(input);
  const host = document.createElement("section");
  host.className = "report-set-timeline";
  host.setAttribute("aria-label", "ブロック順の期間一覧");
  const heading = document.createElement("h4");
  heading.textContent = "区間を選んで、含まれる報告を確認";
  const notice = document.createElement("p");
  notice.textContent = TIMELINE_NOTICE;
  host.append(heading, notice);
  const listeners = [];
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
    section.append(coverage);
    host.append(section);
  }
  parent.append(host);
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.forEach(remove => remove());
      host.remove();
    },
  });
}
