import test from "node:test";
import assert from "node:assert/strict";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive, bytes, deferred } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const card = new Element("section");
  card.dataset = { agent: "DAT" };
  let current = observation("1");
  let calls = 0;
  const panel = mountPortfolioPanel({ document: { createElement: tag => new Element(tag) }, card,
    getContext: () => ({ agent: "DAT", chainId: 84532 }),
    read: async () => { calls++; return current; } });
  const field = name => card.find(name);
  const click = name => field(name).click();
  async function add(block) {
    current = observation(block);
    click("portfolio-read");
    await settle();
    click("history-add-current");
  }
  function candidate(text, replace = false) {
    field("history-json").value = text;
    field("history-json").dispatchEvent(new Event("input"));
    field("history-replace").checked = replace;
    field("history-replace").dispatchEvent(new Event("change"));
  }
  const choose = (text, arrayBuffer = async () => bytes(text).buffer) => {
    field("history-file-input").files = [{ name: "history.json", size: bytes(text).length, arrayBuffer }];
    field("history-file-input").dispatchEvent(new Event("change"));
  };
  return { card, panel, field, click, add, candidate, choose, calls: () => calls,
    count: () => field("history-list").children.length };
}

test("integrated record deletion and explicit recovery preserve order", async () => {
  const f = fixture();
  await f.add("1");
  await f.add("2");
  f.field("history-last").value = "0";
  f.click("history-remove");
  assert.equal(f.count(), 1);
  assert.equal(f.field("history-recovery-apply").disabled, true);
  f.click("history-recovery-preview");
  assert.equal(f.count(), 1);
  f.click("history-recovery-apply");
  assert.equal(f.count(), 2);
  assert.equal(f.field("history-list").children[0].textContent.includes("block 1"), true);
  assert.equal(f.calls(), 2);
  f.panel.dispose();
});

test("clear-all requires confirmation and supports reviewed recovery", async () => {
  const f = fixture();
  await f.add("1");
  f.click("history-clear");
  assert.equal(f.count(), 1);
  assert.equal(f.field("history-recovery-preview").disabled, true);
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  assert.equal(f.count(), 0);
  f.click("history-recovery-preview");
  f.click("history-recovery-apply");
  assert.equal(f.count(), 1);
  f.panel.dispose();
});

test("confirmed archive replacement also has a recovery point", async () => {
  const f = fixture();
  await f.add("1");
  f.candidate(archive([observation("99")]), true);
  f.click("history-preview");
  f.click("history-apply");
  assert.equal(f.field("history-list").children[0].textContent.includes("99"), true);
  f.click("history-recovery-preview");
  f.click("history-recovery-apply");
  assert.equal(f.field("history-list").children[0].textContent.includes("block 1"), true);
  f.panel.dispose();
});

test("ordinary archive merge does not create a destructive recovery point", () => {
  const f = fixture();
  f.candidate(archive([observation("99")]));
  f.click("history-preview");
  f.click("history-apply");
  assert.equal(f.count(), 1);
  assert.equal(f.field("history-recovery-preview").disabled, true);
  f.panel.dispose();
});

test("new records disable direct recovery instead of overwriting them", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-last").value = "0";
  f.click("history-remove");
  await f.add("99");
  assert.equal(f.field("history-recovery-preview").disabled, true);
  assert.equal(f.field("history-recovery-copy").disabled, false);
  assert.equal(f.count(), 1);
  assert.equal(f.field("history-list").children[0].textContent.includes("99"), true);
  f.panel.dispose();
});

test("stale backup copy defaults to merge mode for separate review", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-last").value = "0";
  f.click("history-remove");
  await f.add("99");
  f.field("history-replace").checked = true;
  f.click("history-recovery-copy");
  assert.equal(f.field("history-replace").checked, false);
  assert.equal(f.field("history-apply").disabled, true);
  f.click("history-preview");
  f.click("history-apply");
  assert.equal(f.count(), 2);
  f.panel.dispose();
});

test("manual JSON edits cancel a pending recovery preview", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  f.click("history-recovery-preview");
  f.candidate(archive([observation("99")]));
  assert.equal(f.field("history-recovery-apply").disabled, true);
  assert.equal(f.count(), 0);
  f.panel.dispose();
});

test("file loading start cancels restoration before the asynchronous read", async () => {
  const pending = deferred();
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  f.click("history-recovery-preview");
  const text = archive([observation("99")]);
  f.choose(text, () => pending.promise);
  assert.equal(f.field("history-recovery-apply").disabled, true);
  pending.resolve(bytes(text).buffer);
  await settle();
  assert.equal(f.count(), 0);
  f.panel.dispose();
});

test("context change keeps a saved recovery point but cancels review", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  f.click("history-recovery-preview");
  f.panel.invalidate();
  assert.equal(f.field("history-recovery-apply").disabled, true);
  assert.equal(f.field("history-recovery-save").disabled, false);
  f.panel.dispose();
});

test("recovery invalidates a previous content review and filter result", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  f.click("history-review-current");
  f.click("history-filter-run");
  f.click("history-recovery-preview");
  f.click("history-recovery-apply");
  assert.equal(f.field("history-review-save").disabled, true);
  assert.equal(f.field("history-filter-results").textContent, "");
  assert.equal(f.field("history-file-save-subset").disabled, true);
  f.panel.dispose();
});

test("discarding recovery never discards the current history", async () => {
  const f = fixture();
  await f.add("1");
  await f.add("2");
  f.field("history-last").value = "0";
  f.click("history-remove");
  f.field("history-recovery-discard-confirm").checked = true;
  f.click("history-recovery-discard");
  assert.equal(f.count(), 1);
  assert.equal(f.field("history-recovery-preview").disabled, true);
  f.panel.dispose();
});

test("a second deletion retains only its own previous state", async () => {
  const f = fixture();
  await f.add("1");
  await f.add("2");
  await f.add("3");
  f.field("history-last").value = "0";
  f.click("history-remove");
  f.field("history-last").value = "0";
  f.click("history-remove");
  f.click("history-recovery-preview");
  f.click("history-recovery-apply");
  assert.equal(f.count(), 2);
  assert.equal(f.field("history-list").children[0].textContent.includes("block 2"), true);
  f.panel.dispose();
});

test("failed import replacement preserves the earlier deletion backup", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  f.candidate("broken", true);
  f.click("history-preview");
  assert.equal(f.field("history-apply").disabled, true);
  f.click("history-recovery-preview");
  f.click("history-recovery-apply");
  assert.equal(f.count(), 1);
  f.panel.dispose();
});

test("disposing the complete portfolio panel removes recovery callbacks", async () => {
  const f = fixture();
  await f.add("1");
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  const preview = f.field("history-recovery-preview");
  f.panel.dispose();
  preview.click();
  assert.equal(f.card.children.length, 0);
  assert.equal(f.calls(), 1);
});
