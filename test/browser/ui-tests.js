import { registerWorkspaceUITests } from "/test/browser/workspace-ui-tests.js";
import { registerTransferUITests } from "/test/browser/transfer-ui-tests.js";
import { registerTokenIdentityUITests } from "/test/browser/token-identity-ui-tests.js";
import { registerAllowanceUITests } from "/test/browser/allowance-ui-tests.js";
import { registerAllowanceBundleUITests } from "/test/browser/allowance-bundle-ui-tests.js";
import { registerCheckpointUITests } from "/test/browser/checkpoint-ui-tests.js";
import { registerHistoryRecoveryUITests } from "/test/browser/history-recovery-ui-tests.js";
import { registerWalletSetupUITests } from "/test/browser/wallet-setup-ui-tests.js";
import { registerHistoryReviewUITests } from "/test/browser/history-review-ui-tests.js";
import { registerHistoryFileUITests } from "/test/browser/history-file-ui-tests.js";
import { registerHistoryUITests } from "/test/browser/history-ui-tests.js";
import { mountWalletDemo } from "/examples/wallet-demo.js";
import { readErrorMessage } from "/src/provider-error.js";
import { ThreeCoreWalletSession } from "/src/wallet-session.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const SPENDER = "0x4444444444444444444444444444444444444444";
const BLOCK = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const UUID = "12345678-1234-4234-8234-123456789abc";
const word = "0x" + "2a".padStart(64, "0");
const assert = (value, message) => { if (!value) throw Error(message); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function waitFor(predicate, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw Error("UI did not reach the expected state");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function fixture(override = () => undefined, { legacy = true, announced = false, checkpointStorage } = {}) {
  const calls = [], listeners = new Map(), eventTarget = new EventTarget();
  const provider = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, data) { for (const fn of [...listeners.get(name) ?? []]) fn(data); },
    async request(args) {
      calls.push(args);
      const value = await override(args);
      if (value !== undefined) return value;
      switch (args.method) {
        case "eth_chainId": return "0x2105";
        case "eth_requestAccounts":
        case "eth_accounts": return [A];
        case "eth_getBlockByNumber": return { ...BLOCK };
        case "eth_getCode": return "0x6000";
        case "eth_getBalance": return "0x10";
        case "eth_call": return word;
        default: throw Error("Forbidden synthetic-wallet request: " + args.method);
      }
    },
  };
  const announce = (uuid = UUID, selected = provider, name = "Synthetic EIP-6963 Wallet") =>
    eventTarget.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({
      info: Object.freeze({ uuid, name, rdns: "test.synthetic", icon: "data:image/svg+xml,<svg/>" }), provider: selected,
    }) }));
  if (announced) eventTarget.addEventListener("eip6963:requestProvider", () => announce());
  // No reference to window.ethereum or an installed wallet is made.
  const app = mountWalletDemo({
    document, eventTarget, siteOrigin: location.origin, getLegacyProvider: () => legacy ? provider : undefined, checkpointStorage,
    // Short, real-clock deadlines for synthetic fixtures only. Production defaults
    // remain covered by the session unit tests and the normal demo's own factory.
    createSession: options => new ThreeCoreWalletSession({ ...options,
      readTimeoutMs: 1000, connectTimeoutMs: 1000, permissionTimeoutMs: 2000 }),
  });
  const card = document.querySelector('[data-agent="DAT"]');
  const field = selector => card.querySelector(selector);
  function input(selector, value, event = "input") {
    field(selector).value = value;
    field(selector).dispatchEvent(new Event(event, { bubbles: true }));
  }
  input(".account", A);
  input(".chain", "8453", "change");
  input(".token", TOKEN);
  input(".spender", SPENDER);
  return {
    app, calls, provider, eventTarget, card, field, input, announce,
    output: () => field("output").textContent,
    async connect() { field(".connect").click(); await waitFor(() => !field(".read").disabled); },
  };
}
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("EIP-6963のみでも検出したWalletを選んで接続・読み取りできる", async use => {
  const f = use(undefined, { legacy: false, announced: true });
  assert(f.field(".provider").value === UUID, "Discovered provider was not listed");
  assert(![...f.field(".provider").options].some(o => o.value === "legacy"), "Unexpected legacy fallback");
  assert(f.calls.length === 0, "Discovery requested accounts");
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  assert(f.calls.filter(c => c.method === "eth_requestAccounts").length === 1, "Wrong permission request count");
});

test("遅れて検出したWalletも候補から除外せず、操作前に接続しない", async use => {
  const f = use(undefined, { legacy: false });
  assert(f.field(".provider").value === "none", "Expected no initial provider");
  f.announce();
  assert(f.field(".provider").value === UUID, "Late provider was hidden");
  assert(f.calls.length === 0, "Late discovery automatically requested permission");
  await f.connect();
  assert(f.output().includes("接続済み"), "Selected EIP-6963 provider did not connect");
});

test("複数Walletの追加通知後も選択したEIP-6963プロバイダーへ接続する", async use => {
  const f = use(undefined, { legacy: false, announced: true });
  const otherCalls = [];
  const other = { request: async args => { otherCalls.push(args.method); throw Error("Wrong provider selected"); } };
  f.announce("98765432-4321-4321-8321-cba987654321", other, "Other synthetic Wallet");
  assert(f.field(".provider").options.length === 2, "A discovered provider was sliced away");
  assert(f.field(".provider").value === UUID, "Selection was silently replaced");
  await f.connect();
  assert(otherCalls.length === 0, "Connected to an unselected provider");
});

test("読み取りに失敗する検出通知の後も正常なWalletへ接続できる", async use => {
  const f = use(undefined, { legacy: false });
  const errors = [];
  const capture = event => { errors.push(event.message); event.preventDefault(); };
  window.addEventListener("error", capture);
  try {
    const info = { uuid: UUID, rdns: "test.synthetic" };
    Object.defineProperty(info, "name", { get() { throw Error("Broken discovery metadata"); } });
    f.eventTarget.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: { info, provider: f.provider } }));
    assert(f.field(".provider").value === "none", "Invalid provider was listed");
    f.announce();
    assert(f.calls.length === 0, "Discovery issued RPC");
    await f.connect();
    assert(errors.length === 0, "Announcement escaped into the page error handler");
  } finally { window.removeEventListener("error", capture); }
});

