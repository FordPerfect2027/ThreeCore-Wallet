import { createEncryptedLibraryStorage } from "/src/encrypted-library-storage.js";
import { createEncryptedLibraryController } from "/src/encrypted-library-controller.js";
import { emptyEncryptedLibrary, prepareLibraryEntry, verifyEncryptedLibrary } from "/src/encrypted-library-model.js";
import { mountSecureBackupPanel } from "/examples/secure-backup-panel.js";
import { backupHeader, prepareEncryptedEnvelope } from "/src/secure-backup-format.js";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "/src/secure-backup-crypto.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { workspaceFromDraft } from "/src/workspace-format.js";
import { prepareEncryptedArchive, decodeEncryptedArchive } from "/src/encrypted-library-archive.js";

const assert = (value, message) => { if (!value) throw Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const PASSWORD = "synthetic library only purple nebula";
const addresses = ["11", "22", "33"].map(pair => "0x" + pair.repeat(20));
function draft() {
  return ["DAT", "EMA", "CAWELON"].map((agent, index) => ({ agent,
    account: addresses[index], chainId: 84532, tokenAddress: "", tokens: "",
    history: createPortfolioHistory().exportText() }));
}
function envelope(seed = 1) {
  return prepareEncryptedEnvelope(backupHeader(new Uint8Array(16).fill(seed),
    new Uint8Array(12).fill(seed)), new Uint8Array(32).fill(seed)).text;
}
async function waitFor(condition, timeout = 20000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start >= timeout) throw Error("encrypted library UI timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function erase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error("test database blocked"));
  });
}
async function fixture(action) {
  const name = "threecore-encrypted-library-test-" + crypto.randomUUID();
  const adapters = [], controllers = [], panels = [];
  const storage = () => {
    const value = createEncryptedLibraryStorage({ name });
    adapters.push(value);
    return value;
  };
  const controller = (options = {}) => {
    const value = createEncryptedLibraryController({ storage: storage(), ...options });
    controllers.push(value);
    return value;
  };
  const panel = (options = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const staged = [], downloads = [];
    const value = mountSecureBackupPanel({ document, parent: host,
      readDraft: draft, onStage(text) { staged.push(text); return true; },
      download: ({ prepared }) => downloads.push(prepared),
      libraryOptions: { storage: storage() }, ...options });
    const secure = name => host.querySelector(".secure-backup-" + name);
    const local = name => host.querySelector(".encrypted-library-" + name);
    const remove = () => { value.dispose(); host.remove(); };
    panels.push(remove);
    return { host, value, secure, local, staged, downloads, remove };
  };
  try { await action({ name, storage, controller, panel }); }
  finally {
    for (const remove of panels) remove();
    for (const item of controllers) item.dispose();
    for (const item of adapters) item.close();
    await erase(name);
  }
}
async function save(controller, text = envelope()) {
  assert(await controller.prepareSave(text), "prepared");
  assert(await controller.confirm(controller.state().review.ticket, true), "committed");
}
function check(input) {
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
async function selectFirst(f) {
  f.local("load").click();
  await waitFor(() => !f.local("load").disabled);
  const first = f.local("select").options[0];
  assert(first, "saved option exists");
  f.local("select").value = first.value;
  f.local("select").dispatchEvent(new Event("change", { bubbles: true }));
}
async function rawDocument(name, mutate) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("checkpoints", mutate ? "readwrite" : "readonly");
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? Error("raw test aborted"));
      const store = tx.objectStore("checkpoints"), request = store.get("current");
      request.onsuccess = () => {
        result = request.result;
        if (mutate) { result = mutate(result); store.put(result, "current"); }
      };
    });
  } finally { db.close(); }
}
let encryptedSample;
function sample() {
  encryptedSample ??= encryptWorkspaceBackup(workspaceFromDraft(draft()), PASSWORD);
  return encryptedSample;
}

