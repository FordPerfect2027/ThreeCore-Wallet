import { prepareHistoryDownload } from "../src/history-file.js";
import { offerHistoryDownload } from "./history-files.js";

/** Card-local single-step recovery, with separate review and explicit apply. */
export function mountHistoryRecovery({ document, parent, agent, recovery, onRestore,
  onCopyArchive, download = offerHistoryDownload }) {
  let disposed = false;
  let previewId = null;
  let renderedRecoveryId = null;
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
      try { run(); }
      catch {
        invalidate();
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
  const preview = button("history-recovery-preview", "戻す内容を確認", () => {
    const result = recovery.preview();
    previewId = result.previewId;
    const impact = result.impact;
    details.textContent = "現在 " + impact.previousCount + "件 → 復元後 " + impact.resultingCount + "件\n" +
      "戻る記録 " + impact.added.length + "件 / 置換される記録 " + impact.changed.length + "件\n" +
      "まだ復元していません。確認後に「確認した履歴へ戻す」を押してください。";
    apply.disabled = false;
    status.textContent = "復元前の確認です。履歴は変更していません。";
  });
  const report = button("history-recovery-report", "操作前の履歴を詳しく確認", () => {
    if (recovery.state().recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    invalidate();
    details.textContent = recovery.report().text;
    status.textContent = "復元用控えの内容です。まだ履歴を変更していません。";
  });
  const apply = button("history-recovery-apply", "確認した履歴へ戻す", () => {
    recovery.apply(previewId);
    previewId = null;
    onRestore();
    refresh();
    status.textContent = "直前の操作前の履歴へ戻しました。接続・署名・送金は行っていません。";
  });
  apply.disabled = true;
  const save = button("history-recovery-save", "操作前の履歴をファイル保存", () => {
    const state = recovery.state();
    if (state.recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    const prepared = prepareHistoryDownload(recovery.exportText(), agent, state.currentRevision);
    download({ document, prepared: Object.freeze({ ...prepared,
      filename: prepared.filename.replace(".json", "-before-change.json") }) });
    status.textContent = "操作前の履歴のダウンロードを開始しました。現在の履歴は変更していません。";
  });
  const copy = button("history-recovery-copy", "操作前のJSONを読み込み欄へ出す", () => {
    const state = recovery.state();
    if (state.recoveryId !== renderedRecoveryId) throw Error("Recovery changed");
    onCopyArchive(recovery.exportText());
    invalidate();
    status.textContent = "操作前のJSONを入力欄へ出しました。追加・置き換えの内容を別途確認してから適用してください。";
  });
  const confirm = node("input", "history-recovery-discard-confirm");
  confirm.type = "checkbox";
  const confirmLabel = node("label", "", "この復元用控えだけを破棄することを確認");
  confirmLabel.append(confirm);
  const discard = button("history-recovery-discard", "復元用の控えを破棄", () => {
    if (!confirm.checked) throw Error("Confirm discard");
    recovery.discard(renderedRecoveryId);
    refresh();
    status.textContent = "復元用の控えだけを破棄しました。現在の履歴は保持しています。";
  });
  function invalidate() {
    previewId = null;
    recovery.cancelPreview();
    details.textContent = "";
    apply.disabled = true;
    confirm.checked = false;
  }
  function refresh() {
    if (disposed) return;
    invalidate();
    const state = recovery.state();
    renderedRecoveryId = state.recoveryId;
    preview.disabled = !state.canPreview;
    save.disabled = copy.disabled = discard.disabled = report.disabled = !state.hasBackup;
    status.textContent = !state.hasBackup ? "戻せる操作はまだありません。" : state.canPreview
      ? "操作前の履歴 " + state.previousCount + "件を保持しています。戻す前に確認してください。"
      : "操作後に履歴が変わっています。直接戻さず、控えのJSONを保存・確認できます。";
  }
  section.append(heading, note, status, preview, report, details, apply, save, copy, confirmLabel, discard);
  parent.append(section);
  refresh();
  return Object.freeze({
    refresh,
    invalidate() { if (!disposed) invalidate(); },
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      for (const stop of stops) stop();
      section.remove();
    },
  });
}
