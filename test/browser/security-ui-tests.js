import { mountSecurityPanel } from "/examples/security-panel.js";
import { mountReportSetPanel } from "/examples/report-set-panel.js";
import { readSecurityFileText } from "/src/security-file.js";
import { parseSecurityJson } from "/src/security-json.js";
import { prepareReportSetFile } from "/src/report-set-file.js";
import { sequenceSet, sequenceHistory, historyMemory, AFTER } from "/test/helpers/report-set-fixtures.js";

const assert = (condition, message = "Security UI assertion failed") => { if (!condition) throw Error(message); };
const wait = async predicate => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 3000) throw Error("Security UI did not settle");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const q = name => document.querySelector(".security-" + name);

function isolatedPanel() {
  const host = document.createElement("div"); document.body.append(host);
  const events = new EventTarget(); let now = 0, stops = 0;
  const timers = new Map(); let nextId = 0;
  const panel = mountSecurityPanel({ document, parent: host, eventTarget: events,
    onLock() { stops++; }, lockOptions: { now: () => now,
      schedule(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
      unschedule(id) { timers.delete(id); },
    } });
  return { host, panel, events, q: name => host.querySelector(".security-" + name),
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {
      timers.delete(id); timer.callback();
    } },
    stops: () => stops,
    dispose() { panel.dispose(); host.remove(); },
  };
}

