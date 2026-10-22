import test from "node:test";
import assert from "node:assert/strict";
import { mountPortfolioPanel } from "../examples/portfolio-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive } from "./helpers/history-fixtures.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function screen(agent) {
  const card = new Element("section");
  card.dataset = { agent };
  let row = observation("1", { agent });
  let reads = 0;
  const panel = mountPortfolioPanel({
    document: { createElement: tag => new Element(tag) }, card,
    getContext: () => ({ agent, chainId: 84532 }),
    read: async () => { reads++; return row; },
  });
  const field = name => card.find(name);
  const click = name => field(name).click();
  async function add(block) {
    row = observation(block, { agent });
    click("portfolio-read");
    await settle();
    click("history-add-current");
  }
  function remove() {
    field("history-last").value = "0";
    click("history-remove");
  }
  function restore() {
    click("history-recovery-preview");
    click("history-recovery-apply");
  }
  function replace(block) {
    field("history-json").value = archive([observation(block, { agent })]);
    field("history-json").dispatchEvent(new Event("input"));
    field("history-replace").checked = true;
    field("history-replace").dispatchEvent(new Event("change"));
    click("history-preview");
    click("history-apply");
  }
  return { panel, field, click, add, remove, restore, replace,
    count: () => field("history-list").children.length,
    text: () => field("history-list").children.map(row => row.textContent).join("\n"),
    reads: () => reads };
}

test("DAT, EMA and CAWELON each keep their own deletion recovery slot", async () => {
  const cards = ["DAT", "EMA", "CAWELON"].map(screen);
  try {
    for (let index = 0; index < cards.length; index++) {
      await cards[index].add(String(index * 10 + 1));
      await cards[index].add(String(index * 10 + 2));
    }
    const originals = cards.map(card => card.text());
    for (const card of cards) card.remove();
    assert.deepEqual(cards.map(card => card.count()), [1, 1, 1]);
    cards[1].restore();
    assert.deepEqual(cards.map(card => card.count()), [1, 2, 1]);
    assert.equal(cards[1].text(), originals[1]);
    assert.equal(cards[0].field("history-recovery-preview").disabled, false);
    assert.equal(cards[2].field("history-recovery-preview").disabled, false);
    cards[0].restore();
    cards[2].restore();
    assert.deepEqual(cards.map(card => card.text()), originals);
    assert.deepEqual(cards.map(card => card.reads()), [2, 2, 2]);
  } finally {
    cards.forEach(card => card.panel.dispose());
  }
});

test("discarding one card's archive leaves the others recoverable", async () => {
  const dat = screen("DAT");
  const ema = screen("EMA");
  try {
    await dat.add("1");
    await ema.add("9");
    dat.remove();
    ema.remove();
    dat.field("history-recovery-discard-confirm").checked = true;
    dat.click("history-recovery-discard");
    assert.equal(dat.field("history-recovery-preview").disabled, true);
    assert.equal(ema.field("history-recovery-preview").disabled, false);
    ema.restore();
    assert.equal(ema.count(), 1);
    assert.equal(dat.count(), 0);
  } finally {
    dat.panel.dispose();
    ema.panel.dispose();
  }
});

test("new observations invalidate only the changed card's direct restoration", async () => {
  const dat = screen("DAT");
  const caw = screen("CAWELON");
  try {
    await dat.add("1");
    await caw.add("2");
    dat.remove();
    caw.remove();
    await dat.add("3");
    assert.equal(dat.field("history-recovery-preview").disabled, true);
    assert.equal(dat.field("history-recovery-report").disabled, false);
    assert.equal(caw.field("history-recovery-preview").disabled, false);
    caw.restore();
    assert.match(caw.text(), /block 2/);
    assert.match(dat.text(), /block 3/);
    assert.equal(dat.count(), 1);
  } finally {
    dat.panel.dispose();
    caw.panel.dispose();
  }
});

test("replacement recovery on one card does not touch another card's preview", async () => {
  const dat = screen("DAT");
  const ema = screen("EMA");
  try {
    await dat.add("1");
    await ema.add("2");
    dat.replace("99");
    ema.remove();
    ema.click("history-recovery-preview");
    assert.equal(ema.field("history-recovery-apply").disabled, false);
    dat.restore();
    assert.match(dat.text(), /block 1/);
    assert.equal(ema.field("history-recovery-apply").disabled, false);
    ema.click("history-recovery-apply");
    assert.match(ema.text(), /block 2/);
    assert.equal(dat.reads(), 1);
    assert.equal(ema.reads(), 1);
  } finally {
    dat.panel.dispose();
    ema.panel.dispose();
  }
});

test("disposing a card does not destroy a sibling card's retained archive", async () => {
  const dat = screen("DAT");
  const ema = screen("EMA");
  try {
    await dat.add("1");
    await ema.add("2");
    dat.remove();
    ema.remove();
    dat.panel.dispose();
    ema.click("history-recovery-report");
    assert.match(ema.field("history-recovery-details").textContent, /EMA/);
    assert.doesNotMatch(ema.field("history-recovery-details").textContent, /1\. DAT/);
    ema.restore();
    assert.equal(ema.count(), 1);
    assert.match(ema.text(), /block 2/);
  } finally {
    dat.panel.dispose();
    ema.panel.dispose();
  }
});