test("検出通知のproviderが読み取りごとに変わっても検査済みのWalletへ接続する", async use => {
  const f = use(undefined, { legacy: false });
  let reads = 0, otherCalls = 0;
  const other = { request() { otherCalls++; throw Error("Unexpected replacement provider"); } };
  const detail = { info: { uuid: UUID, name: "Accessor Wallet", rdns: "test.synthetic" } };
  Object.defineProperty(detail, "provider", { get() { return ++reads === 1 ? f.provider : other; } });
  f.eventTarget.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  await f.connect();
  assert(reads === 1 && otherCalls === 0, "Provider changed between validation and selection");
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
});

test("UUIDの大文字通知で接続中のWalletを重複表示・置換しない", async use => {
  const f = use(undefined, { legacy: false, announced: true });
  await f.connect();
  const connected = f.output();
  let otherCalls = 0;
  f.announce(UUID.toUpperCase(), { request() { otherCalls++; throw Error("Duplicate UUID provider"); } }, "Duplicate");
  assert(f.field(".provider").options.length === 1, "Equivalent UUID added another option");
  assert(f.field(".provider").value === UUID && f.output() === connected, "Selection or session changed");
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  assert(otherCalls === 0, "Duplicate received RPC");
});

test("接続中の連打は許可要求を増やさない", async use => {
  const gate = deferred();
  const f = use(({ method }) => method === "eth_requestAccounts" ? gate.promise : undefined);
  f.field(".connect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_requestAccounts"));
  assert(f.field(".connect").disabled, "Connect must be disabled while awaiting permission");
  f.field(".connect").click();
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Duplicate prompt");
  gate.resolve([A]);
  await waitFor(() => !f.field(".read").disabled);
  assert(f.output().includes("接続済み"), "Connection result missing");
});

test("切断後の遅い接続エラーは表示を上書きしない", async use => {
  const gate = deferred();
  const f = use(({ method }) => method === "eth_requestAccounts" ? gate.promise : undefined);
  f.field(".connect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_requestAccounts"));
  f.field(".disconnect").click();
  const expected = f.output();
  gate.reject(Error("obsolete permission error"));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === expected && expected.includes("未接続"), "Disconnected view was overwritten");
});

test("残高・承認額と参照ブロックを同時に表示する", async use => {
  const f = use();
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  assert(f.output().includes("参照ブロック: 42"), "Block missing");
  assert(f.output().includes("既存の承認額（最小単位）: 42"), "Allowance missing");
  assert(f.output().includes(TOKEN) && f.output().includes(SPENDER), "Read addresses missing");
  for (const { params } of f.calls.filter(x => ["eth_getCode", "eth_getBalance", "eth_call"].includes(x.method))) {
    assert(params[1].blockHash === BLOCK.hash && params[1].requireCanonical === true, "Unpinned read");
  }
});

test("読み取り中のトークン変更は古い残高を表示しない", async use => {
  const gate = deferred();
  const f = use(({ method }) => method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_getBalance"));
  f.input(".token", B);
  const expected = f.output();
  gate.resolve("0xff");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === expected && !expected.includes("ETH残高"), "Stale amount survived input change");
  assert(!f.field(".read").disabled, "Connection should remain available");
});

test("dApp検査中の切断は古い結果を表示しない", async use => {
  const gate = deferred();
  const f = use(({ method }) => method === "eth_getBlockByNumber" ? gate.promise : undefined);
  await f.connect();
  f.field(".inspect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_getBlockByNumber"));
  f.field(".disconnect").click();
  const expected = f.output();
  gate.resolve({ ...BLOCK });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === expected && !expected.includes("参照ブロック"), "Stale preflight was displayed");
});

test("Walletのアカウント変更で結果を消し、自動再接続しない", async use => {
  const f = use();
  await f.connect();
  f.field(".inspect").click();
  await waitFor(() => f.output().includes("参照ブロック"));
  const count = f.calls.length;
  f.provider.emit("accountsChanged", [B]);
  assert(f.output().includes("未接続") && !f.output().includes("参照ブロック"), "Stale report remains");
  assert(f.calls.length === count && f.field(".read").disabled, "Unexpected automatic request");
});

test("Wallet情報をHTMLとして実行せず、選択変更で切断する", async use => {
  const f = use();
  await f.connect();
  f.eventTarget.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
    info: { uuid: UUID, name: '<img src=x onerror="alert(1)">', rdns: "test.wallet" }, provider: f.provider,
  } }));
  assert(!f.card.querySelector("img"), "Untrusted metadata became markup");
  assert(f.field(".provider").textContent.includes("<img"), "Metadata text missing");
  f.input(".provider", UUID, "change");
  assert(f.output().includes("未接続") && f.field(".read").disabled, "Provider change retained session");
});

test("他エージェントの重複アドレスは接続要求の前に拒否する", async use => {
  const f = use();
  await f.connect();
  const ema = document.querySelector('[data-agent="EMA"]');
  ema.querySelector(".account").value = A;
  ema.querySelector(".chain").value = "8453";
  const count = f.calls.length;
  ema.querySelector(".connect").click();
  assert(ema.querySelector("output").textContent.includes("同一"), "Duplicate agent account accepted");
  assert(f.calls.length === count && f.output().includes("接続済み"), "Another card's session was changed");
});

for (const code of [4100, 4900, 4901]) {
  test(`イベントなしの接続エラー${code}で結果を消し、明示的な再接続で復帰する`, async use => {
    let failed = false;
    const f = use(({ method }) => {
      if (failed && method === "eth_call") throw Object.assign(Error("Synthetic provider error"), { code });
    });
    await f.connect();
    f.field(".read").click();
    await waitFor(() => f.output().includes("ETH残高"));
    failed = true;
    f.field(".inspect").click();
    await waitFor(() => f.output().includes("再接続"));
    assert(f.output().includes("未接続") && !f.output().includes("参照ブロック"), "Invalid session retained its report");
    assert(f.field(".read").disabled && f.field(".inspect").disabled, "Reads still enabled");
    assert(!f.field(".connect").disabled, "Explicit reconnect unavailable");
    const count = f.calls.length;
    f.field(".read").click();
    f.field(".inspect").click();
    assert(f.calls.length === count, "Unexpected retry after disconnect");
    assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Automatic permission prompt");
    failed = false;
    await f.connect();
    f.field(".read").click();
    await waitFor(() => f.output().includes("ETH残高"));
    assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 2, "Missing explicit reconnect");
  });
}

