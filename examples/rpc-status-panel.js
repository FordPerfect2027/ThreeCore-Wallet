import { walletRpcSupervisor } from "../src/rpc-supervisor.js";
import { describeRpcStatus, validateRpcStatus } from "../src/rpc-status.js";
import { consumeCallback, observeCallbackResult } from "../src/security-callback.js";

/** Observes aggregate counts only. Has no provider, request or retry capability. */
export function mountRpcStatusPanel({ document, parent, supervisor = walletRpcSupervisor, onFault = () => {} }) {
  const section = document.createElement("section");
  section.className = "rpc-status-panel";
  function node(tag, name, text) {
    const element = document.createElement(tag);
    element.className = "rpc-status-" + name;
    if (text) element.textContent = text;
    section.append(element);
    return element;
  }
  node("h3", "title", "Walletの応答保護");
  const headline = node("p", "headline");
  headline.setAttribute("role", "status");
  headline.setAttribute("aria-live", "polite");
  const detail = node("p", "detail");
  const counts = node("pre", "counts");
  node("p", "scope", "このページ内の集計です。他のタブ・ブラウザーは含みません。アドレス・残高・要求内容は記録しません。件数は安全性の認証ではありません。");
  parent.append(section);
  let disposed = false;
  let observing = true, generation = 0;
  let faultReported = false;
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const id = ++generation;
    const captured = validateRpcStatus(value);
    if (disposed || id !== generation) return;
    const view = describeRpcStatus(captured);
    section.setAttribute("data-level", view.level);
    headline.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
    if (!faultReported && captured?.fault === "RPC_CLOCK") {
      faultReported = true;
      // The production owner uses its existing stop-and-clear path. The fixed
      // reason carries no provider data and does not grant any new capability.
      consumeCallback(() => onFault("clock"));
    }
  }
  try {
    const initial = supervisor.state();
    const initialKind = observeCallbackResult(initial);
    render(initialKind === "synchronous" ? initial : null);
    const receipt = supervisor.subscribe(value => { if (observing) render(value); });
    const kind = observeCallbackResult(receipt, late => { if (typeof late === "function") consumeCallback(late); });
    if (kind !== "synchronous" || typeof receipt !== "function") { observing = false; render(null); }
    else if (disposed) consumeCallback(receipt);
    else unsubscribe = receipt;
  } catch { observing = false; render(null); }
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      observing = false; generation++;
      consumeCallback(unsubscribe);
      section.remove();
    },
  });
}
