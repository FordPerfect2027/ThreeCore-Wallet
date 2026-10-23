import test from "node:test";
import assert from "node:assert/strict";
import { mountTransferPanel } from "../examples/transfer-panel.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { Element } from "./helpers/panel-dom.js";
import { REQUEST, context, deferred, event, fileFromText, snapshot, tick } from "./helpers/transfer-fixtures.js";

async function settle(predicate) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail("Transfer panel did not settle");
}
function fixture(options = {}) {
  const parent = new Element("div");
  const document = { createElement: tag => new Element(tag) };
  const reads = [], downloads = [], states = [];
  let cancels = 0;
  const panel = mountTransferPanel({ document, parent, getContext: () => context(),
    read: async (request, extras) => { reads.push({ request, extras }); return snapshot(); },
    download: file => downloads.push(file), onCancel: () => cancels++,
    onStateChange: state => states.push(state), ...options });
  const q = name => parent.find("transfer-" + name);
  const click = name => q(name).click();
  const change = (name, value, type = "input") => {
    q(name).value = value;
    q(name).dispatchEvent(new Event(type));
  };
  return { parent, document, panel, reads, downloads, states, q, click, change,
    get cancels() { return cancels; },
    async inspect() { click("read"); await settle(() => q("panel").getAttribute("aria-busy") === "false"); },
    async load(file) {
      q("file").files = [file];
      q("file").dispatchEvent(new Event("change"));
      await settle(() => q("panel").getAttribute("aria-busy") === "false");
    },
  };
}

test("transfer panel: accessible initial state has no reads and no enabled export", () => {
  const f = fixture();
  assert.equal(f.reads.length, 0);
  assert.equal(f.q("save-json").disabled, true);
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("archive-add").disabled, true);
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.equal(f.q("lookback").value, "250");
  f.panel.dispose();
});

test("transfer panel: explicit range reaches reader and summary shows exact values", async () => {
  const f = fixture();
  f.change("from", "30");
  f.change("to", "42");
  await f.inspect();
  assert.deepEqual(f.reads[0].request, REQUEST);
  assert.match(f.q("summary").textContent, /1\.234567890123456789 DAT/);
  assert.equal(f.q("save-json").disabled, false);
  assert.equal(f.q("archive-add").disabled, false);
  assert.equal(f.q("rows").children.length, 1);
  f.panel.dispose();
});

test("transfer panel: RPC failure is a status message, not zero events", async () => {
  const f = fixture({ read: async () => { throw Object.assign(Error("secret"), { code: "TRANSFER_RPC_FAILED" }); } });
  await f.inspect();
  assert.match(f.q("status").textContent, /取得できません/);
  assert.equal(f.q("summary").textContent, "");
  assert.equal(f.q("save-json").disabled, true);
  f.panel.dispose();
});

test("transfer panel: window controls edit only the draft, never start another read", async () => {
  const f = fixture();
  await f.inspect();
  f.click("window-pin");
  assert.equal(f.q("from").value, "30");
  assert.equal(f.q("to").value, "42");
  f.click("window-previous");
  assert.equal(f.q("from").value, "17");
  assert.equal(f.q("to").value, "29");
  assert.equal(f.reads.length, 1);
  assert.match(f.q("summary").textContent, /30 ～ 42/);
  assert.match(f.q("window-status").textContent, /新しい履歴/);
  f.click("window-latest");
  assert.equal(f.q("from").value, "");
  assert.equal(f.q("to").value, "");
  assert.equal(f.q("lookback").value, "13");
  f.panel.dispose();
});

test("transfer panel: numeric and directional filters paginate without more RPC", async () => {
  let reads = 0;
  const f = fixture({ read: async () => { reads++; return snapshot({ events: Array.from({ length: 25 }, (_, index) => event({}, index)) }); } });
  await f.inspect();
  assert.equal(f.q("rows").children.length, 10);
  assert.match(f.q("counter").textContent, /1ページ目/);
  f.click("next");
  assert.match(f.q("counter").textContent, /2ページ目/);
  f.click("next");
  assert.equal(f.q("rows").children.length, 5);
  f.change("direction", "outgoing", "change");
  assert.match(f.q("empty").textContent, /該当する記録はありません/);
  assert.equal(f.q("previous").disabled, true);
  assert.equal(reads, 1);
  f.panel.dispose();
});

