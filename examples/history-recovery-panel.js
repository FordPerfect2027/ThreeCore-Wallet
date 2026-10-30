import { prepareHistoryDownload } from "../src/history-file.js";
import { offerHistoryDownload } from "./history-files.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";

/** Card-local single-step recovery, with separate review and explicit apply. */
export function mountHistoryRecovery({ document, parent, agent, recovery, onRestore,
  onCopyArchive, download = offerHistoryDownload }) {
  let disposed = false;
  let previewId = null;
  let renderedRecoveryId = null;
  let generation = 0, refreshing = false, cancellingPreview = false;
  const current = id => !disposed && generation === id;
  function model(read, id) {
    if (!current(id)) throw Error("Recovery retired");
    const value = read();
    const kind = observeCallbackResult(value);
    if (!current(id) || kind !== "synchronous") throw Error("Recovery adapter unavailable");
    return value;
  }
  function accepted(work, id) {
    const value = model(work, id);
    if (value === false) throw Error("Recovery handoff refused");
    return current(id);
  }
  const stops = [];
  const section = document.createElement("section");
  section.className = "history-recovery-panel";
  function node(tag, name, text) {
    const value = document.createElement(tag);
    value.className = name;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function button(name, text, run) {
    const value = node("button", name + " secondary", text);
    value.type = "button";
    const action = () => {
      if (disposed) return;
      const id = ++generation;
      try { return run(id); }
      catch {
        if (!current(id) || !invalidateView(id)) return;
        status.textContent = "復元操作は行えませんでした。新しい履歴は上書きしていません。必要なら復元用JSONを別途保存してください。";
      }
    };
    value.addEventListener("click", action);
    stops.push(() => value.removeEventListener("click", action));
    return value;
  }
  const heading = node("h4", "", "直前の削除・置き換えを戻す");
  const note = node("p", "notice", "直前1回分だけを、このページを開いている間保持します。ページを閉じる前に必要なJSONを保存してください。削除後に履歴が変わった場合、直接の復元では新しい記録を上書きしません。");
  const status = node("p", "history-recovery-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const details = node("pre", "history-recovery-details");
  const preview = button("history-recovery-preview", "戻す内容を確認", id => {
    const result = model(() => recovery.preview(), id);
    previewId = result.previewId;
    const impact = result.impact;
    details.textContent = "現在 " + impact.previousCount + "件 → 復元後 " + impact.resultingCount + "件\n" +
      "戻る記録 " + impact.added.length + "件 / 置換される記録 " + impact.changed.length + "件\n" +
      "まだ復元していません。確認後に「確認した履歴へ戻す」を押してください。";
    apply.disabled = false;
    status.textContent = "復元前の確認です。履歴は変更していません。";
  });
  const report = button("history-recovery-report", "操作前の履歴を詳しく確認", id => {
    if (model(() => recovery.state(), id).recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    if (!invalidateView(id)) return;
    details.textContent = model(() => recovery.report(), id).text;
    status.textContent = "復元用控えの内容です。まだ履歴を変更していません。";
  });
  const apply = button("history-recovery-apply", "確認した履歴へ戻す", id => {
    model(() => recovery.apply(previewId), id);
    previewId = null;
    consumeCallback(onRestore);
    if (!current(id)) return;
    try { if (!refreshOwned(id)) return; }
    catch {
      if (current(id)) status.textContent = "履歴の復元は完了しました。復元用の控えの表示を再確認してください。";
      return;
    }
    status.textContent = "直前の操作前の履歴へ戻しました。接続・署名・送金は行っていません。";
  });
  apply.disabled = true;
  const save = button("history-recovery-save", "操作前の履歴をファイル保存", id => {
    const state = model(() => recovery.state(), id);
    if (state.recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    const prepared = prepareHistoryDownload(model(() => recovery.exportText(), id), agent, state.currentRevision);
    if (!accepted(() => download({ document, prepared: Object.freeze({ ...prepared,
      filename: prepared.filename.replace(".json", "-before-change.json") }) }), id)) return;
    status.textContent = "操作前の履歴のダウンロードを開始しました。現在の履歴は変更していません。";
  });
  const copy = button("history-recovery-copy", "操作前のJSONを読み込み欄へ出す", id => {
    const state = model(() => recovery.state(), id);
    if (state.recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    const text = model(() => recovery.exportText(), id);
    if (!accepted(() => onCopyArchive(text), id) || !invalidateView(id)) return;
    status.textContent = "操作前のJSONを入力欄へ出しました。追加・置き換えの内容を別途確認してから適用してください。";
  });
  const confirm = node("input", "history-recovery-discard-confirm");
  confirm.type = "checkbox";
  const confirmLabel = node("label", "", "この復元用控えだけを破棄することを確認");
  confirmLabel.append(confirm);
  const discard = button("history-recovery-discard", "復元用の控えを破棄", id => {
    if (!confirm.checked) throw Error("Confirm discard");
    model(() => recovery.discard(renderedRecoveryId), id);
    try { if (!refreshOwned(id)) return; }
    catch {
      if (current(id)) status.textContent = "復元用の控えは破棄しました。履歴と控えの表示を再確認してください。";
      return;
    }
    status.textContent = "復元用の控えだけを破棄しました。現在の履歴は保持しています。";
  });
  function clearPreviewDisplay() {
    previewId = null;
    details.textContent = "";
    apply.disabled = true;
    confirm.checked = false;
  }
  function cancelPreview() {
    if (cancellingPreview) return;
    cancellingPreview = true;
    try { consumeCallback(() => recovery.cancelPreview()); }
    finally { cancellingPreview = false; }
  }
  function invalidateView(id) {
    if (!current(id)) return false;
    clearPreviewDisplay();
    cancelPreview();
    return current(id);
  }
  function refresh() {
    if (disposed || refreshing) return false;
    const id = ++generation;
    try { return refreshOwned(id); }
    catch {
      if (current(id)) status.textContent = "復元用の控えを確認できませんでした。履歴の表示を確認してください。";
      return false;
    }
  }
  function refreshOwned(id) {
    if (!current(id) || refreshing) return false;
    refreshing = true;
    try {
      if (!invalidateView(id)) return false;
      preview.disabled = save.disabled = copy.disabled = discard.disabled = report.disabled = true;
      const state = model(() => recovery.state(), id);
      renderedRecoveryId = state.recoveryId;
      preview.disabled = !state.canPreview;
      save.disabled = copy.disabled = discard.disabled = report.disabled = !state.hasBackup;
      status.textContent = !state.hasBackup ? "戻せる操作はまだありません。" : state.canPreview
        ? "操作前の履歴 " + state.previousCount + "件を保持しています。戻す前に確認してください。"
        : "操作後に履歴が変わっています。直接戻さず、控えのJSONを保存・確認できます。";
      return current(id);
    } finally { refreshing = false; }
  }
  section.append(heading, note, status, preview, report, details, apply, save, copy, confirmLabel, discard);
  parent.append(section);
  refresh();
  return Object.freeze({
    refresh,
    invalidate() { if (!disposed) invalidateView(++generation); },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearPreviewDisplay();
      cancelPreview();
      for (const stop of stops) stop();
      section.remove();
    },
  });
}
