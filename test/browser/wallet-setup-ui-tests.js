import { encodeWalletSetup } from "/src/wallet-setup.js";

// These addresses and providers are synthetic; no extension is consulted.
const A = "0x" + "11".repeat(20);
const B = "0x" + "22".repeat(20);
const C = "0x" + "33".repeat(20);
const TOKEN = "0x" + "55".repeat(20);
const AGENTS = ["DAT", "EMA", "CAWELON"];
const assert = (value, message) => { if (!value) throw Error(message); };
const q = suffix => document.querySelector(".wallet-setup-" + suffix);
const field = (agent, selector) => document.querySelector('[data-agent="' + agent + '"] ' + selector);
const input = (node, value, event = "input") => {
  node.value = value;
  node.dispatchEvent(new Event(event, { bubbles: true }));
};
function plan(accounts = [A, B, C], chains = [8453, 84532, 84532]) {
  return encodeWalletSetup({ schema: "threecore-wallet-setup-v1",
    entries: AGENTS.map((agent, index) => ({ agent, account: accounts[index], chainId: chains[index] })) });
}
function review(text = plan()) {
  input(q("json"), text);
  q("preview").click();
}
function confirm() {
  q("confirm").checked = true;
  q("confirm").dispatchEvent(new Event("change"));
}
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Setup UI did not reach expected state");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export function registerWalletSetupUITests(test) {
  test("setup: missing addresses are visible without wallet requests", make => {
    const f = make();
    assert(q("readiness").textContent.includes("1 / 3"), "fixture DAT configured");
    assert(q("readiness").textContent.includes("EMA: 未設定"), "missing EMA reported");
    assert(f.calls.length === 0, "configuration did not query wallet");
    assert(q("apply").disabled, "apply requires review");
  });

  test("setup: three distinct settings do not claim connection", make => {
    const f = make();
    review();
    confirm();
    q("apply").click();
    assert(q("readiness").textContent.includes("3 / 3"), "all configured");
    assert(q("readiness").textContent.includes("接続未確認"), "no ownership claim");
    assert(f.calls.length === 0, "no automatic account request");
    for (const agent of AGENTS) assert(field(agent, ".read").disabled, agent + " remains disconnected");
  });

  test("setup: JSON preview cannot modify any address", make => {
    make();
    review();
    assert(field("EMA", ".account").value === "", "EMA remains blank");
    assert(q("details").textContent.includes("変更対象: EMA・CAWELON"), "accurate affected cards");
    assert(q("apply").disabled, "confirmation still required");
  });

  test("setup: changed JSON removes stale checkbox confirmation", make => {
    make();
    review();
    confirm();
    input(q("json"), plan() + "\n");
    assert(!q("confirm").checked, "confirmation removed");
    assert(q("apply").disabled, "stale apply disabled");
    assert(q("details").textContent === "", "stale preview hidden");
  });

  test("setup: account changes after preview cannot be overwritten", make => {
    make();
    review();
    confirm();
    input(field("EMA", ".account"), C);
    q("apply").click();
    assert(field("EMA", ".account").value === C, "new manual entry retained");
    assert(q("apply").disabled, "review invalidated");
  });

  test("setup: network changes after preview cancel old review", make => {
    make();
    review();
    confirm();
    input(field("EMA", ".chain"), "8453", "change");
    assert(q("apply").disabled, "network edit invalidated preview");
    assert(field("EMA", ".chain").value === "8453", "new network retained");
  });

  test("setup: wallet provider selection cancels pending settings review", make => {
    const f = make(undefined, { announced: true });
    review();
    confirm();
    input(field("DAT", ".provider"), "legacy", "change");
    assert(q("apply").disabled, "provider change invalidated review");
    assert(f.calls.length === 0, "provider selection is not a connection");
  });

  test("setup: duplicate accounts are diagnosed on both cards", make => {
    make();
    input(field("EMA", ".account"), A);
    assert(q("readiness").textContent.includes("DAT: 他のカードと同じアドレス"), "DAT conflict");
    assert(q("readiness").textContent.includes("EMA: 他のカードと同じアドレス"), "EMA conflict");
    q("export").click();
    assert(q("status").textContent.includes("同じ公開アドレス"), "export rejected");
    assert(q("json").value === "", "invalid setup not exported");
  });

  test("setup: importing valid settings can repair duplicates", make => {
    make();
    input(field("EMA", ".account"), A);
    review();
    confirm();
    q("apply").click();
    assert(field("EMA", ".account").value === B, "duplicate repaired");
    assert(q("readiness").textContent.includes("3 / 3"), "distinct addresses ready");
  });

  test("setup: current export excludes provider token balances and secrets", async make => {
    const f = make();
    await f.connect();
    q("export").click();
    const value = JSON.parse(q("json").value);
    assert(Object.keys(value).join(",") === "schema,entries", "bounded top level");
    assert(Object.keys(value.entries[0]).join(",") === "agent,account,chainId", "only settings");
    assert(!q("json").value.includes(TOKEN), "token state not included");
    assert(!q("json").value.includes("connected"), "authorization not serialized");
    assert(f.output().includes("接続済み"), "export did not disconnect");
  });

  test("setup: unchanged DAT connection survives other card configuration", async make => {
    const f = make();
    await f.connect();
    const calls = f.calls.length;
    review();
    confirm();
    q("apply").click();
    assert(f.output().includes("DAT 接続済み"), "unchanged DAT stays connected");
    assert(f.calls.length === calls, "configuration did not request RPC");
    assert(field("EMA", ".read").disabled, "new EMA not implicitly connected");
  });

  test("setup: replacing connected account invalidates balances", async make => {
    const f = make();
    await f.connect();
    f.field(".read").click();
    await waitFor(() => f.output().includes("ETH残高"));
    const calls = f.calls.length;
    review(plan([C, B, A]));
    confirm();
    q("apply").click();
    assert(!f.output().includes("ETH残高"), "old balance removed");
    assert(!f.output().includes("接続済み"), "old session disconnected");
    assert(f.field(".read").disabled, "fresh connection required");
    assert(f.calls.length === calls, "no RPC while applying");
  });

  test("setup: network changes clear token inputs and spender", make => {
    const f = make();
    f.input(".portfolio-tokens", TOKEN);
    review(plan([A, B, C], [84532, 84532, 84532]));
    assert(q("details").textContent.includes("トークン入力を消去"), "clear disclosed in preview");
    confirm();
    q("apply").click();
    assert(f.field(".token").value === "", "single token cleared");
    assert(f.field(".portfolio-tokens").value === "", "list cleared");
    assert(f.field(".spender").value === "", "spender cleared");
    assert(f.field(".chain").value === "84532", "chain updated");
  });

  test("setup: same-network address changes retain token configuration", make => {
    const f = make();
    f.input(".portfolio-tokens", TOKEN);
    const previous = f.field(".token").value;
    review(plan([C, B, A]));
    confirm();
    q("apply").click();
    assert(f.field(".token").value === previous, "token retained on same chain");
    assert(f.field(".portfolio-tokens").value === TOKEN, "list retained");
    assert(f.field(".spender").value === "", "spender association cleared");
  });

  test("setup: changing identity preserves previously saved history", async make => {
    const f = make();
    await f.connect();
    f.input(".portfolio-tokens", TOKEN);
    f.field(".portfolio-read").click();
    await waitFor(() => f.field(".portfolio-status").textContent.includes("完了"));
    f.field(".history-add-current").click();
    f.field(".history-export").click();
    const original = f.field(".history-json").value;
    review(plan([C, B, A], [84532, 84532, 84532]));
    confirm();
    q("apply").click();
    f.field(".history-export").click();
    assert(f.field(".history-json").value === original, "history unchanged");
    assert(f.field(".portfolio-details").textContent === "", "current result cleared");
    assert(f.field(".history-list").textContent.includes(A), "old identity remains honestly labelled");
  });

  test("setup: removing a card address is explicit and disconnects it", async make => {
    const f = make();
    await f.connect();
    review(plan([null, B, C]));
    assert(q("details").textContent.includes("変更後: 未設定"), "removal visible");
    confirm();
    q("apply").click();
    assert(f.field(".account").value === "", "address cleared");
    assert(f.field(".read").disabled, "card disconnected");
  });

  test("setup: cancel does not alter an existing connected wallet", async make => {
    const f = make();
    await f.connect();
    const before = f.output();
    review(plan([C, B, A]));
    confirm();
    q("cancel").click();
    assert(f.output() === before, "connected state unchanged");
    assert(f.field(".account").value === A, "account unchanged");
  });

  test("setup: late permission result cannot restore a replaced configuration", async make => {
    let resolve;
    const gate = new Promise(yes => { resolve = yes; });
    const f = make(args => args.method === "eth_requestAccounts" ? gate : undefined);
    f.field(".connect").click();
    await waitFor(() => f.calls.some(call => call.method === "eth_requestAccounts"));
    review(plan([C, B, A]));
    confirm();
    q("apply").click();
    resolve([A]);
    await new Promise(done => setTimeout(done, 30));
    assert(f.field(".account").value === C, "replacement retained");
    assert(f.field(".read").disabled, "late response does not authorize new identity");
    assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "no automatic retry");
  });

  test("setup: unrelated pending history preview is cancelled without erasing history", async make => {
    const f = make();
    await f.connect();
    f.input(".portfolio-tokens", TOKEN);
    f.field(".portfolio-read").click();
    await waitFor(() => f.field(".portfolio-status").textContent.includes("完了"));
    f.field(".history-add-current").click();
    f.field(".history-export").click();
    f.field(".history-preview").click();
    assert(!f.field(".history-apply").disabled, "history review active");
    review(plan([C, B, A]));
    confirm();
    q("apply").click();
    assert(f.field(".history-apply").disabled, "old preview invalidated");
    assert(f.field(".history-list").children.length === 1, "saved history remains");
  });

  test("setup: settings restore after remount never restores connection permission", async make => {
    const f = make();
    await f.connect();
    review();
    confirm();
    q("apply").click();
    q("export").click();
    const saved = q("json").value;
    f.app.dispose();
    const next = make();
    review(saved);
    confirm();
    q("apply").click();
    assert(next.calls.length === 0, "restore did not connect");
    for (const agent of AGENTS) assert(field(agent, ".read").disabled, agent + " needs explicit connection");
  });

  test("setup: three synthetic wallets connect and read independently after restore", async make => {
    const f = make();
    review(plan([A, B, C], [8453, 8453, 8453]));
    confirm();
    q("apply").click();
    const requests = { DAT: f.calls, EMA: [], CAWELON: [] };
    const providers = [
      ["EMA", B, "22222222-2222-4222-8222-222222222222", "0x20"],
      ["CAWELON", C, "33333333-3333-4333-8333-333333333333", "0x30"],
    ];
    for (const [agent, account, uuid, amount] of providers) {
      const listeners = new Map();
      const provider = {
        on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
        removeListener(name, callback) { listeners.get(name)?.delete(callback); },
        async request(args) {
          requests[agent].push(args);
          if (args.method === "eth_chainId") return "0x2105";
          if (["eth_requestAccounts", "eth_accounts"].includes(args.method)) return [account];
          if (args.method === "eth_getBlockByNumber") return { number: "0x2a", hash: "0x" + "ab".repeat(32) };
          if (args.method === "eth_getBalance") return amount;
          if (args.method === "eth_getCode") return "0x6000";
          if (args.method === "eth_call") return "0x" + amount.slice(2).padStart(64, "0");
          throw Error("Forbidden synthetic request " + args.method);
        },
      };
      f.announce(uuid, provider, "Synthetic " + agent);
      input(field(agent, ".provider"), uuid, "change");
    }
    const snapshots = {};
    for (const agent of AGENTS) {
      field(agent, ".connect").click();
      await waitFor(() => !field(agent, ".read").disabled);
      input(field(agent, ".portfolio-tokens"), TOKEN);
      field(agent, ".portfolio-read").click();
      await waitFor(() => field(agent, ".portfolio-status").textContent.includes("完了"));
      field(agent, ".history-add-current").click();
      field(agent, ".history-export").click();
      snapshots[agent] = JSON.parse(field(agent, ".history-json").value).reports[0].snapshot;
    }
    assert(snapshots.DAT.account === A, "DAT identity");
    assert(snapshots.EMA.account === B, "EMA identity");
    assert(snapshots.CAWELON.account === C, "CAWELON identity");
    assert(snapshots.DAT.holdings[0].balanceBaseUnits === "42", "DAT balance");
    assert(snapshots.EMA.holdings[0].balanceBaseUnits === "32", "EMA balance");
    assert(snapshots.CAWELON.holdings[0].balanceBaseUnits === "48", "CAWELON balance");
    for (const agent of AGENTS) {
      assert(requests[agent].filter(call => call.method === "eth_requestAccounts").length === 1, agent + " explicit connect");
      assert(!requests[agent].some(call => /sign|sendTransaction|switchEthereum|addEthereum/i.test(call.method)), "no privileged method");
    }
  });

  test("setup: invalid imported addresses cannot insert HTML elements", make => {
    make();
    const value = JSON.parse(plan());
    value.entries[1].account = '<img src=x onerror="window.invalidSetup=true">';
    review(JSON.stringify(value));
    assert(q("apply").disabled, "invalid address cannot apply");
    assert(document.querySelector(".wallet-setup-panel img") === null, "no injected element");
    assert(field("EMA", ".account").value === "", "no partial apply");
  });

  test("setup: dispose removes global setup panel and listeners", make => {
    const f = make();
    review();
    confirm();
    const apply = q("apply");
    f.app.dispose();
    apply.click();
    assert(document.querySelector(".wallet-setup-panel") === null, "panel removed");
    assert(f.calls.length === 0, "retained button inert");
  });
}
