import { AGENT_IDS } from "../src/wallet-session.js";
import { describeHistoryReview, describeHistoryImport, reviewPortfolioHistory, reviewHistoryImport } from "../src/history-review.js";
import { offerHistoryDownload } from "./history-files.js";
import { observeCallbackResult } from "../src/security-callback.js";

/** Content checks are local observations, never a blockchain/security audit. */
export function mountHistoryReview({ document, parent, agent, getArchive, getRevision,
  getIncoming, getReplace, download = offerHistoryDownload }) {
  if (!AGENT_IDS.includes(agent)) throw new TypeError("Unknown ThreeCore agent");
  let disposed = false;
  let proposal = null;
  let generation = 0;
  const current = id => !disposed && generation === id;
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
      const id = ++generation;
      try { return fn(id); }
      catch {
        if (!current(id)) return;
        clearProposal();
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
  function source(read, id) {
    if (!current(id)) throw Error("Review retired");
    const value = read();
    const kind = observeCallbackResult(value);
    if (!current(id) || kind !== "synchronous") throw Error("Review source unavailable");
    return value;
  }
  function capture(mode, id) {
    return {
      mode,
      archive: source(getArchive, id),
      revision: source(getRevision, id),
      incoming: mode === "impact" ? source(getIncoming, id) : null,
      replace: mode === "impact" ? source(getReplace, id) : null,
    };
  }
  function stillCurrent(item, id) {
    if (!Number.isSafeInteger(item.revision) || item.revision < 0) return false;
    if (item.revision !== source(getRevision, id) || item.archive !== source(getArchive, id)) return false;
    if (item.mode === "impact" && (item.incoming !== source(getIncoming, id) || item.replace !== source(getReplace, id))) return false;
    return item.revision === source(getRevision, id) && current(id);
  }
  const inspect = button("history-review-current", "現在の保存履歴を確認", id => {
    clearProposal();
    const captured = capture("current", id);
    const report = reviewPortfolioHistory(captured.archive);
    if (report.groups.some(group => group.agent !== agent)) throw Error("Agent mismatch");
    const description = describeHistoryReview(captured.archive);
    if (!stillCurrent(captured, id)) throw Error("Review became stale");
    details.textContent = description;
    proposal = { ...captured, report, description };
    save.disabled = false;
    saveText.disabled = false;
    status.textContent = "保存済みの記録内容を確認しました。履歴は変更していません。";
  });
  const impact = button("history-review-impact", "読み込みによる変更予定を確認", id => {
    clearProposal();
    const captured = capture("impact", id);
    const options = { replace: captured.replace };
    const report = reviewHistoryImport(captured.archive, captured.incoming, options);
    if (report.review.groups.some(group => group.agent !== agent)) throw Error("Agent mismatch");
    const description = describeHistoryImport(captured.archive, captured.incoming, options);
    if (!stillCurrent(captured, id)) throw Error("Review became stale");
    details.textContent = description;
    proposal = { ...captured, report, description };
    save.disabled = false;
    saveText.disabled = false;
    status.textContent = "変更予定だけを表示しています。まだ適用していません。";
  });
  function deliver(prepared, id) {
    if (!current(id)) return false;
    const receipt = download({ document, prepared: Object.freeze(prepared) });
    const kind = observeCallbackResult(receipt);
    if (!current(id)) return false;
    if (kind !== "synchronous" || receipt === false) throw Error("Download refused");
    return true;
  }
  const save = button("history-review-save", "内容確認レポートをダウンロード", id => {
    const selected = proposal;
    if (!selected || !stillCurrent(selected, id)) throw Error("Review became stale");
    const text = JSON.stringify(selected.report, null, 2);
    const mode = selected.mode === "impact" ? "import-impact" : "coverage";
    if (!deliver({
      filename: "ThreeCore-" + agent + "-" + mode + "-r" + selected.revision + ".json",
      text,
      mimeType: "application/json;charset=utf-8",
    }, id)) return;
    status.textContent = "内容確認レポートのダウンロードを開始しました。これは復元用の履歴ファイルではありません。";
  });
  save.disabled = true;
  const saveText = button("history-review-save-text", "確認内容を読みやすいテキストで保存", id => {
    const selected = proposal;
    if (!selected || !stillCurrent(selected, id)) throw Error("Review became stale");
    const mode = selected.mode === "impact" ? "import-impact" : "coverage";
    if (!deliver({
      filename: "ThreeCore-" + agent + "-" + mode + "-r" + selected.revision + ".txt",
      text: selected.description,
      mimeType: "text/plain;charset=utf-8",
    }, id)) return;
    status.textContent = "読みやすい確認内容のダウンロードを開始しました。復元用JSONとは別の説明ファイルです。";
  });
  saveText.disabled = true;
  const clear = button("history-review-clear", "内容確認の表示を消去", () => {
    clearProposal();
    status.textContent = "確認結果だけを消去しました。履歴は保持しています。";
  });
  function invalidate() {
    if (disposed) return;
    generation++;
    clearProposal();
  }
  function clearProposal() {
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