test("入力変更後に届く接続エラーでも無効な接続表示を残さない", async use => {
  const gate = deferred();
  const f = use(({ method }) => method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_getBalance"));
  f.input(".token", B);
  gate.reject(Object.assign(Error("Synthetic disconnect"), { code: 4900 }));
  await waitFor(() => f.output().includes("再接続"));
  assert(f.field(".read").disabled && f.output().includes("未接続"), "Superseded read left connected UI");
  assert(!f.output().includes("ETH残高"), "Stale amount displayed");
});

test("未対応の読み取りでは結果を消し、接続と手動再試行を維持する", async use => {
  let unsupported = true;
  const f = use(({ method }) => {
    if (unsupported && method === "eth_call") throw Object.assign(Error("Pinned read unsupported"), { code: 4200 });
  });
  await f.connect();
  f.field(".inspect").click();
  await waitFor(() => f.output().includes("Pinned read unsupported"));
  assert(!f.field(".read").disabled && !f.output().includes("参照ブロック"), "Unexpected disconnect or partial report");
  unsupported = false;
  f.field(".inspect").click();
  await waitFor(() => f.output().includes("参照ブロック"));
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Unnecessary permission prompt");
});

test("無応答の読み取りを設定した期限で終了し、再接続後に古い応答を表示しない", async use => {
  const gate = deferred();
  let delayed = true;
  const f = use(({ method }) => delayed && method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_getBalance"));
  await waitFor(() => f.output().includes("応答がない"), 40_000);
  assert(f.output().includes("未接続") && f.field(".read").disabled, "Timeout retained access");
  assert(!f.output().includes("参照ブロック") && !f.output().includes("ETH残高"), "Partial report survived");
  assert(f.calls.filter(x => x.method === "eth_getBalance").length === 1, "Automatic retry");
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Automatic permission prompt");
  delayed = false;
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  const fresh = f.output();
  gate.resolve("0xffff");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === fresh, "Timed-out result overwrote the new connection");
});

test("無応答のdApp検査から手動切断でき、新しい接続で再検査できる", async use => {
  const gate = deferred();
  let delayed = true;
  const f = use(({ method }) => delayed && method === "eth_call" ? gate.promise : undefined);
  await f.connect();
  f.field(".inspect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_call"));
  f.field(".disconnect").click();
  assert(f.output().includes("未接続") && f.field(".read").disabled, "Disconnect failed during a hung read");
  delayed = false;
  await f.connect();
  f.field(".inspect").click();
  await waitFor(() => f.output().includes("参照ブロック"));
  const fresh = f.output();
  gate.reject(Object.assign(Error("Obsolete failure"), { code: 4900 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === fresh, "Old failure overwrote the new inspection");
});

test("接続確認の無応答を設定した期限で終了し、明示的な再接続で復帰する", async use => {
  const gate = deferred();
  let delayed = true;
  const f = use(({ method }) => delayed && method === "eth_chainId" ? gate.promise : undefined);
  f.field(".connect").click();
  await waitFor(() => f.output().includes("応答がない"), 40_000);
  assert(f.output().includes("未接続") && !f.field(".connect").disabled, "Connection timeout did not release UI");
  assert(f.field(".read").disabled && f.calls.length === 1, "Unexpected follow-up RPC");
  delayed = false;
  await f.connect();
  const fresh = f.output();
  gate.resolve("0x1");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output() === fresh, "Old chain response changed the new connection");
});

test("許可待ちを設定した期限で終了し、残っている許可要求を重複させない", async use => {
  const gate = deferred();
  let delayed = true;
  const f = use(({ method }) => delayed && method === "eth_requestAccounts" ? gate.promise : undefined);
  f.field(".connect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_requestAccounts"));
  await waitFor(() => f.output().includes("接続許可の待機を終了"), 130_000);
  assert(f.output().includes("未接続") && f.field(".read").disabled, "Permission timeout retained access");
  assert(!f.field(".connect").disabled, "Reconnect button stayed busy");
  const count = f.calls.length;
  f.field(".connect").click();
  await waitFor(() => f.output().includes("まだ処理中"));
  assert(f.calls.length === count, "Outstanding prompt was duplicated");
  delayed = false;
  gate.resolve([A]);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.field(".read").disabled && f.output().includes("未接続"), "Late permission auto-connected");
  await f.connect();
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 2, "Fresh explicit permission missing");
});

test("許可待ちの手動切断後も重複要求を防ぎ、拒否の完了後に再接続できる", async use => {
  const gate = deferred();
  let delayed = true;
  const f = use(({ method }) => delayed && method === "eth_requestAccounts" ? gate.promise : undefined);
  f.field(".connect").click();
  await waitFor(() => f.calls.some(x => x.method === "eth_requestAccounts"));
  f.field(".disconnect").click();
  assert(f.output().includes("未接続"), "Pending connection was not cancelled");
  const count = f.calls.length;
  f.field(".connect").click();
  await waitFor(() => f.output().includes("まだ処理中"));
  assert(f.calls.length === count, "Cancellation duplicated the permission prompt");
  delayed = false;
  gate.reject(Object.assign(Error("Old prompt rejected"), { code: 4001 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.output().includes("未接続"), "Old rejection changed connection state");
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
});

test("null permission rejection releases the UI and allows explicit reconnection", async use => {
  let fail = true;
  const f = use(({ method }) => fail && method === "eth_requestAccounts" ? Promise.reject(null) : undefined);
  f.field(".connect").click();
  await waitFor(() => f.output().includes("処理に失敗"));
  assert(f.output().includes("未接続") && !f.field(".connect").disabled, "Connection stayed busy");
  assert(f.field(".read").disabled, "Rejected permission enabled reads");
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Automatic retry");
  fail = false;
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
});

test("inaccessible rejection properties clear stale balances and allow another read", async use => {
  let fail = false;
  const error = { get code() { throw Error("Code unavailable"); }, get message() { throw Error("Message unavailable"); } };
  const f = use(({ method }) => fail && method === "eth_getBalance" ? Promise.reject(error) : undefined);
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  fail = true;
  f.field(".read").click();
  await waitFor(() => f.output().includes("処理に失敗"));
  assert(!f.field(".read").disabled && !f.output().includes("ETH残高"), "Read remained busy or retained stale balance");
  fail = false;
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  assert(f.calls.filter(x => x.method === "eth_requestAccounts").length === 1, "Read recovery requested permission");
});

test("throwing listener cleanup cannot keep a disconnected card active", async use => {
  const f = use();
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
  Object.defineProperty(f.provider, "removeListener", { get() { throw Error("Cleanup unavailable"); } });
  f.field(".disconnect").click();
  assert(f.output().includes("未接続") && !f.output().includes("ETH残高"), "Disconnect retained old result");
  assert(f.field(".read").disabled && !f.field(".connect").disabled, "Disconnect did not release UI");
  await f.connect();
  f.field(".read").click();
  await waitFor(() => f.output().includes("ETH残高"));
});

test("portfolio panel reads two token balances pinned to one block", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN + "\n" + SPENDER);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("完了"));
  const text = f.field(".portfolio-details").textContent;
  assert(text.includes(TOKEN) && text.includes(SPENDER), "both contracts visible");
  assert(text.includes("42") && text.includes(BLOCK.hash), "block reference visible");
  assert(text.includes("最小単位）: 42"), "exact raw balance");
  assert(!f.field(".portfolio-export").disabled, "export enabled only after result");
});

