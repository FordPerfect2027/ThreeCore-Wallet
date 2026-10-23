import { createPeriodLibraryStorage } from "/src/period-library-storage.js";
import { mountPeriodLibraryPanel } from "/examples/period-library-panel.js";
import { mountPeriodPanel } from "/examples/period-panel.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "/src/period-library-file.js";
import { collectPeriod } from "/src/period-reader.js";
import {
  library, entry, sampleLibrary, saveOperation, id, LATER, checkpoint, plan, context,
  memoryStorage, deferred, randomLibraryName,
} from "/test/helpers/period-library-fixtures.js";
import { periodSession } from "/test/helpers/period-fixtures.js";

const assert = (value, message = "Period library UI assertion failed") => { if (!value) throw Error(message); };
async function waitFor(predicate) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 6000) throw Error("Period library UI timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function request(value) {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
    value.onblocked = () => reject(Error("Test database blocked"));
  });
}
async function database(callback) {
  const name = randomLibraryName("browser");
  const adapters = [], connections = [];
  const connect = () => {
    const adapter = createPeriodLibraryStorage({ indexedDB, name });
    adapters.push(adapter);
    return adapter;
  };
  const raw = async () => {
    const connection = await request(indexedDB.open(name, 1));
    connections.push(connection);
    return connection;
  };
  try { await callback({ name, connect, raw }); }
  finally {
    adapters.forEach(adapter => adapter.close());
    connections.forEach(connection => connection.close());
    // Only this test's random database is removed.
    await request(indexedDB.deleteDatabase(name));
  }
}
function fixture(options = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const store = options.store ?? memoryStorage(options.initial);
  const files = [], restored = [];
  let current = { draft: checkpoint(3), requiresNewPlan: false }, number = 20;
  const mounted = mountPeriodLibraryPanel({
    document, parent, storage: store.storage,
    getCheckpoint: () => current,
    stageCheckpoint: (draft, metadata) => { restored.push({ draft, metadata }); return true; },
    download: value => files.push(value), now: () => LATER, createId: () => id(++number),
    ...options.panel,
  });
  const q = name => parent.querySelector(".period-library-" + name);
  const settled = () => waitFor(() => q("panel").getAttribute("aria-busy") === "false");
  const f = {
    parent, store, files, restored, mounted, q, settled,
    source(value) { current = value; },
    click(name) { assert(!q(name).disabled, "Disabled " + name); q(name).click(); },
    input(name, value, event = "input") {
      q(name).value = value; q(name).dispatchEvent(new Event(event, { bubbles: true }));
    },
    async open() { f.click("refresh"); await settled(); },
    select(label) {
      const button = [...q("rows").querySelectorAll("button")].find(element =>
        element.getAttribute("aria-label") === "控えを選択: " + label);
      assert(button, "Missing saved row");
      button.click();
    },
    async file(text) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], "period-library.json", { type: "application/json" }));
      q("file").files = transfer.files;
      q("file").dispatchEvent(new Event("change", { bubbles: true }));
      await settled();
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
  return f;
}

