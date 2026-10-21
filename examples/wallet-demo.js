import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createWalletProviderRegistry } from "../src/provider-registry.js";
import { AGENT_IDS, normalizeAddress } from "../src/wallet-session.js";

/** Dependencies are explicit so browser tests never consult a real extension. */
export function mountWalletDemo({ document, eventTarget, siteOrigin, getLegacyProvider }) {
  const grid = document.querySelector("#grid");
  const cards = [], controllers = new Map(), cleanup = [];
  let registry;
  function listen(element, event, callback) {
    element.addEventListener(event, callback);
    cleanup.push(() => element.removeEventListener(event, callback));
  }
  function render(card, state) {
    const connected = state.connection?.connected === true;
    const busy = state.phase === "connecting" || state.phase === "reading";
    card.querySelector(".connect").disabled = state.phase === "connecting";
    card.querySelector(".read").disabled = busy || !connected;
    card.querySelector(".inspect").disabled = busy || !connected;
    card.querySelector(".disconnect").disabled = !connected && state.phase !== "connecting";
    let text;
    if (state.phase === "connecting") text = "Walletの接続許可を確認しています。";
    else if (state.phase === "reading") text = "読み取り中です。";
    else if (!connected) text = "未接続";
    else text = card.dataset.agent + " 接続済み\n" + state.connection.account + "\nチェーン: " + state.connection.chainId;
    if (state.error) text += "\n" + state.error;
    if (state.result) {
      const result = state.result;
      text += "\n参照ブロック: " + result.blockNumber;
      if (result.kind === "balances") text += "\nETH残高（wei）: " + result.nativeBalanceBaseUnits;
      if (result.tokenAddress) {
        text += "\nトークン: " + result.tokenAddress;
        text += "\nトークン残高（最小単位）: " + (result.tokenBalanceBaseUnits ?? "確認できません");
        if (!result.tokenHasCode) text += "\nこのアドレスにトークンのコードが見つかりません。";
      }
      if (result.spenderAddress) {
        text += "\n承認先: " + result.spenderAddress;
        text += "\n既存の承認額（最小単位）: " + (result.existingAllowanceBaseUnits ?? "確認できません");
      }
      if (result.kind === "preflight") {
        if (!result.spenderHasCode) text += "\n承認先のコードが見つかりません。";
        text += "\n読み取り専用です。承認・送金は行っていません。安全性を保証する検査ではありません。";
      }
    }
    card.querySelector("output").textContent = text;
  }
  for (const agent of AGENT_IDS) {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.agent = agent;
    card.innerHTML = '<h2>' + agent + '</h2>' +
      '<label>接続するWallet<select class="provider"></select></label>' +
      '<label>このエージェントのWallet公開アドレス<input class="account" placeholder="0x..." autocomplete="off" spellcheck="false"></label>' +
      '<label>チェーン<select class="chain"><option value="84532">Base Sepolia / testnet</option><option value="8453">Base Mainnet / read only</option></select></label>' +
      '<label>トークンの契約アドレス（任意）<input class="token" placeholder="0x..." autocomplete="off" spellcheck="false"></label>' +
      '<label>承認先の契約アドレス（任意）<input class="spender" placeholder="0x..." autocomplete="off" spellcheck="false"></label>' +
      '<button class="connect">接続</button><button class="read secondary">残高を参照</button>' +
      '<button class="inspect secondary">dApp権限の事前確認</button><button class="disconnect secondary">切断</button>' +
      '<output aria-live="polite">未接続</output>';
    grid.append(card);
    cards.push(card);
    const controller = createWalletCardController({ agent, siteOrigin, onChange: state => render(card, state) });
    controllers.set(card, controller);
    render(card, controller.state);
    const value = selector => card.querySelector(selector).value.trim();
    listen(card.querySelector(".connect"), "click", () => {
      try {
        const choice = value(".provider");
        const provider = choice === "legacy" ? getLegacyProvider() : registry.getProvider(choice);
        if (!provider) throw Error("接続するWalletを選択してください。");
        const account = normalizeAddress(value(".account"));
        for (const other of cards.filter(item => item !== card)) {
          const address = other.querySelector(".account").value.trim();
          if (address && normalizeAddress(address) === account) throw Error("別のエージェントと同一のWalletアドレスです。");
        }
        controller.connect({ provider, account, chainId: Number(value(".chain")) });
      } catch (error) { controller.disconnect(error.message); }
    });
    listen(card.querySelector(".read"), "click", () => controller.readBalances({
      tokenAddress: value(".token"), spenderAddress: value(".spender"),
    }));
    listen(card.querySelector(".inspect"), "click", () => controller.inspect({
      tokenAddress: value(".token"), spenderAddress: value(".spender"),
    }));
    listen(card.querySelector(".disconnect"), "click", () => controller.disconnect());
    for (const selector of [".provider", ".chain"]) {
      listen(card.querySelector(selector), "change", () => controller.disconnect("接続設定を変更しました。再接続してください。"));
    }
    listen(card.querySelector(".account"), "input", () => controller.disconnect("公開アドレスを変更しました。再接続してください。"));
    for (const selector of [".token", ".spender"]) {
      listen(card.querySelector(selector), "input", () => controller.clearResult());
    }
  }
  function renderWalletProviders(wallets) {
    for (const card of cards) {
      const select = card.querySelector(".provider");
      const previous = select.value;
      select.replaceChildren();
      function option(label, value) {
        const item = document.createElement("option");
        item.textContent = label; // Wallet metadata is untrusted text, never HTML.
        item.value = value;
        select.add(item);
      }
      if (getLegacyProvider()) option("ブラウザーのWallet", "legacy");
      for (const item of wallets) option(item.name + " — " + item.rdns, item.uuid);
      if (!select.options.length) option("Walletが見つかりません", "none");
      if ([...select.options].some(item => item.value === previous)) select.value = previous;
      const controller = controllers.get(card);
      if (previous && select.value !== previous &&
          (controller.state.connection?.connected || controller.state.phase === "connecting")) {
        controller.disconnect("Walletの選択が変わりました。再接続してください。");
      }
    }
  }
  registry = createWalletProviderRegistry({ eventTarget, onChange: renderWalletProviders });
  renderWalletProviders(registry.list());
  return Object.freeze({
    dispose() {
      registry.dispose();
      for (const controller of controllers.values()) controller.dispose();
      for (const stop of cleanup) stop();
      grid.replaceChildren();
    },
  });
}
