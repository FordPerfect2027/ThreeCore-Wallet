import { walletRpcSupervisor } from "../src/rpc-supervisor.js";
import { describeRpcStatus, validateRpcStatus } from "../src/rpc-status.js";

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
  let faultReported = false;
  let unsubscribe = () => {};
  function render(value) {
    if (disposed) return;
    const view = describeRpcStatus(value);
    section.setAttribute("data-level", view.level);
    headline.textContent = view.heading;
    detail.textContent = view.detail;
    counts.textContent = view.counts;
    if (!faultReported && validateRpcStatus(value)?.fault === "RPC_CLOCK") {
      faultReported = true;
      // The production owner uses its existing stop-and-clear path. The fixed
      // reason carries no provider data and does not grant any new capability.
      try { Promise.resolve(onFault("clock")).catch(() => {}); } catch {}
    }
  }
  try {
    render(supervisor.state());
    unsubscribe = supervisor.subscribe(render);
    if (typeof unsubscribe !== "function") { unsubscribe = () => {}; render(null); }
  } catch { render(null); }
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      try { unsubscribe(); } catch {}
      section.remove();
    },
  });
}
