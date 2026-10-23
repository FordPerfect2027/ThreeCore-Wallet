import { mountTransferPanel } from "/examples/transfer-panel.js";
import { mountWalletDemo } from "/examples/wallet-demo.js";
import { encodeTransferFile } from "/src/transfer-file.js";
import { ACCOUNT, OTHER, REQUEST, context, deferred, event, providerFixture, snapshot } from "/test/helpers/transfer-fixtures.js";

const assert = (value, message = "Assertion failed") => { if (!value) throw Error(message); };
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Transfer UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function panel(options = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const downloads = [];
  let reads = 0;
  const mounted = mountTransferPanel({ document, parent: host, getContext: () => context(),
    read: async () => { reads++; return snapshot(); }, download: file => downloads.push(file), ...options });
  const q = name => host.querySelector(".transfer-" + name);
  return { q, host, downloads, mounted, get reads() { return reads; },
    async inspect() { q("read").click(); await waitFor(() => q("panel").getAttribute("aria-busy") === "false"); },
    input(name, value, type = "input") { q(name).value = value; q(name).dispatchEvent(new Event(type, { bubbles: true })); },
    async import(text, target = "snapshot") {
      q("import-target").value = target;
      const files = new DataTransfer();
      files.items.add(new File([text], "transfers.json", { type: "application/json" }));
      q("file").files = files.files;
      q("file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
    },
    dispose() { mounted.dispose(); host.remove(); },
  };
}

export function registerTransferUITests(test) {
  test("transfer: initial native DOM state performs no automatic read", async () => {
    const f = panel();
    try {
      assert(f.reads === 0);
      assert(f.q("save-json").disabled);
      assert(f.q("file").labels.length === 1);
      assert(f.q("status").getAttribute("aria-live") === "polite");
    } finally { f.dispose(); }
  });

  test("transfer: filters and pages use exact event amounts", async () => {
    const f = panel({ read: async () => snapshot({ events: Array.from({ length: 22 }, (_, index) => event({}, index)) }) });
    try {
      await f.inspect();
      assert(f.q("rows").children.length === 10);
      assert(f.q("row-details").textContent.includes("1234567890123456789"));
      f.q("next").click();
      assert(f.q("counter").textContent.includes("2ページ目"));
      f.input("direction", "outgoing", "change");
      assert(f.q("rows").children.length === 1 && f.q("empty"));
      assert(f.q("previous").disabled);
      f.input("direction", "incoming", "change");
      f.input("search", event().transactionHash);
      assert(f.q("counter").textContent.startsWith("1件"));
    } finally { f.dispose(); }
  });

  test("transfer: native File round-trip requires preview and does not reconnect", async () => {
    const f = panel();
    try {
      await f.inspect();
      f.q("save-json").click();
      await waitFor(() => f.downloads.length === 1);
      const text = f.downloads[0].text;
      f.q("clear").click();
      await f.import(text);
      assert(!f.q("apply").disabled);
      assert(f.q("summary").textContent === "");
      assert(f.q("file").value === "");
      f.q("apply").click();
      assert(f.q("summary").textContent.includes("現在のチェーン状態は未確認"));
      assert(f.reads === 1);
    } finally { f.dispose(); }
  });

  test("transfer: previous-window action changes draft without a provider read", async () => {
    const f = panel();
    try {
      await f.inspect();
      f.q("window-previous").click();
      assert(f.q("from").value === "17");
      assert(f.q("to").value === "29");
      assert(f.q("summary").textContent.includes("30 ～ 42"));
      assert(f.q("window-status").textContent.includes("新しい履歴"));
      assert(f.reads === 1);
    } finally { f.dispose(); }
  });

  test("transfer: corruption is refused without replacing prior observation", async () => {
    const f = panel();
    try {
      await f.inspect();
      const raw = JSON.parse(await encodeTransferFile(snapshot({ events: [] })));
      raw.digest = "0".repeat(64);
      await f.import(JSON.stringify(raw));
      assert(f.q("status").textContent.includes("チェックサム"));
      assert(f.q("summary").textContent.includes("1取引"));
      assert(f.q("apply").disabled);
    } finally { f.dispose(); }
  });

  test("transfer: baseline comparison shows additions without sending a transaction", async () => {
    const f = panel();
    try {
      await f.inspect();
      await f.import(await encodeTransferFile(snapshot({ events: [] })), "baseline");
      f.q("apply").click();
      f.q("compare").click();
      assert(f.q("comparison").textContent.includes("追加 1件"));
      assert(f.reads === 1);
    } finally { f.dispose(); }
  });

  test("transfer: literal search strings cannot add HTML nodes", async () => {
    const f = panel();
    try {
      await f.inspect();
      f.input("search", "<img src=x onerror=alert(1)>");
      assert(f.host.querySelector("img") === null);
      assert(f.q("empty").textContent.includes("該当する記録"));
    } finally { f.dispose(); }
  });

  test("transfer: explicit cancel prevents late RPC result from appearing", async () => {
    const pending = deferred();
    let signal;
    const f = panel({ read: (request, options) => { signal = options.signal; return pending.promise; } });
    try {
      f.q("read").click();
      assert(f.q("read").disabled);
      f.q("cancel").click();
      assert(signal.aborted);
      pending.resolve(snapshot());
      await new Promise(resolve => setTimeout(resolve, 10));
      assert(f.q("summary").textContent === "");
    } finally { f.dispose(); }
  });

  test("transfer: archive export, native file preview and replacement stay offline", async () => {
    const f = panel();
    try {
      await f.inspect();
      f.q("archive-add").click();
      f.q("archive-save").click();
      await waitFor(() => f.downloads.length === 1);
      const text = f.downloads[0].text;
      f.q("archive-clear").click();
      const data = new DataTransfer();
      data.items.add(new File([text], "transfer-archive.json", { type: "application/json" }));
      f.q("archive-file").files = data.files;
      f.q("archive-file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !f.q("archive-apply").disabled);
      assert(f.q("archive-overview").textContent === "");
      f.q("archive-apply").click();
      assert(f.q("archive-overview").textContent.includes("1記録"));
      assert(f.reads === 1);
    } finally { f.dispose(); }
  });

  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    for (const chainId of [8453, 84532]) {
      test(`transfer: integrated ${agent} ${chainId} card reads registered token and clears on disconnect`, async () => {
        const selected = context(agent, chainId);
        const f = providerFixture({ selected, siteOrigin: location.origin });
        const app = mountWalletDemo({ document, eventTarget: new EventTarget(), siteOrigin: location.origin,
          getLegacyProvider: () => f.provider });
        try {
          const card = document.querySelector(`[data-agent="${agent}"]`);
          const q = selector => card.querySelector(selector);
          q(".account").value = ACCOUNT;
          q(".account").dispatchEvent(new Event("input", { bubbles: true }));
          q(".chain").value = String(chainId);
          q(".chain").dispatchEvent(new Event("change", { bubbles: true }));
          q(".connect").click();
          await waitFor(() => !q(".read").disabled);
          q(".transfer-from").value = REQUEST.fromBlock;
          q(".transfer-to").value = REQUEST.toBlock;
          q(".transfer-read").click();
          await waitFor(() => !q(".transfer-save-json").disabled);
          assert(q(".transfer-summary").textContent.includes(agent));
          assert(q(".transfer-summary").textContent.includes(f.observed.tokenAddress));
          assert(!q("output").textContent.includes("undefined"));
          assert(!q("output").textContent.includes("コードが見つかりません"));
          assert(f.calls.filter(call => call.method === "eth_getLogs").length === 2);
          q(".transfer-archive-add").click();
          f.provider.account = OTHER;
          f.provider.emit("accountsChanged", [OTHER]);
          assert(q(".transfer-summary").textContent === "");
          assert(q(".transfer-archive-overview").textContent === "");
          assert(q(".transfer-save-json").disabled);
          assert(f.calls.every(call => !["eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain"].includes(call.method)));
        } finally { app.dispose(); f.session.disconnect(); }
      });
    }
  }
}
