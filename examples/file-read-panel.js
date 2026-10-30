import { walletFileReadService } from "../src/file-read-service.js";
import { describeFileReadStatus } from "../src/file-read-status.js";
import { consumeCleanup } from "../src/file-read-policy.js";
import { observeCallbackResult } from "../src/security-callback.js";

/** Aggregate observation and explicit cancellation; cannot import or save data. */
export function mountFileReadPanel({ document, parent, service = walletFileReadService }) {
  const section = document.createElement("section");
  section.className = "file-read-panel";
  function node(tag, name, text) {
    const element = document.createElement(tag);
    element.className = "file-read-" + name;
    if (text) element.textContent = text;
    section.append(element);
    return element;
  }
  node("h3", "title", "ファイル読み込みの保護");
  const headline = node("p", "headline");
  headline.setAttribute("role", "status");
  headline.setAttribute("aria-live", "polite");
  const detail = node("p", "detail");
  const counts = node("pre", "counts");
  const stop = node("button", "stop", "進行中のファイル読み込みを止める");
  stop.type = "button";
  node("p", "scope", "このページ内の集計です。ファイル名・内容・パスは表示や記録に含めません。入力サイズはブラウザー全体のメモリ使用量ではありません。");
  const action = node("p", "action");
  action.setAttribute("role", "status");
  parent.append(section);
  let disposed = false;
  let observing = true, renderGeneration = 0, actionGeneration = 0;
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const id = ++renderGeneration;
    const view = describeFileReadStatus(value);
    if (disposed || id !== renderGeneration) return;
    section.setAttribute("data-level", view.level);
    headline.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
  }
  function cancel() {
    if (disposed) return;
    const id = ++actionGeneration;
    try {
      const count = service.cancelAll();
      const kind = observeCallbackResult(count);
      if (disposed || id !== actionGeneration) return;
      action.textContent = kind === "synchronous" && Number.isSafeInteger(count) && count >= 0 && count <= 4 ?
        `読み込み ${count}件の待機を停止しました。保存済みの内容は変更していません。` :
        "停止した件数を確認できませんでした。";
    } catch { if (!disposed && id === actionGeneration) action.textContent = "読み込みの停止を確認できませんでした。"; }
  }
  stop.addEventListener("click", cancel);
  try {
    const initial = service.state();
    const initialKind = observeCallbackResult(initial);
    render(initialKind === "synchronous" ? initial : null);
    const receipt = service.subscribe(value => { if (observing) render(value); });
    const kind = observeCallbackResult(receipt, late => { if (typeof late === "function") consumeCleanup(late); });
    if (kind !== "synchronous" || typeof receipt !== "function") { observing = false; render(null); }
    else if (disposed) consumeCleanup(receipt);
    else unsubscribe = receipt;
  } catch { observing = false; render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    observing = false; renderGeneration++; actionGeneration++;
    consumeCleanup(() => unsubscribe());
    stop.removeEventListener("click", cancel);
    section.remove();
  } });
}

/** Picker dismissal is a notice, not cancellation of an already running read. */
export function createFileSelectionNotice(input, note) {
  let disposed = false;
  function noSelection() {
    if (!disposed) note.textContent = "新しいファイルは選ばれていません。進行中の読み込みや現在の確認内容は変更していません。";
  }
  function clear() { if (!disposed) note.textContent = ""; }
  input.addEventListener("cancel", noSelection);
  return Object.freeze({
    noSelection, clear,
    dispose() {
      if (disposed) return;
      clear(); disposed = true;
      input.removeEventListener("cancel", noSelection);
    },
  });
}
