import { describeExportStatus, inspectExportStatus } from "../src/export-status.js";

/** Aggregate information only: no names, URLs, addresses or exported contents. */
export function mountExportGuardPanel({ document, parent, guard }) {
  const host = document.createElement("section");
  host.className = "export-guard-panel";
  host.setAttribute("aria-label", "保存ファイルの保護");
  let disposed = false, last = null;
  function node(tag, name, text) {
    const element = document.createElement(tag);
    element.className = "export-guard-" + name;
    if (text) element.textContent = text;
    host.append(element);
    return element;
  }
  node("h3", "heading", "保存ファイルの保護");
  const title = node("p", "title");
  title.setAttribute("role", "status");
  title.setAttribute("aria-live", "polite");
  const detail = node("p", "detail"), counts = node("pre", "counts");
  const clear = node("button", "clear", "保存用の一時URLを解放する");
  const retry = node("button", "retry", "一時URLの解放を再試行");
  clear.type = retry.type = "button";
  const outcome = node("p", "outcome");
  outcome.setAttribute("aria-live", "polite");
  node("p", "scope", "このページの件数だけを表示します。ファイル名・内容・公開アドレスは記録しません。一時URLを解放しても、PCに保存済みのファイルは削除されません。");
  node("p", "limit", "解放操作は進行中のダウンロードに影響する場合があります。ブラウザーの保存完了や、端末全体からのデータ消去を保証する表示ではありません。");
  function render(value) {
    if (disposed) return;
    last = inspectExportStatus(value);
    outcome.textContent = "";
    const message = describeExportStatus(value);
    host.dataset.phase = message.kind;
    title.textContent = message.title; detail.textContent = message.detail; counts.textContent = message.counts;
    clear.disabled = !last || !last.active;
    retry.disabled = !last || !last.pendingCleanup;
  }
  function action(method) {
    if (disposed || !last) return;
    try {
      const result = guard[method]();
      outcome.textContent = result === true ? "一時URLの解放を確認しました。保存済みファイルは変更していません。" :
        "まだ解放を確認できない処理があります。保存完了はブラウザー側でも確認してください。";
    } catch { outcome.textContent = "解放状態を確認できませんでした。保存済みファイルは変更していません。"; }
  }
  const onClear = () => action("clear"), onRetry = () => action("retryCleanup");
  clear.addEventListener("click", onClear); retry.addEventListener("click", onRetry);
  parent.append(host);
  let unsubscribe;
  try { unsubscribe = guard.subscribe(render); }
  catch { render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    clear.removeEventListener("click", onClear); retry.removeEventListener("click", onRetry);
    try { unsubscribe?.(); } catch {}
    host.remove(); last = null;
  } });
}
