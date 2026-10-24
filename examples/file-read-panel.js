import { walletFileReadService } from "../src/file-read-service.js";
import { describeFileReadStatus } from "../src/file-read-status.js";
import { consumeCleanup } from "../src/file-read-policy.js";

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
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const view = describeFileReadStatus(value);
    section.setAttribute("data-level", view.level);
    headline.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
  }
  function cancel() {
    if (disposed) return;
    try {
      const count = service.cancelAll();
      action.textContent = Number.isSafeInteger(count) && count >= 0 && count <= 4 ?
        `読み込み ${count}件の待機を停止しました。保存済みの内容は変更していません。` :
        "停止した件数を確認できませんでした。";
    } catch { action.textContent = "読み込みの停止を確認できませんでした。"; }
  }
  stop.addEventListener("click", cancel);
  try {
    render(service.state());
    unsubscribe = service.subscribe(render);
    if (typeof unsubscribe !== "function") { unsubscribe = () => {}; render(null); }
  } catch { render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    consumeCleanup(() => unsubscribe());
    stop.removeEventListener("click", cancel);
    section.remove();
  } });
}
