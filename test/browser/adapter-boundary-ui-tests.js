import { createRpcSupervisor } from "/src/rpc-supervisor.js";
import { createFileReadService } from "/src/file-read-service.js";
import { createSecureBackupRunner } from "/src/secure-backup-runner.js";
import { createExportGuard } from "/src/export-guard.js";
import { mountFileReadPanel } from "/examples/file-read-panel.js";
import { mountExportGuardPanel } from "/examples/export-guard-panel.js";
import { mountTabGuardPanel } from "/examples/tab-guard-panel.js";
import { manualTime, microtasks } from "/test/helpers/secure-lifecycle-time.js";

const assert = (value, message) => { if (!value) throw Error(message); };
const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function wait(predicate) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5000) throw Error("Adapter UI observation deadline");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function host() {
  const parent = document.createElement("section");
  document.body.append(parent);
  return parent;
}

export function registerAdapterBoundaryUITests(test) {
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test(`adapter-boundary: ${agent} refuses connection with asynchronous RPC timer`, async fixture => {
      const time = manualTime();
      const supervisor = createRpcSupervisor({ ...time.options,
        schedule(fn, ms) { return Promise.resolve(time.schedule(fn, ms)); } });
      const f = fixture(undefined, { rpcSupervisor: supervisor });
      const card = document.querySelector(`[data-agent="${agent}"]`);
      // The base fixture prepopulates DAT. Keep account uniqueness checks valid
      // so the selected card reaches the deadline boundary being exercised.
      if (agent !== "DAT") f.input(".account", "0x" + "22".repeat(20));
      for (const [selector, value, event] of [[".account", "0x" + "11".repeat(20), "input"], [".chain", "8453", "change"]]) {
        const field = card.querySelector(selector);
        field.value = value; field.dispatchEvent(new Event(event, { bubbles: true }));
      }
      card.querySelector(".connect").click();
      await wait(() => supervisor.state().failed === 1);
      await microtasks();
      assert(f.calls.length === 0, "Provider must never be called without a valid deadline");
      assert(card.querySelector(".read").disabled, "Failed connection cannot expose balance reads");
      assert(time.pending === 0, "Late registration is released");
      for (const id of time.allIds()) time.fire(id, { stale: true });
      await turn();
      assert(f.calls.length === 0 && card.querySelector(".read").disabled, "Stale timer cannot reconnect");
    });
  }

  for (const mode of ["readText", "readBytes"]) {
    test(`adapter-boundary: native File ${mode} refuses async timer and recovers explicitly`, async () => {
      const parent = host(), time = manualTime();
      let broken = true;
      const service = createFileReadService({ ...time.options,
        schedule(fn, ms) { const id = time.schedule(fn, ms); return broken ? Promise.resolve(id) : id; } });
      const panel = mountFileReadPanel({ document, parent, service });
      let opened = 0;
      const file = new File(["DAT EMA CAWELON"], "synthetic-private-name.json");
      const nativeStream = file.stream;
      file.stream = function() { opened++; return nativeStream.call(this); };
      try {
        assert((await outcome(service[mode](file))).code === "FILE_READ", "Invalid timer must reject native input");
        await microtasks();
        assert(opened === 0 && time.pending === 0, "No file opened and no timer retained");
        assert(service.state().active === 0, "Undispatched file does not retain budget");
        assert(!parent.textContent.includes(file.name), "File name must not enter aggregate status");
        broken = false;
        const value = await service[mode](file);
        assert(mode === "readText" ? value === "DAT EMA CAWELON" : new TextDecoder().decode(value) === "DAT EMA CAWELON", "Fresh explicit selection still reads the file");
        assert(service.state().completed === 1, "Only the valid read counts as completed");
        assert(parent.querySelector(".file-read-panel").dataset.level === "ready", "Status recovers");
      } finally { panel.dispose(); service.dispose(); parent.remove(); }
    });
  }

  test("adapter-boundary: native abort state wins over a shadowed property", async () => {
    const service = createFileReadService(), runner = createSecureBackupRunner();
    const abort = new AbortController();
    Object.defineProperty(abort.signal, "aborted", { value: false });
    abort.abort();
    let cryptoCalls = 0;
    try {
      const file = new File(["private synthetic content"], "synthetic.json");
      assert((await outcome(service.readText(file, { signal: abort.signal }))).code === "FILE_CANCELLED", "Native cancelled file must be refused");
      assert((await outcome(runner.run(() => { cryptoCalls++; }, { signal: abort.signal }))).code === "SECURE_CANCELLED", "Native cancelled crypto must be refused");
      assert(cryptoCalls === 0 && service.state().accepted === 0, "No protected work admitted");
    } finally { service.dispose(); runner.dispose(); }
  });

  test("adapter-boundary: silent native abort after stream read drops its data", async () => {
    const parent = host(), gate = deferred(), abort = new AbortController();
    const service = createFileReadService();
    const panel = mountFileReadPanel({ document, parent, service });
    let cancelled = 0;
    const stream = new ReadableStream({ start(controller) {
      gate.promise.then(() => controller.enqueue(new Uint8Array([65]))).catch(() => {});
    }, cancel() { cancelled++; } });
    // Simulate a wrapper which missed notification while preserving native state.
    abort.signal.addEventListener = () => {};
    Object.defineProperty(abort.signal, "aborted", { value: false });
    try {
      const pending = outcome(service.readText({ size: 1, stream: () => stream }, { signal: abort.signal, timeoutMs: 1000 }));
      await turn();
      abort.abort(); gate.resolve();
      assert((await pending).code === "FILE_CANCELLED", "Silent abort must beat returned bytes");
      await turn();
      assert(service.state().completed === 0 && service.state().cancelled === 1, "No successful import");
      assert(cancelled === 1 && !stream.locked, "Native reader released after actual settlement");
      assert(parent.querySelector(".file-read-panel").dataset.level === "ready", "Status has no stuck operation");
    } finally { service.dispose(); panel.dispose(); parent.remove(); gate.resolve(); }
  });

  test("adapter-boundary: stop button with delayed timer cleanup never accepts late bytes", async () => {
    const parent = host(), time = manualTime(), gate = deferred();
    const cleanup = deferred();
    const service = createFileReadService({ ...time.options,
      unschedule(id) { return cleanup.promise.then(() => time.unschedule(id)); } });
    const panel = mountFileReadPanel({ document, parent, service });
    try {
      const pending = outcome(service.readText({ size: 1, arrayBuffer: () => gate.promise }));
      await turn();
      parent.querySelector(".file-read-stop").click();
      assert((await pending).code === "FILE_CANCELLED", "Button cancels the local waiter immediately");
      assert(service.state().retained === 1, "Unsettled native work retains its budget");
      for (const id of time.allIds()) time.fire(id, { stale: true });
      cleanup.resolve(); gate.resolve(new Uint8Array([65]).buffer);
      await turn();
      assert(service.state().active === 0 && service.state().completed === 0, "Late bytes cannot become success");
      assert(time.pending === 0, "Actual delayed cleanup finishes");
    } finally { service.dispose(); panel.dispose(); parent.remove(); cleanup.resolve(); gate.resolve(new ArrayBuffer(0)); }
  });

  test("adapter-boundary: export timer refusal does not activate or claim a saved file", async () => {
    const parent = host(), time = manualTime();
    let activated = 0, released = 0;
    const guard = createExportGuard({ ...time.options,
      schedule(fn, ms) { return Promise.resolve(time.schedule(fn, ms)); },
      createResource: () => ({ activate() { activated++; }, release() { released++; return true; } }) });
    const panel = mountExportGuardPanel({ document, parent, guard });
    try {
      let error;
      try { guard.offer({ text: "synthetic private data", filename: "synthetic.json", mimeType: "application/json" }); }
      catch (value) { error = value; }
      await microtasks();
      assert(error?.code === "EXPORT_FAILED", "Export fails with static code");
      assert(activated === 0 && released >= 1, "Resources reclaimed without download activation");
      assert(guard.state().offered === 0 && guard.state().active === 0, "No success claim or budget leak");
      assert(time.pending === 0, "Late handle removed");
      assert(!parent.textContent.includes("synthetic private data"), "Content absent from aggregate status");
    } finally { panel.dispose(); guard.dispose(); parent.remove(); }
  });

  test("adapter-boundary: tab stop button refuses unprotected receipt wait", async () => {
    const parent = host(), time = manualTime(1780000000000), posts = [], stops = [];
    const panel = mountTabGuardPanel({ document, parent, onStop: reason => { stops.push(reason); return true; },
      options: { ...time.options, schedule(fn, ms) { return Promise.resolve(time.schedule(fn, ms)); },
        transport: { subscribe: () => true, close() {}, post(signal) { posts.push(signal); return true; } } } });
    try {
      parent.querySelector(".tab-guard-stop").click();
      await microtasks();
      assert(stops.includes("broadcast-stop"), "Current screen still stops first");
      assert(posts.length === 0, "No message sent without a valid receipt deadline");
      assert(panel.state().phase === "error" && panel.state().errorCode === "TAB_CONFIG", "Actionable error displayed");
      assert(parent.querySelector(".tab-guard-status").textContent.includes("開き直して"), "Recovery instruction shown");
      assert(parent.querySelector(".tab-guard-receipts").textContent.includes("まだ送っていません"), "No claim of successful cross-tab stop");
      assert(time.pending === 0, "Late receipt timer removed");
    } finally { panel.dispose(); parent.remove(); }
  });
}
