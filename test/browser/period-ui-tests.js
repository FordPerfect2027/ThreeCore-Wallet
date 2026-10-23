import { mountPeriodPanel } from "/examples/period-panel.js";
import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";
import { mountWalletDemo } from "/examples/wallet-demo.js";
import { collectPeriod } from "/src/period-reader.js";
import { preparePeriodFile, decodePeriodFile } from "/src/period-file.js";
import { periodDraftKey } from "/src/period-draft.js";
import { context, periodSession, checkpoint, plan, deferred, ACCOUNT, OTHER, THIRD } from "/test/helpers/period-fixtures.js";

const assert = (value, message = "Period UI assertion failed") => { if (!value) throw Error(message); };
async function waitFor(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw Error("Period UI timeout");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function fixture(options = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const files = [];
  const deliveries = [];
  let reads = 0;
  const mounted = mountPeriodPanel({ document, parent,
    getContext: agent => context(agent),
    read: (agent, selected, config) => {
      reads++;
      return collectPeriod(periodSession(selected).session, selected, config);
    },
    stageWorkspace: (workspace, agent) => { deliveries.push({ workspace, agent }); return true; },
    download: value => files.push(value), ...options,
  });
  const q = name => parent.querySelector(".period-" + name);
  const f = { parent, mounted, q, files, deliveries, get reads() { return reads; },
    click(name) { assert(!q(name).disabled, "Disabled: " + name); q(name).click(); },
    input(name, value, event = "input") { q(name).value = value; q(name).dispatchEvent(new Event(event, { bubbles: true })); },
    prepare() {
      f.input("earlier", "30"); f.input("later", "42"); f.input("window-size", "5"); f.click("prepare");
    },
    ack() { q("ack").checked = true; q("ack").dispatchEvent(new Event("change", { bubbles: true })); },
    async file(text) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], "period.json", { type: "application/json" }));
      q("file").files = transfer.files;
      q("file").dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => q("panel").getAttribute("aria-busy") === "false");
    },
    dispose() { mounted.dispose(); parent.remove(); },
  };
  return f;
}

