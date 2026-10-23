import { mountWalletDemo } from "/examples/wallet-demo.js";
import { mountTransferVaultPanel } from "/examples/transfer-vault-panel.js";
import { createVaultStorage, VAULT_DATABASE } from "/src/transfer-vault-storage.js";
import { createCheckpointStorage, CHECKPOINT_DATABASE } from "/src/checkpoint-storage.js";
import { bundleFor, saveOperation, id, TIME } from "/test/helpers/vault-fixtures.js";
import { prepareVaultFile } from "/src/transfer-vault-file.js";
import { vaultKey } from "/src/transfer-vault-model.js";
import { prepareTransferArchive } from "/src/transfer-archive-file.js";
import { encodeTransferFile } from "/src/transfer-file.js";
import { mountTransferPanel } from "/examples/transfer-panel.js";
import { context, snapshot, deferred } from "/test/helpers/transfer-fixtures.js";

const assert = (value, message = "Vault assertion failed") => { if (!value) throw Error(message); };
async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 6000) throw Error("Vault UI timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function rejectCode(promise, code) {
  try { await promise; } catch (error) { assert(error.code === code, "Expected " + code + ", got " + error.code); return; }
  throw Error("Expected rejection " + code);
}
function request(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Isolated database blocked"));
  });
}

async function isolated(run) {
  const name = "threecore-test-transfer-vault-" + crypto.randomUUID();
  const adapters = [], rawConnections = [];
  function storage() {
    const value = createVaultStorage({ indexedDB, name, openTimeoutMs: 3000 });
    adapters.push(value);
    return value;
  }
  async function raw() {
    const db = await request(indexedDB.open(name, 1));
    rawConnections.push(db);
    return db;
  }
  try { await run({ name, storage, raw }); }
  finally {
    adapters.forEach(adapter => adapter.close());
    rawConnections.forEach(db => db.close());
    // Only this randomly named synthetic database is removed.
    await request(indexedDB.deleteDatabase(name));
  }
}

