import { createHistoryRecovery } from "../src/history-recovery.js";
import { mountHistoryRecovery } from "./history-recovery-panel.js";
import { mountHistoryReview } from "./history-review-panel.js";
import { mountHistoryFiles, offerHistoryDownload } from "./history-files.js";
import { createPortfolioHistory, HISTORY_TEXT_LIMIT } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { describePortfolioHistory } from "../src/portfolio-history-summary.js";
import { decodePortfolioReport, validatePortfolioSnapshot, encodePortfolioReport, describePortfolioObservation } from "../src/portfolio-report.js";
import { describePortfolioComparison, encodePortfolioComparisonReport } from "../src/portfolio-comparison.js";
import { readOwnErrorCode } from "../src/provider-error.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { createTokenPlan } from "../src/token-plan.js";
import { assessHistoryMerge, describeHistoryMergeAssessment } from "../src/history-review.js";

/** Local, card-scoped history. No automatic persistence or provider access. */
export function mountHistoryPanel({ document, parent, agent, getSnapshot, getReport, download = offerHistoryDownload, onReuseTokens = null }) {
  const history = createPortfolioHistory();
  const recovery = createHistoryRecovery(history);
  const importer = createHistoryImportController({
    state: history.state,
    importText: (text, options) => options.replace
      ? recovery.replace(text, history.state().revision) : history.importText(text, options),
  });
  const cleanup = [];
  let disposed = false;
  let generation = 0;
  const current = id => !disposed && generation === id;
  let review = null;
  let filesPanel;
  let reviewPanel;
  let recoveryPanel;
  let renderedRevision = 0;
  let completedComparison = null;
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
      const id = ++generation;
      try { action(id); }
      catch (error) {
        if (!current(id)) return;
        const code = readOwnErrorCode(error);
        if (!current(id)) return;
        cancelReview();
        if (!current(id)) return;
        status.textContent = code === "OBSERVATION_CONFLICT"
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
    snapshot = validatePortfolioSnapshot(snapshot);
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
  details.setAttribute("tabindex", "-1"); details.setAttribute("aria-label", "保存履歴の詳細・比較");
  const json = element("textarea", "history-json");
  json.rows = 5;
  json.maxLength = HISTORY_TEXT_LIMIT;
  json.spellcheck = false;
  json.setAttribute("aria-label", "履歴JSON");
  const replace = element("input", "history-replace");
  replace.type = "checkbox";
  const previewText = element("pre", "history-preview-details");
  const addCurrent = button("history-add-current", "今回の確認結果を履歴に追加", id => {
    const snapshot = getSnapshot();
    if (observeCallbackResult(snapshot) !== "synchronous") throw Error("Synchronous observation required");
    if (!current(id)) return;
    if (!snapshot) throw Error("No complete current observation");
    const captured = checkAgent(snapshot);
    if (!current(id)) return;
    const result = history.add(captured);
    changed(result.duplicates ? "同じ記録は追加しませんでした。" : "確認結果を履歴に追加しました。");
  });
  const addReport = button("history-add-report", "上の確認記録JSONを履歴に追加", id => {
    const text = getReport();
    if (observeCallbackResult(text) !== "synchronous") throw Error("Synchronous report required");
    if (!current(id)) return;
    const snapshot = checkAgent(decodePortfolioReport(text).snapshot);
    if (!current(id)) return;
    const result = history.add(snapshot);
    changed(result.duplicates ? "同じ記録は追加しませんでした。" : "過去の確認記録を履歴に追加しました。");
  });
  const exportButton = button("history-export", "履歴全体をJSONにする", () => {
    cancelReview();
    json.value = history.exportText();
    status.textContent = "履歴JSONを作成しました。公開アドレスと残高が含まれます。コピーして保存してください。";
  });
  const previewButton = button("history-preview", "履歴JSONの読み込みをプレビュー", id => {
    cancelReview();
    const candidate = createPortfolioHistory();
    candidate.importText(json.value);
    candidate.state().snapshots.forEach(checkAgent);
    if (!replace.checked) {
      const original = history.exportText(), incoming = candidate.exportText(), diagnosis = assessHistoryMerge(original, incoming);
      if (!current(id)) return;
      if (!diagnosis.admissible) {
        previewText.textContent = describeHistoryMergeAssessment(original, incoming);
        status.textContent = "追加を保留しました。空き容量と矛盾の診断を確認してください。入力欄と履歴は保持しています。";
        return;
      }
    }
    review = importer.preview(json.value, { replace: replace.checked });
    previewText.textContent = (review.mode === "replace" ? "置き換え" : "追加") +
      " / 現在 " + review.previousSize + "件 → " + review.resultingSize +
      "件 / 新規 " + review.added + "件 / 重複 " + review.duplicates + "件";
    apply.disabled = false;
    status.textContent = "まだ履歴は変更していません。内容を確認して適用してください。";
  });
  const apply = button("history-apply", "確認した履歴を適用", () => {
    if (!review) throw Error("Preview required");
    importer.apply(review.previewId, json.value, { replace: replace.checked });
    changed("確認した履歴を適用しました。");
  });
  apply.disabled = true;
  function clearComparison() { completedComparison = null; details.textContent = ""; saveComparison.disabled = true; }
  function selectedAfter() {
    const state = history.state(), value = last.value;
    if (state.revision !== renderedRevision || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error("Stale record selection");
    const index = Number(value); if (!Number.isSafeInteger(index) || index >= state.size) throw Error("Invalid record selection");
    return { state, value, index, snapshot: state.snapshots[index] };
  }
  function compareSelected() {
    clearComparison();
    if (![first.value, last.value].every(value => /^(0|[1-9][0-9]*)$/.test(value))) throw Error("Invalid record selection");
    const before = Number(first.value), after = Number(last.value);
    history.compare(before, after, renderedRevision);
    const state = history.state();
    details.textContent = describePortfolioComparison(state.snapshots[before], state.snapshots[after]);
    completedComparison = { revision: state.revision, before: first.value, after: last.value, earlier: state.snapshots[before], later: state.snapshots[after] };
    saveComparison.disabled = false;
    status.textContent = "過去の2記録を比較しています。送金履歴や利益ではありません。";
  }
  const compare = button("history-compare", "選択した2件を比較", compareSelected);
  const previous = button("history-compare-previous", "同じ対象の一つ前の記録と比較", () => {
    clearComparison(); const selected = selectedAfter();
    const group = history.groups().find(value => value.indices.includes(selected.index)), position = group?.indices.indexOf(selected.index);
    if (!(position > 0)) { status.textContent = "同じアカウント・チェーン・サイトの、さらに前の記録はありません。"; return; }
    first.value = String(group.indices[position - 1]); compareSelected();
    status.textContent = "同じアカウント・チェーン・サイトの直前の保存記録と比較しました。間のブロックをすべて確認したという意味ではありません。";
  });
  const showRecord = button("history-show-record", "選択した後の記録の詳細を表示", id => {
    clearComparison(); const { snapshot } = selectedAfter();
    details.textContent = "過去の保存記録（現在の状態ではありません）\n" + describePortfolioObservation(snapshot);
    status.textContent = "選択した1記録を表示しています。現在の確認結果・履歴・接続は変更していません。";
    if (current(id)) { try { details.focus?.(); } catch {} }
  });
  const saveComparison = button("history-save-comparison", "この2件の比較を資料付きで保存", id => {
    const selected = completedComparison;
    const matches = () => current(id) && selected && completedComparison === selected && history.state().revision === selected.revision && first.value === selected.before && last.value === selected.after;
    if (!matches()) { clearComparison(); throw Error("Review comparison first"); }
    const prepared = { text: encodePortfolioComparisonReport(selected.earlier, selected.later), filename: `ThreeCore-${agent}-portfolio-comparison-${selected.earlier.blockNumber}-${selected.later.blockNumber}.json`, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: true, restorable: false };
    if (!matches()) return;
    const result = download({ document, prepared }), kind = observeCallbackResult(result);
    if (!matches()) return;
    if (kind !== "synchronous" || result === false) throw Error("Download unconfirmed");
    status.textContent = "比較と元の2記録の保存を開始しました。残高比較欄で再計算できます。全履歴のバックアップではありません。";
  });
  saveComparison.disabled = true;
  const filterIdentity = button("history-filter-identity", "選択した記録と同じ対象の履歴を検索", id => {
    const selected = selectedAfter(), result = filesPanel.filterIdentity(selected.snapshot);
    if (!current(id) || history.state().revision !== selected.state.revision || last.value !== selected.value) return;
    if (result !== true) throw Error("Identity search unconfirmed");
    status.textContent = "同じアカウント・チェーン・サイトの記録を検索欄に表示しました。履歴は変更していません。";
  });
  const remove = button("history-remove", "選択した後の記録を削除", () => {
    recovery.remove(Number(last.value), renderedRevision);
    changed("選択した記録を履歴から削除しました。");
  });
  const saveRecord = button("history-save-record", "選択した後の記録を単独で保存", id => {
    const { state, value, snapshot: selected } = selectedAfter();
    const snapshot = checkAgent(selected); if (!current(id)) return;
    const prepared = { text: encodePortfolioReport(snapshot), filename: `ThreeCore-${agent}-portfolio-${snapshot.blockNumber}.json`, mimeType: "application/json;charset=utf-8", containsOriginalEvidence: true, restorable: false };
    if (history.state().revision !== state.revision || last.value !== value) return;
    const result = download({ document, prepared }), kind = observeCallbackResult(result);
    if (!current(id) || history.state().revision !== state.revision || last.value !== value) return;
    if (kind !== "synchronous" || result === false) throw Error("Download unconfirmed");
    status.textContent = "選択した過去の1記録の保存を開始しました。全履歴のバックアップではありません。ダウンロード先をご確認ください。";
  });
  const clearConfirm = element("input", "history-clear-confirm");
  const reuseTokens = button("history-reuse-tokens", "この記録の契約一覧を再利用する準備", id => {
    const selected = selectedAfter();
    if (typeof onReuseTokens !== "function") throw Error("Token list handoff unavailable");
    const plan = createTokenPlan({ agent: selected.snapshot.agent, chainId: selected.snapshot.chainId }, selected.snapshot.holdings.map(row => row.address).join("\n"));
    if (!current(id)) return;
    const receipt = onReuseTokens(plan), kind = observeCallbackResult(receipt);
    if (!current(id) || history.state().revision !== selected.state.revision || last.value !== selected.value) return;
    if (kind !== "synchronous" || receipt !== true) { status.textContent = "契約一覧の準備を確認できませんでした。入力リスト欄のエージェント・チェーンを確認してください。"; return; }
    status.textContent = "契約一覧を入力リストの確認欄へ準備しました。内容確認・反映が必要です。アカウント・残高は移していません。";
  });
  reuseTokens.hidden = typeof onReuseTokens !== "function";
  clearConfirm.type = "checkbox";
  const clear = button("history-clear", "このカードの履歴を全消去", () => {
    if (!clearConfirm.checked) throw Error("Confirm clearing");
    recovery.clear(renderedRevision);
    clearConfirm.checked = false;
    changed("このカードの履歴を消去しました。");
  });
  const timeline = button("history-timeline", "履歴の時系列一覧を表示", () => {
    clearComparison();
    details.textContent = describePortfolioHistory(history.exportText());
  });
  function render() {
    const state = history.state();
    renderedRevision = state.revision;
    list.replaceChildren();
    first.replaceChildren();
    last.replaceChildren();
    state.snapshots.forEach((snapshot, index) => {
      const text = snapshot.agent + " / " + snapshot.account + " / chain " + snapshot.chainId + " / " + snapshot.siteOrigin + " / block " + snapshot.blockNumber;
      list.append(element("li", "", text));
      for (const select of [first, last]) {
        const option = element("option", "", text);
        option.value = String(index);
        select.append(option);
      }
    });
    if (state.size) last.value = String(state.size - 1);
    first.disabled = last.disabled = compare.disabled = remove.disabled = saveRecord.disabled = showRecord.disabled = filterIdentity.disabled = !state.size;
    previous.disabled = state.size < 2;
    reuseTokens.disabled = !state.size || typeof onReuseTokens !== "function";
    clear.disabled = !state.size;
    recoveryPanel?.refresh();
  }
  function changed(message) {
    filesPanel?.invalidate();
    clearConfirm.checked = false;
    cancelReview();
    clearComparison();
    render();
    status.textContent = message + " 履歴 " + history.state().size + "件。";
  }
  for (const select of [first, last]) listen(select, "change", () => { generation++; clearComparison(); });
  listen(json, "input", () => { filesPanel?.invalidate(); cancelReview(); status.textContent = "JSONが変わりました。再度プレビューしてください。"; });
  listen(replace, "change", () => { filesPanel?.invalidate(); cancelReview(); });
  section.append(heading, note, addCurrent, addReport, status, list,
    label("前の記録", first), label("後の記録・削除対象", last), showRecord, filterIdentity, compare, previous, saveComparison, remove, saveRecord, reuseTokens, timeline,
    details, exportButton, label("保存・読み込み用の履歴JSON", json),
    label("既存履歴を置き換える（未選択なら追加）", replace), previewButton, previewText, apply,
    label("このカードの全履歴を消去することを確認", clearConfirm), clear);
  filesPanel = mountHistoryFiles({ document, parent: section, agent, download,
    getArchive: () => history.exportText(), getRevision: () => history.state().revision,
    onReadStart: cancelReview,
    onImportText: text => { cancelReview(); json.value = text; },
    onSelectRecord: selected => {
      if (disposed) return false; const state = history.state();
      if (!Number.isSafeInteger(selected.index) || selected.index < 0 || selected.index >= state.size || !["before", "after"].includes(selected.side) ||
        selected.revision !== state.revision || renderedRevision !== state.revision || selected.archive !== history.exportText()) return false;
      const id = ++generation, target = selected.side === "before" ? first : last; target.value = String(selected.index); clearComparison(); clearConfirm.checked = false;
      try { target.focus?.(); } catch {}
      return current(id) && history.state().revision === state.revision && target.value === String(selected.index);
    },
  });
  reviewPanel = mountHistoryReview({ document, parent: section, agent, download,
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
    invalidate() { if (!disposed) { generation++; clearComparison(); cancelReview(); filesPanel.invalidate(); } },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearComparison();
      filesPanel.dispose();
      reviewPanel.dispose();
      recoveryPanel.dispose();
      recovery.dispose();
      importer.dispose();
      cancelReview();
      for (const stop of cleanup) stop();
      section.remove();
    },
  });
}







