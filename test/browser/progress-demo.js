import { mountWalletDemo } from "/examples/wallet-demo.js";

// This fixture accepts no real provider and performs no fetch/network call.
// A manually released response makes waiting/cancellation reproducible.
const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const HASH = "0x" + "ab".repeat(32);
const release = document.querySelector("#release");
const status = document.querySelector("#scenario-status");
let pending = null;
const provider = {
  on() {},
  removeListener() {},
  async request({ method }) {
    switch (method) {
      case "eth_chainId": return "0x2105";
      case "eth_requestAccounts":
      case "eth_accounts": return [ACCOUNT];
      case "eth_getBlockByNumber": return { number: "0x2a", hash: HASH };
      case "eth_getCode": return "0x6000";
      case "eth_call": return "0x" + "2a".padStart(64, "0");
      case "eth_getBalance":
        if (pending) throw Error("A synthetic response is already pending");
        release.disabled = false;
        status.textContent = "ETH残高の模擬応答を待っています。キャンセル・切断も試せます。";
        return new Promise(resolve => { pending = resolve; });
      default: throw Error("Unsupported synthetic request");
    }
  },
};
const app = mountWalletDemo({
  document, eventTarget: new EventTarget(), siteOrigin: location.origin,
  getLegacyProvider: () => provider,
});
const card = document.querySelector('[data-agent="DAT"]');
function input(selector, value, type = "input") {
  const element = card.querySelector(selector);
  element.value = value;
  element.dispatchEvent(new Event(type, { bubbles: true }));
}
input(".account", ACCOUNT);
input(".chain", "8453", "change");
input(".portfolio-tokens", TOKEN);
release.addEventListener("click", () => {
  if (!pending) return;
  const resolve = pending;
  pending = null;
  release.disabled = true;
  status.textContent = "模擬応答を返しました。実資産の読み取りではありません。";
  resolve("0x10");
});
window.addEventListener("pagehide", () => {
  app.dispose();
  pending?.("0x0");
  pending = null;
}, { once: true });