export function registerSecurityUITests(test) {
  test("security: displayed protection history excludes connected wallet addresses", async make => {
    const f = make(); await f.connect(); q("stop").click();
    document.querySelector(".security-journal-prepare").click();
    const output = document.querySelector(".security-journal-output");
    const report = JSON.parse(output.value);
    assert(output.readOnly);
    assert(report.counts.manual === 1);
    assert(!output.value.includes(f.field(".account").value));
    assert(!output.value.includes("eth_requestAccounts"));
    assert(!document.querySelector(".security-journal-export-label").hidden);
  });

  test("security: changing protection state invalidates the displayed journal report", async make => {
    make(); document.querySelector(".security-journal-prepare").click();
    q("stop").click();
    assert(document.querySelector(".security-journal-output").value === "");
    assert(document.querySelector(".security-journal-export-label").hidden);
    assert(document.querySelector(".security-journal-notice").textContent.includes("新しい記録"));
    document.querySelector(".security-journal-prepare").click();
    assert(JSON.parse(document.querySelector(".security-journal-output").value).counts.manual === 1);
  });

  test("security: policy changes are visible in a bounded text-only journal", async make => {
    make();
    q("idle").value = "60000"; q("idle").dispatchEvent(new Event("change"));
    q("hidden").checked = false; q("hidden").dispatchEvent(new Event("change"));
    const rows = document.querySelectorAll(".security-journal-event");
    assert(rows.length === 3);
    assert(rows[0].textContent.includes("無効"));
    assert(rows[1].textContent.includes("1分"));
    assert(document.querySelectorAll(".security-journal script").length === 0);
  });

  test("security: closing a journal preview clears the textarea and keeps the history", async make => {
    make(); q("stop").click();
    document.querySelector(".security-journal-prepare").click();
    document.querySelector(".security-journal-close").click();
    assert(document.querySelector(".security-journal-output").value === "");
    assert(document.querySelector(".security-journal-event").textContent.includes("停止ボタン"));
  });

  test("security: native protection controls mount without a permission request", async make => {
    const f = make();
    assert(f.calls.length === 0);
    assert(q("panel").getAttribute("aria-label") === "ウォレット接続の保護");
    assert(q("status").getAttribute("role") === "status");
    assert(q("resume").disabled);
    assert(!q("stop").disabled);
    assert(q("hidden").checked);
  });

  test("security: stopping a connected wallet clears live results and prevents reconnect clicks", async make => {
    const f = make(); await f.connect();
    f.field(".read").click(); await wait(() => f.output().includes("ETH残高"));
    q("stop").click();
    assert(!f.output().includes("ETH残高"));
    assert(f.output().includes("未接続"));
    assert(f.field(".connect").disabled);
    assert(f.field(".read").disabled);
    const count = f.calls.length; f.field(".connect").click();
    assert(f.calls.length === count);
  });

  test("security: resume does not reconnect until the user presses Connect again", async make => {
    const f = make(); await f.connect(); q("stop").click();
    const count = f.calls.length; q("resume").click();
    assert(f.calls.length === count);
    assert(!f.field(".connect").disabled && f.field(".read").disabled);
    await f.connect(); assert(!f.field(".read").disabled);
  });

  test("security: one stop applies to all three cards and keeps their public address inputs", async make => {
    const f = make(); await f.connect(); q("stop").click();
    const cards = [...document.querySelectorAll("#grid .card")];
    assert(cards.length === 3);
    assert(cards.every(card => card.querySelector(".connect").disabled));
    assert(f.field(".account").value.startsWith("0x111111"));
    q("resume").click();
    assert(cards.every(card => !card.querySelector(".connect").disabled));
  });

  test("security: a late provider response cannot restore results after Stop", async make => {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const f = make(({ method }) => method === "eth_getBalance" ? delayed : undefined);
    await f.connect(); f.field(".read").click();
    await wait(() => f.calls.some(row => row.method === "eth_getBalance"));
    q("stop").click(); release("0xffff");
    await new Promise(resolve => setTimeout(resolve, 10));
    assert(!f.output().includes("65535"));
    assert(f.output().includes("未接続"));
    assert(f.field(".connect").disabled);
  });

  test("security: pending permission is not duplicated after Stop and Resume", async make => {
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    const f = make(({ method }) => method === "eth_requestAccounts" ? delayed : undefined);
    f.field(".connect").click();
    await wait(() => f.calls.some(row => row.method === "eth_requestAccounts"));
    q("stop").click(); q("resume").click(); f.field(".connect").click();
    await wait(() => f.output().includes("許可画面"));
    assert(f.calls.filter(row => row.method === "eth_requestAccounts").length === 1);
    release([f.field(".account").value]);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert(f.field(".read").disabled);
  });

  test("security: provider phishing text never appears in the account card", async make => {
    const f = make(({ method }) => {
      if (method === "eth_requestAccounts") throw Object.assign(Error("SEND YOUR SEED PHRASE TO evil.invalid"), { code: 4001 });
    });
    f.field(".connect").click(); await wait(() => f.output().includes("拒否"));
    assert(!document.body.textContent.includes("SEND YOUR SEED"));
    assert(!f.output().includes("evil.invalid"));
  });

  test("security: oversized wallet responses clear the connection without partial balances", async make => {
    const f = make(({ method }) => method === "eth_getBalance" ? "0x" + "f".repeat(2000) : undefined);
    await f.connect(); f.field(".read").click();
    await wait(() => f.output().includes("未接続"));
    assert(!f.output().includes("ETH残高"));
    assert(f.field(".read").disabled);
  });

  test("security: native select changes the idle interval and timer stops the panel", async () => {
    const f = isolatedPanel();
    try {
      f.q("idle").value = "60000";
      f.q("idle").dispatchEvent(new Event("change", { bubbles: true }));
      f.advance(60_000);
      assert(!f.panel.check());
      assert(f.q("status").textContent.includes("一定時間"));
      assert(f.stops() === 1);
    } finally { f.dispose(); }
  });

  test("security: synthetic keyboard and pointer events cannot extend an idle session", async () => {
    const f = isolatedPanel();
    try {
      f.advance(250_000);
      f.events.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      f.events.dispatchEvent(new Event("pointerdown"));
      f.advance(50_000);
      assert(!f.panel.check());
      assert(f.panel.state().reason === "idle");
    } finally { f.dispose(); }
  });

  test("security: leaving a page locks it and returning never auto-unlocks", async () => {
    const f = isolatedPanel();
    try {
      f.events.dispatchEvent(new Event("pagehide"));
      assert(f.panel.state().reason === "page-exit");
      f.events.dispatchEvent(new Event("pageshow"));
      assert(!f.panel.check());
      f.q("resume").click(); assert(f.panel.check());
    } finally { f.dispose(); }
  });

  test("security: new DOM controls do not survive component disposal", async () => {
    const f = isolatedPanel(), stop = f.q("stop"), resume = f.q("resume");
    f.dispose(); stop.click(); resume.click();
    assert(f.panel.state().disposed);
    assert(!document.contains(stop));
    assert(f.stops() === 1);
  });

  test("security: native File stream decodes multi-byte text without replacement", async () => {
    const text = '{"test":"日本語🚀"}';
    const file = new File([text], "utf8.json");
    assert(await readSecurityFileText(file) === text);
    assert(parseSecurityJson(await readSecurityFileText(file)).test === "日本語🚀");
  });

  test("security: aborting a file review does not invoke another read", async () => {
    const aborter = new AbortController(); aborter.abort();
    let error;
    try { await readSecurityFileText(new File(["{}"], "test.json"), { signal: aborter.signal }); }
    catch (value) { error = value; }
    assert(error?.code === "FILE_CANCELLED");
  });

  test("security: duplicate-property file leaves an accepted report and source history intact", async () => {
    const parent = document.createElement("div"); document.body.append(parent);
    const store = historyMemory(sequenceHistory());
    const panel = mountReportSetPanel({ document, parent, storage: store.storage, now: () => AFTER });
    const find = name => parent.querySelector(".report-set-" + name);
    const idle = () => wait(() => find("panel").getAttribute("aria-busy") === "false");
    try {
      find("refresh").click(); await idle(); find("select-visible").click();
      find("prepare").click(); find("apply").click(); await idle();
      assert(panel.getState().input !== null, "Expected an accepted report before the attack");
      const before = JSON.stringify(panel.getState().input);
      const historyBefore = JSON.stringify(store.document);
      const good = await prepareReportSetFile(sequenceSet());
      const attack = '{"schema":"discarded",' + good.text.trim().slice(1);
      const transfer = new DataTransfer(); transfer.items.add(new File([attack], "duplicate.json"));
      find("file").files = transfer.files; find("file").dispatchEvent(new Event("change"));
      await idle();
      assert(find("status").dataset.error === "true");
      assert(JSON.stringify(panel.getState().input) === before);
      assert(JSON.stringify(store.document) === historyBefore);
      assert(store.calls.every(call => call[0] === "read"), "Read-only review wrote history");
    } finally { panel.dispose(); parent.remove(); }
  });

  test("security: served page has enforcing CSP and embedding protection", async () => {
    const response = await fetch("/", { cache: "no-store" });
    assert(response.ok);
    const policy = response.headers.get("content-security-policy");
    assert(policy.includes("script-src 'self'"));
    assert(policy.includes("frame-ancestors 'none'"));
    assert(response.headers.get("x-frame-options") === "DENY");
    assert(response.headers.get("referrer-policy") === "no-referrer");
  });

  test("security: inline scripts are actually blocked by the browser", async () => {
    const script = document.createElement("script");
    script.textContent = 'document.body.dataset.securityInlineExecuted="yes"';
    document.body.append(script);
    await new Promise(resolve => setTimeout(resolve, 0));
    script.remove();
    assert(document.body.dataset.securityInlineExecuted === undefined);
  });

  test("security: inline event-handler code is actually blocked by the browser", async () => {
    const button = document.createElement("button");
    button.setAttribute("onclick", 'document.body.dataset.securityHandlerExecuted="yes"');
    document.body.append(button); button.click(); button.remove();
    assert(document.body.dataset.securityHandlerExecuted === undefined);
  });

  test("security: dynamic string evaluation is disabled by the browser policy", async () => {
    let blocked = false;
    try { new Function("return 42")(); } catch (error) { blocked = error instanceof EvalError; }
    assert(blocked);
  });
}
