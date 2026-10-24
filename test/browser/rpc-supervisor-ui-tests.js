import { createRpcSupervisor } from "/src/rpc-supervisor.js";
import { mountRpcStatusPanel } from "/examples/rpc-status-panel.js";
import { ThreeCoreWalletSession } from "/src/wallet-session.js";

const assert = (value, message = "RPC protection assertion") => { if (!value) throw Error(message); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
};
async function wait(predicate, timeout = 5000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start >= timeout) throw Error("RPC UI observation deadline");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const field = name => document.querySelector(".rpc-status-" + name);
const level = () => document.querySelector(".rpc-status-panel")?.getAttribute("data-level");
const A = "0x" + "11".repeat(20);
const HASH = "0x" + "ab".repeat(32);

async function isolated(action, options = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const supervisor = createRpcSupervisor(options);
  const panel = mountRpcStatusPanel({ document, parent: host, supervisor });
  const operations = [];
  const provider = {};
  function start(extra = {}) {
    const gate = deferred();
    let calls = 0;
    const operation = supervisor.start({ provider, timeoutMs: 2000,
      invoke() { calls++; return gate.promise; }, ...extra });
    const result = operation.promise.then(value => ({ value }), error => ({ code: error.code }));
    const record = { ...operation, gate, result, calls: () => calls };
    operations.push(record);
    return record;
  }
  try {
    await action({ host, supervisor, start,
      field: name => host.querySelector(".rpc-status-" + name),
      level: () => host.querySelector(".rpc-status-panel").getAttribute("data-level") });
  } finally {
    panel.dispose(); supervisor.dispose();
    for (const operation of operations) operation.gate.resolve(null);
    host.remove();
    await Promise.all(operations.map(item => item.result));
  }
}