function panel(storage, overrides = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  let serial = 0, cards = bundleFor();
  const downloads = [], stages = [];
  const mounted = mountTransferVaultPanel({ document, parent, storage,
    readCards: () => cards, stageArchive: async (...args) => { stages.push(args); return true; },
    download: file => downloads.push(file), now: () => TIME, createId: () => id(++serial), ...overrides });
  const q = name => parent.querySelector(".transfer-vault-" + name);
  return { parent, q, downloads, stages, mounted,
    setCards(value) { cards = value; },
    async click(name) {
      assert(!q(name).disabled, "Disabled vault button " + name);
      q(name).click();
      await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
    },
    input(name, value, type = "input") { q(name).value = value; q(name).dispatchEvent(new Event(type, { bubbles: true })); },
    check(name) { q(name).checked = true; q(name).dispatchEvent(new Event("change", { bubbles: true })); },
    async capture() { await this.click("capture"); await this.click("apply"); },
    async save() { await this.click("refresh"); this.input("label", "Native vault test"); await this.click("save"); },
    async file(text, name = "file") {
      const files = new DataTransfer();
      files.items.add(new File([text], "history.json", { type: "application/json" }));
      q(name).files = files.files;
      q(name).dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
}

export function registerVaultUITests(test) {
  test("vault: native IndexedDB survives close and reopen with all three histories", async () => isolated(async ({ storage }) => {
    const first = storage();
    assert((await first.read()).entries.length === 0);
    const saved = await first.change(0, saveOperation());
    first.close();
    const restored = await storage().read();
    assert(restored.revision === 1);
    assert(vaultKey(restored.entries[0].bundle) === vaultKey(saved.entries[0].bundle));
    assert(restored.entries[0].bundle.slots.every(slot => slot.archive));
  }));

  test("vault: competing native transactions cannot overwrite one another", async () => isolated(async ({ storage }) => {
    const left = storage(), right = storage();
    await Promise.all([left.read(), right.read()]);
    const outcomes = await Promise.allSettled([left.change(0, saveOperation(bundleFor(["DAT"]), 1)), right.change(0, saveOperation(bundleFor(["EMA"]), 2))]);
    assert(outcomes.filter(row => row.status === "fulfilled").length === 1);
    const failure = outcomes.find(row => row.status === "rejected").reason;
    assert(failure.code === "TRANSFER_VAULT_STALE");
    assert((await left.read()).entries.length === 1);
  }));

  test("vault: cancellation after queueing a native write rolls it back", async () => isolated(async ({ storage }) => {
    const adapter = storage(), aborter = new AbortController();
    await adapter.read();
    await rejectCode(adapter.change(0, saveOperation(), { signal: aborter.signal,
      canCommit: () => { queueMicrotask(() => aborter.abort()); return true; } }), "CHECKPOINT_CANCELLED");
    assert((await adapter.read()).entries.length === 0);
  }));

  test("vault: native corrupt data is refused without deleting or repairing it", async () => isolated(async ({ storage, raw }) => {
    const adapter = storage();
    await adapter.read();
    const db = await raw();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readwrite");
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.objectStore("checkpoints").put({ sentinel: "preserve me" }, "current");
    });
    await rejectCode(adapter.read(), "TRANSFER_SHAPE");
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", "readonly");
      let result;
      tx.objectStore("checkpoints").get("current").onsuccess = event => { result = event.target.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
    });
    assert(value.sentinel === "preserve me");
  }));

  test("vault: data is origin-scoped and uses a separate named database", async () => {
    assert(VAULT_DATABASE !== CHECKPOINT_DATABASE);
    await isolated(async ({ storage }) => {
      const adapter = storage();
      await adapter.change(0, saveOperation());
      assert((await adapter.read()).schema === "threecore.transfer-vault-storage.v1");
    });
  });

  test("vault: native archive and explicit purge preserve the other entry", async () => isolated(async ({ storage }) => {
    const adapter = storage();
    await adapter.change(0, saveOperation(bundleFor(["DAT"]), 1));
    await adapter.change(1, saveOperation(bundleFor(["EMA"]), 2));
    await adapter.change(2, { kind: "archive", id: id(1), time: TIME });
    await rejectCode(adapter.change(3, { kind: "purge", id: id(1), confirmed: false }), "TRANSFER_VAULT_CONFIRMATION");
    const after = await adapter.change(3, { kind: "purge", id: id(1), confirmed: true });
    assert(after.entries.length === 1 && after.entries[0].id === id(2));
    assert(after.revision === 4);
  }));

  test("vault: panel persistence requires explicit load and review after remount", async () => isolated(async ({ storage }) => {
    const first = panel(storage());
    try { await first.capture(); await first.save(); }
    finally { first.dispose(); }
    const second = panel(storage());
    try {
      assert(second.q("export-json").disabled);
      assert(second.q("stored").options.length === 1);
      await second.click("refresh");
      second.input("stored", id(1), "change");
      await second.click("inspect");
      assert(second.q("export-json").disabled);
      assert(second.q("review").textContent.includes("PC内の保存"));
      await second.click("apply");
      assert(!second.q("export-json").disabled);
      assert(second.q("overview").textContent.includes("CAWELON"));
    } finally { second.dispose(); }
  }));

  test("vault: native file input restores with preview and accessible labels", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      assert(f.q("file").labels.length === 1);
      assert(f.q("acknowledge").labels.length === 1);
      await f.file((await prepareVaultFile(bundleFor())).text);
      assert(!f.q("apply").disabled);
      assert(f.q("export-json").disabled);
      assert(f.q("file").value === "");
      await f.click("apply");
      assert(f.q("rows").children.length === 3);
      assert(f.q("overview").textContent.includes("残高・損益・完全な取引履歴ではありません"));
    } finally { f.dispose(); }
  }));

  test("vault: replacing a working copy requires a fresh removal acknowledgement", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      await f.capture();
      await f.file((await prepareVaultFile(bundleFor(["DAT"]))).text);
      assert(f.q("apply").disabled);
      f.check("acknowledge");
      await f.click("apply");
      assert(f.q("overview").textContent.includes("EMA\n記録なし"));
      assert((await storage().read()).entries.length === 0);
    } finally { f.dispose(); }
  }));

  test("vault: native search and paging do not conflate token amounts", async () => isolated(async ({ storage }) => {
    const f = panel(storage(), { readCards: () => bundleFor(undefined, { count: 22 }) });
    try {
      await f.capture();
      await f.click("next");
      assert(f.q("counter").textContent.includes("2ページ目"));
      f.input("agent", "CAWELON", "change");
      assert(f.q("counter").textContent.includes("22件 / 1ページ目"));
      assert([...f.q("rows").children].every(row => row.textContent.startsWith("CAWELON")));
      f.input("search", "<img src=x onerror=alert(1)>");
      assert(f.parent.querySelector("img") === null);
      assert(f.q("counter").textContent.startsWith("0件"));
    } finally { f.dispose(); }
  }));

  test("vault: bundle and collection downloads contain separate formats", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      await f.capture();
      await f.save();
      await f.click("export-json");
      await waitFor(() => f.downloads.length === 1);
      await f.click("collection-export");
      await waitFor(() => f.downloads.length === 2);
      assert(JSON.parse(f.downloads[0].text).schema === "threecore.transfer-vault-file.v1");
      assert(JSON.parse(f.downloads[1].text).schema === "threecore.transfer-vault-collection.v1");
      assert(JSON.parse(f.downloads[1].text).document.revision === 0);
    } finally { f.dispose(); }
  }));

  test("vault: importing a collection twice does not multiply native saved records", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      await f.capture();
      await f.save();
      await f.click("collection-export");
      await waitFor(() => f.downloads.length === 1);
      for (let i = 0; i < 2; i++) {
        await f.file(f.downloads[0].text, "collection-file");
        assert(f.q("collection-review").textContent.includes("完全に一致する既存の記録: 1件"));
        await f.click("collection-apply");
      }
      assert((await storage().read()).entries.length === 1);
    } finally { f.dispose(); }
  }));

  test("vault: stale tab reports conflict and retains both historical working copies", async () => isolated(async ({ storage }) => {
    const left = panel(storage()), right = panel(storage(), { createId: () => id(2) });
    try {
      await left.capture(); await right.capture();
      await left.click("refresh"); await right.click("refresh");
      left.input("label", "Left"); right.input("label", "Right");
      await left.click("save"); await right.click("save");
      assert(right.q("status").textContent.includes("別の画面で保管庫が変更"));
      assert(!right.q("export-json").disabled);
      assert((await storage().read()).entries.length === 1);
    } finally { left.dispose(); right.dispose(); }
  }));

  test("vault: archived entry export remains available and purge resets selection", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      await f.capture(); await f.save(); await f.click("archive");
      assert(f.q("inspect").disabled && !f.q("stored-export").disabled);
      assert(f.q("purge").disabled);
      f.check("purge-ack");
      await f.click("purge");
      assert(f.q("stored").value === "");
      assert((await storage().read()).entries.length === 0);
    } finally { f.dispose(); }
  }));

  for (const kind of ["snapshot", "archive"]) {
    test("vault: native legacy " + kind + " file remains supported", async () => isolated(async ({ storage }) => {
      const f = panel(storage());
      try {
        const archive = bundleFor(["EMA"]).slots[1].archive;
        const text = kind === "snapshot" ? await encodeTransferFile(archive.records[0]) : (await prepareTransferArchive(archive)).text;
        f.input("file-kind", kind, "change");
        f.input("legacy-agent", "EMA", "change");
        await f.file(text);
        await f.click("apply");
        assert(f.q("overview").textContent.includes("EMA\nチェーン"));
        assert(f.q("overview").textContent.includes("DAT\n記録なし"));
      } finally { f.dispose(); }
    }));
  }

  test("vault: card restore requires matching account and explicit archive apply", async () => isolated(async ({ storage }) => {
    const cardHost = document.createElement("div");
    document.body.append(cardHost);
    let reads = 0;
    const card = mountTransferPanel({ document, parent: cardHost, getContext: () => context(), read: async () => { reads++; return snapshot(); } });
    const f = panel(storage(), { stageArchive: (agent, archive, options) => card.stageArchive(archive, options) });
    try {
      await f.capture();
      await f.click("stage-card");
      assert(cardHost.querySelector(".transfer-archive-panel").open);
      assert(cardHost.querySelector(".transfer-archive-overview").textContent === "");
      cardHost.querySelector(".transfer-archive-apply").click();
      assert(cardHost.querySelector(".transfer-archive-overview").textContent.includes("1記録"));
      assert(reads === 0);
      f.input("restore-agent", "EMA", "change");
      await f.click("stage-card");
      assert(f.q("status").textContent.includes("カードにプレビューできません"));
    } finally { f.dispose(); card.dispose(); cardHost.remove(); }
  }));

  test("vault: cancelled asynchronous file read cannot restore data", async () => isolated(async ({ storage }) => {
    const pending = deferred();
    const subtle = { digest: () => pending.promise };
    const text = (await prepareVaultFile(bundleFor())).text;
    const f = panel(storage(), { subtle });
    try {
      const loading = f.file(text);
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "true");
      await f.click("cancel");
      pending.resolve(new ArrayBuffer(32));
      await loading;
      assert(f.q("apply").disabled);
      assert(f.q("export-json").disabled);
    } finally { f.dispose(); }
  }));

  test("vault: undo and redo update the screen while retaining the native saved entry", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      assert(f.q("undo").disabled && f.q("redo").disabled);
      await f.capture();
      await f.save();
      const saved = await storage().read();
      await f.click("undo");
      assert(f.q("export-json").disabled);
      assert(f.q("status").textContent.includes("保存済みの記録は変更していません"));
      assert(f.q("undo").disabled && !f.q("redo").disabled);
      await f.click("redo");
      assert(!f.q("export-json").disabled);
      assert(f.q("overview").textContent.includes("CAWELON"));
      assert(JSON.stringify(await storage().read()) === JSON.stringify(saved));
    } finally { f.dispose(); }
  }));

  test("vault: undo invalidates a destructive preview and its acknowledgement", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      await f.capture();
      await f.file((await prepareVaultFile(bundleFor(["DAT"]))).text);
      f.check("acknowledge");
      assert(!f.q("apply").disabled);
      await f.click("undo");
      assert(f.q("apply").disabled);
      assert(!f.q("acknowledge").checked);
      assert(f.q("review").textContent === "");
      await f.click("redo");
      assert(f.q("apply").disabled);
      assert(f.q("overview").textContent.includes("EMA\nチェーン"));
    } finally { f.dispose(); }
  }));

  test("vault: undo is volatile across remount and never restores itself from storage", async () => isolated(async ({ storage }) => {
    const first = panel(storage());
    try { await first.capture(); await first.save(); await first.click("undo"); }
    finally { first.dispose(); }
    const second = panel(storage());
    try {
      assert(second.q("undo").disabled && second.q("redo").disabled);
      await second.click("refresh");
      assert(second.q("stored").options.length === 2);
      assert(second.q("export-json").disabled);
      second.input("stored", id(1), "change");
      await second.click("inspect"); await second.click("apply");
      assert(!second.q("undo").disabled);
    } finally { second.dispose(); }
  }));

  test("vault: additive import after undo starts a new branch without affecting stored data", async () => isolated(async ({ storage }) => {
    const f = panel(storage());
    try {
      f.setCards(bundleFor(["DAT"]));
      await f.capture(); await f.save();
      f.setCards(bundleFor());
      await f.capture();
      await f.click("undo");
      f.input("strategy", "merge", "change");
      await f.file((await prepareVaultFile(bundleFor(["EMA"]))).text);
      await f.click("apply");
      assert(f.q("redo").disabled);
      assert(f.q("overview").textContent.includes("CAWELON\n記録なし"));
      assert(f.q("overview").textContent.includes("EMA\nチェーン"));
      const saved = (await storage().read()).entries[0].bundle;
      assert(saved.slots[0].archive && saved.slots[1].archive === null);
    } finally { f.dispose(); }
  }));

  test("vault: filtered CSV exports all matches beyond the visible page", async () => isolated(async ({ storage }) => {
    const f = panel(storage(), { readCards: () => bundleFor(undefined, { count: 23 }) });
    try {
      assert(f.q("filtered-export").disabled);
      await f.capture();
      f.input("agent", "EMA", "change");
      await f.click("next");
      assert(f.q("rows").children.length === 3);
      await f.click("filtered-export");
      await waitFor(() => f.downloads.length === 1);
      const file = f.downloads[0];
      assert(file.filename === "ThreeCore-filtered-transfer-activity.csv");
      assert(file.matched === 23);
      const rows = file.text.trimEnd().split("\r\n").slice(1);
      assert(rows.length === 23 && rows.every(row => row.startsWith('"EMA",')));
      assert(f.q("counter").textContent.includes("2ページ目"));
      f.input("search", "unmatched");
      assert(f.q("filtered-export").disabled);
      assert((await storage().read()).entries.length === 0);
    } finally { f.dispose(); }
  }));

  for (const chainId of [8453, 84532]) {
    test("vault: integrated three-card capture, persistence and invalidation on chain " + chainId, async () => isolated(async ({ storage }) => {
      let providerCalls = 0;
      const provider = { request: async () => { providerCalls++; throw Error("No RPC allowed in import workflow"); } };
      const adapter = storage();
      const app = mountWalletDemo({ document, eventTarget: new EventTarget(), siteOrigin: location.origin,
        getLegacyProvider: () => provider, transferVaultStorage: adapter });
      const q = name => document.querySelector(".transfer-vault-" + name);
      try {
        assert(q("panel"));
        assert(q("metadata").textContent.includes("まだ開いていません"));
        for (const slot of bundleFor(undefined, { chainId }).slots) {
          const card = document.querySelector('[data-agent="' + slot.agent + '"]');
          const selected = slot.archive.records[0].context;
          for (const [selector, value, eventType] of [[".account", selected.account, "input"], [".chain", String(chainId), "change"]]) {
            card.querySelector(selector).value = value;
            card.querySelector(selector).dispatchEvent(new Event(eventType, { bubbles: true }));
          }
          const files = new DataTransfer();
          files.items.add(new File([await encodeTransferFile(slot.archive.records[0])], "history.json", { type: "application/json" }));
          const file = card.querySelector(".transfer-file");
          file.files = files.files;
          file.dispatchEvent(new Event("change", { bubbles: true }));
          await waitFor(() => !card.querySelector(".transfer-apply").disabled);
          card.querySelector(".transfer-apply").click();
          assert(card.querySelector(".transfer-summary").textContent.includes(slot.agent));
          card.querySelector(".transfer-archive-add").click();
          assert(card.querySelector(".transfer-archive-overview").textContent.includes("1記録"));
        }
        q("capture").click();
        for (const agent of ["DAT", "EMA", "CAWELON"]) assert(q("review").textContent.includes(agent + ": 追加 1期間"));
        q("apply").click();
        await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
        assert(q("overview").textContent.includes("チェーン " + chainId));
        q("refresh").click();
        await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
        q("label").value = "Three integrated cards";
        q("save").click();
        await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
        assert(q("status").textContent.includes("PC内への保存が完了"));
        const persisted = await adapter.read();
        assert(persisted.entries.length === 1);
        const saved = persisted.entries[0].bundle;
        assert(saved.slots.every(slot => slot.archive.records.length === 1));
        assert(new Set(saved.slots.map(slot => slot.archive.records[0].context.account)).size === 3);
        assert(saved.slots.every(slot => slot.archive.records[0].context.chainId === chainId));

        q("capture").click();
        assert(!q("apply").disabled);
        const datAccount = document.querySelector('[data-agent="DAT"] .account');
        datAccount.value = "0x" + "44".repeat(20);
        datAccount.dispatchEvent(new Event("input", { bubbles: true }));
        assert(q("apply").disabled);
        assert(q("status").textContent.includes("カードの状態が変わっています"));
        assert(q("overview").textContent.includes(saved.slots[0].archive.records[0].context.account));
        assert(JSON.stringify(await adapter.read()) === JSON.stringify(persisted));

        q("restore-agent").value = "EMA";
        q("restore-agent").dispatchEvent(new Event("change", { bubbles: true }));
        q("stage-card").click();
        await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
        const ema = document.querySelector('[data-agent="EMA"]');
        assert(ema.querySelector(".transfer-archive-panel").open);
        assert(!ema.querySelector(".transfer-archive-apply").disabled);
        assert(providerCalls === 0);
      } finally { app.dispose(); }
      assert(document.querySelector(".transfer-vault-panel") === null);
    }));
  }
}