export function registerPeriodUITests(test) {
  test("period: idle panel reads nothing and hides unstarted evidence", async () => {
    const f = fixture();
    try {
      assert(f.reads === 0);
      assert(f.q("summary").hidden);
      assert(f.q("review").hidden);
      assert(f.q("start").disabled);
      assert(f.q("save").disabled);
      assert(f.q("status").getAttribute("aria-live") === "polite");
    } finally { f.dispose(); }
  });

  test("period: plan preview precedes all RPC and shows the excluded starting block", async () => {
    const f = fixture();
    try {
      f.prepare();
      assert(f.reads === 0);
      assert(f.q("review-text").textContent.includes("31 ～ 42"));
      assert(f.q("review-text").textContent.includes("5段階"));
      assert(f.q("summary").hidden);
      f.click("apply");
      assert(!f.q("summary").hidden);
      assert(f.q("rows").children.length === 3);
      assert(f.q("rows").textContent.includes("未取得"));
      assert(f.reads === 0);
    } finally { f.dispose(); }
  });

  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test("period: collect and export " + agent + " through the visible form", async () => {
      const f = fixture();
      try {
        f.input("agent", agent, "change");
        f.prepare(); f.click("apply"); f.click("start");
        await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
        assert(f.q("status").textContent.includes("完了"));
        assert(f.q("before-amount").textContent === "100 " + agent);
        assert(f.q("after-amount").textContent === "107 " + agent);
        assert(f.q("progress").value === 5);
        assert(f.q("rows").textContent.includes("取得済み"));
        assert(!f.q("send").disabled);
        f.click("save");
        await waitFor(() => f.files.length === 1);
        const saved = await decodePeriodFile(f.files[0].text);
        assert(saved.draft.plan.context.agent === agent);
        f.click("send");
        assert(f.deliveries.length === 1);
        assert(f.deliveries[0].agent === agent);
      } finally { f.dispose(); }
    });
  }

  test("period: partial provider failure is visible and resumable", async () => {
    let fail = true;
    const f = fixture({ read: (agent, selected, options) => {
      const mock = periodSession(selected, { before(method, [request]) {
        if (fail && method === "logs" && request.fromBlock === "36") { fail = false; throw Error("down"); }
      } });
      return collectPeriod(mock.session, selected, options);
    } });
    try {
      f.prepare(); f.click("apply"); f.click("start");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
      assert(f.q("status").getAttribute("data-error") === "true");
      assert(f.q("progress").value === 3);
      assert(f.q("send").disabled);
      f.click("save");
      await waitFor(() => f.files.length === 1);
      f.click("start");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
      assert(f.q("progress").value === 5);
      assert(!f.q("send").disabled);
      assert(f.q("saved").textContent.includes("まだJSON保存していません"));
    } finally { f.dispose(); }
  });

  test("period: native File restore on a fresh panel retains checkpoint and does not read", async () => {
    const text = (await preparePeriodFile(checkpoint(3))).text;
    const f = fixture();
    try {
      await f.file(text);
      assert(!f.q("review").hidden);
      assert(f.q("review-text").textContent.includes("真正性は未確認"));
      assert(f.mounted.getDraft() === null);
      f.click("apply");
      assert(periodDraftKey(f.mounted.getDraft()) === periodDraftKey(checkpoint(3)));
      assert(f.reads === 0);
      assert(f.q("provenance").textContent.includes("まだ完了していません"));
      f.click("start");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
      assert(f.q("progress").value === 5);
    } finally { f.dispose(); }
  });

  test("period: corrupt native file leaves original evidence unchanged", async () => {
    const f = fixture();
    try {
      await f.file((await preparePeriodFile(checkpoint(2))).text); f.click("apply");
      const before = periodDraftKey(f.mounted.getDraft());
      const parsed = JSON.parse((await preparePeriodFile(checkpoint())).text);
      parsed.digest = "0".repeat(64);
      await f.file(JSON.stringify(parsed));
      assert(f.q("status").textContent.includes("検査値が一致しません"));
      assert(f.q("review").hidden);
      assert(periodDraftKey(f.mounted.getDraft()) === before);
    } finally { f.dispose(); }
  });

  test("period: replacing a collected checkpoint requires a fresh checkbox each time", async () => {
    const f = fixture();
    try {
      await f.file((await preparePeriodFile(checkpoint())).text); f.click("apply");
      f.prepare();
      assert(f.q("apply").disabled);
      f.ack(); assert(!f.q("apply").disabled);
      f.click("cancel");
      f.prepare();
      assert(!f.q("ack").checked);
      assert(f.q("apply").disabled);
      f.ack(); f.click("apply");
      assert(f.q("progress").value === 0);
    } finally { f.dispose(); }
  });

  test("period: editing a plan after preview removes the stale confirmation", async () => {
    const f = fixture();
    try {
      f.prepare(); f.input("later", "43");
      assert(f.q("review").hidden);
      assert(f.q("apply").disabled);
      assert(f.mounted.getDraft() === null);
    } finally { f.dispose(); }
  });

  test("period: cancellation disables late checkpoint writes", async () => {
    const gate = deferred();
    let aborted = false;
    const f = fixture({ read: async (agent, selected, options) => {
      options.onCheckpoint(checkpoint(1));
      await gate.promise;
      aborted = options.signal.aborted;
      options.onCheckpoint(checkpoint());
      return checkpoint();
    } });
    try {
      f.prepare(); f.click("apply"); f.click("start");
      assert(f.q("file").disabled);
      assert(f.q("agent").disabled);
      f.click("cancel");
      gate.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
      assert(aborted);
      assert(f.q("progress").value === 1);
      assert(f.q("send").disabled);
    } finally { f.dispose(); }
  });

  test("period: invalid block and window limits display errors without provider calls", async () => {
    const f = fixture();
    try {
      for (const [start, end, size] of [["0x1e", "42", "5"], ["30", "30", "5"], ["0", "24001", "2000"], ["30", "42", "0"]]) {
        f.input("earlier", start); f.input("later", end); f.input("window-size", size);
        f.click("prepare");
        assert(f.q("status").getAttribute("data-error") === "true");
        assert(f.q("review").hidden);
      }
      assert(f.reads === 0);
    } finally { f.dispose(); }
  });

  test("period: actual reconciliation bridge stages one token and preserves the other two", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const target = mountReconciliationPanel({ document, parent });
    const f = fixture({ stageWorkspace: (value, agent) => target.stageCollected(value, agent) });
    try {
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        await f.file((await preparePeriodFile(checkpoint(5, plan({}, context(agent))))).text);
        if (!f.q("ack-label").hidden) f.ack();
        f.click("apply"); f.click("send");
        assert(!parent.querySelector(".reconciliation-review").hidden);
        const apply = parent.querySelector(".reconciliation-apply");
        assert(!apply.disabled);
        apply.click();
      }
      assert(target.getWorkspace().slots.every(slot => slot.earlier !== null && slot.archive.records.length === 3));
      parent.querySelector(".reconciliation-calculate").click();
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        assert(parent.querySelector(".reconciliation-result-" + agent).textContent.includes("計算が一致"));
      }
    } finally { f.dispose(); target.dispose(); parent.remove(); }
  });

  test("period: complete file export can be opened by the existing reconciliation importer", async () => {
    const f = fixture();
    try {
      await f.file((await preparePeriodFile(checkpoint())).text); f.click("apply");
      f.click("save-reconciliation");
      await waitFor(() => f.files.length === 1);
      assert(f.files[0].filename === "ThreeCore-balance-reconciliation.json");
      const value = JSON.parse(f.files[0].text);
      assert(value.workspace.slots[0].archive.records.length === 3);
      assert(value.workspace.slots[1].archive === null);
      f.click("save-text");
      await waitFor(() => f.files.length === 2);
      assert(f.files[1].text.includes("期間取得の控え"));
    } finally { f.dispose(); }
  });

  test("period: complete main wallet routes three distinct connected cards into one reconciliation workspace", async () => {
    const sessions = new Map();
    const provider = { request: async () => { throw Error("Test must use injected sessions"); } };
    const app = mountWalletDemo({ document, eventTarget: new EventTarget(), siteOrigin: location.origin,
      getLegacyProvider: () => provider,
      createSession: options => {
        const selected = plan({}, context(options.agent, options.chainId, options.expectedAccount));
        const f = periodSession(selected);
        f.state.connected = false;
        f.session.connect = async () => { f.state.connected = true; return f.session.state; };
        f.session.disconnect = () => { f.state.connected = false; };
        sessions.set(options.agent, f);
        return f.session;
      },
    });
    try {
      const accounts = { DAT: ACCOUNT, EMA: OTHER, CAWELON: THIRD };
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        const card = document.querySelector(`#grid .card[data-agent="${agent}"]`);
        card.querySelector(".account").value = accounts[agent];
        card.querySelector(".account").dispatchEvent(new Event("input", { bubbles: true }));
        card.querySelector(".connect").click();
        await waitFor(() => !card.querySelector(".read").disabled);
      }
      const p = document.querySelector(".period-panel");
      const r = document.querySelector(".reconciliation-panel");
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        const selector = p.querySelector(".period-agent");
        selector.value = agent; selector.dispatchEvent(new Event("change", { bubbles: true }));
        for (const [name, value] of [["earlier", "30"], ["later", "42"], ["window-size", "5"]]) {
          const input = p.querySelector(".period-" + name);
          input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        p.querySelector(".period-prepare").click();
        if (!p.querySelector(".period-ack-label").hidden) {
          const ack = p.querySelector(".period-ack");
          ack.checked = true; ack.dispatchEvent(new Event("change", { bubbles: true }));
        }
        assert(!p.querySelector(".period-apply").disabled);
        p.querySelector(".period-apply").click();
        p.querySelector(".period-start").click();
        await waitFor(() => p.getAttribute("aria-busy") === "false");
        assert(p.querySelector(".period-status").textContent.includes("完了"));
        p.querySelector(".period-send").click();
        assert(!r.querySelector(".reconciliation-review").hidden);
        r.querySelector(".reconciliation-apply").click();
      }
      r.querySelector(".reconciliation-calculate").click();
      for (const agent of ["DAT", "EMA", "CAWELON"]) {
        assert(r.querySelector(".reconciliation-result-" + agent).textContent.includes("計算が一致"));
        assert(r.querySelector(".reconciliation-result-" + agent).textContent.includes(accounts[agent]));
        assert(sessions.get(agent).calls.some(row => row[0] === "logs"));
      }
    } finally { app.dispose(); }
  });

  test("period: known block change disables resumption and offers reviewed restart", async () => {
    const f = fixture({ read: async () => { throw { code: "PERIOD_BLOCK_CHANGED" }; } });
    try {
      await f.file((await preparePeriodFile(checkpoint())).text); f.click("apply"); f.click("start");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
      assert(f.q("start").disabled);
      assert(f.q("send").disabled);
      assert(f.q("save-reconciliation").disabled);
      assert(!f.q("save").disabled);
      assert(f.q("badge").textContent.includes("再取得が必要"));
      f.click("repair");
      assert(f.q("apply").disabled);
      f.ack(); f.click("apply");
      assert(f.q("progress").value === 0);
      assert(!f.q("start").disabled);
    } finally { f.dispose(); }
  });

  test("period: log overflow offers a narrower plan without issuing another RPC", async () => {
    let reads = 0;
    const f = fixture({ read: async () => { reads++; throw { code: "TRANSFER_EVENT_LIMIT" }; } });
    try {
      await f.file((await preparePeriodFile(checkpoint(3))).text); f.click("apply"); f.click("start");
      await waitFor(() => f.q("panel").getAttribute("aria-busy") === "false");
      assert(f.q("recovery-text").textContent.includes("2ブロック"));
      f.click("repair");
      assert(f.q("review-text").textContent.includes("6区間"));
      assert(reads === 1);
      f.ack(); f.click("apply");
      assert(f.q("window-size").value === "2");
      assert(f.q("rows").children.length === 6);
      assert(reads === 1);
    } finally { f.dispose(); }
  });
}