export function registerEncryptedLibraryUITests(test) {
  for (const action of ["protect", "select"]) {
    test(`encrypted-library: ${action} during deletion clock check preserves native records and allows a fresh review`, async () => {
      await fixture(async ({ name, controller, panel, storage }) => {
        const seed = controller();
        await save(seed, envelope(1));
        await save(seed, envelope(2));
        const original = await rawDocument(name);
        let armed = false, f;
        f = panel({ libraryOptions: { storage: storage(), now() {
          if (armed) {
            armed = false;
            if (action === "protect") f.value.protect();
            else {
              f.local("select").value = f.local("select").options[1].value;
              f.local("select").dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          return Date.now();
        } } });
        await selectFirst(f);
        const selected = f.local("select").value;
        f.local("remove").click();
        await waitFor(() => !f.local("ack").disabled);
        check(f.local("ack"));
        armed = true;
        f.local("commit").click();
        await waitFor(() => !f.local("load").disabled);
        assert(!armed, "clock boundary exercised");
        assert(JSON.stringify(await rawDocument(name)) === JSON.stringify(original), "all records and revision preserved");
        assert(f.local("review").textContent === "", "revoked review cleared");
        assert(f.local("commit").disabled, "revoked commit unavailable");
        assert(!f.local("ack").checked, "old consent cleared");
        await selectFirst(f);
        assert(f.local("select").value === selected, "same first record selected again");
        f.local("remove").click();
        await waitFor(() => !f.local("ack").disabled);
        assert(f.local("commit").disabled, "fresh review requires fresh consent");
        check(f.local("ack"));
        f.local("commit").click();
        await waitFor(() => !f.local("load").disabled);
        const remaining = await rawDocument(name);
        assert(remaining.entries.length === 1, "explicit retry removed exactly one record");
        assert(JSON.stringify(remaining.entries) === JSON.stringify(original.entries.filter(entry => entry.id !== selected)), "other ciphertext preserved exactly");
      });
    });
  }

  test("encrypted-library: protection while constructing a review cannot revive native deletion controls", async () => {
    await fixture(async ({ name, controller, panel, storage }) => {
      await save(controller());
      const before = JSON.stringify(await rawDocument(name));
      let armed = false, f;
      f = panel({ libraryOptions: { storage: storage(), now() {
        if (armed) { armed = false; f.value.protect(); }
        return Date.now();
      } } });
      await selectFirst(f);
      armed = true;
      f.local("remove").click();
      await waitFor(() => !f.local("load").disabled);
      assert(!armed, "review timestamp callback reached");
      assert(f.local("review").textContent === "", "no late review");
      assert(f.local("commit").disabled && f.local("ack").disabled, "no revived consent controls");
      assert(f.local("select").options.length === 0, "protected inventory remains hidden");
      assert(JSON.stringify(await rawDocument(name)) === before, "database preserved");
    });
  });

  test("encrypted-library: cancellation by a native read completion observer returns false", async () => {
    await fixture(async ({ name, controller }) => {
      await save(controller());
      const before = JSON.stringify(await rawDocument(name));
      let c;
      c = controller({ onChange(state) { if (state.phase === "ready") c.cancel(); } });
      assert(!await c.load(), "caller observes cancellation");
      assert(c.state().phase === "cancelled" && !c.state().loaded, "inventory remains revoked");
      assert(c.state().summary === null && c.state().selected === null, "no stale record metadata");
      assert(JSON.stringify(await rawDocument(name)) === before, "observer cannot change stored records");
    });
  });

  test("encrypted-library: native read abort cleanup cannot start a replacement read", async () => {
    await fixture(async ({ name, controller, storage }) => {
      await save(controller());
      const before = JSON.stringify(await rawDocument(name));
      const adapter = storage();
      let c, calls = 0, observed, replacement;
      c = controller({ storage: {
        read(options) {
          calls++;
          const stopped = () => { observed = c.state(); replacement = c.load(); };
          options.signal.addEventListener("abort", stopped, { once: true });
          return adapter.read(options).finally(() => options.signal.removeEventListener("abort", stopped));
        },
        change: (...args) => adapter.change(...args),
        close: () => adapter.close(),
      } });
      const pending = c.load();
      c.cancel();
      assert(!await pending && !await replacement, "both interrupted and cleanup work refused");
      assert(calls === 1, "no replacement storage read");
      assert(observed?.phase === "cancelled" && observed.summary === null, "abort observer sees cleared state");
      assert(JSON.stringify(await rawDocument(name)) === before, "original database remains intact");
    });
  });

  test("encrypted-library: native archive File import reviews additions and preserves duplicate timestamps", async () => {
    await fixture(async ({ name, controller, panel }) => {
      const c = controller();
      await save(c, envelope(1));
      const original = await rawDocument(name);
      const duplicate = clone(original.entries[0]);
      duplicate.savedAt++;
      const second = await prepareLibraryEntry(envelope(2));
      const prepared = await prepareEncryptedArchive({ ...emptyEncryptedLibrary(), entries: [duplicate, second] });
      const f = panel();
      const transfer = new DataTransfer();
      transfer.items.add(new File([prepared.text], "ThreeCore-encrypted-library.json", { type: "application/json" }));
      f.local("file").files = transfer.files;
      f.local("file").dispatchEvent(new Event("change", { bubbles: true }));
      assert(f.local("file").value === "", "picker cleared");
      await waitFor(() => !f.local("ack").disabled);
      assert(f.local("review").textContent.includes("1 件を追加"), "new count visible");
      assert(f.local("review").textContent.includes("重複 1 件"), "duplicate count visible");
      assert((await rawDocument(name)).entries.length === 1, "preview did not commit");
      check(f.local("ack"));
      f.local("commit").click();
      await waitFor(() => !f.local("load").disabled);
      const after = await rawDocument(name);
      assert(after.entries.length === 2, "one new encrypted record");
      assert(after.entries[0].savedAt === original.entries[0].savedAt, "duplicate timestamp preserved");
      assert(f.staged.length === 0, "not decrypted or restored");
    });
  });

  test("encrypted-library: whole-library export button requires a second explicit action", async () => {
    await fixture(async ({ controller, panel }) => {
      const c = controller();
      await save(c, envelope(1));
      await save(c, envelope(2));
      const f = panel();
      f.local("archive").click();
      await waitFor(() => !f.local("export").disabled);
      assert(f.downloads.length === 0, "no automatic download");
      f.local("export").click();
      assert(f.downloads.length === 1, "one explicit download");
      assert((await decodeEncryptedArchive(f.downloads[0].text)).entries.length === 2, "all records retained");
      assert(f.local("export").disabled, "download consumed");
    });
  });

  test("encrypted-library: selecting plaintext import clears previous confirmation without overwriting", async () => {
    await fixture(async ({ controller, panel, name }) => {
      await save(controller(), envelope(1));
      const before = JSON.stringify(await rawDocument(name));
      const f = panel();
      await selectFirst(f);
      f.local("remove").click();
      await waitFor(() => !f.local("ack").disabled);
      check(f.local("ack"));
      const transfer = new DataTransfer();
      transfer.items.add(new File(['{"password":"secret"}'], "untrusted.json"));
      f.local("file").files = transfer.files;
      f.local("file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !f.local("load").disabled);
      assert(f.local("commit").disabled, "old confirm invalidated");
      assert(!f.local("ack").checked, "old acknowledgement cleared");
      assert(!f.host.textContent.includes('"password":"secret"'), "private content not reflected");
      assert(JSON.stringify(await rawDocument(name)) === before, "database unchanged");
    });
  });

  test("encrypted-library: archive transfer to another store is additive and remains encrypted", async () => {
    await fixture(async ({ controller: source }) => {
      const original = source();
      await save(original, (await sample()).text);
      await original.prepareArchive();
      const downloads = [];
      original.offer(value => downloads.push(value));
      await fixture(async ({ controller: destination, name }) => {
        const target = destination();
        await save(target, envelope(8));
        assert(await target.prepareImport(new File([downloads[0].text], "archive.json")), "prepared import");
        assert(await target.confirm(target.state().review.ticket, true), "committed merge");
        const raw = JSON.stringify(await rawDocument(name));
        assert(target.state().summary.count === 2, "existing destination file retained");
        assert(!raw.includes(PASSWORD), "no password transferred");
        for (const address of addresses) assert(!raw.includes(address), "no plaintext account transferred");
      });
    });
  });
  test("encrypted-library: ordinary wallet includes protected local storage without network calls", make => {
    const f = make();
    assert(document.querySelector(".encrypted-library-panel"), "panel mounted");
    assert(document.querySelector(".encrypted-library-save").disabled, "requires encryption");
    assert(f.calls.length === 0, "no wallet request");
  });

  test("encrypted-library: real IndexedDB persists ciphertext across closed connections", async () => {
    await fixture(async ({ controller }) => {
      const first = controller();
      await save(first);
      first.dispose();
      const second = controller();
      assert(await second.load(), "reopened");
      assert(second.state().summary.count === 1, "persisted record");
      assert(second.state().summary.entries[0].bytes === envelope().length, "persisted size");
    });
  });

  test("encrypted-library: two native concurrent writers cannot silently overwrite", async () => {
    await fixture(async ({ controller }) => {
      const a = controller(), b = controller();
      assert(await a.prepareSave(envelope(1)), "first review");
      assert(await b.prepareSave(envelope(2)), "second review");
      const results = await Promise.all([
        a.confirm(a.state().review.ticket, true), b.confirm(b.state().review.ticket, true),
      ]);
      assert(results.filter(Boolean).length === 1, "only one conflicting transaction commits");
      assert([a, b].some(value => value.state().errorCode === "LIBRARY_CONFLICT"), "conflict shown");
      const read = controller();
      await read.load();
      assert(read.state().summary.count === 1, "not overwritten");
    });
  });

  test("encrypted-library: native abort prevents a put from committing", async () => {
    await fixture(async ({ storage }) => {
      const adapter = storage();
      const before = await adapter.read();
      const abort = new AbortController();
      const item = await prepareLibraryEntry(envelope());
      const write = adapter.change(before, { kind: "add", entry: item }, {
        signal: abort.signal, canCommit() { abort.abort(); return false; },
      });
      let code;
      try { await write; } catch (error) { code = error.code; }
      assert(code === "LIBRARY_CANCELLED", "aborted");
      assert((await adapter.read()).entries.length === 0, "no partial write");
    });
  });

  test("encrypted-library: native deletion changes only the selected record", async () => {
    await fixture(async ({ controller }) => {
      const c = controller();
      await save(c, envelope(1));
      await save(c, envelope(2));
      const first = c.state().summary.entries[0].id;
      c.select(first);
      await c.prepareRemove();
      await c.confirm(c.state().review.ticket, true);
      c.dispose();
      const another = controller();
      await another.load();
      assert(another.state().summary.count === 1, "other entry retained");
      assert(another.state().summary.entries[0].id !== first, "selected entry removed");
    });
  });

  test("encrypted-library: corrupted digest blocks opening without modifying native database", async () => {
    await fixture(async ({ name, controller }) => {
      const c = controller();
      await save(c);
      await rawDocument(name, value => {
        value.entries[0].id = "f".repeat(64);
        return value;
      });
      assert(!await c.load(), "corrupt file rejected");
      assert(c.state().errorCode === "LIBRARY_INTEGRITY", "static integrity error");
      assert((await rawDocument(name)).entries[0].id === "f".repeat(64), "no silent cleanup");
    });
  });

  test("encrypted-library: malformed persisted plaintext cannot appear in inventory DOM", async () => {
    await fixture(async ({ name, controller, panel }) => {
      const c = controller();
      await save(c);
      await rawDocument(name, value => { value.entries[0].secret = "<img onerror=alert(1)>"; return value; });
      const f = panel();
      f.local("load").click();
      await waitFor(() => !f.local("load").disabled);
      assert(f.local("select").options.length === 0, "no unverified options");
      assert(!f.host.innerHTML.includes("onerror="), "no raw payload inserted");
      assert(!f.host.textContent.includes("<img"), "no raw prose displayed");
    });
  });

  test("encrypted-library: unchanged revision cannot hide a native content change", async () => {
    await fixture(async ({ name, controller }) => {
      const c = controller();
      await save(c);
      c.select(c.state().summary.entries[0].id);
      await c.prepareRemove();
      const ticket = c.state().review.ticket;
      await rawDocument(name, value => { value.entries[0].savedAt++; return value; });
      assert(!await c.confirm(ticket, true), "stale remove refused");
      assert(c.state().errorCode === "LIBRARY_CONFLICT", "exact-content conflict");
      assert((await rawDocument(name)).entries.length === 1, "preserved");
    });
  });

  test("encrypted-library: real encrypted workspace round-trips after remount with explicit password", async () => {
    await fixture(async ({ name, panel }) => {
      const f = panel();
      f.secure("password").value = f.secure("confirmation").value = PASSWORD;
      check(f.secure("acknowledged"));
      f.secure("encrypt").click();
      assert(f.secure("password").value === "", "password cleared");
      await waitFor(() => !f.local("save").disabled);
      f.local("save").click();
      await waitFor(() => !f.local("ack").disabled);
      assert(f.local("commit").disabled, "unchecked preview cannot save");
      check(f.local("ack"));
      f.local("commit").click();
      await waitFor(() => !f.local("load").disabled);
      const raw = JSON.stringify(await rawDocument(name));
      assert(raw.includes("ciphertext"), "ciphertext persisted");
      assert(!raw.includes(PASSWORD), "no password persisted");
      for (const address of addresses) assert(!raw.includes(address), "no plaintext account persisted");
      f.remove();
      const next = panel();
      await selectFirst(next);
      next.local("open").click();
      await waitFor(() => !next.secure("decrypt").disabled);
      assert(next.staged.length === 0, "not automatically restored");
      next.secure("restore-password").value = PASSWORD;
      next.secure("decrypt").click();
      assert(next.secure("restore-password").value === "", "restore password cleared");
      await waitFor(() => !next.secure("stage").disabled);
      assert(next.staged.length === 0, "requires separate handoff");
      next.secure("stage").click();
      assert(next.staged.length === 1, "explicit preview handoff");
      assert(next.staged[0].includes(addresses[0]), "original DAT settings recovered");
      assert(next.staged[0].includes(addresses[1]), "original EMA settings recovered");
      assert(next.staged[0].includes(addresses[2]), "original CAWELON settings recovered");
    });
  });

  test("encrypted-library: wrong password fails without changing saved ciphertext", async () => {
    await fixture(async ({ name, controller, panel }) => {
      await save(controller(), (await sample()).text);
      const before = JSON.stringify(await rawDocument(name));
      const f = panel();
      await selectFirst(f);
      f.local("open").click();
      await waitFor(() => !f.secure("decrypt").disabled);
      f.secure("restore-password").value = PASSWORD + " wrong";
      f.secure("decrypt").click();
      await waitFor(() => f.value.state().phase === "error");
      assert(f.value.state().errorCode === "SECURE_AUTH", "authentication failed");
      assert(f.staged.length === 0, "no restored content");
      assert(JSON.stringify(await rawDocument(name)) === before, "ciphertext preserved");
    });
  });

  test("encrypted-library: forged digest is not confused with AES authentication", async () => {
    await fixture(async ({ name, controller, panel }) => {
      const value = JSON.parse((await sample()).text);
      const bytes = Uint8Array.from(atob(value.ciphertext), character => character.charCodeAt(0));
      bytes[0] ^= 1;
      value.ciphertext = btoa(String.fromCharCode(...bytes));
      await save(controller(), JSON.stringify(value));
      const f = panel();
      await selectFirst(f);
      f.local("open").click();
      await waitFor(() => !f.secure("decrypt").disabled);
      f.secure("restore-password").value = PASSWORD;
      f.secure("decrypt").click();
      await waitFor(() => f.value.state().phase === "error");
      assert(f.value.state().errorCode === "SECURE_AUTH", "AEAD still rejects changed content");
      assert(f.staged.length === 0, "no plaintext bypass");
      assert((await rawDocument(name)).entries.length === 1, "file not erased");
    });
  });

  test("encrypted-library: export remains encrypted and decryptable after explicit offer", async () => {
    await fixture(async ({ controller }) => {
      const c = controller(), prepared = await sample(), offered = [];
      await save(c, prepared.text);
      c.select(c.state().summary.entries[0].id);
      assert(await c.prepareExport(), "export prepared");
      assert(offered.length === 0, "no automatic download");
      assert(c.offer(value => offered.push(value)), "offered");
      assert(!offered[0].text.includes(addresses[0]), "export is encrypted");
      const decoded = await decryptWorkspaceBackup(offered[0].text, PASSWORD);
      assert(decoded.text.includes(addresses[0]), "portable encrypted file");
    });
  });

  test("encrypted-library: protection clears a native deletion preview without removing data", async () => {
    await fixture(async ({ name, controller, panel }) => {
      await save(controller());
      const f = panel();
      await selectFirst(f);
      f.local("remove").click();
      await waitFor(() => !f.local("ack").disabled);
      check(f.local("ack"));
      f.value.protect();
      assert(f.local("review").textContent === "", "review cleared");
      assert(f.local("commit").disabled, "commit stopped");
      assert(f.local("select").options.length === 0, "inventory hidden");
      assert((await rawDocument(name)).entries.length === 1, "retained");
    });
  });

  test("encrypted-library: browser connection version change allows clean reopen", async () => {
    await fixture(async ({ name, storage }) => {
      const adapter = storage();
      await adapter.read();
      await erase(name);
      const reopened = await adapter.read();
      assert(reopened.entries.length === 0 && reopened.revision === 0, "reopened after external deletion");
    });
  });
}
