import test from "node:test";
import assert from "node:assert/strict";
import { mountAllowancePanel } from "../examples/allowance-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { record, targets, saved, S1, S2, ACCOUNT, deferred, tick, nextRecord } from "./helpers/allowance-fixtures.js";

async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail("Panel did not settle");
}
function fixture(options = {}) {
  const parent = new Element("div");
  const document = { createElement: tag => new Element(tag) };
  const reads = [], downloads = [], states = [];
  const panel = mountAllowancePanel({
    document, parent,
    getContext: () => ({ ...targets(), account: ACCOUNT }),
    read: async (plan, opts) => { reads.push({ plan, opts }); return record({ targets: plan }); },
    downloadFile: file => downloads.push(file),
    onStateChange: state => states.push(state),
    ...options,
  });
  const q = name => parent.find("allowance-" + name);
  const click = name => q(name).click();
  const input = (name, value) => {
    q(name).value = value;
    q(name).dispatchEvent(new Event("input"));
  };
  return { parent, document, panel, reads, downloads, states, q, click, input,
    async configure() {
      input("draft", S1 + " | Exchange A\n" + S2 + " | Exchange B");
      click("preview");
      click("apply");
    },
    async inspect() {
      click("inspect");
      await settle(() => q("panel").getAttribute("aria-busy") === "false");
    },
    async load(file) {
      q("file").files = [file];
      q("file").dispatchEvent(new Event("change"));
      await settle(() => q("panel").getAttribute("aria-busy") === "false");
    },
  };
}
test("allowance panel: initial actions and accessible labels", () => {
  const f = fixture();
  assert(f.q("inspect").disabled);
  assert(f.q("apply").disabled);
  assert(f.q("save").disabled);
  assert(f.q("save-targets").disabled);
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.equal(f.q("file").accept, ".json,application/json");
  assert.equal(f.reads.length, 0);
  f.panel.dispose();
});
test("allowance panel: preview and apply display exact addresses before reading", async () => {
  const f = fixture();
  await f.configure();
  assert(f.q("targets").textContent.includes(S1));
  assert(!f.q("inspect").disabled);
  assert(!f.q("save-targets").disabled);
  assert.equal(f.reads.length, 0);
  await f.inspect();
  assert.equal(f.reads.length, 1);
  assert(f.q("details").textContent.includes("今回読み取った"));
  assert(f.q("details").textContent.includes(ACCOUNT));
});
test("allowance panel: editing draft clears prior observation and disables download", async () => {
  const f = fixture();
  await f.configure();
  await f.inspect();
  f.input("draft", S1);
  assert.equal(f.q("details").textContent, "");
  assert(f.q("inspect").disabled);
  assert(f.q("save").disabled);
});
test("allowance panel: label markup remains text", async () => {
  const f = fixture();
  f.input("draft", S1 + " | <img src=x>");
  f.click("preview");
  assert(f.q("targets").textContent.includes("<img src=x>"));
  assert.equal(f.q("targets").children.length, 0);
});
test("allowance panel: status filters never call provider", async () => {
  const f = fixture();
  await f.configure();
  await f.inspect();
  const count = f.reads.length;
  f.q("filter").value = "zero";
  f.q("filter").dispatchEvent(new Event("change"));
  assert(f.q("details").textContent.includes("表示対象: 1 / 2件"));
  assert(!f.q("details").textContent.includes(S2));
  f.input("search", "no-match");
  assert(f.q("details").textContent.includes("表示対象: 0 / 2件"));
  assert.equal(f.reads.length, count);
});
test("allowance panel: busy controls disable duplicate read and file input", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  await f.configure();
  f.click("inspect");
  for (const name of ["inspect", "draft", "preview", "apply", "file", "save", "save-targets"]) assert(f.q(name).disabled);
  assert.equal(f.q("cancel").disabled, false);
  gate.resolve(record());
  await settle(() => !f.q("save").disabled);
});
test("allowance panel: cancellation and late result do not show old data", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  await f.configure();
  f.click("inspect");
  f.click("cancel");
  gate.resolve(record());
  await tick();
  assert.equal(f.q("details").textContent, "");
  assert(f.q("status").textContent.includes("中止"));
});
test("allowance panel: target file imports require preview/application", async () => {
  const f = fixture();
  await f.load(await saved("targets", targets()));
  assert(f.q("targets").textContent.includes(S1));
  assert.equal(f.q("apply").disabled, false);
  assert(f.q("inspect").disabled);
  assert.equal(f.reads.length, 0);
  f.click("apply");
  assert(f.q("draft").value.includes(S1));
  assert.equal(f.q("inspect").disabled, false);
});
test("allowance panel: observation import is historical with no automatic read", async () => {
  const f = fixture();
  await f.load(await saved());
  assert(f.q("details").textContent.includes("過去の承認記録"));
  assert.equal(f.reads.length, 0);
  assert(f.q("inspect").disabled);
  assert.equal(f.q("file").value, "");
});
test("allowance panel: malformed import clears old visible observation", async () => {
  const f = fixture();
  await f.load(await saved());
  const bytes = new TextEncoder().encode("{");
  await f.load({ name: "bad.json", size: bytes.length, arrayBuffer: async () => bytes.buffer });
  assert.equal(f.q("details").textContent, "");
  assert(f.q("save").disabled);
});
test("allowance panel: save both plan and record only after explicit clicks", async () => {
  const f = fixture();
  await f.configure();
  assert.equal(f.downloads.length, 0);
  f.click("save-targets");
  await settle(() => f.downloads.length === 1);
  assert.equal(f.downloads[0].kind, "targets");
  await f.inspect();
  assert.equal(f.downloads.length, 1);
  f.click("save");
  await settle(() => f.downloads.length === 2);
  assert.equal(f.downloads[1].kind, "observation");
});
test("allowance panel: failed download visible without claiming success", async () => {
  const f = fixture({ downloadFile: async () => { throw Error("disk failure"); } });
  await f.load(await saved());
  f.click("save");
  await settle(() => f.q("status").textContent.includes("ダウンロードできません"));
  assert(f.q("details").textContent.includes(ACCOUNT));
});
test("allowance panel: baseline and subsequent observation produce visible delta", async () => {
  const f = fixture();
  await f.load(await saved());
  f.click("baseline");
  const next = nextRecord(record());
  next.rows[1].allowanceBaseUnits = "11";
  await f.load(await saved("observation", next));
  f.click("compare");
  assert(f.q("comparison").textContent.includes("+0.000000000000000001"));
  assert(f.q("baseline-status").textContent.includes("block 42"));
});
test("allowance panel: clear resets baseline and summary without deleting files", async () => {
  const f = fixture();
  await f.load(await saved());
  f.click("baseline");
  f.click("clear");
  assert.equal(f.q("details").textContent, "");
  assert.equal(f.q("comparison").textContent, "");
  assert(f.q("baseline-status").textContent.includes("未設定"));
  assert.equal(f.states.at(-1).observation, null);
  assert.equal(f.downloads.length, 0);
});
test("allowance panel: invalidation preserves typed draft but retires applied target review", async () => {
  const f = fixture();
  await f.configure();
  const draft = f.q("draft").value;
  f.panel.invalidate();
  assert.equal(f.q("draft").value, draft);
  assert(f.q("inspect").disabled);
});
test("allowance panel: disposal removes nodes and listeners", async () => {
  const f = fixture();
  await f.configure();
  const inspect = f.q("inspect");
  f.panel.dispose();
  f.panel.dispose();
  inspect.click();
  assert.equal(f.reads.length, 0);
  assert.equal(f.parent.children.length, 0);
});
test("allowance panel: late async download does not replace status after clear", async () => {
  const gate = deferred();
  let entered = false;
  const f = fixture({ downloadFile: async () => { entered = true; await gate.promise; } });
  await f.load(await saved());
  f.click("save");
  await settle(() => entered);
  f.click("clear");
  const status = f.q("status").textContent;
  gate.resolve();
  await tick();
  assert.equal(f.q("status").textContent, status);
});
