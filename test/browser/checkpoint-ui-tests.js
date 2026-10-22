import { createCheckpointStorage } from "/src/checkpoint-storage.js";
import { emptyCheckpointDocument, mutateCheckpoints } from "/src/checkpoint-model.js";
import { prepareCheckpointCollection, decodeCheckpointCollection } from "/src/checkpoint-transfer.js";
import { createCheckpointController } from "/src/checkpoint-controller.js";
import { workspaceFromDraft, encodeWorkspace } from "/src/workspace-format.js";
import { prepareWorkspaceFile } from "/src/workspace-file.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";

const assert = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), message);
const TIME = "2026-10-23T00:00:00.000Z";
const LATER = "2026-10-23T01:00:00.000Z";
const id = n => "11111111-2222-4333-8444-" + String(n).padStart(12, "0");
const agents = ["DAT", "EMA", "CAWELON"];
const accounts = ["11", "22", "33"].map(part => "0x" + part.repeat(20));
const token = "0x" + "44".repeat(20);
const q = name => document.querySelector(".checkpoint-" + name);
const w = name => document.querySelector(".workspace-" + name);
const card = (agent, name) => document.querySelector('[data-agent="' + agent + '"] .' + name);
const input = (element, value, type = "input") => {
  element.value = value;
  element.dispatchEvent(new Event(type, { bubbles: true }));
};
const checked = (element, value = true) => {
  element.checked = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
};
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Checkpoint UI timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function click(name) {
  assert(!q(name).disabled, "Control unexpectedly disabled: " + name);
  q(name).click();
  await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
}
function draft(block = "42") {
  return agents.map((agent, index) => {
    const history = createPortfolioHistory();
    history.add({
      agent, account: accounts[index], chainId: 84532, siteOrigin: location.origin,
      connectionEpoch: 1, blockNumber: block, blockHash: "0x" + "ab".repeat(32),
      nativeBalanceBaseUnits: String(16 + index),
      holdings: [{ address: token, hasCode: true, balanceBaseUnits: String(42 + index), notice: null }],
      readOnly: true, securityAudit: false,
    });
    return { agent, account: accounts[index], chainId: 84532,
      tokenAddress: token, tokens: token, history: history.exportText() };
  });
}
async function documentWith(count = 1) {
  const fileText = (await prepareWorkspaceFile(workspaceFromDraft(draft()))).text;
  let document = emptyCheckpointDocument();
  for (let n = 1; n <= count; n++) {
    document = mutateCheckpoints(document, document.revision,
      { kind: "save", id: id(n), label: "検証用 " + n, time: TIME, fileText });
  }
  return document;
}
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("Isolated test database unexpectedly blocked"));
  });
}
async function isolated(run) {
  // Never open or delete the application's default database in this test suite.
  const name = "threecore-test-checkpoint-" + crypto.randomUUID();
  const adapters = [], rawConnections = [];
  function storage() {
    const value = createCheckpointStorage({ indexedDB, name, openTimeoutMs: 3000 });
    adapters.push(value);
    return value;
  }
  async function raw(version = 1) {
    const db = await requestResult(indexedDB.open(name, version));
    rawConnections.push(db);
    return db;
  }
  try {
    await run({ name, storage, raw });
  } finally {
    for (const adapter of adapters) adapter.close();
    for (const db of rawConnections) db.close();
    assert(name.startsWith("threecore-test-checkpoint-"), "Refuse non-test cleanup");
    await requestResult(indexedDB.deleteDatabase(name));
  }
}
async function seed(storage, count = 1) {
  const source = await documentWith(count);
  return storage.change(0, { kind: "import", entries: source.entries });
}
function controller(storage, overrides = {}) {
  return createCheckpointController({ storage, readDraft: () => draft(),
    onStage: () => {}, download: () => {}, ...overrides });
}
function restoreFixtureDraft() {
  input(w("json"), encodeWorkspace(workspaceFromDraft(draft())));
  w("preview").click();
  checked(w("confirmed"));
  w("apply").click();
}
async function loadCollection(text) {
  const transfer = new DataTransfer();
  transfer.items.add(new File([text], "checkpoints.json", { type: "application/json" }));
  q("import-file").files = transfer.files;
  q("import-file").dispatchEvent(new Event("change", { bubbles: true }));
  await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
}

