import { reportSetTimeline, timelineCellLabel, timelineCellText,
  TIMELINE_NOTICE } from "../src/report-set-timeline.js";
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
