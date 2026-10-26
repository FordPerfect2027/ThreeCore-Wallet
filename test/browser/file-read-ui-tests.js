import { createFileReadService } from "/src/file-read-service.js";
import { mountFileReadPanel } from "/examples/file-read-panel.js";
import { createWalletSetupFileReader, prepareWalletSetupFile } from "/src/wallet-setup-file.js";
import { WALLET_SETUP_SCHEMA, WalletSetupError } from "/src/wallet-setup.js";
import { mountWalletSetupPanel } from "/examples/wallet-setup-panel.js";
import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { prepareWorkspaceFile, createWorkspaceFileReader } from "/src/workspace-file.js";
import { workspaceFromDraft, WorkspaceError } from "/src/workspace-format.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { createHistoryFileReader } from "/src/history-file-reader.js";
import { readSecurityFileBytes } from "/src/security-file.js";

const assert = (value, message = "File boundary UI assertion failed") => { if (!value) throw Error(message); };
const bytes = text => new TextEncoder().encode(text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));

async function isolated(action, options = {}) {
  const service = createFileReadService(options);
  const host = document.createElement("div");
  document.body.append(host);
  const panel = mountFileReadPanel({ document, parent: host, service });
  const pending = [];
  function start(size = 1) {
    const gate = deferred();
    let calls = 0;
    const file = { name: "synthetic.json", size, arrayBuffer() { calls++; return gate.promise; } };
    const result = outcome(service.readText(file));
    const item = { gate, result, calls: () => calls };
    pending.push(item);
    return item;
  }
  try {
    await action({ service, host, panel, start,
      field: name => host.querySelector(".file-read-" + name),
      level: () => host.querySelector(".file-read-panel")?.getAttribute("data-level") });
  } finally {
    panel.dispose(); service.dispose();
    pending.forEach(item => item.gate.resolve(new ArrayBuffer(0)));
    await Promise.all(pending.map(item => item.result));
    host.remove();
    await tick();
  }
}

