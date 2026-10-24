import test from "node:test";
import assert from "node:assert/strict";
import { reportSetTimeline, timelineCellLabel, timelineCellText, TIMELINE_NOTICE } from "../src/report-set-timeline.js";
import { mountReportSetTimeline } from "../examples/report-set-timeline-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { sequenceHistory, sequenceSet, demoSetHistory, clone, id } from "./helpers/report-set-fixtures.js";

test("timeline has distinct chronological groups for all three tokens", () => {
  const result = reportSetTimeline(sequenceSet());
  assert.equal(result.groupCount, 3);
  assert.equal(result.cellCount, 9);
  assert.deepEqual(result.groups.map(group => group.agent), ["DAT", "EMA", "CAWELON"]);
  assert.equal(result.proportional, false);
  assert.equal(result.chronological, true);
  assert.equal(result.liveChainRechecked, false);
  assert.equal(result.tokenAmountsSummed, false);
  for (const group of result.groups) {
    assert.deepEqual(group.cells.map(cell => [cell.start, cell.end]), [["30", "42"], ["42", "54"], ["54", "66"]]);
    assert.ok(group.cells.every(cell => cell.tone === "recorded"));
    assert.ok(group.cells.every(cell => cell.covering.length === 1));
    assert.ok(group.cells.every(cell => cell.blocks === "12"));
  }
});

test("timeline order is independent of the order in which checkboxes were selected", () => {
  const history = sequenceHistory();
  const forward = reportSetTimeline(sequenceSet(history));
  const reversed = reportSetTimeline(sequenceSet(history, [id(103), id(102), id(101)]));
  assert.deepEqual(reversed, forward);
});

test("gap cell explains exact boundaries and adjacent report names", () => {
  const result = reportSetTimeline(sequenceSet(sequenceHistory([0n, 24n])));
  const gap = result.groups[0].cells.find(cell => cell.kind === "gap");
  assert.equal(gap.tone, "gap");
  assert.equal(gap.start, "42");
  assert.equal(gap.end, "54");
  assert.equal(gap.blocks, "12");
  assert.deepEqual(gap.covering, []);
  assert.deepEqual(gap.neighbors.map(row => [row.label, row.side]), [["報告 1", "before"], ["報告 2", "after"]]);
  const text = timelineCellText(gap);
  assert.match(text, /取引がなかったことを意味しません/);
  assert.match(text, /直前の報告: 報告 1/);
  assert.match(text, /直後の報告: 報告 2/);
  assert.match(timelineCellLabel(gap), /42から54、12ブロック、計画の抜け/);
});

test("tiny intervals stay visible beside a gap larger than safe floating-point integers", () => {
  const gap = 9007199254740999n;
  const result = reportSetTimeline(sequenceSet(sequenceHistory([0n, 12n + gap])));
  const cells = result.groups[0].cells;
  assert.equal(cells.length, 3);
  assert.equal(cells[0].blocks, "12");
  assert.equal(cells[1].blocks, gap.toString());
  assert.equal(cells[2].blocks, "12");
  assert.ok(timelineCellText(cells[1]).includes(gap.toString()));
  assert.ok(TIMELINE_NOTICE.includes("長さの比率は表しません"));
});

test("overlap cell identifies every covering report without repeating an interval", () => {
  const result = reportSetTimeline(sequenceSet(sequenceHistory([0n, 6n])));
  const overlap = result.groups[0].cells.find(cell => cell.kind === "overlap");
  assert.equal(overlap.blocks, "6");
  assert.deepEqual(overlap.covering.map(row => row.id), [id(101), id(102)]);
  assert.match(timelineCellText(overlap), /履歴は結合していません/);
});

test("same-evidence repetitions use review wording instead of duplicate value totals", () => {
  const history = demoSetHistory();
  const result = reportSetTimeline(sequenceSet(history, [id(102), id(105)]));
  const repeated = result.groups[0].cells[0];
  assert.equal(repeated.kind, "repeated");
  assert.equal(repeated.tone, "review");
  assert.equal(repeated.blocks, "12");
  assert.match(timelineCellText(repeated), /取引や資産を二重に数えません/);
});

test("a conflicting boundary is disclosed on both neighboring cells", () => {
  const input = sequenceSet(sequenceHistory([0n, 12n], (value, index) => {
    if (index === 1) value.slots[0].entry.draft.earlier.balanceBaseUnits = "1";
  }));
  const cells = reportSetTimeline(input).groups[0].cells;
  assert.equal(cells.length, 2);
  assert.ok(cells.every(cell => cell.tone === "conflict"));
  assert.ok(cells.every(cell => cell.balanceConflictBlocks.includes("42")));
  assert.ok(cells.every(cell => timelineCellText(cell).includes("残高不一致: Block 42")));
});

test("shared chain hash disagreements are visible on each affected token group", () => {
  const history = demoSetHistory();
  const result = reportSetTimeline(sequenceSet(history, [id(101), id(106)]));
  assert.ok(result.groups.every(group => group.cells.some(cell => cell.tone === "conflict")));
  assert.ok(result.groups.every(group => group.cells.some(cell => cell.hashConflictBlocks.length > 0)));
  assert.ok(result.groups.every(group => group.cells.some(cell => timelineCellLabel(cell).includes("食い違い"))));
});

test("missing agent has a named notice instead of an invented empty period", () => {
  const history = sequenceHistory(undefined, value => { value.slots[1].entry = null; });
  const result = reportSetTimeline(sequenceSet(history));
  assert.equal(result.groupCount, 2);
  assert.deepEqual(result.missingAgents, ["EMA"]);
  assert.ok(!result.groups.some(group => group.agent === "EMA"));
});

