import { createTabGuard } from "../src/tab-guard-controller.js";
import { createBrowserTabTransport } from "../src/tab-guard-transport.js";

const messages = Object.freeze({
  TAB_UNAVAILABLE: "この環境では他の画面へ通知できません。この画面の停止は利用できます。",
  TAB_TRANSPORT: "停止通知の通信を確認できません。各画面でも停止状態を確認してください。",
  TAB_FLOOD: "通知が多すぎるため、この画面を保護停止して通知の受信を終了しました。",
  TAB_CLOCK: "通知の時刻を確認できません。この画面を開き直してください。",
  TAB_ENTROPY: "通知用の識別子を安全に作れません。各画面で停止してください。",
  TAB_CLEANUP: "停止処理の完了を確認できません。各画面を閉じて状態を確認してください。",
  TAB_CONFIG: "停止通知を利用できません。この画面を開き直してください。",
  TAB_CLOSED: "停止通知の受信を終了しています。各画面で停止してください。",
  TAB_FORMAT: "通知の形式を確認できません。各画面で停止してください。",
});
export function mountTabGuardPanel({ document, parent, onStop, options = {} }) {
  const section = document.createElement("section");
  section.className = "tab-guard-panel";
  section.setAttribute("aria-label", "同じアドレスの画面へ停止を通知");
  const node = (tag, name, text) => {
    const element = document.createElement(tag);
    element.className = "tab-guard-" + name;
    element.textContent = text;
    section.append(element);
    return element;
  };
  node("h3", "heading", "同じアドレスの画面も停止する");
  node("p", "scope", "このブラウザーで開いている、同じアドレスの対応画面へ停止だけを通知します。別のブラウザー・別のポート番号・以前の版には届きません。");
  const button = node("button", "stop", "この画面を停止し、同じアドレスの画面にも通知");
  button.type = "button";
  const status = node("p", "status", "停止通知を準備しています。");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const receipt = node("p", "receipts", "停止通知はまだ送っていません。");
  node("p", "limits", "応答数は全画面の停止を保証しません。停止の通知に公開アドレス・残高・合言葉は含めません。通知からの自動再開は行わず、再開は各画面で操作します。Wallet拡張機能自体のロックや権限の取り消しは行いません。");
  let disposed = false;
  function render(state) {
    if (disposed) return;
    button.disabled = state.disposed || state.pending;
    section.setAttribute("data-phase", state.phase);
    status.textContent = state.errorCode ? messages[state.errorCode] ?? messages.TAB_CONFIG
      : state.phase === "waiting" ? "この画面を停止し、通知への応答を待っています。"
      : state.phase === "complete" ? "停止通知の応答待ちを終了しました。必要な画面の状態を個別に確認してください。"
      : state.phase === "received" ? "同じアドレスの画面から停止通知を受け、この画面を保護停止しました。"
      : state.phase === "disposed" ? "停止通知の受信を終了しました。"
      : "停止通知を受け付けています。再開の指示は受け付けません。";
    receipt.textContent = state.sent ? `今回の通知への応答: ${state.receiptCount} 件（最大${state.maxReceipts}件を表示）。未応答の画面があるかは判定できません。`
      : "停止通知はまだ送っていません。";
  }
  const transport = options.transport ?? createBrowserTabTransport({ host: document.defaultView });
  const controller = createTabGuard({ ...options, transport, onStop, onChange: render });
  const stop = () => { if (!disposed) controller.stop(); };
  button.addEventListener("click", stop);
  parent.append(section);
  controller.start();
  render(controller.state());
  return Object.freeze({ state: controller.state, noteResume: controller.noteResume,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.dispose();
      button.removeEventListener("click", stop);
      section.remove();
    } });
}