test("portfolio panel cannot read before explicit connection", async make => {
  const f = make();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
  assert(f.calls.length === 0, "no implicit wallet connection");
  assert(f.field(".portfolio-details").textContent === "", "no stale result");
});

test("portfolio JSON import stays historical and never requests wallet permission", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".portfolio-export").click();
  const report = f.field(".portfolio-json").value;
  assert(JSON.parse(report).historicalObservation === true, "historical export marker");
  f.field(".portfolio-clear").click();
  f.input(".portfolio-json", report);
  const calls = f.calls.length;
  f.field(".portfolio-import").click();
  assert(f.field(".portfolio-details").textContent.includes("過去の保存記録"), "historical label");
  assert(f.calls.length === calls, "import performs no RPC");
  assert(f.field(".portfolio-export").disabled, "import cannot masquerade as fresh result");
});

test("invalid imported JSON clears prior result without HTML injection", async make => {
  const f = make();
  f.input(".portfolio-json", '<img src=x onerror="throw Error(1)">');
  f.field(".portfolio-import").click();
  assert(f.field(".portfolio-status").textContent.includes("正しくありません"), "invalid format label");
  assert(f.field(".portfolio-details").textContent === "", "no imported result");
  assert(!f.field(".portfolio-panel").querySelector("img"), "untrusted content is not HTML");
});

test("changing the portfolio token plan clears its export and display", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".portfolio-export").click();
  f.input(".portfolio-tokens", SPENDER);
  assert(f.field(".portfolio-json").value === "", "old export removed");
  assert(f.field(".portfolio-details").textContent === "", "old display removed");
  assert(f.field(".portfolio-export").disabled, "old export unavailable");
});

test("portfolio cancellation prevents late provider values from displaying", async make => {
  const pending = deferred();
  const f = make(args => args.method === "eth_getBalance" ? pending.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  f.field(".portfolio-cancel").click();
  pending.resolve("0x999");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.field(".portfolio-details").textContent === "", "cancelled result hidden");
  assert(f.field(".portfolio-status").textContent.includes("キャンセル"), "cancel status retained");
});

test("disconnect clears a completed portfolio and its export", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".disconnect").click();
  assert(f.field(".portfolio-details").textContent === "", "disconnect clears result");
  assert(f.field(".portfolio-export").disabled, "disconnect prevents export");
});

test("portfolio UI never requests signing, approvals, switching or transactions", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  const before = f.calls.length;
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  const allowed = new Set(["eth_chainId", "eth_accounts", "eth_getBlockByNumber",
    "eth_getBalance", "eth_getCode", "eth_call"]);
  assert(f.calls.slice(before).every(call => allowed.has(call.method)), "read-only RPC allowlist");
  f.field(".portfolio-export").click();
  const report = JSON.parse(f.field(".portfolio-json").value);
  assert(report.snapshot.readOnly === true, "read-only report flag");
  assert(report.snapshot.securityAudit === false, "not a security audit");
});

test("portfolio missing contract code is unknown and skips balanceOf", async make => {
  const f = make(args => args.method === "eth_getCode" ? "0x" : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.field(".portfolio-details").textContent.includes("契約コードなし"), "missing code notice");
  assert(!f.calls.some(call => call.method === "eth_call"), "no calls to absent contracts");
});

test("portfolio zero is displayed as an actual observed balance", async make => {
  const f = make(args => args.method === "eth_call" ? "0x" + "0".repeat(64) : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.field(".portfolio-details").textContent.includes("最小単位）: 0"), "zero balance rendered");
});

test("portfolio uint256 maximum survives browser rendering and JSON export exactly", async make => {
  const max = (1n << 256n) - 1n;
  const f = make(args => args.method === "eth_call" ? "0x" + max.toString(16) : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.field(".portfolio-details").textContent.includes(max.toString()), "no numeric rounding");
  f.field(".portfolio-export").click();
  assert(JSON.parse(f.field(".portfolio-json").value).snapshot.holdings[0].balanceBaseUnits === max.toString(),
    "exact decimal string export");
});

for (const plan of ["", "not-an-address", TOKEN + "\n" + TOKEN]) {
  test("portfolio invalid plan does not start balance RPC: " + JSON.stringify(plan), async make => {
    const f = make();
    await f.connect();
    const before = f.calls.length;
    f.input(".portfolio-tokens", plan);
    f.field(".portfolio-read").click();
    await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
    assert(!f.calls.slice(before).some(call => call.method === "eth_getBalance"), "no invalid-plan reads");
    assert(f.field(".portfolio-export").disabled, "no export for invalid plan");
    assert(f.field(".portfolio-details").textContent === "", "no result");
  });
}

test("portfolio duplicate click during loading starts only one balance read", async make => {
  const pending = deferred();
  const f = make(args => args.method === "eth_getBalance" ? pending.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  assert(f.field(".portfolio-panel").getAttribute("aria-busy") === "true", "accessible busy state");
  assert(f.calls.filter(call => call.method === "eth_getBalance").length === 1, "single active read");
  pending.resolve("0x10");
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.field(".portfolio-panel").getAttribute("aria-busy") === "false", "busy state released");
});