test("partial archived evidence is visibly marked and never receives recorded tone", () => {
  const history = demoSetHistory();
  const result = reportSetTimeline(sequenceSet(history, [id(103), id(107)]));
  const caw = result.groups.find(group => group.agent === "CAWELON");
  assert.equal(caw.cells[1].tone, "review");
  assert.equal(caw.cells[1].covering[0].archived, true);
  assert.ok(timelineCellText(caw.cells[1]).includes("非表示保管"));
  assert.ok(timelineCellLabel(caw.cells[1]).includes("計算一致は未確認"));
});

test("restricted source record retains the reacquisition instruction", () => {
  const history = sequenceHistory(undefined, (value, index) => {
    if (index === 1) value.slots[0].entry.requiresNewPlan = true;
  });
  const cell = reportSetTimeline(sequenceSet(history)).groups[0].cells[1];
  assert.equal(cell.tone, "review");
  assert.ok(timelineCellText(cell).includes("再取得が必要"));
});

test("all cells have unique stable identifiers and immutable nested report references", () => {
  const input = clone(sequenceSet(demoSetHistory()));
  const before = JSON.stringify(input);
  const result = reportSetTimeline(input);
  const cells = result.groups.flatMap(group => group.cells);
  assert.equal(new Set(cells.map(cell => cell.id)).size, cells.length);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(cells[0].covering));
  assert.ok(Object.isFrozen(cells[0].covering[0]));
  assert.deepEqual(result, reportSetTimeline(input));
});

function panel(input = sequenceSet()) {
  const document = { activeElement: null, createElement(tag) {
    const node = new Element(tag);
    node.focus = () => { document.activeElement = node; };
    return node;
  } };
  const parent = new Element("div");
  const mounted = mountReportSetTimeline({ document, parent, input });
  const walk = element => [element, ...element.children.flatMap(walk)];
  const all = className => walk(parent).filter(node => node.className?.split(" ").includes(className));
  return { document, parent, mounted, all,
    buttons: () => all("report-set-timeline-cell"),
    details: () => all("report-set-timeline-detail"),
  };
}

test("timeline panel announces selected report details without modifying source input", () => {
  const input = sequenceSet();
  const before = JSON.stringify(input);
  const f = panel(input);
  const buttons = f.buttons();
  assert.equal(buttons.length, 9);
  assert.ok(buttons.every(button => button.getAttribute("aria-pressed") === "false"));
  buttons[1].click();
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.match(f.details()[0].textContent, /報告 2/);
  assert.equal(f.details()[0].getAttribute("aria-live"), "polite");
  assert.equal(JSON.stringify(input), before);
  f.mounted.dispose();
});

test("selection is exclusive within one token group and independent across groups", () => {
  const f = panel();
  f.buttons()[0].click(); f.buttons()[1].click(); f.buttons()[3].click();
  assert.equal(f.buttons()[0].getAttribute("aria-pressed"), "false");
  assert.equal(f.buttons()[1].getAttribute("aria-pressed"), "true");
  assert.equal(f.buttons()[3].getAttribute("aria-pressed"), "true");
  assert.match(f.details()[0].textContent, /DAT \/ 区間 2/);
  assert.match(f.details()[1].textContent, /EMA \/ 区間 1/);
  f.mounted.dispose();
});

test("arrow keys and Home/End move focus without silently selecting a different interval", () => {
  const f = panel();
  const buttons = f.buttons();
  function key(button, name) {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperty(event, "key", { value: name });
    button.dispatchEvent(event);
    return event;
  }
  buttons[0].focus();
  assert.equal(key(buttons[0], "ArrowRight").defaultPrevented, true);
  assert.equal(f.document.activeElement, buttons[1]);
  key(buttons[1], "End");
  assert.equal(f.document.activeElement, buttons[2]);
  key(buttons[2], "ArrowRight");
  assert.equal(f.document.activeElement, buttons[2]);
  key(buttons[2], "Home");
  assert.equal(f.document.activeElement, buttons[0]);
  key(buttons[0], "ArrowLeft");
  assert.equal(f.document.activeElement, buttons[0]);
  assert.ok(buttons.every(button => button.getAttribute("aria-pressed") === "false"));
  assert.equal(key(buttons[0], "Tab").defaultPrevented, false);
  f.mounted.dispose();
});

test("timeline renders hostile labels as plain text when a cell is selected", () => {
  const input = clone(sequenceSet());
  input.entries[0].label = "<img src=x onerror=alert(1)>";
  const f = panel(input);
  f.buttons()[0].click();
  assert.ok(f.details()[0].textContent.includes("<img"));
  assert.equal(f.all("report-set-timeline-detail")[0].children.length, 0);
  f.mounted.dispose();
});

test("unmounting removes handlers from retained controls", () => {
  const f = panel();
  const button = f.buttons()[0], detail = f.details()[0];
  const before = detail.textContent;
  f.mounted.dispose(); f.mounted.dispose();
  button.click();
  assert.equal(detail.textContent, before);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(f.parent.children.length, 0);
});

test("all missing-token notices remain explicit in the visual panel", () => {
  const input = sequenceSet(sequenceHistory(undefined, value => {
    value.slots[0].entry = null;
    value.slots[1].entry = null;
  }));
  const f = panel(input);
  assert.deepEqual(f.all("report-set-timeline-missing").map(node => node.textContent), [
    "DAT: 選択した報告に期間の記録がありません。",
    "EMA: 選択した報告に期間の記録がありません。",
  ]);
  assert.equal(f.buttons().length, 3);
  f.mounted.dispose();
});
