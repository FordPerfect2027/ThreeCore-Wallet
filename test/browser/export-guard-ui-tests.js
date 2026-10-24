import { createExportGuard } from "/src/export-guard.js";
import { inspectExportPayload } from "/src/export-payload.js";
import { mountExportGuardPanel } from "/examples/export-guard-panel.js";
import { createBrowserExportResource } from "/examples/export-resource.js";
import { getDocumentExportGuard } from "/examples/export-download.js";
import { prepareWalletSetupFile } from "/src/wallet-setup-file.js";
import { WALLET_SETUP_SCHEMA } from "/src/wallet-setup.js";

const assert = (value, message = "Export protection UI assertion failed") => { if (!value) throw Error(message); };
const payload = (changes = {}) => ({ text: "synthetic export", filename: "ThreeCore-synthetic.txt",
  mimeType: "text/plain;charset=utf-8", ...changes });
const refuses = (action, code) => {
  let error;
  try { action(); } catch (value) { error = value; }
  assert(error?.code === code, "Expected " + code);
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** Real DOM with synthetic resources: this suite creates no downloaded files. */
async function isolated(action) {
  let now = 0, id = 0, cleanupWorks = true;
  const timers = new Map(), resources = [];
  const guard = createExportGuard({
    now: () => now,
    schedule(callback, delay) { timers.set(++id, { callback, due: now + delay }); return id; },
    unschedule(timer) { timers.delete(timer); },
    createResource(prepared, current) {
      const item = { bytes: prepared.byteLength, current, live: false, released: 0 };
      resources.push(item);
      return {
        activate() { item.live = true; },
        release() {
          item.released++;
          if (!cleanupWorks) return false;
          item.live = false; return true;
        },
      };
    },
  });
  const parent = document.createElement("div");
  document.body.append(parent);
  const panel = mountExportGuardPanel({ document, parent, guard });
  const field = name => parent.querySelector(".export-guard-" + name);
  try {
    await action({ guard, resources, parent, panel, field,
      phase: () => field("panel").dataset.phase,
      cleanup(value) { cleanupWorks = value; },
      advance(ms) {
        now += ms;
        for (const [key, item] of [...timers]) if (item.due <= now) {
          timers.delete(key); item.callback();
        }
      },
      clock(value) { now = value; },
    });
  } finally {
    cleanupWorks = true; guard.dispose(); guard.retryCleanup();
    panel.dispose(); parent.remove(); await tick();
  }
}

export function registerExportGuardUITests(test) {
  test("export-guard: production screen mounts accessible status without wallet access", async fixture => {
    const f = fixture();
    const panel = document.querySelector(".export-guard-panel");
    assert(panel);
    assert(panel.querySelector("h3").textContent === "保存ファイルの保護");
    assert(panel.querySelector("[role=status]").getAttribute("aria-live") === "polite");
    assert(panel.querySelector(".export-guard-clear").disabled);
    assert(panel.querySelector(".export-guard-retry").disabled);
    assert(f.calls.length === 0);
  });

  test("export-guard: retained resource status updates and deadline frees it", async () => {
    await isolated(({ guard, phase, field, advance }) => {
      const receipt = guard.offer(payload());
      assert(receipt.offered && receipt.downloadComplete === false);
      assert(phase() === "retaining");
      assert(field("counts").textContent.includes("1 / 4"));
      assert(!field("clear").disabled);
      advance(999);
      assert(phase() === "retaining");
      advance(1);
      assert(phase() === "ready");
      assert(field("clear").disabled);
    });
  });

  test("export-guard: four retained offers visibly block a fifth", async () => {
    await isolated(({ guard, phase, field, resources }) => {
      for (let i = 0; i < 4; i++) guard.offer(payload());
      assert(phase() === "limited");
      refuses(() => guard.offer(payload()), "EXPORT_BUSY");
      assert(resources.length === 4);
      field("clear").click();
      assert(phase() === "ready");
      assert(resources.every(item => !item.live));
      assert(field("outcome").textContent.includes("保存済みファイルは変更していません"));
    });
  });

  test("export-guard: failed cleanup keeps reservation and exposes explicit retry", async () => {
    await isolated(({ guard, phase, field, cleanup }) => {
      guard.offer(payload()); cleanup(false);
      field("clear").click();
      assert(phase() === "cleanup");
      assert(guard.state().reservedBytes > 0);
      assert(!field("retry").disabled);
      assert(field("outcome").textContent.includes("まだ解放を確認できない"));
      refuses(() => guard.offer(payload()), "EXPORT_CLEANUP");
      cleanup(true); field("retry").click();
      assert(phase() === "ready");
      assert(guard.state().reservedBytes === 0);
      assert(field("retry").disabled);
    });
  });

  test("export-guard: backward clock closes leases and shows a fixed warning", async () => {
    await isolated(({ guard, phase, clock, resources }) => {
      clock(20); guard.offer(payload()); clock(19);
      refuses(() => guard.offer(payload()), "EXPORT_CLOCK");
      assert(phase() === "clock");
      assert(resources.every(item => !item.live));
      clock(100);
      refuses(() => guard.offer(payload()), "EXPORT_CLOCK");
    });
  });

  for (const [name, changes, code] of [
    ["path traversal", { filename: "../private.txt" }, "EXPORT_NAME"],
    ["Windows device", { filename: "CON.txt" }, "EXPORT_NAME"],
    ["script MIME", { mimeType: "text/javascript" }, "EXPORT_TYPE"],
    ["HTML mismatch", { filename: "report.html" }, "EXPORT_TYPE"],
    ["byte declaration", { byteLength: 1 }, "EXPORT_SIZE"],
    ["unpaired Unicode", { text: "\ud800" }, "EXPORT_ENCODING"],
    ["empty text", { text: "" }, "EXPORT_SIZE"],
    ["bidi filename", { filename: "safe\u202e.txt" }, "EXPORT_NAME"],
  ]) {
    test("export-guard: browser rejects " + name + " without allocating", async () => {
      await isolated(({ guard, resources, field }) => {
        refuses(() => guard.offer(payload(changes)), code);
        assert(resources.length === 0);
        assert(guard.state().reservedBytes === 0);
        assert(field("counts").textContent.includes("受付拒否 1"));
      });
    });
  }

  test("export-guard: private canary and markup are absent from aggregate display", async () => {
    await isolated(({ guard, parent }) => {
      guard.offer(payload({ text: '<img src=x onerror="SYNTHETIC_PRIVATE">' }));
      assert(!parent.textContent.includes("SYNTHETIC_PRIVATE"));
      assert(!parent.textContent.includes("ThreeCore-synthetic"));
      assert(!parent.querySelector("img"));
      assert(!parent.querySelector("a"));
    });
  });

  test("export-guard: Japanese and emoji use UTF-8 bytes in browser status", async () => {
    await isolated(({ guard, field }) => {
      const text = "保存😀";
      const receipt = guard.offer(payload({ text }));
      const size = new TextEncoder().encode(text).length;
      assert(receipt.byteLength === size);
      assert(guard.state().reservedBytes === size);
      assert(field("counts").textContent.includes(size + " / 134217728 bytes"));
    });
  });

  test("export-guard: panel disposal does not dispose the shared resource manager", async () => {
    await isolated(({ guard, panel, parent, field }) => {
      guard.offer(payload());
      const clear = field("clear");
      panel.dispose();
      assert(parent.children.length === 0);
      clear.click();
      assert(guard.state().active === 1);
      assert(!guard.state().disposed);
    });
  });

  test("export-guard: two panels display one shared document budget", async () => {
    await isolated(({ guard, parent, field }) => {
      const extra = document.createElement("div"); parent.append(extra);
      const other = mountExportGuardPanel({ document, parent: extra, guard });
      try {
        guard.offer(payload());
        assert(extra.querySelector(".export-guard-counts").textContent === field("counts").textContent);
        extra.querySelector(".export-guard-clear").click();
        assert(guard.state().active === 0);
        assert(field("clear").disabled);
      } finally { other.dispose(); extra.remove(); }
    });
  });

  test("export-guard: controls remain usable at a narrow container width", async () => {
    await isolated(({ guard, parent, field }) => {
      parent.style.width = "320px";
      guard.offer(payload());
      const panel = field("panel");
      assert(panel.scrollWidth <= panel.clientWidth + 1, "Export panel overflows its container");
      assert(field("clear").getBoundingClientRect().width <= panel.getBoundingClientRect().width);
      field("clear").click();
      assert(guard.state().active === 0);
    });
  });

  test("export-guard: manual security stop clears retained export resources", async fixture => {
    await isolated(({ guard, resources }) => {
      const f = fixture(undefined, { exportGuard: guard });
      guard.offer(payload());
      document.querySelector(".security-stop").click();
      assert(guard.state().active === 0);
      assert(resources.every(item => !item.live));
      assert(f.calls.length === 0);
    });
  });

  test("export-guard: failed cleanup blocks resume while wallet read gate stays closed", async fixture => {
    await isolated(({ guard, cleanup }) => {
      const f = fixture(undefined, { exportGuard: guard });
      guard.offer(payload()); cleanup(false);
      document.querySelector(".security-stop").click();
      assert(document.querySelector(".security-resume").disabled);
      assert(!document.querySelector(".security-cleanup-warning").hidden);
      assert(f.field(".connect").disabled);
      cleanup(true);
      document.querySelector(".security-cleanup-retry").click();
      assert(guard.state().active === 0);
      assert(!document.querySelector(".security-resume").disabled);
    });
  });

  test("export-guard: page lifecycle protection clears exports without asking a wallet", async fixture => {
    await isolated(({ guard }) => {
      const f = fixture(undefined, { exportGuard: guard });
      guard.offer(payload());
      f.eventTarget.dispatchEvent(new Event("pagehide"));
      assert(guard.state().active === 0);
      assert(f.calls.length === 0);
      assert(f.field(".connect").disabled);
    });
  });

  test("export-guard: app disposal clears resources and detaches its status panel", async fixture => {
    await isolated(({ guard }) => {
      const f = fixture(undefined, { exportGuard: guard });
      guard.offer(payload()); f.app.dispose();
      assert(guard.state().active === 0);
      assert(document.querySelectorAll(".export-guard-panel").length === 1);
    });
  });

  test("export-guard: current wallet settings generator crosses the new boundary unchanged", async () => {
    await isolated(({ guard }) => {
      const plan = { schema: WALLET_SETUP_SCHEMA,
        entries: ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
          agent, account: "0x" + String(index + 1).repeat(40), chainId: 8453,
        })) };
      const file = prepareWalletSetupFile(plan);
      const receipt = guard.offer(file);
      assert(receipt.kind === "json");
      assert(receipt.byteLength === new TextEncoder().encode(file.text).length);
    });
  });

  test("export-guard: browser native Blob and URL are used without native navigation", async () => {
    const live = new Set(), revoked = [], anchors = [];
    const fakeDocument = {
      location: document.location,
      body: document.createElement("div"),
      defaultView: {
        Blob,
        URL: {
          createObjectURL(blob) { const url = URL.createObjectURL(blob); live.add(url); return url; },
          revokeObjectURL(url) { URL.revokeObjectURL(url); live.delete(url); revoked.push(url); },
        },
      },
      createElement(tag) {
        const anchor = document.createElement(tag);
        anchor.click = () => { anchors.push({ href: anchor.href, filename: anchor.download }); };
        return anchor;
      },
    };
    const resource = createBrowserExportResource(fakeDocument, inspectExportPayload(payload()), () => true);
    try {
      resource.activate();
      assert(anchors.length === 1);
      assert(anchors[0].href.startsWith("blob:" + location.origin + "/"));
      assert(anchors[0].filename === "ThreeCore-synthetic.txt");
      assert(fakeDocument.body.children.length === 0);
      assert(live.size === 1);
    } finally { assert(resource.release()); }
    assert(live.size === 0 && revoked.length === 1);
  });

  test("export-guard: status never says browser download completion was confirmed", async () => {
    await isolated(({ guard, parent }) => {
      guard.offer(payload()); guard.clear();
      assert(parent.textContent.includes("ブラウザーの保存完了"));
      assert(parent.textContent.includes("保証する表示ではありません"));
      assert(!parent.textContent.includes("ダウンロードが完了しました"));
    });
  });

  test("export-guard: normal document guard is shared without replacing its lifecycle", async fixture => {
    fixture();
    const first = getDocumentExportGuard(document);
    const second = getDocumentExportGuard(document);
    assert(first === second);
    assert(first.state().active === 0);
  });
}