test("portfolio clear during loading releases the outer card and blocks late output", async make => {
  const pending = deferred();
  const f = make(args => args.method === "eth_getBalance" ? pending.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  f.field(".portfolio-clear").click();
  assert(!f.field(".read").disabled, "outer card is released");
  pending.resolve("0x99");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.field(".portfolio-details").textContent === "", "late result stays hidden");
  assert(!f.output().includes("参照ブロック"), "outer card retains no obsolete result");
});

test("portfolio input changes during loading release the card and preserve input notice", async make => {
  const pending = deferred();
  const f = make(args => args.method === "eth_getBalance" ? pending.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  f.input(".portfolio-tokens", SPENDER);
  assert(!f.field(".read").disabled, "outer card released after changed plan");
  pending.resolve("0x99");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.field(".portfolio-status").textContent.includes("入力が変わりました"), "input notice retained");
  assert(f.field(".portfolio-details").textContent === "", "old plan hidden");
});

test("portfolio provider rejection clears the display and permits explicit retry", async make => {
  let fail = true;
  const f = make(args => fail && args.method === "eth_call" ? Promise.reject(Error("private diagnostic")) : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
  assert(!f.field(".portfolio-status").textContent.includes("private"), "no raw provider diagnostics");
  assert(f.field(".portfolio-details").textContent === "", "failed read cleared");
  fail = false;
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "no implicit new permission");
});

test("portfolio reorganized block cannot become a completed visible observation", async make => {
  let blocks = 0;
  const f = make(args => args.method === "eth_getBlockByNumber" && ++blocks === 2
    ? { ...BLOCK, hash: "0x" + "cd".repeat(32) } : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
  assert(f.field(".portfolio-export").disabled, "no export after reorganization");
  assert(f.field(".portfolio-details").textContent === "", "no mixed-block observation");
});

for (const event of ["accountsChanged", "chainChanged"]) {
  test("portfolio pending read is cleared by " + event, async make => {
    const pending = deferred();
    const f = make(args => args.method === "eth_getBalance" ? pending.promise : undefined);
    await f.connect();
    f.input(".portfolio-tokens", TOKEN);
    f.field(".portfolio-read").click();
    await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
    f.provider.emit(event, event === "accountsChanged" ? [B] : "0x1");
    pending.resolve("0x99");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(f.field(".read").disabled, "card disconnected");
    assert(f.field(".portfolio-export").disabled, "export disabled");
    assert(f.field(".portfolio-details").textContent === "", "late provider result ignored");
    assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "no automatic reconnect");
  });
}

test("portfolio changed chain setting clears completed observation and export text", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".portfolio-export").click();
  f.input(".chain", "84532", "change");
  assert(f.field(".portfolio-details").textContent === "", "previous chain result cleared");
  assert(f.field(".portfolio-json").value === "", "previous chain export cleared");
  assert(f.field(".read").disabled, "explicit connection required");
});

test("portfolio views remain isolated between DAT, EMA and CAWELON cards", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  for (const agent of ["EMA", "CAWELON"]) {
    const card = document.querySelector('[data-agent="' + agent + '"]');
    assert(card.querySelector(".portfolio-details").textContent === "", "no cross-card observation");
    assert(card.querySelector(".portfolio-json").value === "", "no cross-card export");
    assert(card.querySelector(".portfolio-export").disabled, "other card export disabled");
  }
});

test("portfolio JSON cannot enable signing by changing historical report flags", async make => {
  const f = make();
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".portfolio-export").click();
  const report = JSON.parse(f.field(".portfolio-json").value);
  report.snapshot.readOnly = false;
  f.input(".portfolio-json", JSON.stringify(report));
  const before = f.calls.length;
  f.field(".portfolio-import").click();
  assert(f.field(".portfolio-status").textContent.includes("正しくありません"), "unsafe import rejected");
  assert(f.field(".portfolio-export").disabled, "no export of modified flags");
  assert(f.calls.length === before, "import never performs RPC");
});

async function prepareComparison(f) {
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => !f.field(".portfolio-export").disabled);
  f.field(".portfolio-export").click();
  const report = JSON.parse(f.field(".portfolio-json").value);
  report.snapshot.blockNumber = "41";
  report.snapshot.blockHash = "0x" + "cd".repeat(32);
  report.snapshot.nativeBalanceBaseUnits = "10";
  report.snapshot.holdings[0].balanceBaseUnits = "40";
  f.input(".comparison-baseline", JSON.stringify(report));
  return report;
}

test("comparison needs a displayed observation and cannot connect a wallet", async make => {
  const f = make();
  assert(f.field(".comparison-run").disabled, "compare disabled before target");
  f.input(".comparison-baseline", "{}");
  f.field(".comparison-run").click();
  assert(f.calls.length === 0, "no connection or provider reads");
  assert(f.field(".comparison-details").textContent === "", "no fabricated target");
});

test("comparison renders exact positive differences without any additional RPC", async make => {
  const f = make();
  await prepareComparison(f);
  const before = f.calls.length;
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("完了"), "comparison completed");
  const text = f.field(".comparison-details").textContent;
  assert(text.includes("wei）: +6"), "native difference");
  assert(text.includes("最小単位）: +2"), "token difference");
  assert(text.includes("41 → 42"), "both block heights");
  assert(text.includes("利益の証明ではありません"), "historical interpretation");
  assert(f.calls.length === before, "comparison is local");
});

test("comparison of a different account is rejected without a wallet operation", async make => {
  const f = make();
  const report = await prepareComparison(f);
  report.snapshot.account = B;
  f.input(".comparison-baseline", JSON.stringify(report));
  const before = f.calls.length;
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("同じエージェント"), "identity error");
  assert(f.field(".comparison-details").textContent === "", "different-account result hidden");
  assert(f.calls.length === before, "no RPC on identity mismatch");
});

test("comparison rejects a baseline from a later block", async make => {
  const f = make();
  const report = await prepareComparison(f);
  report.snapshot.blockNumber = "43";
  f.input(".comparison-baseline", JSON.stringify(report));
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("古いブロック"), "chronology error");
  assert(f.field(".comparison-details").textContent === "", "no reversed comparison");
});