export function registerRpcSupervisorUITests(test) {
  test("rpc-supervisor: clock fault clears all three cards and disables resume", async fixture => {
    let time = 100;
    const supervisor = createRpcSupervisor({ now: () => time });
    const accounts = [A, "0x" + "22".repeat(20), "0x" + "33".repeat(20)];
    const f = fixture(undefined, { rpcSupervisor: supervisor });
    const cards = [...document.querySelectorAll("#grid > .card")];
    assert(cards.length === 3);
    for (const [index, card] of cards.entries()) {
      const input = (name, value) => {
        const element = card.querySelector(name);
        element.value = value;
        element.dispatchEvent(new Event(name === ".account" ? "input" : "change", { bubbles: true }));
      };
      input(".account", accounts[index]);
      input(".chain", "8453");
      if (index > 0) {
        const uuid = "12345678-1234-4234-8234-123456789ab" + index;
        f.announce(uuid, { ...f.provider, request(args) {
          return ["eth_accounts", "eth_requestAccounts"].includes(args.method)
            ? Promise.resolve([accounts[index]]) : f.provider.request(args);
        } }, "Synthetic independent wallet " + index);
        input(".provider", uuid);
      }
      card.querySelector(".connect").click();
      await wait(() => !card.querySelector(".read").disabled).catch(() => {
        throw Error(card.dataset.agent + " connect: " + card.querySelector("output").textContent);
      });
      card.querySelector(".read").click();
      await wait(() => card.querySelector("output").textContent.includes("ETH残高")).catch(() => {
        throw Error(card.dataset.agent + " read: " + card.querySelector("output").textContent);
      });
    }
    time = 99;
    cards[0].querySelector(".read").click();
    await wait(() => level() === "stopped").catch(() => {
      throw Error("Clock protection: " + field("headline").textContent + " / " + cards[0].querySelector("output").textContent);
    });
    await wait(() => cards.every(card => card.querySelector(".read").disabled));
    assert(document.querySelector(".security-resume").disabled);
    for (const card of cards) {
      assert(!card.querySelector("output").textContent.includes("ETH残高"));
      assert(card.querySelector(".connect").disabled);
    }
    const before = f.calls.length;
    document.querySelector(".security-resume").dispatchEvent(new Event("click"));
    time = 10000;
    cards[0].querySelector(".connect").dispatchEvent(new Event("click"));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(f.calls.length === before);
    assert(document.querySelector(".security-resume").disabled);
  });

  for (const event of ["accountsChanged", "chainChanged"]) {
    test("rpc-supervisor: browser event storm closes the card: " + event, async fixture => {
      const f = fixture();
      await f.connect();
      f.field(".read").click();
      await wait(() => f.output().includes("ETH残高"));
      const before = f.calls.length;
      for (let i = 0; i < 300; i++) {
        f.provider.emit(event, event === "accountsChanged" ? [A] : "0x2105");
      }
      await wait(() => f.field(".read").disabled);
      assert(!f.output().includes("ETH残高"));
      assert(f.calls.length === before);
      await f.connect();
      assert(!f.field(".read").disabled);
    });
  }

  test("rpc-supervisor: asynchronous registration cannot leave the card connected", async fixture => {
    const f = fixture();
    const original = f.provider.on;
    f.provider.on = function(name, listener) {
      original.call(this, name, listener);
      return Promise.reject(Error("private asynchronous registration failure"));
    };
    f.field(".connect").click();
    await wait(() => f.output().includes("接続変更を監視できない"));
    const before = f.calls.length;
    f.provider.emit("accountsChanged", [A]);
    f.provider.emit("chainChanged", "0x2105");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(f.field(".read").disabled);
    assert(f.calls.length === before);
    assert(!document.body.textContent.includes("private asynchronous"));
  });

  test("rpc-supervisor: asynchronous cleanup rejection stays consumed after stop", async fixture => {
    const f = fixture();
    const original = f.provider.removeListener;
    f.provider.removeListener = function(name, listener) {
      original.call(this, name, listener);
      return Promise.reject(Error("private asynchronous cleanup failure"));
    };
    await f.connect();
    document.querySelector(".security-stop").click();
    await wait(() => f.field(".read").disabled);
    const before = f.calls.length;
    f.provider.emit("accountsChanged", [A]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert(f.calls.length === before);
    assert(!document.body.textContent.includes("private asynchronous"));
  });

  test("rpc-supervisor: demo mounts read-only request diagnostics", async fixture => {
    const f = fixture();
    assert(level() === "ready");
    assert(field("headline").getAttribute("role") === "status");
    assert(field("headline").getAttribute("aria-live") === "polite");
    assert(!document.querySelector(".rpc-status-panel button"));
    assert(field("scope").textContent.includes("他のタブ"));
    assert(f.calls.length === 0);
  });

  test("rpc-supervisor: completed balance read leaves no outstanding requests", async fixture => {
    const f = fixture();
    await f.connect();
    f.field(".read").click();
    await wait(() => f.output().includes("ETH残高"));
    await wait(() => level() === "ready");
    assert(f.rpcSupervisor.state().pending === 0);
    assert(f.rpcSupervisor.state().completed > 4);
    assert(!field("counts").textContent.includes(A));
    assert(!field("counts").textContent.includes("eth_call"));
    assert(!f.calls.some(call => /sign|send|switchEthereum|addEthereum/.test(call.method)));
  });

  test("rpc-supervisor: stopping a visible read displays abandoned work until the extension settles", async fixture => {
    const gate = deferred();
    const f = fixture(args => args.method === "eth_getBalance" ? gate.promise : undefined);
    try {
      await f.connect(); f.field(".read").click();
      await wait(() => f.calls.some(call => call.method === "eth_getBalance"));
      assert(f.rpcSupervisor.state().waiting === 1);
      document.querySelector(".security-stop").click();
      await wait(() => level() === "pending");
      assert(field("headline").textContent.includes("Wallet側で未完了"));
      assert(field("detail").textContent.includes("取消できません"));
      assert(f.rpcSupervisor.state().abandoned === 1);
      const count = f.calls.length;
      document.querySelector(".security-resume").click();
      gate.resolve("0xffff");
      await wait(() => level() === "ready");
      assert(f.calls.length === count);
      assert(!f.output().includes("65535"));
      assert(f.field(".read").disabled);
    } finally { gate.resolve("0x1"); }
  });

  test("rpc-supervisor: cancelled connection remains counted across UI reconnect attempts", async fixture => {
    const gate = deferred();
    const supervisor = createRpcSupervisor({ perProvider: 1, perPage: 1 });
    let stall = true;
    const f = fixture(args => stall && args.method === "eth_chainId" ? gate.promise : undefined,
      { rpcSupervisor: supervisor });
    try {
      f.field(".connect").click();
      await wait(() => f.calls.length === 1);
      f.field(".disconnect").click();
      await wait(() => f.output().includes("未接続"));
      f.field(".connect").click();
      await wait(() => f.output().includes("未完了の要求"));
      assert(f.calls.length === 1);
      assert(supervisor.state().denied === 1);
      assert(level() === "limited");
      stall = false; gate.resolve("0x2105");
      await wait(() => level() === "ready");
      assert(f.calls.length === 1);
      assert(f.field(".read").disabled);
      await f.connect();
      assert(!f.field(".read").disabled);
    } finally { gate.resolve("0x2105"); }
  });

  test("rpc-supervisor: real browser timer ends a stalled balance read without retrying", async fixture => {
    const gate = deferred();
    const f = fixture(args => args.method === "eth_getBalance" ? gate.promise : undefined);
    try {
      await f.connect(); f.field(".read").click();
      await wait(() => f.rpcSupervisor.state().timedOut === 1);
      await wait(() => f.field(".read").disabled && level() === "pending");
      const count = f.calls.length;
      gate.reject(Error("late confidential provider detail"));
      await wait(() => f.rpcSupervisor.state().pending === 0);
      assert(f.calls.length === count);
      assert(!document.body.textContent.includes("late confidential provider detail"));
      assert(f.rpcSupervisor.state().late === 1);
    } finally { gate.resolve(null); }
  });

  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
    test("rpc-supervisor: " + event + " clears results and does not reconnect", async fixture => {
      const f = fixture();
      await f.connect();
      f.field(".read").click();
      await wait(() => f.output().includes("ETH残高"));
      const count = f.calls.length;
      let payload;
      if (event === "accountsChanged") {
        payload = [A];
        Object.defineProperty(payload, "0", { get() { throw Error("forbidden account getter"); } });
      } else if (event === "chainChanged") payload = "invalid chain";
      else payload = new Proxy({}, { get() { throw Error("forbidden disconnect getter"); } });
      f.provider.emit(event, payload);
      await wait(() => f.field(".read").disabled);
      assert(!f.output().includes("ETH残高"));
      assert(f.calls.length === count);
      assert(!f.output().includes("forbidden"));
    });
  }

  test("rpc-supervisor: provider metadata is absent from visible status", async () => {
    await isolated(async f => {
      const operation = f.start({ provider: { account: A, label: "confidential synthetic provider" } });
      await wait(() => f.level() === "waiting");
      operation.gate.resolve({ balance: "confidential synthetic balance" });
      await operation.result;
      await wait(() => f.level() === "ready");
      assert(!f.host.textContent.includes("confidential"));
      assert(!f.host.textContent.includes(A));
    });
  });

  test("rpc-supervisor: native rejection is rendered only as aggregate counts", async () => {
    await isolated(async f => {
      const operation = f.start();
      await wait(() => operation.calls() === 1);
      operation.gate.reject(Object.assign(Error("<img src=x onerror=alert(1)>"), { code: 4001 }));
      const result = await operation.result;
      assert(result.code === 4001);
      await wait(() => f.level() === "ready");
      assert(!f.host.querySelector("img"));
      assert(!f.host.textContent.includes("onerror"));
    });
  });

  test("rpc-supervisor: page-wide capacity blocks a new provider identity", async () => {
    await isolated(async f => {
      const a = f.start({ provider: {} }), b = f.start({ provider: {} });
      await wait(() => a.calls() === 1 && b.calls() === 1);
      a.cancel(); b.cancel();
      const c = f.start({ provider: {} });
      assert((await c.result).code === "RPC_CAPACITY");
      assert(c.calls() === 0);
      await wait(() => f.level() === "limited");
      assert(f.field("counts").textContent.includes("未完了: 2 / 2"));
      a.gate.resolve(null); b.gate.resolve(null);
      await wait(() => f.level() === "ready");
    }, { perProvider: 1, perPage: 2 });
  });

  test("rpc-supervisor: late native result fails the monotonic deadline without a timer callback", async () => {
    let time = 0;
    await isolated(async f => {
      const operation = f.start({ timeoutMs: 100 });
      await wait(() => operation.calls() === 1);
      time = 100;
      operation.gate.resolve("expired");
      assert((await operation.result).code === "READ_TIMEOUT");
      assert(f.supervisor.state().late === 1);
      assert(f.supervisor.state().completed === 0);
    }, { now: () => time, schedule: () => 1, unschedule: () => {} });
  });

  test("rpc-supervisor: clock rollback closes current waits and updates the warning", async () => {
    let time = 50;
    await isolated(async f => {
      const operation = f.start();
      await wait(() => operation.calls() === 1);
      time = 49; operation.gate.resolve("invalid clock");
      assert((await operation.result).code === "RPC_CLOCK");
      await wait(() => f.level() === "stopped");
      assert(f.field("detail").textContent.includes("経過時間"));
      const extra = f.start();
      assert((await extra.result).code === "RPC_CLOCK");
      assert(extra.calls() === 0);
    }, { now: () => time });
  });

  test("rpc-supervisor: queue cancellation occurs before extension dispatch in browser microtasks", async () => {
    await isolated(async f => {
      const operation = f.start();
      operation.cancel();
      assert((await operation.result).code === "SESSION_CHANGED");
      assert(operation.calls() === 0);
      assert(f.supervisor.state().pending === 0);
      assert(f.supervisor.state().late === 0);
    });
  });

  test("rpc-supervisor: native status observer remains safe after disposal", async () => {
    const host = document.createElement("div"); document.body.append(host);
    let callback;
    const supervisor = createRpcSupervisor();
    const panel = mountRpcStatusPanel({ document, parent: host, supervisor: {
      state: supervisor.state, subscribe(fn) { callback = fn; return () => {}; },
    } });
    panel.dispose(); callback(null);
    assert(host.children.length === 0);
    supervisor.dispose(); host.remove();
  });

  test("rpc-supervisor: hostile status fields cannot insert HTML or reveal an account", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const supervisor = createRpcSupervisor();
    const panel = mountRpcStatusPanel({ document, parent: host, supervisor: {
      state: () => ({ ...supervisor.state(), account: A, error: "<script>private</script>" }),
      subscribe() { return () => {}; },
    } });
    try {
      assert(host.querySelector(".rpc-status-panel").getAttribute("data-level") === "unavailable");
      assert(!host.querySelector("script"));
      assert(!host.textContent.includes(A));
      assert(!host.textContent.includes("private"));
    } finally { panel.dispose(); supervisor.dispose(); host.remove(); }
  });

  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    test("rpc-supervisor: " + agent + " session rejects old responses after an event in native browser", async () => {
      const supervisor = createRpcSupervisor();
      const gate = deferred(), listeners = new Map();
      let reading = false;
      const provider = {
        on(name, fn) { listeners.set(name, fn); },
        removeListener(name) { listeners.delete(name); },
        async request({ method }) {
          if (method === "eth_chainId") return "0x14a34";
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [A];
          if (method === "eth_getBalance") { reading = true; return gate.promise; }
          throw Error("forbidden synthetic method");
        },
      };
      const wallet = new ThreeCoreWalletSession({ provider, agent, expectedAccount: A, chainId: 84532,
        siteOrigin: location.origin, approvedOrigins: [location.origin], rpcSupervisor: supervisor });
      try {
        await wallet.connect();
        const result = wallet.getNativeBalance(HASH).catch(error => error.code);
        await wait(() => reading);
        listeners.get("chainChanged")("0x2105");
        assert(await result === "SESSION_CHANGED");
        assert(supervisor.state().abandoned === 1);
        gate.resolve("0xffff");
        await wait(() => supervisor.state().pending === 0);
        assert(!wallet.state.connected);
        assert(supervisor.state().late === 1);
      } finally { gate.resolve(null); wallet.disconnect(); supervisor.dispose(); }
    });
  }
}