export function registerCheckpointUITests(test) {
  test("checkpoint: IndexedDB begins empty and persists committed bytes across connections", async () => {
    await isolated(async env => {
      const first = env.storage();
      equal(await first.read(), emptyCheckpointDocument(), "new database not empty");
      const saved = await seed(first);
      first.close();
      const second = env.storage();
      equal(await second.read(), saved, "committed data lost after reopen");
    });
  });

  test("checkpoint: concurrent revisions produce one commit and one stale failure", async () => {
    await isolated(async env => {
      const a = env.storage(), b = env.storage();
      await Promise.all([a.read(), b.read()]);
      const entries = (await documentWith(2)).entries;
      const results = await Promise.allSettled([
        a.change(0, { kind: "import", entries: [entries[0]] }),
        b.change(0, { kind: "import", entries: [entries[1]] }),
      ]);
      assert(results.filter(row => row.status === "fulfilled").length === 1, "more than one write won");
      assert(results.find(row => row.status === "rejected").reason.code === "CHECKPOINT_STALE", "wrong conflict");
      const saved = await a.read();
      assert(saved.revision === 1 && saved.entries.length === 1, "lost update or partial write");
    });
  });

  test("checkpoint: transaction cancellation leaves both revision and entries unchanged", async () => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage);
      let error;
      try {
        await storage.change(before.revision, { kind: "archive", id: id(1), time: LATER }, { canCommit: () => false });
      } catch (caught) { error = caught; }
      assert(error?.code === "CHECKPOINT_CANCELLED", "guard did not abort");
      equal(await storage.read(), before, "cancelled write persisted");
    });
  });

  test("checkpoint: schema corruption is preserved instead of repaired automatically", async () => {
    await isolated(async env => {
      const storage = env.storage();
      await storage.read();
      const db = await env.raw();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("checkpoints", "readwrite");
        tx.objectStore("checkpoints").put({ damaged: "synthetic-data" }, "current");
        tx.oncomplete = resolve;
        tx.onabort = reject;
      });
      let error;
      try { await seed(storage); } catch (caught) { error = caught; }
      assert(error?.code === "CHECKPOINT_SHAPE", "malformed storage was accepted");
      const tx = db.transaction("checkpoints", "readonly");
      const preserved = await requestResult(tx.objectStore("checkpoints").get("current"));
      equal(preserved, { damaged: "synthetic-data" }, "corrupt data was overwritten");
    });
  });

  test("checkpoint: a sixth snapshot fails atomically without dropping archived data", async () => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage, 5);
      const extra = { ...before.entries[0], id: id(6) };
      let error;
      try { await storage.change(1, { kind: "import", entries: [extra] }); } catch (caught) { error = caught; }
      assert(error?.code === "CHECKPOINT_CAPACITY", "sixth snapshot accepted");
      equal(await storage.read(), before, "existing snapshot evicted");
    });
  });

  test("checkpoint: duplicate collection import is a no-op in the actual database", async () => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage, 2);
      const after = await storage.change(1, { kind: "import", entries: before.entries });
      equal(after, before, "duplicate changed revision");
      equal(await storage.read(), before, "duplicate changed stored bytes");
    });
  });

  test("checkpoint: conflicting batch rejects earlier valid additions too", async () => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage);
      const added = { ...before.entries[0], id: id(2) };
      const conflict = { ...before.entries[0], fileText: "different" };
      let error;
      try { await storage.change(1, { kind: "import", entries: [added, conflict] }); } catch (caught) { error = caught; }
      assert(error?.code === "CHECKPOINT_CONFLICT", "conflicting ID accepted");
      equal(await storage.read(), before, "partial addition escaped transaction");
    });
  });

  test("checkpoint: an external version upgrade closes old handles and blocks downgrade", async () => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const newer = await env.raw(2);
      assert(newer.version === 2, "version change did not release old handle");
      let error;
      try { await storage.read(); } catch (caught) { error = caught; }
      assert(error?.code === "CHECKPOINT_VERSION", "old code silently opened newer schema");
    });
  });

  test("checkpoint: archive and rename survive connection recreation", async () => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      await storage.change(1, { kind: "rename", id: id(1), label: "保管テスト", time: LATER });
      const saved = await storage.change(2, { kind: "archive", id: id(1), time: LATER });
      storage.close();
      equal(await env.storage().read(), saved, "archive metadata not persistent");
    });
  });

  test("checkpoint: separate test database names cannot read each other's snapshots", async () => {
    await isolated(async first => {
      await isolated(async second => {
        await seed(first.storage());
        assert((await second.storage().read()).entries.length === 0, "database namespace leaked");
      });
    });
  });

  test("checkpoint: default panel mount remains opt-in and issues no storage reads", async make => {
    let reads = 0;
    const f = make(undefined, { checkpointStorage: {
      read: async () => { reads++; return emptyCheckpointDocument(); },
      change: () => { throw Error("Unexpected write"); }, close() {},
    } });
    assert(reads === 0 && f.calls.length === 0, "mount caused side effects");
    assert(q("save").disabled && w("apply").disabled, "actions prematurely enabled");
    await click("refresh");
    assert(reads === 1 && !q("save").disabled, "explicit refresh did not load");
  });

  test("checkpoint: UI saves a complete three-agent snapshot without RPC", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const f = make(undefined, { checkpointStorage: storage });
      restoreFixtureDraft();
      await click("refresh");
      input(q("name"), "三つの控え");
      await click("save");
      const saved = await storage.read();
      assert(saved.entries.length === 1, "save absent");
      assert(saved.entries[0].label === "三つの控え", "wrong label");
      assert(q("select").value === saved.entries[0].id, "new snapshot not selected");
      assert(f.calls.length === 0, "saving requested wallet RPC");
      assert(q("stage").disabled, "inspection bypassed");
      f.app.dispose();
    });
  });

  test("checkpoint: remount loads saved metadata only when refresh is clicked", async make => {
    await isolated(async env => {
      const first = env.storage();
      const expected = await seed(first);
      first.close();
      const f = make(undefined, { checkpointStorage: env.storage() });
      assert(q("select").options.length === 1, "snapshot automatically loaded");
      await click("refresh");
      assert(q("select").options.length === 2, "saved snapshot not listed");
      assert(card("EMA", "account").value === "", "refresh restored settings");
      assert(q("select").options[1].value === expected.entries[0].id, "wrong ID");
      f.app.dispose();
    });
  });

  test("checkpoint: staged restore still requires preview and separate confirmation", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      input(q("select"), id(1), "change");
      await click("inspect");
      assert(q("detail").textContent.includes("CAWELON"), "inspection incomplete");
      await click("stage");
      assert(card("EMA", "account").value === "", "stage directly applied settings");
      assert(w("apply").disabled, "stage skipped preview");
      w("preview").click();
      assert(w("apply").disabled, "preview skipped acknowledgement");
      checked(w("confirmed"));
      w("apply").click();
      agents.forEach((agent, index) => {
        assert(card(agent, "account").value === accounts[index], agent + " account mismatch");
        assert(card(agent, "history-list").children.length === 1, agent + " history missing");
        assert(card(agent, "read").disabled, agent + " unexpectedly connected");
      });
      assert(f.calls.length === 0, "restore contacted a wallet");
      f.app.dispose();
    });
  });

  test("checkpoint: staging replaces a stale workspace proposal and its confirmation", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      input(w("json"), encodeWorkspace(workspaceFromDraft(draft("99"))));
      w("preview").click();
      checked(w("confirmed"));
      assert(!w("apply").disabled, "initial review not ready");
      await click("refresh");
      input(q("select"), id(1), "change");
      await click("inspect");
      await click("stage");
      assert(w("apply").disabled && !w("confirmed").checked, "old confirmation survived");
      assert(w("detail").textContent === "", "old proposal still displayed");
      f.app.dispose();
    });
  });

  test("checkpoint: editing after staging invalidates workspace review", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      input(q("select"), id(1), "change");
      await click("inspect");
      await click("stage");
      w("preview").click();
      checked(w("confirmed"));
      input(card("DAT", "account"), accounts[2]);
      assert(w("apply").disabled, "edited draft left stale restore actionable");
      assert((await storage.read()).revision === 1, "input auto-saved");
      f.app.dispose();
    });
  });

  test("checkpoint: archived snapshots can be inspected but must be unarchived before stage", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      input(q("select"), id(1), "change");
      await click("archive");
      assert(q("archived").checked, "archive view not selected");
      await click("inspect");
      assert(q("stage").disabled, "archived snapshot restorable directly");
      await click("unarchive");
      assert(!q("archived").checked, "active view not restored");
      await click("inspect");
      assert(!q("stage").disabled, "unarchived snapshot not usable");
      f.app.dispose();
    });
  });

  test("checkpoint: permanent deletion confirmation cannot carry to another selection", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage, 2);
      await storage.change(1, { kind: "archive", id: id(1), time: LATER });
      await storage.change(2, { kind: "archive", id: id(2), time: LATER });
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      checked(q("archived"));
      input(q("select"), id(1), "change");
      checked(q("confirmed"));
      assert(!q("purge").disabled, "confirmation not recognized");
      input(q("select"), id(2), "change");
      assert(!q("confirmed").checked && q("purge").disabled, "confirmation reused");
      assert((await storage.read()).entries.length === 2, "selection deleted data");
      f.app.dispose();
    });
  });

  test("checkpoint: changing a snapshot in another connection forces a UI reload", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      input(q("select"), id(1), "change");
      await env.storage().change(1, { kind: "rename", id: id(1), label: "Another tab", time: LATER });
      await click("inspect");
      assert(q("status").textContent.includes("一覧を読み直して"), "stale warning absent");
      assert(q("save").disabled, "stale document permits save");
      await click("refresh");
      assert(q("select").options[1].textContent.includes("Another tab"), "latest name absent");
      f.app.dispose();
    });
  });

  test("checkpoint: malicious-looking saved labels produce no HTML elements", async make => {
    await isolated(async env => {
      const storage = env.storage();
      await seed(storage);
      await storage.change(1, { kind: "rename", id: id(1), label: "<img src=x onerror=alert(1)>", time: LATER });
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      assert(q("select").options[1].textContent.includes("<img"), "label text missing");
      assert(q("panel").querySelectorAll("img,script").length === 0, "label became executable markup");
      f.app.dispose();
    });
  });

  test("checkpoint: actual file input previews a collection without adding snapshots", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      await loadCollection((await prepareCheckpointCollection(await documentWith(2))).text);
      assert(q("import-detail").textContent.includes("0 → 2"), "file preview absent");
      assert(q("import-apply").disabled, "confirmation bypassed");
      assert((await storage.read()).entries.length === 0, "preview persisted data");
      checked(q("import-confirmed"));
      await click("import-apply");
      assert((await storage.read()).entries.length === 2, "confirmed import missing");
      assert(card("EMA", "account").value === "" && f.calls.length === 0, "import changed wallet");
      f.app.dispose();
    });
  });

  test("checkpoint: identical collection reimport keeps local renamed and archived metadata", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const original = await seed(storage);
      const text = (await prepareCheckpointCollection(original)).text;
      await storage.change(1, { kind: "rename", id: id(1), label: "Local choice", time: LATER });
      await storage.change(2, { kind: "archive", id: id(1), time: LATER });
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      await loadCollection(text);
      assert(q("import-detail").textContent.includes("1件"), "deduplication not disclosed");
      checked(q("import-confirmed"));
      await click("import-apply");
      const result = await storage.read();
      assert(result.revision === 3, "duplicate incremented revision");
      assert(result.entries[0].label === "Local choice" && result.entries[0].archived, "metadata overwritten");
      f.app.dispose();
    });
  });

  test("checkpoint: collection changed by another tab after review cannot be applied", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      await loadCollection((await prepareCheckpointCollection(await documentWith(2))).text);
      await seed(env.storage());
      checked(q("import-confirmed"));
      await click("import-apply");
      assert(q("status").textContent.includes("一覧を読み直して"), "stale import not rejected");
      assert((await storage.read()).entries.length === 1, "partial import written");
      f.app.dispose();
    });
  });

  test("checkpoint: collection export and import across two databases preserve exact files", async () => {
    await isolated(async source => {
      await isolated(async destination => {
        const first = source.storage(), second = destination.storage();
        const original = await seed(first, 3);
        const exported = await prepareCheckpointCollection(await first.read());
        const decoded = await decodeCheckpointCollection(exported.text);
        const after = await second.change(0, { kind: "import", entries: decoded.entries });
        equal(after.entries, original.entries, "backup bytes changed");
        equal((await first.read()).entries, original.entries, "source changed");
      });
    });
  });

  test("checkpoint: cancellation after file review leaves existing database unchanged", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      await loadCollection((await prepareCheckpointCollection(await documentWith(2))).text);
      checked(q("import-confirmed"));
      await click("import-cancel");
      assert(q("import-detail").textContent === "" && q("import-apply").disabled, "proposal not cleared");
      equal(await storage.read(), before, "cancel wrote data");
      f.app.dispose();
    });
  });

  test("checkpoint: damaged file rejects all entries without disturbing a saved snapshot", async make => {
    await isolated(async env => {
      const storage = env.storage();
      const before = await seed(storage);
      const f = make(undefined, { checkpointStorage: storage });
      await click("refresh");
      const damaged = JSON.parse((await prepareCheckpointCollection(await documentWith(2))).text);
      damaged.entries[1].label = "tampered";
      await loadCollection(JSON.stringify(damaged));
      assert(q("status").textContent.includes("破損確認"), "checksum warning absent");
      assert(q("import-apply").disabled, "damaged file actionable");
      equal(await storage.read(), before, "damaged import modified storage");
      f.app.dispose();
    });
  });

  test("checkpoint: malformed workspace saved in a slot never reaches restoration", async () => {
    await isolated(async env => {
      const storage = env.storage();
      await storage.change(0, { kind: "save", id: id(1), label: "Broken synthetic", time: TIME, fileText: "{}" });
      let stages = 0;
      const c = controller(storage, { onStage: () => stages++ });
      await c.refresh();
      c.select(id(1));
      assert(await c.inspect() === false, "bad workspace inspected successfully");
      assert(await c.stage() === false, "bad workspace staged");
      assert(stages === 0, "restoration callback invoked");
      c.dispose();
    });
  });
}