test("comparison cannot conflate conflicting block hashes at one height", async make => {
  const f = make();
  const report = await prepareComparison(f);
  report.snapshot.blockNumber = "42";
  f.input(".comparison-baseline", JSON.stringify(report));
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("ハッシュが異なる"), "block conflict");
  assert(f.field(".comparison-details").textContent === "", "no conflicting result");
});

test("editing comparison input removes previous results and never executes HTML", async make => {
  const f = make();
  await prepareComparison(f);
  f.field(".comparison-run").click();
  f.input(".comparison-baseline", "<img src=x onerror=alert(1)>");
  assert(f.field(".comparison-details").textContent === "", "stale comparison cleared");
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("読み取れません"), "malformed input rejected");
  assert(!f.field(".comparison-panel").querySelector("img"), "input stayed text");
});

test("disconnect removes comparison data together with the displayed portfolio", async make => {
  const f = make();
  await prepareComparison(f);
  f.field(".comparison-run").click();
  f.field(".disconnect").click();
  assert(f.field(".comparison-details").textContent === "", "comparison cleared");
  assert(f.field(".comparison-baseline").value === "", "baseline cleared");
  assert(f.field(".comparison-run").disabled, "comparison requires new target");
});

test("clearing portfolio also clears comparison target and historical input", async make => {
  const f = make();
  await prepareComparison(f);
  f.field(".comparison-run").click();
  f.field(".portfolio-clear").click();
  assert(f.field(".comparison-details").textContent === "", "comparison cleared");
  assert(f.field(".comparison-baseline").value === "", "baseline cleared");
  assert(f.field(".comparison-run").disabled, "no obsolete target");
});

test("comparison clear preserves the displayed portfolio and explicit connection", async make => {
  const f = make();
  await prepareComparison(f);
  const text = f.field(".portfolio-details").textContent;
  f.field(".comparison-run").click();
  f.field(".comparison-clear").click();
  assert(f.field(".comparison-details").textContent === "", "comparison gone");
  assert(f.field(".comparison-baseline").value === "", "input gone");
  assert(f.field(".portfolio-details").textContent === text, "portfolio retained");
  assert(!f.field(".read").disabled, "connection retained");
});

test("comparison treats newly observed contracts as unknown rather than a deposit", async make => {
  const f = make();
  const report = await prepareComparison(f);
  report.snapshot.holdings[0].address = SPENDER;
  f.input(".comparison-baseline", JSON.stringify(report));
  f.field(".comparison-run").click();
  const text = f.field(".comparison-details").textContent;
  assert(text.includes("前の記録では未確認"), "newly observed contract");
  assert(text.includes("後の記録では未確認"), "omitted contract");
  assert(!text.includes("最小単位）: +42"), "no invented zero baseline");
});

test("historical portfolio imports can be compared without reconnecting", async make => {
  const f = make();
  await prepareComparison(f);
  const target = f.field(".portfolio-json").value;
  const baseline = f.field(".comparison-baseline").value;
  f.field(".disconnect").click();
  f.input(".portfolio-json", target);
  f.field(".portfolio-import").click();
  f.input(".comparison-baseline", baseline);
  const before = f.calls.length;
  f.field(".comparison-run").click();
  assert(f.field(".comparison-status").textContent.includes("完了"), "historical comparison");
  assert(f.field(".read").disabled, "no restored connection");
  assert(f.field(".portfolio-export").disabled, "no live export");
  assert(f.calls.length === before, "no RPC");
});

test("comparison data is scoped to its agent card", async make => {
  const f = make();
  await prepareComparison(f);
  f.field(".comparison-run").click();
  for (const agent of ["EMA", "CAWELON"]) {
    const card = document.querySelector('[data-agent="' + agent + '"]');
    assert(card.querySelector(".comparison-details").textContent === "", "no cross-agent comparison");
    assert(card.querySelector(".comparison-baseline").value === "", "no cross-agent baseline");
    assert(card.querySelector(".comparison-run").disabled, "other agent has no target");
  }
});

function planJson(tokens = [TOKEN, SPENDER], agent = "DAT", chainId = 8453) {
  return JSON.stringify({ schema: "threecore-token-plan-v1", agent, chainId, tokens });
}

test("token plan export is explicit and contains no account or balance fields", async make => {
  const f = make();
  f.input(".portfolio-tokens", TOKEN + "\n" + SPENDER);
  f.field(".token-plan-save").click();
  const plan = JSON.parse(f.field(".token-plan-json").value);
  assert(plan.tokens.length === 2 && plan.agent === "DAT" && plan.chainId === 8453, "selected context");
  assert(Object.keys(plan).sort().join(",") === "agent,chainId,schema,tokens", "configuration fields only");
  assert(f.calls.length === 0, "export makes no wallet requests");
});

test("token plan preview does not apply or connect automatically", async make => {
  const f = make();
  f.input(".portfolio-tokens", SPENDER);
  f.input(".token-plan-json", planJson([TOKEN]));
  f.field(".token-plan-preview").click();
  assert(f.field(".token-plan-details").textContent.includes(TOKEN), "explicit preview");
  assert(f.field(".portfolio-tokens").value === SPENDER, "old input retained before approval");
  assert(!f.field(".token-plan-apply").disabled, "user can apply reviewed candidate");
  assert(f.calls.length === 0, "preview makes no wallet requests");
});

test("token plan application replaces only the explicit input and requires a separate read", async make => {
  const f = make();
  f.input(".portfolio-tokens", SPENDER);
  f.input(".token-plan-json", planJson([TOKEN]));
  f.field(".token-plan-preview").click();
  f.field(".token-plan-apply").click();
  assert(f.field(".portfolio-tokens").value === TOKEN, "reviewed list applied");
  assert(f.field(".token-plan-apply").disabled, "candidate consumed");
  assert(f.field(".token-plan-status").textContent.includes("まだ行っていません"), "no implicit read");
  assert(f.calls.length === 0, "apply makes no connection or balance request");
});

test("token plan for a different chain is rejected before application", async make => {
  const f = make();
  f.input(".token-plan-json", planJson([TOKEN], "DAT", 84532));
  f.field(".token-plan-preview").click();
  assert(f.field(".token-plan-apply").disabled, "wrong-chain application disabled");
  assert(f.field(".token-plan-status").textContent.includes("同じエージェント・チェーン"), "context hint");
  assert(f.field(".portfolio-tokens").value === "", "input not replaced");
  assert(f.calls.length === 0, "no chain switch or RPC");
});

