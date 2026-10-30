import { describeExportStatus, inspectExportStatus } from "../src/export-status.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";

/** Aggregate information only: no names, URLs, addresses or exported contents. */
export function mountExportGuardPanel({ document, parent, guard }) {
  const host = document.createElement("section");
  host.className = "export-guard-panel";
  host.setAttribute("aria-label", "保存ファイルの保護");
  let disposed = false, last = null;
  let observing = true, renderGeneration = 0, actionGeneration = 0;
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
    const id = ++renderGeneration;
    const captured = inspectExportStatus(value);
    if (disposed || id !== renderGeneration) return;
    const message = describeExportStatus(captured);
    last = captured;
    outcome.textContent = "";
    host.dataset.phase = message.kind;
    title.textContent = message.title; detail.textContent = message.detail; counts.textContent = message.counts;
    clear.disabled = !last || !last.active;
    retry.disabled = !last || !last.pendingCleanup;
  }
  function action(method) {
    if (disposed || !last) return;
    const id = ++actionGeneration;
    try {
      const result = guard[method]();
      const kind = observeCallbackResult(result);
      if (disposed || id !== actionGeneration) return;
      outcome.textContent = kind === "synchronous" && result === true ? "一時URLの解放を確認しました。保存済みファイルは変更していません。" :
        "まだ解放を確認できない処理があります。保存完了はブラウザー側でも確認してください。";
    } catch { if (!disposed && id === actionGeneration) outcome.textContent = "解放状態を確認できませんでした。保存済みファイルは変更していません。"; }
  }
  const onClear = () => action("clear"), onRetry = () => action("retryCleanup");
  clear.addEventListener("click", onClear); retry.addEventListener("click", onRetry);
  parent.append(host);
  let unsubscribe;
  render(null);
  try {
    const receipt = guard.subscribe(value => { if (observing) render(value); });
    const kind = observeCallbackResult(receipt, late => { if (typeof late === "function") consumeCallback(late); });
    if (kind !== "synchronous" || typeof receipt !== "function") { observing = false; render(null); }
    else if (disposed) consumeCallback(receipt);
    else unsubscribe = receipt;
  } catch { observing = false; render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    observing = false; renderGeneration++; actionGeneration++;
    clear.removeEventListener("click", onClear); retry.removeEventListener("click", onRetry);
    consumeCallback(() => unsubscribe?.());
    host.remove(); last = null;
  } });
}
