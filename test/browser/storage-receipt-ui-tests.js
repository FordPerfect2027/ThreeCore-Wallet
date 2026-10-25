import { nativeFixture, formats, rawDocument, outcome, assert, same, waitFor, pause } from "./storage-guard-fixture.js";
import { DELIVERY_CASES, exportReceiptFixture } from "../helpers/export-receipt-fixtures.js";
import { memoryStorage, stored, preparedDraft, id } from "../helpers/checkpoint-fixtures.js";
import { draft } from "../helpers/workspace-fixtures.js";
import { workspace } from "../helpers/reconciliation-fixtures.js";
import { mountCheckpointPanel } from "/examples/checkpoint-panel.js";
import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";

function host() {
  const parent = document.createElement("section");
  document.body.append(parent);
  return parent;
}
function delayedSignal(kind) {
  const listeners = new Set();
  const aborter = new AbortController();
  const signal = aborter.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  let finish, registrations = 0;
  const ready = new Promise(resolve => { finish = resolve; });
  signal.addEventListener = (type, callback, options) => {
    registrations++;
    if (kind === "false") return false;
    return ready.then(() => { listeners.add(callback); add(type, callback, options); });
  };
  signal.removeEventListener = (type, callback) => { listeners.delete(callback); remove(type, callback); };
  return {
    signal, finish, listeners, registrations: () => registrations,
  };
}

export function registerStorageReceiptUITests(test) {
  for (const format of formats) {
    for (const kind of ["false", "late"]) {
      for (const action of ["read", "write"]) {
        test(`storage-receipt: native ${format.key} ${action} rejects ${kind} abort registration`, async () => {
          await nativeFixture(async f => {
            const { name, value } = f.storage(format);
            const initial = await value.read();
            await value.change(format.expected(initial), await format.operation(1));
            const current = await value.read(), before = await rawDocument(name);
            const registration = delayedSignal(kind);
            try {
              const result = await outcome(action === "read" ? value.read({ signal: registration.signal }) :
                value.change(format.expected(current), await format.operation(2), { signal: registration.signal }));
              assert(registration.registrations() === 1, "the test must reach the native signal registration boundary");
              assert(!result.ok, "invalid abort registration must not permit native work");
              registration.finish(); await pause();
              assert(registration.listeners.size === 0, "late listener must be detached");
              same(await rawDocument(name), before, "stored records must be preserved");
              assert(f.guard.state().active === 0, "unstarted work must release its admission slot");
              // Normal AbortSignal still permits a fresh, explicitly requested operation.
              const abort = new AbortController();
              const reread = await value.read({ signal: abort.signal });
              same(reread, current, "fresh native read retains data");
            } finally { registration.finish(); }
          });
        });
      }
    }
  }

  for (const name of DELIVERY_CASES) {
    test(`storage-receipt: ${name} refuses delivery and recovers with a native Blob`, async () => {
      const f = await exportReceiptFixture(name), before = f.source();
      let reads = 0, settlement;
      try {
        const late = { get then() { reads++; return resolve => { settlement = resolve; }; } };
        assert(await f.send(f.formats[0], () => late) === false, "async receipt is not delivery");
        await pause(); settlement(true); await pause();
        assert(reads === 1, "then getter is read once");
        assert(!(f.state().savedCurrent ?? f.state().exportedCurrent), "late receipt cannot mark success");
        assert(await f.send(f.formats[0], () => false) === false, "explicit refusal is retained");
        let blob, text;
        assert(await f.send(f.formats[0], file => {
          text = file.text; blob = new Blob([text], { type: file.mimeType }); return true;
        }) === true, "fresh synchronous browser delivery succeeds");
        assert(await blob.text() === text, "browser Blob preserves prepared content");
        same(f.source(), before, "delivery cannot mutate source records");
      } finally { f.dispose(); }
    });
  }

  for (const action of ["export", "export-collection", "stage"]) {
    for (const receipt of [false, "promise"]) {
      test(`storage-receipt: checkpoint ${action} UI reports ${receipt} refusal and preserves records`, async () => {
        const parent = host(), file = await preparedDraft();
        const storage = memoryStorage(stored(1, file.text)), before = storage.current();
        let permitted = false, deliveries = 0;
        const receive = () => { deliveries++; return permitted ? true : receipt === "promise" ? Promise.resolve(true) : false; };
        const panel = mountCheckpointPanel({ document, parent, storage, readDraft: () => draft(),
          onStage: receive, download: receive });
        const node = name => parent.querySelector(".checkpoint-" + name);
        const idle = () => parent.querySelector(".checkpoint-panel").getAttribute("aria-busy") === "false";
        try {
          node("refresh").click(); await waitFor(() => !node("select").disabled);
          node("select").value = id(1); node("select").dispatchEvent(new Event("change", { bubbles: true }));
          if (action === "stage") { node("inspect").click(); await waitFor(() => !node("stage").disabled); }
          node(action).click(); await waitFor(() => deliveries === 1 && idle());
          const message = node("status").textContent;
          assert(message.includes(action === "stage" ? "渡せませんでした" : "開始できませんでした"), "UI must show refusal");
          assert(!message.includes("開始しました") && !message.includes("控えを入れました"), "no false success");
          same(storage.current(), before, "stored backup remains unchanged");
          permitted = true;
          if (action === "stage") { node("inspect").click(); await waitFor(() => !node("stage").disabled); }
          node(action).click(); await waitFor(() => deliveries === 2 && idle());
          assert(node("status").textContent.includes(action === "stage" ? "控えを入れました" : "開始しました"), "explicit retry succeeds");
          same(storage.current(), before, "successful handoff also preserves backup");
        } finally { panel.dispose(); parent.remove(); }
      });
    }
  }

  for (const kind of ["false", "promise", "cancel", "dispose"]) {
    test(`storage-receipt: reconciliation UI does not announce success after ${kind}`, async () => {
      const parent = host();
      let panel, calls = 0;
      panel = mountReconciliationPanel({ document, parent, initial: workspace(), download: () => {
        calls++;
        if (kind === "cancel") parent.querySelector(".reconciliation-cancel").click();
        if (kind === "dispose") panel.dispose();
        return kind === "promise" ? Promise.resolve(true) : kind !== "false";
      } });
      try {
        parent.querySelector(".reconciliation-export-json").click();
        await waitFor(() => calls === 1); await pause();
        if (kind === "dispose") assert(!parent.querySelector(".reconciliation-panel"), "disposed panel stays removed");
        else {
          assert(!parent.querySelector(".reconciliation-export-status").textContent.includes("開始済み"), "no false saved marker");
          assert(parent.querySelector(".reconciliation-panel").getAttribute("aria-busy") === "false", "UI no longer busy");
          if (kind !== "cancel") assert(parent.querySelector(".reconciliation-status").getAttribute("data-error") === "true", "failure visible");
        }
      } finally { panel.dispose(); parent.remove(); }
    });
  }
}
