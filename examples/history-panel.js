import { createHistoryRecovery } from "../src/history-recovery.js";
import { mountHistoryRecovery } from "./history-recovery-panel.js";
import { mountHistoryReview } from "./history-review-panel.js";
import { mountHistoryFiles } from "./history-files.js";
import { createPortfolioHistory, HISTORY_TEXT_LIMIT } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { describePortfolioHistory } from "../src/portfolio-history-summary.js";
import { decodePortfolioReport } from "../src/portfolio-report.js";
import { describePortfolioComparison } from "../src/portfolio-comparison.js";

/** Local, card-scoped history. No automatic persistence or provider access. */
export function mountHistoryPanel({ document, parent, agent, getSnapshot, getReport }) {
  const history = createPortfolioHistory();
  const recovery = createHistoryRecovery(history);
  const importer = createHistoryImportController({
    state: history.state,
    importText: (text, options) => options.replace
      ? recovery.replace(text, history.state().revision) : history.importText(text, options),
  });
  const cleanup = [];
  let disposed = false;
  let review = null;
  let filesPanel;
  let reviewPanel;
  let recoveryPanel;
  let renderedRevision = 0;
  const section = document.createElement("section");
  section.className = "history-panel";
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text, action) {
    const node = element("button", className + " secondary", text);
    node.type = "button";
    listen(node, "click", () => {
      if (disposed) return;
      try { action(); }
      catch (error) {
        cancelReview();
        status.textContent = error?.code === "OBSERVATION_CONFLICT"
          ? "同じブロックの記録が矛盾しています。履歴は変更していません。"
          : "操作できませんでした。入力・選択・記録上限を確認してください。履歴は保持しています。";
      }
    });
    return node;
  }
  function listen(node, event, action) {
    node.addEventListener(event, action);
    cleanup.push(() => node.removeEventListener(event, action));
  }
  function label(text, node) {
    const wrapper = element("label", "", text);
    wrapper.append(node);
    return wrapper;
  }
  function cancelReview() {
    recoveryPanel?.invalidate();
    reviewPanel?.invalidate();
    importer.cancel();
    review = null;
    previewText.textContent = "";
    apply.disabled = true;
  }
  function checkAgent(snapshot) {
    if (snapshot.agent !== agent) throw Error("Different agent");
    return snapshot;
  }
  const heading = element("h3", "", "保存記録の履歴管理");
  const note = element("p", "notice", "このカード専用・最大64件。ページを閉じると消えます。必要な履歴はファイルとしてダウンロードして保存できます。現在の接続・残高・利益を証明しません。署名・送金は行いません。");
  const status = element("p", "history-status", "履歴は0件です。");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = element("ol", "history-list");
  const first = element("select", "history-first");
  first.setAttribute("aria-label", "履歴比較の前の記録");
  const last = element("select", "history-last");
  last.setAttribute("aria-label", "履歴比較の後の記録・削除対象");
  const details = element("pre", "history-details");
  const json = element("textarea", "history-json");
  json.rows = 5;
  json.maxLength = HISTORY_TEXT_LIMIT;
  json.spellcheck = false;
  json.setAttribute("aria-label", "履歴JSON");
  const replace = element("input", "history-replace");
  replace.type = "checkbox";
  const previewText = element("pre", "history-preview-details");
  const addCurrent = button("history-add-current", "今回の確認結果を履歴に追加", () => {
    const snapshot = getSnapshot();
    if (!snapshot) throw Error("No complete current observation");
    const result = history.add(checkAgent(snapshot));
    changed(result.duplicates ? "同じ記録は追加しませんでした。" : "確認結果を履歴に追加しました。");
  });
  const addReport = button("history-add-report", "上の確認記録JSONを履歴に追加", () => {
    const snapshot = decodePortfolioReport(getReport()).snapshot;
    const result = history.add(checkAgent(snapshot));
    changed(result.duplicates ? "同じ記録は追加しませんでした。" : "過去の確認記録を履歴に追加しました。");
  });
  const exportButton = button("history-export", "履歴全体をJSONにする", () => {
    cancelReview();
    json.value = history.exportText();
    status.textContent = "履歴JSONを作成しました。公開アドレスと残高が含まれます。コピーして保存してください。";
  });
  const previewButton = button("history-preview", "履歴JSONの読み込みをプレビュー", () => {
    cancelReview();
    const candidate = createPortfolioHistory();
    candidate.importText(json.value);
    candidate.state().snapshots.forEach(checkAgent);
    review = importer.preview(json.value, { replace: replace.checked });
    previewText.textContent = (review.mode === "replace" ? "置き換え" : "追加") +
      " / 現在 " + review.previousSize + "件 → " + review.resultingSize +
      "件 / 新規 " + review.added + "件 / 重複 " + review.duplicates + "件";
    apply.disabled = false;
    status.textContent = "まだ履歴は変更していません。内容を確認して適用してください。";
  });
  const apply = button("history-apply", "確認した履歴を適用", () => {
    if (!review) throw Error("Preview required");
    importer.apply(review.previewId, json.value);
    changed("確認した履歴を適用しました。");
  });
  apply.disabled = true;
  const compare = button("history-compare", "選択した2件を比較", () => {
    const before = Number(first.value), after = Number(last.value);
    history.compare(before, after, renderedRevision);
    const state = history.state();
    details.textContent = describePortfolioComparison(state.snapshots[before], state.snapshots[after]);
    status.textContent = "過去の2記録を比較しています。送金履歴や利益ではありません。";
  });
  const remove = button("history-remove", "選択した後の記録を削除", () => {
    recovery.remove(Number(last.value), renderedRevision);
    changed("選択した記録を履歴から削除しました。");
  });
  const clearConfirm = element("input", "history-clear-confirm");
  clearConfirm.type = "checkbox";
  const clear = button("history-clear", "このカードの履歴を全消去", () => {
    if (!clearConfirm.checked) throw Error("Confirm clearing");
    recovery.clear(renderedRevision);
    clearConfirm.checked = false;
    changed("このカードの履歴を消去しました。");
  });
  const timeline = button("history-timeline", "履歴の時系列一覧を表示", () => {
    details.textContent = describePortfolioHistory(history.exportText());
  });
  function render() {
    const state = history.state();
    renderedRevision = state.revision;
    list.replaceChildren();
    first.replaceChildren();
    last.replaceChildren();
    state.snapshots.forEach((snapshot, index) => {
      const text = snapshot.agent + " / " + snapshot.account + " / chain " + snapshot.chainId + " / block " + snapshot.blockNumber;
      list.append(element("li", "", text));
      for (const select of [first, last]) {
        const option = element("option", "", text);
        option.value = String(index);
        select.append(option);
      }
    });
    if (state.size) last.value = String(state.size - 1);
    first.disabled = last.disabled = compare.disabled = remove.disabled = !state.size;
    clear.disabled = !state.size;
    recoveryPanel?.refresh();
  }
  function changed(message) {
    filesPanel?.invalidate();
    clearConfirm.checked = false;
    cancelReview();
    details.textContent = "";
    render();
    status.textContent = message + " 履歴 " + history.state().size + "件。";
  }
  for (const select of [first, last]) listen(select, "change", () => { details.textContent = ""; });
  listen(json, "input", () => { filesPanel?.invalidate(); cancelReview(); status.textContent = "JSONが変わりました。再度プレビューしてください。"; });
  listen(replace, "change", () => { filesPanel?.invalidate(); cancelReview(); });
  section.append(heading, note, addCurrent, addReport, status, list,
    label("前の記録", first), label("後の記録・削除対象", last), compare, remove, timeline,
    details, exportButton, label("保存・読み込み用の履歴JSON", json),
    label("既存履歴を置き換える（未選択なら追加）", replace), previewButton, previewText, apply,
    label("このカードの全履歴を消去することを確認", clearConfirm), clear);
  filesPanel = mountHistoryFiles({ document, parent: section, agent,
    getArchive: () => history.exportText(), getRevision: () => history.state().revision,
    onReadStart: cancelReview,
    onImportText: text => { cancelReview(); json.value = text; },
  });
  reviewPanel = mountHistoryReview({ document, parent: section, agent,
    getArchive: () => history.exportText(), getRevision: () => history.state().revision,
    getIncoming: () => json.value, getReplace: () => replace.checked,
  });
  recoveryPanel = mountHistoryRecovery({ document, parent: section, agent, recovery,
    onRestore: () => changed("履歴を復元しました。"),
    onCopyArchive: text => { filesPanel.invalidate(); cancelReview(); replace.checked = false; json.value = text; },
  });
  parent.append(section);
  render();
  return Object.freeze({
    exportArchive() {
      if (disposed) throw Error("History panel disposed");
      return history.exportText();
    },
    replaceArchive(text) {
      if (disposed) throw Error("History panel disposed");
      // Validate every observation and its agent before altering the real store.
      const candidate = createPortfolioHistory();
      candidate.importText(text);
      for (const snapshot of candidate.state().snapshots) checkAgent(snapshot);
      history.importText(candidate.exportText(), { replace: true });
      changed("一括復元から履歴を反映しました。");
    },
    invalidate() { if (!disposed) { cancelReview(); filesPanel.invalidate(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      filesPanel.dispose();
      reviewPanel.dispose();
      recoveryPanel.dispose();
      recovery.dispose();
      cancelReview();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}







