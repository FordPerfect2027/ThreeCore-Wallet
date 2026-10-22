import test from "node:test";
import assert from "node:assert/strict";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive, bytes, deferred } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const card = new Element("article");
  card.dataset = { agent: "DAT" };
  let result = observation();
  let calls = 0;
  const panel = mountPortfolioPanel({
    document: { createElement: tag => new Element(tag) }, card,
    getContext: () => ({ agent: "DAT", chainId: 84532 }),
    read: async () => { calls++; return result; },
  });
  const field = name => card.find(name);
  const click = name => field(name).click();
  const choose = (text, arrayBuffer = async () => bytes(text).buffer) => {
    const input = field("history-file-input");
    input.files = [{ name: "history.json", size: bytes(text).length, arrayBuffer }];
    input.dispatchEvent(new Event("change"));
  };
  return { card, panel, field, click, choose, result: value => { result = value; }, calls: () => calls };
}

test("full screen read can be added, exported, cleared and restored through a file", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  assert.equal(f.field("history-list").children.length, 1);
  f.click("history-export");
  const saved = f.field("history-json").value;
  assert.equal(JSON.parse(saved).reports.length, 1);
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  assert.equal(f.field("history-list").children.length, 0);
  f.choose(saved);
  await settle();
  assert.equal(f.field("history-list").children.length, 0);
  assert.equal(f.field("history-apply").disabled, true);
  f.click("history-preview");
  assert.equal(f.field("history-apply").disabled, false);
  f.click("history-apply");
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.calls(), 1);
  f.panel.dispose();
});

test("selecting a file invalidates a prior archive proposal", async () => {
  const f = fixture();
  f.field("history-json").value = archive([observation("1")]);
  f.click("history-preview");
  assert.equal(f.field("history-apply").disabled, false);
  f.choose(archive([observation("2")]));
  await settle();
  assert.equal(f.field("history-apply").disabled, true);
  assert.equal(JSON.parse(f.field("history-json").value).reports[0].snapshot.blockNumber, "2");
  f.panel.dispose();
});

test("manual JSON edits cancel a pending file read", async () => {
  const pending = deferred();
  const f = fixture();
  const old = archive([observation("1")]);
  f.choose(old, () => pending.promise);
  const manual = archive([observation("99")]);
  f.field("history-json").value = manual;
  f.field("history-json").dispatchEvent(new Event("input"));
  pending.resolve(bytes(old).buffer);
  await settle();
  assert.equal(f.field("history-json").value, manual);
  assert.equal(f.field("history-apply").disabled, true);
  f.panel.dispose();
});

test("adding a record cancels a file that was read against older history", async () => {
  const pending = deferred();
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  const candidate = archive([observation("99")]);
  f.choose(candidate, () => pending.promise);
  f.click("history-add-current");
  pending.resolve(bytes(candidate).buffer);
  await settle();
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.field("history-json").value, "");
  f.panel.dispose();
});

test("wallet context invalidation retains history but cancels a file read", async () => {
  const pending = deferred();
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  const candidate = archive([observation("99")]);
  f.choose(candidate, () => pending.promise);
  f.panel.invalidate();
  pending.resolve(bytes(candidate).buffer);
  await settle();
  assert.equal(f.field("history-list").children.length, 1);
  assert.equal(f.field("history-json").value, "");
  f.click("history-add-current");
  assert.equal(f.field("history-list").children.length, 1);
  f.panel.dispose();
});

test("switching replacement mode during file IO cannot apply stale contents", async () => {
  const pending = deferred();
  const f = fixture();
  const candidate = archive([observation("99")]);
  f.choose(candidate, () => pending.promise);
  f.field("history-replace").checked = true;
  f.field("history-replace").dispatchEvent(new Event("change"));
  pending.resolve(bytes(candidate).buffer);
  await settle();
  assert.equal(f.field("history-json").value, "");
  assert.equal(f.field("history-apply").disabled, true);
  f.panel.dispose();
});

test("clearing a history leaves exported JSON available for recovery", async () => {
  const f = fixture();
  f.click("portfolio-read");
  await settle();
  f.click("history-add-current");
  f.click("history-export");
  const saved = f.field("history-json").value;
  f.field("history-clear-confirm").checked = true;
  f.click("history-clear");
  assert.equal(f.field("history-json").value, saved);
  f.click("history-preview");
  f.click("history-apply");
  assert.equal(f.field("history-list").children.length, 1);
  f.panel.dispose();
});

test("file import and historical comparisons never trigger live reads", async () => {
  const f = fixture();
  f.choose(archive([observation("1"), observation("2")]));
  await settle();
  f.click("history-preview");
  f.click("history-apply");
  f.field("history-first").value = "0";
  f.field("history-last").value = "1";
  f.click("history-compare");
  assert.match(f.field("history-details").textContent, /保存記録の比較/);
  assert.equal(f.calls(), 0);
  f.panel.dispose();
});

test("other-agent files do not replace a valid manually entered candidate", async () => {
  const f = fixture();
  const manual = archive([observation("99")]);
  f.field("history-json").value = manual;
  f.choose(archive([observation("1", { agent: "EMA" })]));
  await settle();
  assert.equal(f.field("history-json").value, manual);
  assert.equal(f.field("history-list").children.length, 0);
  f.panel.dispose();
});

test("disposal prevents pending file completion from touching detached inputs", async () => {
  const pending = deferred();
  const f = fixture();
  const input = f.field("history-json");
  const candidate = archive([observation("99")]);
  f.choose(candidate, () => pending.promise);
  f.panel.dispose();
  pending.resolve(bytes(candidate).buffer);
  await settle();
  assert.equal(input.value, "");
  assert.equal(f.card.children.length, 0);
});

test("starting a new file immediately invalidates an earlier import review", async () => {
  const pending = deferred();
  const f = fixture();
  f.field("history-json").value = archive([observation("1")]);
  f.click("history-preview");
  assert.equal(f.field("history-apply").disabled, false);
  const candidate = archive([observation("99")]);
  f.choose(candidate, () => pending.promise);
  assert.equal(f.field("history-apply").disabled, true);
  f.click("history-apply");
  assert.equal(f.field("history-list").children.length, 0);
  pending.resolve(bytes(candidate).buffer);
  await settle();
  assert.equal(f.field("history-apply").disabled, true);
  f.panel.dispose();
});
