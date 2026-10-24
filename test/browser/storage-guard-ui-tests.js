import { nativeFixture, formats, translated, assert, same, copy, outcome,
  pause, save, waitFor, rawDocument, virtualDeadline, openGate } from "/test/browser/storage-guard-fixture.js";
import { createCheckpointStorage } from "/src/checkpoint-storage.js";
import { emptyCheckpointDocument } from "/src/checkpoint-model.js";
import { mountStorageGuardPanel } from "/examples/storage-guard-panel.js";

export function registerStorageGuardUITests(test) {
  for (const action of ["button", "pagehide", "dispose"]) {
    test("storage-guard: integrated " + action + " stops native storage and all wallet reads", async use => {
      await nativeFixture(async f => {
        const app = use(undefined, { storageGuard: f.guard });
        await app.connect();
        const gate = openGate();
        const { value } = f.storage(formats[0], { indexedDB: gate.factory });
        const pending = outcome(value.change(0, save(1)));
        await waitFor(() => gate.ready === 1);
        if (action === "button") document.querySelector(".security-stop").click();
        if (action === "pagehide") app.eventTarget.dispatchEvent(new Event("pagehide"));
        if (action === "dispose") app.app.dispose();
        assert((await pending).code === "CHECKPOINT_CANCELLED", "global stop reaches storage");
        if (action !== "dispose") {
          for (const card of document.querySelectorAll("[data-agent]")) {
            const connect = card.querySelector(".connect");
            if (connect) assert(connect.disabled, "wallet read admission closed");
          }
        }
        assert(!app.calls.some(call => /sendTransaction|sign|approve/.test(call.method)), "no signing operations");
        assert(f.guard.state().draining === 1, "native request retained");
        gate.release();
        await waitFor(() => f.guard.state().active === 0);
        assert(f.guard.state().completed === 0, "no cancelled save reported as success");
      });
    });
  }

  test("storage-guard: failing storage cleanup still disconnects all three wallet cards", async use => {
    await nativeFixture(async f => {
      const broken = { state: f.guard.state, subscribe: f.guard.subscribe,
        cancelAll() { throw Error("private cleanup detail"); } };
      const app = use(undefined, { storageGuard: broken });
      await app.connect();
      document.querySelector(".security-stop").click();
      assert(app.field(".connect").disabled, "wallet remains locked");
      assert(app.field(".read").disabled, "live read stopped");
      assert(document.querySelector(".security-resume").disabled, "cleanup failure blocks resume");
      assert(!document.querySelector(".security-cleanup-warning").hidden, "static warning visible");
      assert(!document.querySelector(".security-cleanup-warning").textContent.includes("private"), "no error prose");
    });
  });

  test("storage-guard: opening wallet UI does not open any guarded database", async use => {
    await nativeFixture(async f => {
      const app = use(undefined, { storageGuard: f.guard });
      assert(f.guard.state().accepted === 0, "no automatic saved data read");
      assert(document.querySelector(".storage-guard-panel"), "status mounted");
      assert(app.calls.length === 0, "no wallet request from status panel");
      app.app.dispose();
      assert(!document.querySelector(".storage-guard-panel"), "status detached");
    });
  });

  for (const format of formats) {
    test(`storage-guard: ${format.key} native save survives adapter close and reopen`, async () => {
      await nativeFixture(async f => {
        const first = f.storage(format);
        const before = await first.value.read();
        const saved = await first.value.change(format.expected(before), await format.operation(1));
        assert(saved.revision === 1 && saved.entries.length === 1, "one committed record");
        first.value.close();
        const second = f.storage(format, { name: first.name });
        same(await second.value.read(), saved, "native readback preserved exact document");
        same(await rawDocument(first.name), saved, "raw persisted document agrees");
        assert(f.guard.state().active === 0, "no native tasks remain");
      });
    });

    test(`storage-guard: ${format.key} cancellation in approval rolls back without replacement`, async () => {
      await nativeFixture(async f => {
        const { value, name } = f.storage(format);
        const empty = await value.read();
        const original = await value.change(format.expected(empty), await format.operation(1));
        const aborter = new AbortController();
        const failed = await outcome(value.change(format.expected(original), await format.operation(2), {
          signal: aborter.signal,
          canCommit() { aborter.abort(); return true; },
        }));
        assert(failed.code === translated(format, "CHECKPOINT_CANCELLED"), "cancellation delivered");
        await waitFor(() => f.guard.state().active === 0);
        same(await rawDocument(name), original, "durable original unchanged");
        same(await value.read(), original, "normal UI readback unchanged");
      });
    });

    test(`storage-guard: ${format.key} deadline checked after approval without timer delivery`, async () => {
      await nativeFixture(async f => {
        const time = virtualDeadline();
        const { value, name } = f.storage(format, { deadlineOptions: time.options, transactionTimeoutMs: 50 });
        const empty = await value.read();
        const original = await value.change(format.expected(empty), await format.operation(1));
        const failed = await outcome(value.change(format.expected(original), await format.operation(2), {
          canCommit() { time.advance(50); return true; },
        }));
        assert(failed.code === translated(format, "CHECKPOINT_TIMEOUT"), "absolute deadline enforced");
        await waitFor(() => f.guard.state().active === 0);
        same(await rawDocument(name), original, "expired write did not persist");
        assert(time.pending() === 0, "all timers cleaned");
      });
    });

    test(`storage-guard: ${format.key} global stop reaches native write before put`, async () => {
      await nativeFixture(async f => {
        const { value, name } = f.storage(format);
        const empty = await value.read();
        const original = await value.change(format.expected(empty), await format.operation(1));
        const result = await outcome(value.change(format.expected(original), await format.operation(2), {
          canCommit() { assert(f.guard.cancelAll() === 1, "one stop request"); return true; },
        }));
        assert(!result.ok, "stopped operation rejected");
        await waitFor(() => f.guard.state().active === 0);
        same(await rawDocument(name), original, "saved original retained");
        assert(f.guard.state().cancelled === 1, "cancellation counted once");
      });
    });

    test(`storage-guard: ${format.key} one of two stale writers wins atomically`, async () => {
      await nativeFixture(async f => {
        const first = f.storage(format);
        const second = f.storage(format, { name: first.name });
        const before = await first.value.read();
        await second.value.read();
        const operations = await Promise.all([format.operation(1), format.operation(2)]);
        const results = await Promise.all([
          outcome(first.value.change(format.expected(before), operations[0])),
          outcome(second.value.change(format.expected(before), operations[1])),
        ]);
        assert(results.filter(item => item.ok).length === 1, "exactly one CAS write succeeded");
        const winner = results.find(item => item.ok).value;
        same(await first.value.read(), winner, "later conflict did not overwrite winner");
        same(await rawDocument(first.name), winner, "native durable winner");
      });
    });

    test(`storage-guard: ${format.key} rejected async approval never commits later`, async () => {
      await nativeFixture(async f => {
        const { value, name } = f.storage(format);
        const empty = await value.read();
        const original = await value.change(format.expected(empty), await format.operation(1));
        const failed = await outcome(value.change(format.expected(original), await format.operation(2), {
          canCommit: () => Promise.reject(Error("synthetic rejected policy")),
        }));
        assert(!failed.ok, "async policy refused");
        await pause();
        await waitFor(() => f.guard.state().active === 0);
        same(await rawDocument(name), original, "async result cannot grant authority");
      });
    });

    test(`storage-guard: ${format.key} pre-aborted call performs no database open`, async () => {
      await nativeFixture(async f => {
        let opens = 0;
        const { value } = f.storage(format, { indexedDB: { open() { opens++; throw Error("must not open"); } } });
        const aborter = new AbortController();
        aborter.abort();
        const result = await outcome(value.read({ signal: aborter.signal }));
        assert(result.code === translated(format, "CHECKPOINT_CANCELLED"), "pre-aborted read rejected");
        assert(opens === 0 && f.guard.state().active === 0, "no native operation");
      });
    });

    test(`storage-guard: ${format.key} closed adapter rejects while independent adapter remains usable`, async () => {
      await nativeFixture(async f => {
        const first = f.storage(format);
        const empty = await first.value.read();
        const saved = await first.value.change(format.expected(empty), await format.operation(1));
        first.value.close();
        assert(!(await outcome(first.value.read())).ok, "closed read refused");
        const next = f.storage(format, { name: first.name });
        same(await next.value.read(), saved, "closing did not clear database");
      });
    });
  }

  test("storage-guard: caller mutation during delayed native open cannot change reviewed payload", async () => {
    await nativeFixture(async f => {
      const gate = openGate();
      const { value } = f.storage(formats[0], { indexedDB: gate.factory });
      const operation = save(1, "Reviewed original");
      const pending = value.change(0, operation);
      operation.label = "Unexpected replacement";
      operation.fileText = '{"different":true}';
      await waitFor(() => gate.ready === 1);
      gate.release();
      const saved = await pending;
      assert(saved.entries[0].label === "Reviewed original", "fixed label");
      assert(saved.entries[0].fileText === "{}", "fixed contents");
    });
  });

  test("storage-guard: cancel during open rejects promptly and retains slot until real terminal", async () => {
    await nativeFixture(async f => {
      const gate = openGate();
      const { value } = f.storage(formats[0], { indexedDB: gate.factory });
      const aborter = new AbortController();
      const result = outcome(value.read({ signal: aborter.signal }));
      await waitFor(() => gate.ready === 1);
      aborter.abort();
      assert((await result).code === "CHECKPOINT_CANCELLED", "caller stopped");
      assert(f.guard.state().active === 1 && f.guard.state().draining === 1, "slot quarantined");
      assert((await outcome(value.read())).code === "CHECKPOINT_BLOCKED", "abandoned open cannot be reused");
      assert(gate.opens === 1, "no retry storm");
      gate.release();
      await waitFor(() => f.guard.state().active === 0);
      assert(f.guard.state().uncertain === 0, "no write to reconcile");
    });
  });

  test("storage-guard: one cancelled native open waiter does not discard an authorized peer", async () => {
    await nativeFixture(async f => {
      const gate = openGate();
      const { value } = f.storage(formats[0], { indexedDB: gate.factory });
      const aborter = new AbortController();
      const first = outcome(value.read({ signal: aborter.signal }));
      const second = outcome(value.read());
      await waitFor(() => gate.ready === 1);
      aborter.abort();
      gate.release();
      assert((await first).code === "CHECKPOINT_CANCELLED", "first cancelled");
      assert((await second).ok, "peer completed");
      assert(gate.opens === 1, "native open shared");
    });
  });

  test("storage-guard: five adapters share one four-operation cap", async () => {
    await nativeFixture(async f => {
      const gates = formats.map(() => openGate());
      const stores = formats.map((format, index) => f.storage(format, { indexedDB: gates[index].factory }));
      const reads = stores.slice(0, 4).map(item => outcome(item.value.read()));
      await waitFor(() => gates.slice(0, 4).every(gate => gate.ready === 1));
      const refused = await outcome(stores[4].value.read());
      assert(refused.code === "CHECKPOINT_BUSY", "fifth refused before native work");
      assert(gates[4].opens === 0, "fifth not queued");
      assert(f.guard.cancelAll() === 4, "four callers stopped");
      for (const result of await Promise.all(reads)) assert(!result.ok, "no cancelled result adopted");
      assert(f.guard.state().active === 4, "all four native slots retained");
      gates.forEach(gate => gate.release());
      await waitFor(() => f.guard.state().active === 0);
    });
  });

  test("storage-guard: clock rollback closes admission after native request was created", async () => {
    await nativeFixture(async f => {
      const time = virtualDeadline();
      const { value, name } = f.storage(formats[0], { deadlineOptions: time.options });
      const original = await value.change(0, save(1));
      const result = await outcome(value.change(1, save(2), { canCommit() { time.set(1); return true; } }));
      assert(result.code === "CHECKPOINT_CLOCK", "rollback refused");
      await waitFor(() => f.guard.state().active === 0);
      same(await rawDocument(name), original, "no write after bad clock");
      assert((await outcome(value.read())).code === "CHECKPOINT_CLOCK", "page admission stays closed");
    });
  });

  test("storage-guard: stored schema corruption is reported without repairing or overwriting", async () => {
    await nativeFixture(async f => {
      const { value, name } = f.storage();
      await value.change(0, save(1));
      const corrupt = await rawDocument(name, previous => ({ ...previous, revision: -1 }));
      assert(!(await outcome(value.read())).ok, "bad schema refused");
      assert(!(await outcome(value.change(1, save(2)))).ok, "write through corruption refused");
      same(await rawDocument(name), corrupt, "evidence preserved untouched");
    });
  });

  test("storage-guard: unexpected existing object store schema is not silently migrated", async () => {
    await nativeFixture(async f => {
      const name = f.name();
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore("other-data");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      const { value } = f.storage(formats[0], { name });
      assert((await outcome(value.read())).code === "CHECKPOINT_SCHEMA", "missing expected store refused");
      const inspect = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      assert(inspect.objectStoreNames.contains("other-data"), "existing store preserved");
      assert(!inspect.objectStoreNames.contains("checkpoints"), "no accidental repair");
      inspect.close();
    });
  });

  test("storage-guard: native version change closes stale adapter connection", async () => {
    await nativeFixture(async f => {
      const { value, name } = f.storage();
      await value.change(0, save(1));
      const upgraded = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(Error("old adapter failed to release version change"));
      });
      upgraded.close();
      assert((await outcome(value.read())).code === "CHECKPOINT_VERSION", "cannot downgrade future database");
    });
  });

  test("storage-guard: native result is detached and frozen before UI receives it", async () => {
    await nativeFixture(async f => {
      const { value } = f.storage();
      const result = await value.change(0, save(1));
      assert(Object.isFrozen(result) && Object.isFrozen(result.entries[0]), "deeply frozen");
      let threw = false;
      try { result.entries[0].label = "in-place edit"; } catch { threw = true; }
      assert(threw, "strict mutation rejected");
      const next = await value.read();
      same(result, next, "mutation cannot affect subsequent read");
      assert(result !== next && result.entries !== next.entries, "detached read instances");
    });
  });

  test("storage-guard: panel Stop cancels actual waiting request and shows only aggregate status", async () => {
    await nativeFixture(async f => {
      const host = document.createElement("div");
      document.body.append(host);
      const panel = mountStorageGuardPanel({ document, parent: host, guard: f.guard });
      f.cleanup(() => { panel.dispose(); host.remove(); });
      const gate = openGate();
      const { value, name } = f.storage(formats[0], { indexedDB: gate.factory });
      const pending = outcome(value.change(0, save(1, "private-label-never-in-status")));
      await waitFor(() => gate.ready === 1);
      const stop = host.querySelector(".storage-guard-stop");
      assert(!stop.disabled, "stop enabled");
      stop.click();
      assert((await pending).code === "CHECKPOINT_CANCELLED", "UI cancelled real caller");
      await pause();
      assert(host.textContent.includes("終了を待っています"), "native drain visible");
      assert(!host.textContent.includes(name), "database name not rendered");
      assert(!host.textContent.includes("private-label"), "saved data not rendered");
      gate.release();
      await waitFor(() => f.guard.state().active === 0);
      await pause();
      assert(stop.disabled, "stop disabled after terminal");
    });
  });

  test("storage-guard: disposed panel cannot cancel newer operations through a retained button", async () => {
    await nativeFixture(async f => {
      const host = document.createElement("div");
      document.body.append(host);
      const panel = mountStorageGuardPanel({ document, parent: host, guard: f.guard });
      const button = host.querySelector(".storage-guard-stop");
      panel.dispose();
      host.remove();
      const gate = openGate();
      const { value } = f.storage(formats[0], { indexedDB: gate.factory });
      const pending = outcome(value.read());
      await waitFor(() => gate.ready === 1);
      button.disabled = false;
      button.click();
      assert(f.guard.state().cancelled === 0, "detached UI inert");
      gate.release();
      assert((await pending).ok, "active caller survived old UI");
    });
  });

  test("storage-guard: fresh native document has unchanged schema and revision", async () => {
    await nativeFixture(async f => {
      const { value, name } = f.storage();
      same(await value.read(), emptyCheckpointDocument(), "compatible initial value");
      assert(await rawDocument(name) === undefined, "read did not initialize a record");
    });
  });
}
