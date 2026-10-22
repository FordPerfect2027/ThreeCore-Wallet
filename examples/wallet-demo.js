import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createWalletProviderRegistry } from "../src/provider-registry.js";
import { AGENT_IDS, normalizeAddress } from "../src/wallet-session.js";
import { mountPortfolioPanel } from "./portfolio-panel.js";
import { mountWalletSetupPanel } from "./wallet-setup-panel.js";
import { mountWorkspacePanel } from "./workspace-panel.js";
import { captureWorkspaceDraft } from "../src/workspace-format.js";
import { mountCheckpointPanel } from "./checkpoint-panel.js";
import { mountTokenIdentityPanel } from "./token-identity-panel.js";
import { describeIdentityCards } from "../src/identity-overview.js";
import { mountAllowancePanel } from "./allowance-panel.js";
import { describeAllowanceOverview } from "../src/allowance-overview.js";
import { mountAllowanceBundlePanel } from "./allowance-bundle-panel.js";

/** Dependencies are explicit so browser tests never consult a real extension. */
export function mountWalletDemo({ document, eventTarget, siteOrigin, getLegacyProvider, checkpointStorage }) {
  const grid = document.querySelector("#grid");
  const cards = [], controllers = new Map(), cleanup = [], panels = [], identityPanels = [];
  const allowancePanels = [];
  const allowanceStates = new Map(AGENT_IDS.map(agent => [agent, { agent, observation: null, provenance: null }]));
  const allowanceHost = document.createElement("section");
  allowanceHost.className = "allowance-overview";
  const allowanceHeading = document.createElement("h2");
  allowanceHeading.textContent = "3トークンの承認額確認";
  const allowanceSummary = document.createElement("pre");
  allowanceSummary.className = "allowance-overview-details";
  allowanceSummary.setAttribute("aria-live", "polite");
  allowanceHost.append(allowanceHeading, allowanceSummary);
  grid.before(allowanceHost);
  const renderAllowances = () => {
    allowanceSummary.textContent = describeAllowanceOverview([...allowanceStates.values()]);
  };
  renderAllowances();
  const allowanceBundlePanel = mountAllowanceBundlePanel({
    document, parent: allowanceHost,
    readRecords: () => AGENT_IDS.map(agent => allowanceStates.get(agent).observation),
  });
  let registry;
  let setupPanel;
  let workspacePanel;
  let checkpointPanel;
  const setupHost = document.createElement("div");
  grid.before(setupHost);
  const identityHost = document.createElement("section");
  identityHost.className = "identity-overview";
  const identityHeading = document.createElement("h2");
  identityHeading.textContent = "DAT・EMA・CAWELONの照合";
  const identitySummary = document.createElement("pre");
  identitySummary.className = "identity-overview-details";
  identitySummary.setAttribute("aria-live", "polite");
  identityHost.append(identityHeading, identitySummary);
  grid.before(identityHost);
  const identityStates = new Map(AGENT_IDS.map(agent => [agent, {
    agent, phase: "idle", provenance: null, observation: null,
  }]));
  const renderIdentitySummary = () => {
    identitySummary.textContent = describeIdentityCards([...identityStates.values()]);
  };
  renderIdentitySummary();
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
      text += "\n参照ブロック: " + (result.blockNumber ?? result.identity?.blockNumber);
      if (result.kind === "allowances") text += "\n承認額の記録を下のパネルに表示しています。";
      if (result.kind === "balances") text += "\nETH残高（wei）: " + result.nativeBalanceBaseUnits;
      if (result.kind === "token-identity") {
        text += "\n公式トークンの照合結果を下のパネルに表示しています。";
      }
      if (result.tokenAddress && result.kind !== "token-identity") {
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
    let panel;
    let identityPanel;
    let allowancePanel;
    let wasConnected = false;
    const controller = createWalletCardController({ agent, siteOrigin, onChange: state => {
      render(card, state);
      if (wasConnected && !state.connection?.connected) panel?.invalidate();
      if (wasConnected && !state.connection?.connected) identityPanel?.invalidate();
      if (wasConnected && !state.connection?.connected) allowancePanel?.invalidate();
      wasConnected = state.connection?.connected === true;
    } });
    controllers.set(card, controller);
    render(card, controller.state);
    panel = mountPortfolioPanel({ document, card,
      read: options => controller.readPortfolio(options),
      onCancel: () => controller.clearResult(),
      getContext: () => ({ agent, chainId: Number(card.querySelector(".chain").value) }),
    });
    panels.push(panel);
    identityPanel = mountTokenIdentityPanel({ document, parent: card,
      onStateChange: state => {
        identityStates.set(agent, { agent, phase: state.phase,
          provenance: state.provenance, observation: state.observation });
        renderIdentitySummary();
      },
      getContext: () => ({ agent, chainId: Number(card.querySelector(".chain").value),
        account: card.querySelector(".account").value.trim(),
        tokenAddress: card.querySelector(".token").value.trim() }),
      read: options => controller.readIdentity(options),
      applyAddress: address => {
        card.querySelector(".token").value = address;
        controller.clearResult();
        panel.invalidate();
        allowancePanel?.invalidate();
        workspacePanel?.invalidate();
        checkpointPanel?.invalidateDraft();
      },
    });
    identityPanels.push(identityPanel);
    cleanup.push(() => identityPanel.dispose());
    allowancePanel = mountAllowancePanel({ document, parent: card,
      getContext: () => ({ agent, chainId: Number(card.querySelector(".chain").value),
        account: card.querySelector(".account").value.trim(),
        tokenAddress: card.querySelector(".token").value.trim() }),
      read: (plan, options) => controller.readAllowances(plan, options),
      onStateChange: state => {
        allowanceStates.set(agent, { agent, observation: state.observation, provenance: state.provenance });
        renderAllowances();
      },
    });
    allowancePanels.push(allowancePanel);
    cleanup.push(() => allowancePanel.dispose());
    for (const selector of [".account", ".chain", ".provider", ".token"]) {
      listen(card.querySelector(selector), [".chain", ".provider"].includes(selector) ? "change" : "input",
        () => { identityPanel.invalidate(); allowancePanel.invalidate(); });
    }
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
    for (const selector of [".provider", ".chain", ".account"]) {
      listen(card.querySelector(selector), selector === ".account" ? "input" : "change", () => panel.invalidate());
    }
    for (const selector of [".account", ".chain", ".provider"]) {
      listen(card.querySelector(selector), selector === ".account" ? "input" : "change",
        () => setupPanel?.invalidate());
    }
  }
  setupPanel = mountWalletSetupPanel({ document, parent: setupHost,
    readFields: () => cards.map(card => ({ agent: card.dataset.agent,
      account: card.querySelector(".account").value,
      chainId: Number(card.querySelector(".chain").value),
    })),
    applyPlan: (plan, changes) => {
      // Validate the complete plan before touching any card. Application is
      // synchronous and only changes form values; no provider is called.
      const updates = changes.filter(change => change.accountChanged || change.chainChanged);
      for (const change of updates) {
        const card = cards.find(item => item.dataset.agent === change.agent);
        const index = cards.indexOf(card);
        controllers.get(card).disconnect("保存した設定を反映しました。再接続してください。");
        panels[index].invalidate();
        identityPanels[index].invalidate();
        allowancePanels[index].invalidate();
        card.querySelector(".account").value = change.after.account ?? "";
        card.querySelector(".chain").value = String(change.after.chainId);
        card.querySelector(".spender").value = "";
        if (change.chainChanged) {
          card.querySelector(".token").value = "";
          card.querySelector(".portfolio-tokens").value = "";
        }
      }
      workspacePanel?.invalidate();
      checkpointPanel?.invalidateDraft();
    },
  });
  const readWorkspaceDraft = () => cards.map((card, index) => ({
    agent: card.dataset.agent,
    account: card.querySelector(".account").value,
    chainId: Number(card.querySelector(".chain").value),
    tokenAddress: card.querySelector(".token").value,
    tokens: card.querySelector(".portfolio-tokens").value,
    history: panels[index].exportHistory(),
  }));
  const checkpointHost = document.createElement("div");
  setupHost.append(checkpointHost);
  workspacePanel = mountWorkspacePanel({ document, parent: setupHost,
    readDraft: readWorkspaceDraft,
    writeDraft: input => {
      const next = captureWorkspaceDraft(input);
      const before = captureWorkspaceDraft(readWorkspaceDraft());
      next.forEach((row, index) => {
        const old = before[index];
        const configurationChanged = ["account", "chainId", "tokenAddress", "tokens"].some(key => old[key] !== row[key]);
        const historyChanged = old.history !== row.history;
        if (!configurationChanged && !historyChanged) return;
        const card = cards[index];
        if (configurationChanged) {
          controllers.get(card).disconnect("一括復元で設定が変わりました。必要なら再接続してください。");
          identityPanels[index].invalidate();
          allowancePanels[index].invalidate();
        }
        panels[index].invalidate();
        if (configurationChanged) {
          card.querySelector(".account").value = row.account;
          card.querySelector(".chain").value = String(row.chainId);
          card.querySelector(".token").value = row.tokenAddress;
          card.querySelector(".portfolio-tokens").value = row.tokens;
          card.querySelector(".spender").value = "";
        }
        if (historyChanged) panels[index].replaceHistory(row.history);
      });
      setupPanel.invalidate();
      checkpointPanel?.invalidateDraft();
    },
  });
  checkpointPanel = mountCheckpointPanel({ document, parent: checkpointHost,
    readDraft: readWorkspaceDraft, onStage: text => workspacePanel.stageText(text),
    ...(checkpointStorage ? { storage: checkpointStorage } : {}),
  });
  // All local edits invalidate old reviews and backup preparation, never auto-save.
  for (const event of ["input", "change", "click"]) listen(grid, event, () => {
    workspacePanel.invalidate();
    checkpointPanel.invalidateDraft();
  });
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
      checkpointPanel.dispose();
      workspacePanel.dispose();
      setupPanel.dispose();
      setupHost.remove();
      identityHost.remove();
      allowanceHost.remove();
      allowanceBundlePanel.dispose();
      registry.dispose();
      for (const panel of panels) panel.dispose();
      for (const controller of controllers.values()) controller.dispose();
      for (const stop of cleanup) stop();
      grid.replaceChildren();
    },
  });
}

