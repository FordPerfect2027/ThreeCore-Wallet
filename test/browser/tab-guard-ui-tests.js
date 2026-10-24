import { createTabGuard } from "/src/tab-guard-controller.js";
import { createBrowserTabTransport } from "/src/tab-guard-transport.js";
import { createStopSignal, createStopReceipt, randomTabId } from "/src/tab-guard-protocol.js";
import { mountSecurityPanel } from "/examples/security-panel.js";

const assert = (value, message = "tab guard assertion") => { if (!value) throw Error(message); };
async function wait(predicate, timeout = 5000) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw Error("notification UI deadline exceeded");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const turn = () => new Promise(resolve => setTimeout(resolve, 30));
const q = name => document.querySelector(".security-" + name);
const tabQ = name => document.querySelector(".tab-guard-" + name);

async function isolated(action) {
  const name = "threecore-tab-test-" + crypto.randomUUID();
  const resources = [];
  function transport() {
    const value = createBrowserTabTransport({ host: window, name });
    resources.push(() => value.close());
    return value;
  }
  function guard(options = {}) {
    const stops = [];
    const value = createTabGuard({ transport: transport(), receiptMs: 1000,
      onStop: reason => { stops.push(reason); return true; }, ...options });
    resources.push(() => value.dispose());
    assert(value.start());
    return { value, stops };
  }
  function raw() {
    const channel = new BroadcastChannel(name), messages = [];
    channel.addEventListener("message", event => messages.push(event.data));
    resources.push(() => channel.close());
    return { channel, messages };
  }
  try { await action({ transport, guard, raw, name }); }
  finally { for (const close of resources.reverse()) close(); }
}

