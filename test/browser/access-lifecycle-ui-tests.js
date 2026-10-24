import { mountSecurityPanel } from "/examples/security-panel.js";
import { createWalletCardController } from "/src/wallet-card-controller.js";
const assert = (value, message = "Access lifecycle UI assertion") => { if (!value) throw Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const A = "0x" + "11".repeat(20);

function panelFixture(options = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const events = new EventTarget();
  let now = 0, next = 0, broken = false;
  const timers = new Map();
  const panel = mountSecurityPanel({ document, parent: host, eventTarget: events,
    lockOptions: {
      now: () => now,
      schedule(fn) { if (broken) throw Error("Synthetic timer failure"); timers.set(++next, fn); return next; },
      unschedule(id) { timers.delete(id); },
    }, ...options });
  return { panel, host, events, timers, setTime: value => { now = value; },
    breakTimer: () => { broken = true; }, q: name => host.querySelector(".security-" + name),
    close() { panel.dispose(); host.remove(); } };
}

export function registerAccessLifecycleUITests(test) {
  test("access-lifecycle: timer fault shows Japanese recovery guidance and blocks resume", async () => {
    const f = panelFixture();
    try {
      f.breakTimer();
      f.q("idle").value = "60000";
      f.q("idle").dispatchEvent(new Event("change", { bubbles: true }));
      assert(f.panel.state().reason === "timer");
      assert(f.q("resume").disabled);
      assert(!f.q("cleanup-warning").hidden);
      assert(f.q("cleanup-warning").textContent.includes("ページを開き直"));
      f.q("resume").dispatchEvent(new MouseEvent("click"));
      assert(!f.panel.check());
    } finally { f.close(); }
  });
  test("access-lifecycle: clock rollback between reads stops native controls", async () => {
    const f = panelFixture();
    try {
      f.setTime(100); assert(f.panel.check());
      f.setTime(99); assert(!f.panel.check());
      assert(f.q("resume").disabled);
      assert(f.q("status").textContent.includes("待機時間"));
    } finally { f.close(); }
  });
  for (const failure of ["false", "throw", "reject"]) {
    test(`access-lifecycle: cleanup ${failure} requires retry then explicit resume`, async () => {
      let broken = true;
      const f = panelFixture({ onLock() {
        if (!broken) return true;
        if (failure === "throw") throw Error("synthetic private cleanup");
        if (failure === "reject") return Promise.reject(Error("synthetic private cleanup"));
        return false;
      } });
      try {
        f.q("stop").click();
        assert(f.q("resume").disabled);
        assert(!f.q("cleanup-retry").hidden);
        broken = false;
        f.q("cleanup-retry").click();
        assert(!f.q("resume").disabled);
        assert(!f.panel.check());
        f.q("resume").click();
        assert(f.panel.check());
        await tick();
      } finally { f.close(); }
    });
  }
  test("access-lifecycle: stop during resume eligibility wins over the click", async () => {
    let panel, stop = false;
    const f = panelFixture({ canResume() {
      if (stop) { stop = false; panel.lock(); }
      return true;
    } });
    panel = f.panel;
    try {
      f.q("stop").click();
      stop = true;
      f.q("resume").click();
      assert(!panel.check());
      assert(!f.q("resume").disabled);
      f.q("resume").click();
      assert(panel.check());
    } finally { f.close(); }
  });
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    for (const action of ["clearResult", "disconnect", "dispose"]) {
      test(`access-lifecycle: ${agent} ${action} stops a deferred composite read in the browser`, async () => {
        let release, entered, calls = 0, connected = false;
        const gate = new Promise(resolve => { release = resolve; });
        const reached = new Promise(resolve => { entered = resolve; });
        const session = {
          get state() { return { agent, connected, account: connected ? A : null, chainId: 8453,
            siteOrigin: location.origin, connectionEpoch: 1, canSign: false, canSendTransactions: false, canBridge: false }; },
          connect() { connected = true; }, disconnect() { connected = false; },
          async getBlockSnapshot() { calls++; entered(); await gate; return { number: "0x2a", hash: "0x" + "ab".repeat(32) }; },
          async getNativeBalance() { calls++; return 10n; },
          async getContractCode(address) { calls++; return { address, deployed: true }; },
          async getTokenBalance() { calls++; return 1n; },
        };
        const card = createWalletCardController({ agent, siteOrigin: location.origin, createSession: () => session });
        try {
          await card.connect({ provider: { request() {} }, account: A, chainId: 8453 });
          const pending = card.readPortfolio({ tokens: [A] }).then(() => true, () => false);
          await reached;
          card[action]();
          assert(await pending === false);
          assert(calls === 1);
          release();
          await tick();
          assert(calls === 1);
          assert(card.state.result === null);
        } finally { release(); card.dispose(); }
      });
    }
  }
  test("access-lifecycle: main wallet panel stop clears a connected card", async make => {
    const f = make();
    await f.connect();
    const count = f.calls.length;
    document.querySelector(".security-stop").click();
    assert(f.field(".read").disabled);
    assert(f.output().includes("未接続"));
    document.querySelector(".security-resume").click();
    await tick();
    assert(f.calls.length === count);
    assert(f.field(".read").disabled);
  });
}
