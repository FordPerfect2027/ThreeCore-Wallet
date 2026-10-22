import { AGENT_IDS } from "../src/wallet-session.js";
import { describeHistoryReview, describeHistoryImport, reviewPortfolioHistory, reviewHistoryImport } from "../src/history-review.js";
import { offerHistoryDownload } from "./history-files.js";

/** Content checks are local observations, never a blockchain/security audit. */
export function mountHistoryReview({ document, parent, agent, getArchive, getRevision,
  getIncoming, getReplace, download = offerHistoryDownload }) {
  if (!AGENT_IDS.includes(agent)) throw new TypeError("Unknown ThreeCore agent");
  let disposed = false;
  let proposal = null;
  const stops = [];
  const section = document.createElement("section");
  section.className = "history-review-panel";
  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(name, text, fn) {
    const element = node("button", name + " secondary", text);
    element.type = "button";
    const action = () => {
      if (disposed) return;
      try { fn(); }
      catch {
        invalidate();
        status.textContent = "確認できませんでした。履歴JSONと読み込み方式を確認してください。元の履歴は変更していません。";
      }
    };
    element.addEventListener("click", action);
    stops.push(() => element.removeEventListener("click", action));
    return element;
  }
  const heading = node("h4", "", "保存前の内容確認");
  const explanation = node("p", "notice", "未確認の残高や、読み込みで除外される記録を確認できます。内容の整理であり、監査・安全性・現在の残高の証明ではありません。");
  const status = node("p", "history-review-status", "まだ確認していません。");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = node("pre", "history-review-details");
  function capture(mode) {
    return {
      mode,
      archive: getArchive(),
      revision: getRevision(),
      incoming: mode === "impact" ? getIncoming() : null,
      replace: mode === "impact" ? getReplace() : null,
    };
  }
  function stillCurrent(item) {
    if (item.revision !== getRevision() || item.archive !== getArchive()) return false;
    if (item.mode === "impact" && (item.incoming !== getIncoming() || item.replace !== getReplace())) return false;
    return true;
  }
  const inspect = button("history-review-current", "現在の保存履歴を確認", () => {
    invalidate();
    const captured = capture("current");
    const report = reviewPortfolioHistory(captured.archive);
    if (report.groups.some(group => group.agent !== agent)) throw Error("Agent mismatch");
    details.textContent = describeHistoryReview(captured.archive);
    proposal = { ...captured, report, description: details.textContent };
    save.disabled = false;
    saveText.disabled = false;
    status.textContent = "保存済みの記録内容を確認しました。履歴は変更していません。";
  });
  const impact = button("history-review-impact", "読み込みによる変更予定を確認", () => {
    invalidate();
    const captured = capture("impact");
    const options = { replace: captured.replace };
    const report = reviewHistoryImport(captured.archive, captured.incoming, options);
    if (report.review.groups.some(group => group.agent !== agent)) throw Error("Agent mismatch");
    details.textContent = describeHistoryImport(captured.archive, captured.incoming, options);
    proposal = { ...captured, report, description: details.textContent };
    save.disabled = false;
    saveText.disabled = false;
    status.textContent = "変更予定だけを表示しています。まだ適用していません。";
  });
  const save = button("history-review-save", "内容確認レポートをダウンロード", () => {
    if (!proposal || !Number.isSafeInteger(proposal.revision) || proposal.revision < 0 || !stillCurrent(proposal)) throw Error("Review became stale");
    const text = JSON.stringify(proposal.report, null, 2);
    const mode = proposal.mode === "impact" ? "import-impact" : "coverage";
    download({ document, prepared: Object.freeze({
      filename: "ThreeCore-" + agent + "-" + mode + "-r" + proposal.revision + ".json",
      text,
      mimeType: "application/json;charset=utf-8",
    }) });
    status.textContent = "内容確認レポートのダウンロードを開始しました。これは復元用の履歴ファイルではありません。";
  });
  save.disabled = true;
  const saveText = button("history-review-save-text", "確認内容を読みやすいテキストで保存", () => {
    if (!proposal || !Number.isSafeInteger(proposal.revision) || proposal.revision < 0 || !stillCurrent(proposal)) throw Error("Review became stale");
    const mode = proposal.mode === "impact" ? "import-impact" : "coverage";
    download({ document, prepared: Object.freeze({
      filename: "ThreeCore-" + agent + "-" + mode + "-r" + proposal.revision + ".txt",
      text: proposal.description,
      mimeType: "text/plain;charset=utf-8",
    }) });
    status.textContent = "読みやすい確認内容のダウンロードを開始しました。復元用JSONとは別の説明ファイルです。";
  });
  saveText.disabled = true;
  const clear = button("history-review-clear", "内容確認の表示を消去", () => {
    invalidate();
    status.textContent = "確認結果だけを消去しました。履歴は保持しています。";
  });
  function invalidate() {
    if (disposed) return;
    proposal = null;
    details.textContent = "";
    save.disabled = true;
    saveText.disabled = true;
  }
  section.append(heading, explanation, inspect, impact, status, details, save, saveText, clear);
  parent.append(section);
  return Object.freeze({
    invalidate,
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      for (const stop of stops) stop();
      section.remove();
    },
  });
}


