import { walletStorageGuard } from "../src/storage-guard.js";
import { describeStorageStatus } from "../src/storage-guard-status.js";
import { observeStorageCleanup } from "../src/storage-guard-policy.js";

export function mountStorageGuardPanel({ document, parent, guard = walletStorageGuard }) {
  const section = document.createElement("section");
  section.className = "storage-guard-panel";
  section.setAttribute("aria-label", "PC内保存の保護");
  function node(tag, name, text) {
    const item = document.createElement(tag);
    item.className = "storage-guard-" + name;
    if (text) item.textContent = text;
    section.append(item);
    return item;
  }
  node("h3", "title", "PC内保存の保護");
  const heading = node("p", "heading");
  heading.setAttribute("role", "status");
  heading.setAttribute("aria-live", "polite");
  const detail = node("p", "detail");
  const counts = node("pre", "counts");
  const stop = node("button", "stop", "進行中の保存処理に停止を依頼");
  stop.type = "button";
  const action = node("p", "action");
  action.setAttribute("role", "status");
  node("p", "scope", "このページ内の件数だけを表示します。アドレス・ファイル名・保存内容は集計に含めません。取り消しは確定済みの保存を元に戻しません。");
  parent.append(section);
  let disposed = false;
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const view = describeStorageStatus(value);
    section.setAttribute("data-level", view.level);
    heading.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
    stop.disabled = !view.canStop;
  }
  function cancel() {
    if (disposed) return;
    try {
      const count = guard.cancelAll();
      action.textContent = Number.isSafeInteger(count) && count >= 0 && count <= 4
        ? `${count}件に停止を依頼しました。保存結果は対象の一覧を再読み込みして確認できます。`
        : "停止した件数を確認できませんでした。";
      render(guard.state());
    } catch { action.textContent = "停止の結果を確認できませんでした。"; render(null); }
  }
  stop.addEventListener("click", cancel);
  try {
    render(guard.state());
    unsubscribe = guard.subscribe(render);
    if (typeof unsubscribe !== "function") { unsubscribe = () => {}; render(null); }
  } catch { render(null); }
  return Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    observeStorageCleanup(unsubscribe);
    stop.removeEventListener("click", cancel);
    section.remove();
  } });
}