test("changing plan text invalidates a previously reviewed candidate", async make => {
  const f = make();
  f.input(".token-plan-json", planJson([TOKEN]));
  f.field(".token-plan-preview").click();
  f.input(".token-plan-json", planJson([SPENDER]));
  assert(f.field(".token-plan-apply").disabled, "preview invalidated");
  assert(f.field(".token-plan-details").textContent === "", "old preview cleared");
  f.field(".token-plan-apply").click();
  assert(f.field(".portfolio-tokens").value === "", "changed text not applied implicitly");
});

test("changing selected chain removes the plan candidate and configuration text", async make => {
  const f = make();
  f.input(".token-plan-json", planJson());
  f.field(".token-plan-preview").click();
  f.input(".chain", "84532", "change");
  assert(f.field(".token-plan-json").value === "", "old-context JSON removed");
  assert(f.field(".token-plan-apply").disabled, "old-context apply disabled");
  assert(f.field(".token-plan-details").textContent === "", "old-context preview removed");
});

test("duplicate token plan contracts cannot replace a valid input list", async make => {
  const f = make();
  f.input(".portfolio-tokens", SPENDER);
  f.input(".token-plan-json", planJson([TOKEN, TOKEN]));
  f.field(".token-plan-preview").click();
  assert(f.field(".token-plan-json").getAttribute("aria-invalid") === "true", "invalid plan marker");
  assert(f.field(".token-plan-apply").disabled, "duplicate candidate rejected");
  assert(f.field(".portfolio-tokens").value === SPENDER, "existing list preserved");
});

test("portfolio clear also invalidates the plan preview without provider calls", async make => {
  const f = make();
  f.input(".token-plan-json", planJson());
  f.field(".token-plan-preview").click();
  f.field(".portfolio-clear").click();
  assert(f.field(".token-plan-json").value === "", "JSON cleared");
  assert(f.field(".token-plan-apply").disabled, "candidate cleared");
  assert(f.calls.length === 0, "no implicit provider work");
});

test("applying a new token plan clears completed portfolio and comparison observations", async make => {
  const f = make();
  await prepareComparison(f);
  f.field(".comparison-run").click();
  f.input(".token-plan-json", planJson([SPENDER]));
  f.field(".token-plan-preview").click();
  const before = f.calls.length;
  f.field(".token-plan-apply").click();
  assert(f.field(".portfolio-tokens").value === SPENDER, "new plan applied");
  assert(f.field(".portfolio-details").textContent === "", "old portfolio cleared");
  assert(f.field(".portfolio-export").disabled, "old export disabled");
  assert(f.field(".comparison-details").textContent === "", "old comparison cleared");
  assert(f.calls.length === before, "application itself performs no reads");
});

test("token plan previews cannot spill into another agent card", async make => {
  const f = make();
  f.input(".token-plan-json", planJson());
  f.field(".token-plan-preview").click();
  for (const agent of ["EMA", "CAWELON"]) {
    const card = document.querySelector('[data-agent="' + agent + '"]');
    assert(card.querySelector(".token-plan-json").value === "", "no copied plan");
    assert(card.querySelector(".token-plan-details").textContent === "", "no copied preview");
    assert(card.querySelector(".token-plan-apply").disabled, "no cross-agent candidate");
  }
});

test("portfolio progress shows the current native-balance wait without enabling export", async make => {
  const gate = deferred();
  const f = make(args => args.method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN + "\n" + SPENDER);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  assert(!f.field(".portfolio-progress").hidden, "progress visible while reading");
  assert(f.field(".portfolio-status").textContent.includes("ETH残高"), "specific wait phase");
  assert(f.field(".portfolio-progress").value === 0, "no token completed yet");
  assert(f.field(".portfolio-progress").max === 2, "explicit plan size");
  assert(f.field(".portfolio-export").disabled, "progress is not an exportable result");
  gate.resolve("0x10");
  await waitFor(() => !f.field(".portfolio-export").disabled);
  assert(f.field(".portfolio-progress").hidden, "progress hidden after result");
});

test("portfolio progress counts completed tokens while the next balance is pending", async make => {
  const gate = deferred();
  const f = make(args => args.method === "eth_call" && args.params[0].to === SPENDER ? gate.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN + "\n" + SPENDER);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_call" && call.params[0].to === SPENDER));
  assert(f.field(".portfolio-progress").value === 1, "first token completed");
  assert(f.field(".portfolio-status").textContent.includes("1/2件確認済み"), "bounded token count");
  assert(f.field(".portfolio-status").textContent.includes("2件目"), "current token index");
  gate.resolve(word);
  await waitFor(() => !f.field(".portfolio-export").disabled);
});