export function registerFileReadUITests(test) {
  for (const kind of ["settings", "workspace", "history"]) {
    test(`file-read: ${kind} native import clears content before cleanup and contains rejected notifications`, async () => {
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const history = createPortfolioHistory().exportText();
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "", history }));
      const text = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields }).text
        : kind === "workspace" ? (await prepareWorkspaceFile(workspaceFromDraft(draft))).text : history;
      const file = new File([text], "synthetic.json", { type: "application/json" });
      let reader, observed, notifications = 0;
      const options = { agent: "DAT", onChange() {
        notifications++;
        return Promise.reject(Error("synthetic import observer rejection"));
      }, readBytes(input, config) {
        config.signal.addEventListener("abort", () => { observed = reader.state(); }, { once: true });
        return readSecurityFileBytes(input, config);
      } };
      reader = kind === "settings" ? createWalletSetupFileReader(options)
        : kind === "workspace" ? createWorkspaceFileReader(options) : createHistoryFileReader(options);
      try {
        await reader.load(file);
        assert(reader.state().phase === "ready", "native file accepted");
        reader.cancel();
        assert(observed.phase === (kind === "settings" ? "idle" : "cancelled"), "cleanup sees stopped state");
        assert((observed.result ?? observed.text ?? null) === null, "plaintext absent during cleanup");
        await tick();
        await reader.load(file);
        assert(reader.state().phase === "ready", "fresh selection succeeds");
        assert(notifications === 5, "bounded reading/ready/stop/reading/ready notifications");
      } finally { reader.dispose(); }
      await tick();
      let nested, stopOnce = false, reads = 0;
      const stoppedOptions = { agent: "DAT", readBytes(input, config) {
        reads++;
        return readSecurityFileBytes(input, config);
      }, onChange(state) {
        if (state.phase === "reading" && !stopOnce) { stopOnce = true; reader.cancel(); }
        else if (state.phase === (kind === "settings" ? "idle" : "cancelled")) nested = reader.load(file);
      } };
      reader = kind === "settings" ? createWalletSetupFileReader(stoppedOptions)
        : kind === "workspace" ? createWorkspaceFileReader(stoppedOptions) : createHistoryFileReader(stoppedOptions);
      try {
        await reader.load(file); await nested;
        assert(reads === 0, "deferred stop delivery cannot start another native read");
        assert((reader.state().result ?? reader.state().text ?? null) === null, "no revoked import revived");
      } finally { reader.dispose(); }
    });
  }

  for (const kind of ["settings", "workspace"]) {
    test(`file-read: ${kind} inaccessible error cannot wedge the panel or overwrite its draft`, async () => {
      const parent = document.createElement("section");
      document.body.append(parent);
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "",
        history: createPortfolioHistory().exportText() }));
      const prepared = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields })
        : await prepareWorkspaceFile(workspaceFromDraft(draft));
      const prefix = kind === "settings" ? "wallet-setup-" : "workspace-";
      const field = suffix => parent.querySelector("." + prefix + suffix);
      let reads = 0, accesses = 0, writes = 0;
      const failure = kind === "settings" ? new WalletSetupError("SETUP_SIZE") : new WorkspaceError("WORKSPACE_FILE_SIZE");
      Object.defineProperty(failure, "code", { get() { accesses++; throw Error("synthetic private diagnostic"); } });
      const readBytes = (input, options) => {
        if (++reads === 1) throw failure;
        return readSecurityFileBytes(input, options);
      };
      const panel = kind === "settings"
        ? mountWalletSetupPanel({ document, parent, readFields: () => fields, applyPlan() { writes++; }, readBytes })
        : mountWorkspacePanel({ document, parent, readDraft: () => draft, writeDraft() { writes++; }, readBytes });
      function choose() {
        const transfer = new DataTransfer();
        transfer.items.add(new File([prepared.text], "synthetic.json", { type: "application/json" }));
        field("file").files = transfer.files;
        field("file").dispatchEvent(new Event("change"));
      }
      async function idle() {
        const start = Date.now();
        while (field("file").disabled && Date.now() - start < 5000) await tick();
        assert(!field("file").disabled, "file input recovers after error");
      }
      try {
        field("json").value = "preserved unfinished draft";
        field("json").dispatchEvent(new Event("input"));
        choose(); await idle();
        assert(accesses === 0, "error accessor not invoked");
        assert(!parent.textContent.includes("private diagnostic"), "private diagnostics absent from DOM");
        assert(field("json").value === "preserved unfinished draft", "original edit preserved");
        assert(field("apply").disabled && writes === 0, "error cannot authorize restore");
        choose(); await idle();
        assert(reads === 2 && field("json").value !== "preserved unfinished draft", "fresh valid import offered");
        assert(field("apply").disabled && writes === 0, "new import still requires review");
      } finally { panel.dispose(); parent.remove(); }
    });
  }

  for (const kind of ["settings", "workspace"]) {
    test(`file-read: ${kind} panel cancellation cannot open a file from cleanup`, async () => {
      const parent = document.createElement("section");
      document.body.append(parent);
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "",
        history: createPortfolioHistory().exportText() }));
      const prepared = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields })
        : await prepareWorkspaceFile(workspaceFromDraft(draft));
      const gate = deferred();
      const signals = [];
      let applied = 0;
      const prefix = kind === "settings" ? "wallet-setup-" : "workspace-";
      const field = suffix => parent.querySelector("." + prefix + suffix);
      function choose() {
        const transfer = new DataTransfer();
        transfer.items.add(new File([prepared.text], "synthetic.json", { type: "application/json" }));
        field("file").files = transfer.files;
        field("file").dispatchEvent(new Event("change"));
      }
      const readBytes = (file, { signal }) => {
        signals.push(signal);
        if (signals.length === 1) signal.addEventListener("abort", choose, { once: true });
        return gate.promise;
      };
      const panel = kind === "settings"
        ? mountWalletSetupPanel({ document, parent, readFields: () => fields,
          applyPlan() { applied++; }, readBytes })
        : mountWorkspacePanel({ document, parent, readDraft: () => draft,
          writeDraft() { applied++; }, readBytes });
      try {
        field("json").value = "keep this unfinished draft";
        field("json").dispatchEvent(new Event("input"));
        choose();
        assert(signals.length === 1, "first file started");
        field("cancel").click();
        gate.resolve(bytes(prepared.text));
        await tick(); await tick();
        assert(signals.length === 1, "cleanup opened another file");
        assert(signals[0].aborted, "original IO not stopped");
        assert(field("json").value === "keep this unfinished draft", "cancelled result replaced draft");
        assert(!field("file").disabled && field("apply").disabled, "cancelled review state incorrect");
        assert(applied === 0, "file selection applied settings or history");
        // A separate, later selection is still usable and requires fresh review.
        choose();
        const started = Date.now();
        while (field("file").disabled && Date.now() - started < 5000) await tick();
        assert(signals.length === 2 && !field("file").disabled, "explicit new selection could not finish");
        assert(field("json").value !== "keep this unfinished draft", "new draft not offered");
        assert(field("apply").disabled && applied === 0, "new file bypassed review");
      } finally {
        panel.dispose(); gate.resolve(bytes(prepared.text)); parent.remove();
      }
    });
  }

  test("file-read: production screen mounts status without wallet requests", async fixture => {
    const f = fixture();
    const panel = document.querySelector(".file-read-panel");
    assert(panel);
    assert(panel.querySelector("h3").textContent === "ファイル読み込みの保護");
    assert(panel.querySelector(".file-read-headline").getAttribute("aria-live") === "polite");
    assert(panel.querySelector(".file-read-stop").type === "button");
    assert(f.calls.length === 0);
  });

  test("file-read: stop button ends waiter but keeps native reservation", async () => {
    await isolated(async ({ service, start, field, level }) => {
      const operation = start(2);
      await tick();
      assert(level() === "reading");
      field("stop").click();
      assert((await operation.result).code === "FILE_CANCELLED");
      assert(level() === "retained");
      assert(service.state().reservedBytes === 2);
      assert(field("action").textContent.includes("1件"));
      operation.gate.resolve(bytes("ok").buffer);
      await tick();
      assert(level() === "ready");
      assert(service.state().completed === 0);
    });
  });

  test("file-read: four pending reads refuse a fifth without calling it", async () => {
    await isolated(async ({ service, start, level, field }) => {
      const operations = Array.from({ length: 4 }, () => start());
      await tick();
      assert(level() === "limited");
      let calls = 0;
      const refused = await outcome(service.readText({ size: 1, arrayBuffer() { calls++; return new ArrayBuffer(1); } }));
      assert(refused.code === "FILE_BUSY");
      assert(calls === 0);
      field("stop").click();
      assert((await Promise.all(operations.map(item => item.result))).every(item => item.code === "FILE_CANCELLED"));
      assert(level() === "limited");
      operations.forEach(item => item.gate.resolve(new ArrayBuffer(0)));
      await tick();
      assert(level() === "ready");
    });
  });

  test("file-read: byte reservation cap is visible separately from job count", async () => {
    await isolated(async ({ service, start, level, field }) => {
      start(96 * 1024 * 1024);
      start(32 * 1024 * 1024);
      await tick();
      assert(service.state().active === 2);
      assert(level() === "limited");
      assert(field("counts").textContent.includes("134217728 / 134217728"));
      assert(field("scope").textContent.includes("メモリ使用量ではありません"));
    });
  });

  test("file-read: native File stream ignores a broken unused fallback getter", async () => {
    await isolated(async ({ service, level, field }) => {
      const file = new File(["DAT・EMA・CAWELON🔐"], "synthetic.json");
      Object.defineProperty(file, "arrayBuffer", { get() { throw Error("unused fallback"); } });
      assert(await service.readText(file) === "DAT・EMA・CAWELON🔐");
      assert(level() === "ready");
      assert(field("counts").textContent.includes("完了 1件"));
    });
  });

  test("file-read: native stream cancellation releases its browser lock", async () => {
    await isolated(async ({ service, field }) => {
      let cancelled = 0;
      const stream = new ReadableStream({ cancel() { cancelled++; } });
      const result = outcome(service.readText({ size: 1, stream: () => stream }));
      await tick();
      field("stop").click();
      assert((await result).code === "FILE_CANCELLED");
      await tick();
      assert(cancelled === 1);
      assert(!stream.locked);
      assert(service.state().active === 0);
    });
  });

  test("file-read: global protection stop also stops file reads", async fixture => {
    const service = createFileReadService();
    const gate = deferred();
    const f = fixture(undefined, { fileReadService: service });
    const result = outcome(service.readText({ size: 1, arrayBuffer: () => gate.promise }));
    try {
      await tick();
      document.querySelector(".security-stop").click();
      assert((await result).code === "FILE_CANCELLED");
      assert(service.state().retained === 1);
      assert(f.calls.length === 0);
      gate.resolve(new ArrayBuffer(1));
      await tick();
      assert(service.state().completed === 0);
    } finally { service.dispose(); gate.resolve(new ArrayBuffer(0)); }
  });

  test("file-read: clock fault appears without echoing adapter errors", async () => {
    let time = 100;
    await isolated(async ({ service, start, level, field }) => {
      const operation = start();
      await tick();
      time = 99;
      const second = await outcome(service.readText(new File(["x"], "synthetic.json")));
      assert(second.code === "FILE_CLOCK");
      assert((await operation.result).code === "FILE_CLOCK");
      assert(level() === "stopped");
      assert(field("detail").textContent.includes("経過時間"));
      assert(service.state().canStart === false);
    }, { now: () => time });
  });

  test("file-read: throttled timer cannot accept result after deadline", async () => {
    let time = 0;
    await isolated(async ({ service, level }) => {
      const gate = deferred();
      const result = outcome(service.readText({ size: 2, arrayBuffer: () => gate.promise }, { timeoutMs: 10 }));
      await tick(); time = 10;
      gate.resolve(bytes("ok").buffer);
      assert((await result).code === "FILE_TIMEOUT");
      assert(level() === "ready");
      assert(service.state().completed === 0);
    }, { now: () => time, schedule: () => 1, unschedule() {} });
  });

  test("file-read: native settings import keeps existing three-account schema", async () => {
    const prepared = prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA,
      entries: ["DAT", "EMA", "CAWELON"].map((agent, i) => ({ agent,
        account: "0x" + String(i + 1).repeat(40), chainId: 84532 })) });
    const reader = createWalletSetupFileReader();
    try {
      await reader.load(new File([prepared.text], prepared.filename));
      assert(reader.state().phase === "ready");
      assert(reader.state().text === prepared.text);
    } finally { reader.dispose(); }
  });

  for (const encoding of [[0xff], [0xc3], [0xf4, 0x90, 0x80, 0x80]]) {
    test("file-read: native malformed UTF-8 is rejected " + encoding, async () => {
      await isolated(async ({ service, field }) => {
        const file = new File([Uint8Array.from(encoding)], "synthetic.json");
        assert((await outcome(service.readText(file))).code === "FILE_ENCODING");
        assert(field("counts").textContent.includes("読み込み失敗 1件"));
        assert(service.state().active === 0);
      });
    });
  }

  test("file-read: partial native stream is rejected without a completed count", async () => {
    await isolated(async ({ service }) => {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("x")); controller.close(); } });
      assert((await outcome(service.readBytes({ size: 2, stream: () => stream }))).code === "FILE_SIZE");
      assert(service.state().completed === 0);
      assert(!stream.locked);
    });
  });

  test("file-read: stopped panel does not stop a shared service used elsewhere", async () => {
    await isolated(async ({ service, panel, start, host }) => {
      const operation = start(2);
      await tick(); panel.dispose();
      assert(!host.querySelector(".file-read-panel"));
      operation.gate.resolve(bytes("ok").buffer);
      assert((await operation.result).value === "ok");
      assert(service.state().completed === 1);
    });
  });

  test("file-read: detached button cannot cancel later work", async () => {
    await isolated(async ({ service, panel, start, field }) => {
      const button = field("stop");
      panel.dispose();
      const operation = start(2);
      await tick(); button.click();
      assert(service.state().waiting === 1);
      operation.gate.resolve(bytes("ok").buffer);
      assert((await operation.result).value === "ok");
    });
  });

  for (const property of ["name", "path", "content", "account", "debug"]) {
    test("file-read: unknown aggregate field never appears in DOM " + property, async () => {
      const service = createFileReadService();
      const host = document.createElement("div");
      document.body.append(host);
      const input = { ...service.state(), [property]: "<img src=x onerror=alert(1)>private-marker" };
      const panel = mountFileReadPanel({ document, parent: host,
        service: { state: () => input, subscribe(callback) { callback(input); return () => {}; }, cancelAll: () => 0 } });
      try {
        assert(host.querySelector(".file-read-panel").getAttribute("data-level") === "unavailable");
        assert(!host.textContent.includes("private-marker"));
        assert(!host.querySelector("img"));
      } finally { panel.dispose(); host.remove(); service.dispose(); }
    });
  }

  test("file-read: fixed cancellation failure message never displays thrown text", async () => {
    const real = createFileReadService();
    const host = document.createElement("div");
    document.body.append(host);
    const panel = mountFileReadPanel({ document, parent: host, service: {
      state: real.state, subscribe: real.subscribe, cancelAll() { throw Error("private marker"); },
    } });
    try {
      host.querySelector(".file-read-stop").click();
      assert(host.querySelector(".file-read-action").textContent.includes("確認できません"));
      assert(!host.textContent.includes("private marker"));
    } finally { panel.dispose(); host.remove(); real.dispose(); }
  });

  test("file-read: normal demo import cancellation leaves saved browser sentinel intact", async () => {
    await isolated(async ({ service, start, field }) => {
      const key = "threecore-test-file-boundary-" + crypto.randomUUID();
      localStorage.setItem(key, "synthetic preserved data");
      try {
        const operation = start();
        await tick(); field("stop").click(); await operation.result;
        assert(localStorage.getItem(key) === "synthetic preserved data");
        assert(service.state().cancelled === 1);
      } finally { localStorage.removeItem(key); }
    });
  });
}