test("transfer panel: search text is not interpreted as HTML", async () => {
  const f = fixture();
  await f.inspect();
  f.change("search", "<img src=x onerror=alert(1)>");
  assert.match(f.q("empty").textContent, /該当する記録/);
  assert.equal(f.q("rows").children[0].tagName, "LI");
  f.panel.dispose();
});

test("transfer panel: changing range cancels an outstanding read", async () => {
  const pending = deferred();
  let signal;
  const f = fixture({ read: (request, options) => { signal = options.signal; return pending.promise; } });
  f.click("read");
  f.change("from", "20");
  assert.equal(signal.aborted, true);
  assert.equal(f.cancels, 1);
  pending.resolve(snapshot());
  await tick();
  assert.equal(f.q("summary").textContent, "");
  f.panel.dispose();
});

test("transfer panel: valid JSON requires preview and explicit apply", async () => {
  const f = fixture();
  await f.load(fileFromText(await encodeTransferFile(snapshot())));
  assert.match(f.q("preview").textContent, /現在のチェーン状態は未確認/);
  assert.equal(f.q("summary").textContent, "");
  assert.equal(f.q("apply").disabled, false);
  assert.equal(f.q("file").value, "");
  f.click("apply");
  assert.match(f.q("status").textContent, /保存ファイル/);
  assert.match(f.q("summary").textContent, /1取引/);
  assert.equal(f.reads.length, 0);
  f.panel.dispose();
});

test("transfer panel: cancel preview cannot change the displayed record", async () => {
  const f = fixture();
  await f.inspect();
  await f.load(fileFromText(await encodeTransferFile(snapshot({ events: [] }))));
  f.click("cancel");
  assert.equal(f.q("apply").disabled, true);
  assert.match(f.q("summary").textContent, /1取引/);
  f.panel.dispose();
});

test("transfer panel: baseline comparison is separate from live result", async () => {
  const f = fixture();
  await f.inspect();
  f.click("baseline");
  f.click("compare");
  assert.match(f.q("comparison").textContent, /同一 1件/);
  f.panel.dispose();
});

for (const kind of ["json", "csv", "txt"]) {
  test("transfer panel: explicit " + kind + " download", async () => {
    const f = fixture();
    await f.inspect();
    f.click("save-" + kind);
    await settle(() => f.downloads.length === 1);
    assert.ok(f.downloads[0].filename.endsWith("." + kind));
    assert.equal(f.reads.length, 1);
    f.panel.dispose();
  });
}

test("transfer panel: download error is reported without corrupting observation", async () => {
  const f = fixture({ download: async () => { throw Error("disk unavailable"); } });
  await f.inspect();
  f.click("save-csv");
  await settle(() => f.q("status").textContent.includes("保存できません"));
  assert.match(f.q("summary").textContent, /1取引/);
  f.panel.dispose();
});

test("transfer panel: archive adds record only on explicit action and survives current-view clear", async () => {
  const f = fixture();
  await f.inspect();
  assert.equal(f.q("archive-overview").textContent, "");
  f.click("archive-add");
  assert.match(f.q("archive-overview").textContent, /1記録/);
  f.click("clear");
  assert.equal(f.q("summary").textContent, "");
  assert.match(f.q("archive-overview").textContent, /1記録/);
  f.click("archive-select");
  await settle(() => !f.q("apply").disabled);
  f.click("apply");
  assert.match(f.q("status").textContent, /保存ファイル/);
  assert.equal(f.reads.length, 1);
  f.panel.dispose();
});

test("transfer panel: archive duplicate is explained and previous record preserved", async () => {
  const f = fixture();
  await f.inspect();
  f.click("archive-add");
  f.click("archive-add");
  assert.match(f.q("archive-status").textContent, /同じ期間の記録がすでに/);
  assert.match(f.q("archive-overview").textContent, /1記録/);
  f.panel.dispose();
});

test("transfer panel: context invalidation clears archive as well as current observation", async () => {
  const f = fixture();
  await f.inspect();
  f.click("archive-add");
  f.panel.invalidate();
  assert.equal(f.q("summary").textContent, "");
  assert.equal(f.q("archive-overview").textContent, "");
  assert.equal(f.q("archive-save").disabled, true);
  f.panel.dispose();
});

test("transfer panel: no stale download after disposal", async () => {
  const pending = deferred();
  const f = fixture({ subtle: { digest: () => pending.promise } });
  await f.inspect();
  f.click("save-json");
  f.panel.dispose();
  pending.resolve(new ArrayBuffer(32));
  await tick();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.parent.children.length, 0);
});
