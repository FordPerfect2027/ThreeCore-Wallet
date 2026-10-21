import { mountWalletDemo } from "/examples/wallet-demo.js";
import { readErrorMessage } from "/src/provider-error.js";

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
function fixture(override = () => undefined, { legacy = true, announced = false } = {}) {
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
    document, eventTarget, siteOrigin: location.origin, getLegacyProvider: () => legacy ? provider : undefined,
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

test("無応答の読み取りを30秒で終了し、再接続後に古い応答を表示しない", async use => {
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

test("接続確認の無応答を30秒で終了し、明示的な再接続で復帰する", async use => {
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

test("許可待ちを120秒で終了し、残っている許可要求を重複させない", async use => {
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

let passed = 0, failed = 0;
for (const { name, run } of tests) {
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
  document.body.dataset.testsCount = String(tests.length);
  document.body.dataset.testsPassed = String(passed);
  document.body.dataset.testsFailed = String(failed);
  document.body.dataset.unexpectedErrors = String(unexpectedErrors.length);
  document.body.dataset.errorKinds = unexpectedErrors.map(item => item.kind).join(",");
  document.body.dataset.suiteStatus = failed || unexpectedErrors.length ? "failed" : "passed";
};
publishSummary();