export function registerTabGuardUITests(test) {
  for (const mode of ["false", "throw", "async"]) {
    test("tab-guard: native cleanup warning and explicit retry after " + mode, async () => {
      await isolated(async ({ transport, guard }) => {
        const host = document.createElement("div"); document.body.append(host);
        let broken = true, calls = 0;
        const panel = mountSecurityPanel({ document, parent: host, eventTarget: new EventTarget(),
          onLock() {
            calls++;
            if (!broken) return true;
            if (mode === "throw") throw Error("synthetic confidential failure");
            if (mode === "async") return Promise.reject(Error("synthetic confidential failure"));
            return false;
          }, tabGuardOptions: { transport: transport() } });
        const sender = guard();
        const field = name => host.querySelector(".security-" + name);
        try {
          sender.value.stop();
          await wait(() => !field("cleanup-warning").hidden);
          assert(field("cleanup-warning").getAttribute("role") === "alert");
          assert(!host.textContent.includes("synthetic confidential failure"));
          assert(field("resume").disabled);
          assert(!panel.check());
          assert(sender.value.state().receiptCount === 0);
          field("resume").dispatchEvent(new MouseEvent("click"));
          assert(!panel.check());
          field("cleanup-retry").click();
          assert(calls === 2 && field("resume").disabled);
          broken = false; field("cleanup-retry").click();
          assert(calls === 3 && field("cleanup-warning").hidden);
          assert(field("cleanup-retry").hidden);
          assert(getComputedStyle(field("cleanup-retry")).display === "none");
          assert(!panel.check());
          field("resume").click();
          assert(panel.check());
          assert(sender.value.state().receiptCount === 0);
          await turn();
        } finally { panel.dispose(); host.remove(); }
      });
    });
  }

  test("tab-guard: simultaneous native requests stop both senders without relaying", async () => {
    await isolated(async ({ guard, raw }) => {
      const observer = raw(), first = guard(), second = guard();
      first.value.stop(); second.value.stop();
      await wait(() => first.value.state().receiptCount === 1 && second.value.state().receiptCount === 1);
      await turn();
      assert(first.stops.join() === "broadcast-stop,peer-stop");
      assert(second.stops.join() === "broadcast-stop,peer-stop");
      assert(observer.messages.filter(value => value.kind === "stop").length === 2);
      assert(observer.messages.filter(value => value.kind === "receipt").length === 2);
    });
  });

  test("tab-guard: zero native responses never claims all screens have stopped", async () => {
    await isolated(async ({ guard }) => {
      const first = guard({ receiptMs: 50 });
      first.value.stop();
      await wait(() => first.value.state().phase === "complete");
      assert(first.value.state().receiptCount === 0);
      assert(!Object.hasOwn(first.value.state(), "allStopped"));
      assert(first.stops.join() === "broadcast-stop");
    });
  });

  test("tab-guard: native older schema never grants authority to stop or resume", async () => {
    await isolated(async ({ guard, raw }) => {
      const first = guard(), sender = raw();
      for (const schema of ["threecore-tab-stop-v0", "threecore-tab-stop-v2", "wallet-unlock-v1"]) {
        sender.channel.postMessage({ ...createStopSignal(randomTabId(), randomTabId(), Date.now()), schema });
      }
      await wait(() => first.value.state().ignored === 3);
      assert(first.stops.length === 0);
      assert(sender.messages.length === 0);
    });
  });

  test("tab-guard: protected native panel keeps healthy retry controls hidden", async () => {
    await isolated(async ({ transport }) => {
      const host = document.createElement("div"); document.body.append(host);
      const panel = mountSecurityPanel({ document, parent: host, eventTarget: new EventTarget(),
        tabGuardOptions: { transport: transport() } });
      try {
        const retry = host.querySelector(".security-cleanup-retry");
        assert(retry.hidden && getComputedStyle(retry).display === "none");
        panel.lock();
        assert(retry.hidden && getComputedStyle(retry).display === "none");
        assert(host.querySelector(".security-cleanup-warning").hidden);
        assert(!host.querySelector(".security-resume").disabled);
      } finally { panel.dispose(); host.remove(); }
    });
  });

  test("tab-guard: repeated local stops re-clear values without duplicating the journal", async () => {
    await isolated(async ({ transport }) => {
      const host = document.createElement("div"); document.body.append(host);
      let text = "synthetic draft", count = 0;
      const panel = mountSecurityPanel({ document, parent: host, eventTarget: new EventTarget(),
        onLock() { text = ""; count++; }, tabGuardOptions: { transport: transport() } });
      try {
        panel.lock(); text = "new synthetic draft"; panel.lock();
        assert(text === "" && count === 2);
        host.querySelector(".security-journal-prepare").click();
        const record = JSON.parse(host.querySelector(".security-journal-output").value);
        assert(record.counts.manual === 1);
        assert(!record.events.some(value => JSON.stringify(value).includes("synthetic draft")));
      } finally { panel.dispose(); host.remove(); }
    });
  });

  test("tab-guard: real BroadcastChannel delivers stop and a matching receipt", async () => {
    await isolated(async ({ guard }) => {
      const sender = guard(), receiver = guard();
      assert(sender.value.stop());
      await wait(() => receiver.value.state().received === 1);
      await wait(() => sender.value.state().receiptCount === 1);
      assert(sender.stops.join() === "broadcast-stop");
      assert(receiver.stops.join() === "peer-stop");
      await wait(() => sender.value.state().phase === "complete");
      assert(sender.value.state().receiptCount === 1);
    });
  });

  test("tab-guard: native three-peer delivery does not relay stops or loop", async () => {
    await isolated(async ({ guard, raw }) => {
      const observer = raw(), peers = [guard(), guard(), guard()];
      peers[0].value.stop();
      await wait(() => peers[0].value.state().receiptCount === 2);
      await turn();
      assert(observer.messages.filter(value => value.kind === "stop").length === 1);
      assert(observer.messages.filter(value => value.kind === "receipt").length === 2);
      assert(peers[1].value.state().received === 1 && peers[2].value.state().received === 1);
    });
  });

  test("tab-guard: native structured clone transports only notification metadata", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), observer = raw(); peer.value.stop();
      await wait(() => observer.messages.length === 1);
      assert(Object.keys(observer.messages[0]).sort().join() === "id,issuedAt,kind,schema,source");
      for (const word of ["account", "balance", "password", "secret", "token", "address"]) {
        assert(!JSON.stringify(observer.messages).includes(word));
      }
    });
  });

  test("tab-guard: distinct channel namespaces cannot stop one another", async () => {
    await isolated(async ({ guard }) => {
      const peer = guard();
      const other = new BroadcastChannel("threecore-other-" + crypto.randomUUID());
      try {
        other.postMessage(createStopSignal(randomTabId(), randomTabId(), Date.now()));
        await turn();
        assert(peer.stops.length === 0);
      } finally { other.close(); }
    });
  });

  test("tab-guard: native malformed messages cannot invoke wallet cleanup", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), sender = raw();
      for (const value of [null, "unlock", { kind: "resume" },
        { ...createStopSignal(randomTabId(), randomTabId(), Date.now()), password: "synthetic" }]) {
        sender.channel.postMessage(value);
      }
      await wait(() => peer.value.state().ignored === 4);
      assert(peer.stops.length === 0);
      assert(peer.value.state().available);
      assert(sender.messages.length === 0);
    });
  });

  test("tab-guard: replaying a native stop does not repeat cleanup or receipt", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), sender = raw();
      const signal = createStopSignal(randomTabId(), randomTabId(), Date.now());
      sender.channel.postMessage(signal); sender.channel.postMessage(signal);
      await wait(() => peer.value.state().ignored === 1);
      await wait(() => sender.messages.length === 1);
      assert(peer.stops.length === 1);
      assert(sender.messages[0].kind === "receipt");
    });
  });

  test("tab-guard: native resume is local and queued old messages stay ignored", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), sender = raw();
      const previous = createStopSignal(randomTabId(), randomTabId(), Date.now());
      sender.channel.postMessage(previous);
      await wait(() => peer.stops.length === 1); await turn();
      assert(peer.value.noteResume());
      sender.channel.postMessage({ ...previous, id: randomTabId() });
      await wait(() => peer.value.state().ignored === 1);
      assert(peer.stops.length === 1);
      assert(sender.messages.every(value => value.kind === "receipt"));
    });
  });

  test("tab-guard: native expiry checks refuse stale and future signal times", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), sender = raw();
      for (const delta of [-20000, 20000]) {
        sender.channel.postMessage(createStopSignal(randomTabId(), randomTabId(), Date.now() + delta));
      }
      await wait(() => peer.value.state().ignored === 2);
      assert(peer.stops.length === 0);
    });
  });

  test("tab-guard: a forged receipt for a different request is not counted", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard({ receiptMs: 1000 }), sender = raw();
      peer.value.stop(); await wait(() => sender.messages.length === 1);
      const receipt = createStopReceipt(sender.messages[0], randomTabId());
      sender.channel.postMessage({ ...receipt, id: randomTabId() });
      await wait(() => peer.value.state().ignored === 1);
      assert(peer.value.state().receiptCount === 0);
      sender.channel.postMessage(receipt);
      await wait(() => peer.value.state().receiptCount === 1);
    });
  });

  test("tab-guard: a disposed native receiver cannot acknowledge or stop", async () => {
    await isolated(async ({ guard, raw }) => {
      const peer = guard(), sender = raw(); peer.value.dispose();
      sender.channel.postMessage(createStopSignal(randomTabId(), randomTabId(), Date.now()));
      await turn();
      assert(peer.stops.length === 0);
      assert(sender.messages.length === 0);
      assert(peer.value.state().disposed);
    });
  });

  test("tab-guard: integrated wallet stops and clears a live read on remote notification", async make => {
    await isolated(async ({ transport, guard }) => {
      const f = make(undefined, { tabGuardOptions: { transport: transport(), receiptMs: 1000 } });
      const sender = guard({ receiptMs: 1000 });
      await f.connect(); f.field(".read").click();
      await wait(() => f.output().includes("ETH残高"));
      const count = f.calls.length;
      sender.value.stop();
      await wait(() => q("panel").getAttribute("data-locked") === "true");
      assert(f.output().includes("未接続"));
      assert(!f.output().includes("ETH残高"));
      assert(f.field(".connect").disabled && f.field(".read").disabled);
      assert(f.calls.length === count);
      assert(tabQ("status").textContent.includes("停止通知を受け"));
      await wait(() => sender.value.state().receiptCount === 1);
    });
  });

  test("tab-guard: remote stop protects all three wallet cards at once", async make => {
    await isolated(async ({ transport, guard }) => {
      const f = make(undefined, { tabGuardOptions: { transport: transport() } });
      const sender = guard(); await f.connect(); sender.value.stop();
      await wait(() => f.field(".connect").disabled);
      const cards = [...document.querySelectorAll("#grid .card")];
      assert(cards.length === 3);
      assert(cards.every(card => card.querySelector(".connect").disabled));
      assert(cards.every(card => card.querySelector(".read").disabled));
    });
  });

  test("tab-guard: integrated resume performs no permission or balance call", async make => {
    await isolated(async ({ transport, guard }) => {
      const f = make(undefined, { tabGuardOptions: { transport: transport() } });
      const sender = guard(); await f.connect(); sender.value.stop();
      await wait(() => f.field(".connect").disabled);
      const count = f.calls.length; q("resume").click();
      assert(!f.field(".connect").disabled);
      assert(f.field(".read").disabled);
      assert(f.calls.length === count);
      assert(sender.value.state().received === 0);
      await f.connect(); assert(!f.field(".read").disabled);
    });
  });

  test("tab-guard: a delayed provider result cannot repopulate after a peer stop", async make => {
    await isolated(async ({ transport, guard }) => {
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const f = make(args => args.method === "eth_getBalance" ? pending : undefined,
        { tabGuardOptions: { transport: transport() } });
      const sender = guard();
      try {
        await f.connect(); f.field(".read").click();
        await wait(() => f.calls.some(value => value.method === "eth_getBalance"));
        sender.value.stop(); await wait(() => f.field(".connect").disabled);
        release("0xffff"); await turn(); q("resume").click();
        assert(!f.output().includes("65535"));
        assert(f.field(".read").disabled);
      } finally { release("0xffff"); }
    });
  });

  test("tab-guard: remote stop clears typed backup credentials even when already stopped", async make => {
    await isolated(async ({ transport, guard }) => {
      make(undefined, { tabGuardOptions: { transport: transport() } });
      const sender = guard(); q("stop").click();
      for (const name of ["password", "confirmation", "restore-password"]) {
        document.querySelector(".secure-backup-" + name).value = "synthetic backup fixture";
      }
      sender.value.stop();
      await wait(() => tabQ("status").textContent.includes("この画面を保護停止しました"));
      for (const name of ["password", "confirmation", "restore-password"]) {
        assert(document.querySelector(".secure-backup-" + name).value === "", "credential field not cleared: " + name);
      }
    });
  });

  test("tab-guard: peer stop clears encrypted library review without deleting stored entries", async make => {
    await isolated(async ({ transport, guard }) => {
      make(undefined, { tabGuardOptions: { transport: transport() } });
      const sender = guard();
      const load = document.querySelector(".encrypted-library-load"); load.click();
      await wait(() => !load.disabled);
      assert(!document.querySelector(".encrypted-library-capacity").textContent.includes("まだ"));
      sender.value.stop();
      await wait(() => document.querySelector(".encrypted-library-capacity").textContent.includes("まだ"));
      assert(document.querySelector(".encrypted-library-commit").disabled);
      assert(document.querySelector(".encrypted-library-select").options.length === 0);
    });
  });

  test("tab-guard: hidden/idle local protection does not stop unrelated active contexts", async () => {
    await isolated(async ({ transport, guard }) => {
      const host = document.createElement("div"); document.body.append(host);
      const peer = guard(), events = new EventTarget();
      const panel = mountSecurityPanel({ document, parent: host, eventTarget: events,
        tabGuardOptions: { transport: transport() } });
      try {
        panel.lock("hidden"); await turn();
        assert(!panel.state().canRead);
        assert(peer.stops.length === 0);
        assert(peer.value.state().received === 0);
      } finally { panel.dispose(); host.remove(); }
    });
  });

  test("tab-guard: browser page-freeze and restored-page events leave access stopped", async make => {
    const f = make();
    q("hidden").checked = false;
    document.dispatchEvent(new Event("freeze"));
    assert(f.field(".connect").disabled);
    assert(q("status").textContent.includes("一時停止"));
    q("resume").click();
    f.eventTarget.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    assert(f.field(".connect").disabled);
    assert(q("status").textContent.includes("再表示"));
  });
}