test("full token count still waits for canonical-block verification", async make => {
  const gate = deferred();
  const f = make(args => args.method === "eth_getBlockByNumber" && args.params[0] === "0x2a" ? gate.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBlockByNumber" && call.params[0] === "0x2a"));
  assert(f.field(".portfolio-progress").value === 1, "all requested tokens observed");
  assert(f.field(".portfolio-status").textContent.includes("再確認"), "canonical wait is explicit");
  assert(f.field(".portfolio-export").disabled, "not completed before canonical verification");
  gate.resolve({ ...BLOCK });
  await waitFor(() => !f.field(".portfolio-export").disabled);
});

for (const action of [".portfolio-cancel", ".disconnect"]) {
  test("progress cannot resume after " + action, async make => {
    const gate = deferred();
    const f = make(args => args.method === "eth_getBalance" ? gate.promise : undefined);
    await f.connect();
    f.input(".portfolio-tokens", TOKEN);
    f.field(".portfolio-read").click();
    await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
    f.field(action).click();
    const message = f.field(".portfolio-status").textContent;
    gate.resolve("0x10");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert(f.field(".portfolio-progress").hidden, "cancelled progress hidden");
    assert(f.field(".portfolio-progress").value === 0, "old count cleared");
    assert(f.field(".portfolio-status").textContent === message, "no stale stage text");
    assert(f.field(".portfolio-export").disabled, "no obsolete result");
  });
}

test("input changes clear the progress bar before a late provider value arrives", async make => {
  const gate = deferred();
  const f = make(args => args.method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  f.input(".portfolio-tokens", SPENDER);
  gate.resolve("0x10");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(f.field(".portfolio-progress").hidden, "old progress hidden");
  assert(f.field(".portfolio-status").textContent.includes("入力が変わりました"), "input notice retained");
});

test("provider failure removes active progress and keeps retry explicit", async make => {
  const f = make(args => args.method === "eth_call" ? Promise.reject(Error("read failed")) : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
  assert(f.field(".portfolio-progress").hidden, "failed progress hidden");
  assert(!f.field(".portfolio-read").disabled, "manual retry available");
  assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "no automatic reconnect");
});

test("progress stays in its own agent card", async make => {
  const gate = deferred();
  const f = make(args => args.method === "eth_getBalance" ? gate.promise : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.calls.some(call => call.method === "eth_getBalance"));
  for (const agent of ["EMA", "CAWELON"]) {
    const card = document.querySelector('[data-agent="' + agent + '"]');
    assert(card.querySelector(".portfolio-progress").hidden, "other agent stays idle");
    assert(card.querySelector(".portfolio-status").textContent === "未確認", "no progress leak");
  }
  gate.resolve("0x10");
  await waitFor(() => !f.field(".portfolio-export").disabled);
});

test("portfolio duplicate-plan guidance reaches the real card without a provider read", async make => {
  const f = make();
  await f.connect();
  const before = f.calls.length;
  f.input(".portfolio-tokens", TOKEN + "\n" + TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("重複"));
  assert(f.field(".portfolio-progress").hidden, "progress ended after input rejection");
  assert(!f.calls.slice(before).some(call => call.method === "eth_getBalance"), "no invalid-plan balance RPC");
});

test("canonical-block changes give a specific retry hint and no completed export", async make => {
  const f = make(args => args.method === "eth_getBlockByNumber" && args.params[0] === "0x2a"
    ? { ...BLOCK, hash: "0x" + "cd".repeat(32) } : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("ブロックが変わりました"));
  assert(f.field(".portfolio-export").disabled, "reorganized observation rejected");
  assert(f.field(".portfolio-progress").hidden, "no stale completion bar");
});

test("unknown portfolio provider diagnostics are hidden in both the card and panel", async make => {
  const f = make(args => args.method === "eth_call"
    ? Promise.reject({ code: "PRIVATE_INTERNAL", message: "private diagnostic payload" }) : undefined);
  await f.connect();
  f.input(".portfolio-tokens", TOKEN);
  f.field(".portfolio-read").click();
  await waitFor(() => f.field(".portfolio-status").textContent.includes("確認できません"));
  assert(!f.output().includes("private diagnostic"), "card uses a finite label");
  assert(!f.field(".portfolio-status").textContent.includes("private diagnostic"), "panel uses a finite label");
  assert(f.calls.filter(call => call.method === "eth_requestAccounts").length === 1, "no retry side effect");
});

// Negative controls run only on the explicit, isolated browser-test route.
const fault = new URL(location.href).searchParams.get("harness-fault");
if (fault && !["error", "unhandledrejection"].includes(fault)) throw Error("Unknown harness fault");
const unexpectedErrors = [];
let publishSummary = () => {};
function recordUnexpected(kind, message) {
  unexpectedErrors.push({ kind, message });
  const item = document.createElement("li");
  item.textContent = "UNEXPECTED " + kind + ": " + message;
  document.querySelector("#results").append(item);
  console.error(item.textContent);
  publishSummary(); // A late event must invalidate a previously completed result.
}
window.addEventListener("error", event => recordUnexpected("error", readErrorMessage(event)));
window.addEventListener("unhandledrejection", event => recordUnexpected("unhandledrejection", readErrorMessage(event.reason)));
document.body.dataset.injectedFault = "";
if (fault) setTimeout(() => {
  document.body.dataset.injectedFault = fault;
  if (fault === "error") throw Error("Synthetic harness error");
  Promise.reject(Error("Synthetic harness rejection"));
}, 0);

registerHistoryUITests(test);
registerHistoryFileUITests(test);
registerHistoryReviewUITests(test);
registerHistoryRecoveryUITests(test);
registerWalletSetupUITests(test);
registerWorkspaceUITests(test);
registerCheckpointUITests(test);
registerTokenIdentityUITests(test);
registerAllowanceUITests(test);
registerAllowanceBundleUITests(test);
registerTransferUITests(test);
let passed = 0, failed = 0;
const requestedSuite = new URLSearchParams(location.search).get("suite");
const selectedTests = ["history", "checkpoint", "identity", "allowance", "transfer"].includes(requestedSuite)
  ? tests.filter(item => item.name.startsWith(requestedSuite + ":")) : tests;
for (const { name, run } of selectedTests) {
  console.info("Starting synthetic UI case: " + name);
  const fixtures = [];
  const item = document.createElement("li");
  try {
    await run((override, options) => {
      const value = fixture(override, options);
      fixtures.push(value);
      return value;
    });
    item.textContent = "PASS — " + name;
    passed++;
  } catch (error) {
    item.textContent = "FAIL — " + name + ": " + error.message;
    failed++;
  } finally {
    for (const value of fixtures) value.app.dispose();
    document.querySelector("#results").append(item);
    console.info(item.textContent);
  }
}
// Give unhandled rejection reporting a task turn before declaring completion.
await new Promise(resolve => setTimeout(resolve, 0));
publishSummary = () => {
  document.querySelector("#summary").textContent = `${passed} passed / ${failed} failed / ${unexpectedErrors.length} unexpected browser errors`;
  document.body.dataset.testsCount = String(selectedTests.length);
  document.body.dataset.testsPassed = String(passed);
  document.body.dataset.testsFailed = String(failed);
  document.body.dataset.unexpectedErrors = String(unexpectedErrors.length);
  document.body.dataset.errorKinds = unexpectedErrors.map(item => item.kind).join(",");
  document.body.dataset.suiteStatus = failed || unexpectedErrors.length ? "failed" : "passed";
};
publishSummary();
// Only the isolated CI runner accepts this nonce-scoped completion receipt.
// Report after actual IndexedDB/File tasks finish, without a virtual-time budget.
const receipt = new URLSearchParams(location.search).get("ci-report");
if (receipt && /^[a-f0-9-]{36}$/.test(receipt)) {
  await new Promise(resolve => setTimeout(resolve, 50));
  await fetch("/test/browser/ci-result/" + receipt, {
    method: "POST", headers: { "Content-Type": "text/html" },
    body: document.documentElement.outerHTML,
  });
}