export function registerPeriodLibraryUITests(test) {
  test("period library: IndexedDB remains unopened until explicit read", () => database(async ({ name, connect }) => {
    const adapter = connect();
    const before = await indexedDB.databases();
    assert(!before.some(row => row.name === name));
    const initial = await adapter.read();
    assert(initial.entries.length === 0 && initial.revision === 0);
    assert((await indexedDB.databases()).some(row => row.name === name));
  }));

  test("period library: native persistence survives a closed and reopened adapter", () => database(async ({ connect }) => {
    const first = connect();
    await first.change(0, saveOperation());
    first.close();
    const next = connect();
    const saved = await next.read();
    assert(saved.revision === 1 && saved.entries.length === 1);
    assert(saved.entries[0].draft.earlier.blockNumber === "30");
  }));

  test("period library: native transaction isolation rejects a stale simultaneous writer", () => database(async ({ connect }) => {
    const one = connect(), two = connect();
    await Promise.all([one.read(), two.read()]);
    const results = await Promise.allSettled([
      one.change(0, saveOperation(1, checkpoint(2))),
      two.change(0, saveOperation(2, checkpoint(5))),
    ]);
    assert(results.filter(row => row.status === "fulfilled").length === 1);
    assert(results.find(row => row.status === "rejected").reason.code === "PERIOD_LIBRARY_STALE");
    const after = await one.read();
    assert(after.entries.length === 1 && after.revision === 1);
  }));

  test("period library: malformed native storage is preserved for recovery", () => database(async ({ connect, raw }) => {
    const adapter = connect();
    await adapter.read();
    const db = await raw();
    const tx = db.transaction("checkpoints", "readwrite");
    tx.objectStore("checkpoints").put({ unknown: "do not erase" }, "current");
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
    const failure = await adapter.read().catch(error => error);
    assert(failure.code === "PERIOD_SHAPE");
    const check = db.transaction("checkpoints", "readonly");
    const completed = new Promise((resolve, reject) => { check.oncomplete = resolve; check.onabort = reject; });
    const retained = await request(check.objectStore("checkpoints").get("current"));
    await completed;
    assert(retained.unknown === "do not erase");
  }));

  test("period library: aborted native write leaves previous records unchanged", () => database(async ({ connect }) => {
    const adapter = connect();
    await adapter.change(0, saveOperation());
    const aborter = new AbortController();
    aborter.abort();
    const failure = await adapter.change(1, saveOperation(2, checkpoint(5)), { signal: aborter.signal }).catch(error => error);
    assert(failure.code === "CHECKPOINT_CANCELLED");
    assert((await adapter.read()).entries.length === 1);
  }));

  test("period library: native import conflict is atomic", () => database(async ({ connect }) => {
    const adapter = connect();
    await adapter.change(0, saveOperation());
    const failure = await adapter.change(1, {
      kind: "import", entries: [entry(2), entry(1, { label: "Conflict" })],
    }).catch(error => error);
    assert(failure.code === "PERIOD_LIBRARY_IMPORT_CONFLICT");
    assert((await adapter.read()).entries.length === 1);
  }));

  test("period library: archive and quarantine survive native reopen", () => database(async ({ connect }) => {
    const adapter = connect();
    await adapter.change(0, { kind: "import", entries: sampleLibrary().entries });
    adapter.close();
    const saved = await connect().read();
    assert(saved.entries[2].requiresNewPlan === true);
    assert(saved.entries[3].archived === true);
  }));

  test("period library: UI mounts without reading storage or connecting a wallet", async () => {
    const f = fixture();
    try {
      assert(f.store.calls.length === 0);
      assert(f.q("save").disabled && f.q("file").disabled);
      assert(f.q("status").getAttribute("aria-live") === "polite");
      assert(f.q("notice").textContent.includes("暗号化されていません"));
    } finally { f.dispose(); }
  });

  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test("period library: visible native save and remount for " + agent, () => database(async ({ connect }) => {
      const selected = plan({}, context(agent));
      const first = fixture({ panel: { storage: connect(), getCheckpoint: () => ({ draft: checkpoint(3, selected), requiresNewPlan: false }) } });
      try {
        await first.open();
        first.input("label", agent + " saved");
        first.click("save");
        assert(first.mounted.getDocument().entries.length === 0);
        assert(!first.q("review").hidden);
        first.click("apply"); await first.settled();
        assert(first.mounted.getDocument().entries.length === 1);
      } finally { first.dispose(); }
      const second = fixture({ panel: { storage: connect() } });
      try {
        assert(second.q("rows").children.length === 0);
        await second.open();
        assert(second.q("rows").textContent.includes(agent + " saved"));
        second.select(agent + " saved");
        second.click("restore");
        assert(second.restored.length === 0);
        second.click("apply"); await second.settled();
        assert(second.restored[0].draft.plan.context.agent === agent);
      } finally { second.dispose(); }
    }));
  }

  test("period library: editing a reviewed name cancels the pending save", async () => {
    const f = fixture();
    try {
      await f.open();
      f.input("label", "first");
      f.click("save");
      f.input("label", "second");
      assert(f.q("review").hidden && f.q("apply").disabled);
      assert(f.store.document.entries.length === 0);
    } finally { f.dispose(); }
  });

  test("period library: DOM filtering distinguishes token, archive and blocked status", async () => {
    const f = fixture({ initial: sampleLibrary() });
    try {
      await f.open();
      assert(f.q("rows").children.length === 3);
      f.input("status-filter", "blocked", "change");
      assert(f.q("rows").children.length === 1);
      assert(f.q("rows").textContent.includes("CAWELON"));
      f.input("status-filter", "all", "change");
      f.input("archive", "all", "change");
      f.input("agent", "DAT", "change");
      assert(f.q("rows").children.length === 2);
      f.input("search", "古い");
      assert(f.q("rows").children.length === 1);
      assert(f.store.document.entries.length === 4);
    } finally { f.dispose(); }
  });

  test("period library: stored markup is rendered as text without executable elements", async () => {
    const f = fixture({ initial: library([entry(1, { label: "<img src=x onerror=alert(1)>" })]) });
    try {
      await f.open();
      assert(!f.parent.querySelector("img"));
      assert(f.q("rows").textContent.includes("<img"));
      f.select("<img src=x onerror=alert(1)>");
      assert(f.q("detail-text").textContent.includes("<img"));
    } finally { f.dispose(); }
  });

  test("period library: full JSON backup and reimport retain all four saved states", async () => {
    const f = fixture({ initial: sampleLibrary() });
    let saved;
    try {
      await f.open();
      f.click("export-all"); await f.settled();
      saved = f.files[0];
      assert((await decodePeriodLibraryFile(saved.text)).document.entries.length === 4);
    } finally { f.dispose(); }
    const empty = fixture();
    try {
      await empty.open();
      await empty.file(saved.text);
      assert(!empty.q("review").hidden);
      assert(empty.store.document.entries.length === 0);
      empty.click("apply"); await empty.settled();
      assert(empty.store.document.entries.length === 4);
      assert(empty.store.document.entries[2].requiresNewPlan);
      assert(empty.store.document.entries[3].archived);
    } finally { empty.dispose(); }
  });

  test("period library: selecting and exporting one record retains its restriction marker", async () => {
    const f = fixture({ initial: sampleLibrary() });
    try {
      await f.open();
      f.select("CAWELON 要再取得");
      f.click("selected-export"); await f.settled();
      const decoded = await decodePeriodLibraryFile(f.files[0].text);
      assert(decoded.document.entries.length === 1);
      assert(decoded.document.entries[0].requiresNewPlan);
    } finally { f.dispose(); }
  });

  test("period library: CSV export matches the visible filter", async () => {
    const f = fixture({ initial: sampleLibrary() });
    try {
      await f.open();
      f.input("agent", "EMA", "change");
      f.click("export-csv"); await f.settled();
      assert(f.files[0].rows === 1);
      assert(f.files[0].text.includes("EMA"));
      assert(!f.files[0].text.includes("DAT 途中"));
    } finally { f.dispose(); }
  });

  test("period library: archive, unarchive and confirmed purge are separate actions", async () => {
    const f = fixture({ initial: sampleLibrary() });
    try {
      await f.open(); f.select("DAT 途中");
      assert(f.q("purge").disabled);
      f.click("archive-save"); await f.settled();
      assert(f.q("rows").children.length === 2);
      assert(f.store.document.entries.length === 4);
      f.click("unarchive"); await f.settled();
      assert(f.q("rows").children.length === 3);
      f.click("archive-save"); await f.settled();
      assert(f.q("purge").disabled);
      f.q("purge-ack").checked = true;
      f.q("purge-ack").dispatchEvent(new Event("change", { bubbles: true }));
      assert(!f.q("purge").disabled);
      f.click("purge"); await f.settled();
      assert(f.store.document.entries.length === 3);
      assert(f.q("detail").hidden);
    } finally { f.dispose(); }
  });

  test("period library: selection change clears a deletion acknowledgement", async () => {
    const f = fixture({ initial: sampleLibrary() });
    try {
      await f.open();
      f.input("archive", "all", "change");
      f.select("DAT 古い保管");
      f.q("purge-ack").checked = true;
      f.q("purge-ack").dispatchEvent(new Event("change", { bubbles: true }));
      f.select("EMA 取得済み");
      assert(!f.q("purge-ack").checked);
      assert(f.q("purge").disabled);
    } finally { f.dispose(); }
  });

  test("period library: canceling a delayed import leaves no late review or data write", async () => {
    const f = fixture();
    try {
      await f.open();
      const file = await preparePeriodLibraryFile(sampleLibrary());
      const transfer = new DataTransfer();
      transfer.items.add(new File([file.text], "collection.json"));
      f.q("file").files = transfer.files;
      f.q("file").dispatchEvent(new Event("change"));
      f.click("cancel");
      await f.settled();
      await new Promise(resolve => setTimeout(resolve, 30));
      assert(f.q("review").hidden);
      assert(f.store.document.entries.length === 0);
    } finally { f.dispose(); }
  });

  test("period library: concurrent native rename is surfaced as stale in the UI", () => database(async ({ connect }) => {
    const first = connect(), second = connect();
    await first.change(0, { kind: "import", entries: sampleLibrary().entries });
    const f = fixture({ panel: { storage: first } });
    try {
      await f.open(); f.select("DAT 途中");
      await second.change(1, { kind: "rename", id: id(1), label: "Elsewhere", time: LATER });
      f.input("rename", "This screen");
      f.click("rename-save"); await f.settled();
      assert(f.q("status").getAttribute("data-error") === "true");
      assert(f.q("save").disabled);
      assert((await second.read()).entries[0].label === "Elsewhere");
      await f.open();
      assert(f.q("rows").textContent.includes("Elsewhere"));
    } finally { f.dispose(); }
  }));

  test("period library: transfer into acquisition panel keeps historical evidence unverified", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    let calls = 0;
    const period = mountPeriodPanel({
      document, parent, getContext: agent => context(agent),
      read: async (agent, selected, config) => {
        calls++;
        return collectPeriod(periodSession(selected).session, selected, config);
      },
    });
    const f = fixture({ initial: library([entry()]), panel: {
      getCheckpoint: () => period.getCheckpoint(),
      stageCheckpoint: (draft, options) => period.stageSaved(draft, options),
    } });
    try {
      await f.open(); f.select("控え 1"); f.click("restore");
      f.click("apply"); await f.settled();
      assert(period.getDraft() === null);
      assert(!parent.querySelector(".period-review").hidden);
      parent.querySelector(".period-apply").click();
      assert(calls === 0);
      assert(period.getDraft().records.length === 1);
      parent.querySelector(".period-start").click();
      await waitFor(() => parent.querySelector(".period-panel").getAttribute("aria-busy") === "false");
      assert(calls === 1);
      assert(period.getDraft().records.length === 3);
    } finally { f.dispose(); period.dispose(); parent.remove(); }
  });

  test("period library: quarantined restored data cannot enable the acquire button", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const period = mountPeriodPanel({ document, parent, getContext: agent => context(agent), read: () => { throw Error("Must not read"); } });
    const f = fixture({ initial: library([entry(1, { requiresNewPlan: true })]), panel: {
      getCheckpoint: () => period.getCheckpoint(),
      stageCheckpoint: (draft, options) => period.stageSaved(draft, options),
    } });
    try {
      await f.open(); f.select("控え 1"); f.click("restore"); f.click("apply"); await f.settled();
      parent.querySelector(".period-apply").click();
      assert(period.getCheckpoint().requiresNewPlan);
      assert(parent.querySelector(".period-start").disabled);
    } finally { f.dispose(); period.dispose(); parent.remove(); }
  });

  test("period library: native failed write cannot be shown as committed", async () => {
    const store = memoryStorage(undefined, { beforeChange() { throw { code: "CHECKPOINT_QUOTA" }; } });
    const f = fixture({ store });
    try {
      await f.open();
      f.input("label", "No space");
      f.click("save"); f.click("apply"); await f.settled();
      assert(f.q("status").getAttribute("data-error") === "true");
      assert(f.store.document.entries.length === 0);
      assert(f.q("save").disabled);
    } finally { f.dispose(); }
  });

  test("period library: disposing a visible component removes its actions", async () => {
    const f = fixture({ initial: sampleLibrary() });
    await f.open();
    const refresh = f.q("refresh");
    f.dispose();
    const before = f.store.calls.length;
    refresh.click();
    assert(f.store.calls.length === before);
    assert(!document.body.contains(f.parent));
  });
}
