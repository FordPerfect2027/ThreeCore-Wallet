import test from "node:test";
import assert from "node:assert/strict";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { archive, observation, bytes, deferred } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const card = new Element("article");
  card.dataset = { agent: "DAT" };
  let snapshot = observation();
  let reads = 0;
  const panel = mountPortfolioPanel({
    document: { createElement: tag => new Element(tag) }, card,
    getContext: () => ({ agent: "DAT", chainId: 84532 }),
    read: async () => { reads++; return snapshot; },
  });
  const field = name => card.find(name);
  const click = name => field(name).click();
  const candidate = (text, notify = true) => {
    field("history-json").value = text;
    if (notify) field("history-json").dispatchEvent(new Event("input"));
  };
  const choose = (text, getBuffer = async () => bytes(text).buffer) => {
    field("history-file-input").files = [{ name: "history.json", size: bytes(text).length, arrayBuffer: getBuffer }];
    field("history-file-input").dispatchEvent(new Event("change"));
  };
  return { card, panel, field, click, candidate, choose,
    snapshot: value => { snapshot = value; }, reads: () => reads };
}

test("current review describes records added through the actual portfolio panel", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.click("history-review-current");
  assert.match(f.field("history-review-details").textContent, /記録: 1件/);
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.reads(), 1);
  f.panel.dispose();
});

test("impact review leaves the actual history and apply controls unchanged", () => {
  const f = fixture();
  f.candidate(archive([observation("1")]));
  f.click("history-review-impact");
  assert.match(f.field("history-review-details").textContent, /適用後 1件/);
  assert.equal(f.field("history-apply").disabled, true);
  assert.equal(f.field("history-list").children.length, 0);
  assert.equal(f.reads(), 0);
  f.panel.dispose();
});

test("review of a replacement exposes removal from the actual card", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.candidate(archive([observation("99")]));
  f.field("history-replace").checked = true;
  f.field("history-replace").dispatchEvent(new Event("change"));
  f.click("history-review-impact");
  assert.match(f.field("history-review-details").textContent, /除外予定: DAT/);
  assert.equal(f.field("history-list").children.length, 1);
  f.panel.dispose();
});

test("editing candidate JSON invalidates an impact report immediately", () => {
  const f = fixture();
  f.candidate(archive());
  f.click("history-review-impact");
  assert.equal(f.field("history-review-save").disabled, false);
  f.candidate(archive([observation("99")]));
  assert.equal(f.field("history-review-save").disabled, true);
  assert.equal(f.field("history-review-details").textContent, "");
  f.panel.dispose();
});

test("replacement checkbox invalidates a prior impact report", () => {
  const f = fixture();
  f.candidate(archive());
  f.click("history-review-impact");
  f.field("history-replace").checked = true;
  f.field("history-replace").dispatchEvent(new Event("change"));
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("adding another record invalidates a current coverage report", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.click("history-review-current");
  f.snapshot(observation("43"));
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  assert.equal(f.field("history-list").children.length, 2);
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("deleting a record invalidates its previous report", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.click("history-review-current");
  f.field("history-last").value = "0";
  f.click("history-remove");
  assert.equal(f.field("history-list").children.length, 0);
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("context invalidation discards the report while preserving recorded history", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.click("history-review-current");
  f.panel.invalidate();
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("starting file IO invalidates an earlier impact report before completion", async () => {
  const pending = deferred();
  const f = fixture();
  f.candidate(archive());
  f.click("history-review-impact");
  const text = archive([observation("99")]);
  f.choose(text, () => pending.promise);
  assert.equal(f.field("history-review-save").disabled, true);
  pending.resolve(bytes(text).buffer);
  await settle();
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("completed file can be reviewed but still needs explicit import preview", async () => {
  const f = fixture();
  f.choose(archive([observation("99")]));
  await settle();
  f.click("history-review-impact");
  assert.match(f.field("history-review-details").textContent, /block 99/);
  assert.equal(f.field("history-apply").disabled, true);
  f.click("history-preview");
  f.click("history-apply");
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("clearing only the report retains restored history and candidate JSON", () => {
  const f = fixture();
  const text = archive([observation("99")]);
  f.candidate(text);
  f.click("history-preview");
  f.click("history-apply");
  f.click("history-review-current");
  f.click("history-review-clear");
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.field("history-json").value, text);
  f.panel.dispose();
});

test("empty replacement report warns before an intentional full removal", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.candidate(archive([]));
  f.field("history-replace").checked = true;
  f.click("history-review-impact");
  assert.match(f.field("history-review-details").textContent, /現在 1件 → 適用後 0件/);
  assert.equal(f.field("history-list").children.length, 1);
  f.panel.dispose();
});

test("another agent file cannot produce an impact for this card", () => {
  const f = fixture();
  f.candidate(archive([observation("1", { agent: "EMA" })]));
  f.click("history-review-impact");
  assert.equal(f.field("history-review-save").disabled, true);
  assert.equal(f.field("history-list").children.length, 0);
  f.panel.dispose();
});

test("bad JSON cannot leave a previously successful report visible", () => {
  const f = fixture();
  f.click("history-review-current");
  f.candidate("<img>");
  f.click("history-review-impact");
  assert.equal(f.field("history-review-details").textContent, "");
  assert.equal(f.field("history-review-save").disabled, true);
  f.panel.dispose();
});

test("disposal detaches review controls from the integrated screen", () => {
  const f = fixture();
  f.click("history-review-current");
  const current = f.field("history-review-current");
  f.panel.dispose();
  current.click();
  assert.equal(f.card.children.length, 0);
  assert.equal(f.reads(), 0);
});
