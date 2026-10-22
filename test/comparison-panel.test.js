import test from "node:test";
import assert from "node:assert/strict";
import { mountComparisonPanel } from "../examples/comparison-panel.js";
import { encodePortfolioReport } from "../src/portfolio-report.js";
import { Element } from "./helpers/panel-dom.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const HASH = "0x" + "ab".repeat(32);
function snapshot(overrides = {}) {
  return {
    agent: "DAT", account: ACCOUNT, chainId: 84532, siteOrigin: "http://localhost:4184",
    connectionEpoch: 1, blockNumber: "42", blockHash: HASH,
    nativeBalanceBaseUnits: "16",
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "42", notice: null }],
    readOnly: true, securityAudit: false, ...overrides,
  };
}
const later = () => snapshot({ blockNumber: "43", blockHash: "0x" + "cd".repeat(32),
  nativeBalanceBaseUnits: "20" });
function fixture() {
  const parent = new Element("article");
  const panel = mountComparisonPanel({ document: { createElement: tag => new Element(tag) }, parent });
  const field = name => parent.find("comparison-" + name);
  function input(value) {
    field("baseline").value = value;
    field("baseline").dispatchEvent(new Event("input"));
  }
  function compare(first = snapshot(), last = later()) {
    panel.setTarget(last);
    input(encodePortfolioReport(first));
    field("run").click();
  }
  return { parent, panel, field, input, compare };
}

test("without a displayed target the comparison button remains disabled", () => {
  const f = fixture();
  f.input(encodePortfolioReport(snapshot()));
  f.field("run").click();
  assert.equal(f.field("run").disabled, true);
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /先に表示/);
});

test("comparison renders a local observation difference with no provider dependency", () => {
  const f = fixture();
  f.compare();
  assert.match(f.field("status").textContent, /比較が完了/);
  assert.match(f.field("status").textContent, /外部通信は行っていません/);
  assert.match(f.field("details").textContent, /wei）: \+4/);
  assert.match(f.field("details").textContent, /最小単位）: 0/);
  assert.equal(f.field("status").getAttribute("aria-live"), "polite");
});

test("editing the baseline clears an earlier comparison immediately", () => {
  const f = fixture();
  f.compare();
  f.input("{");
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /入力が変わりました/);
  f.field("run").click();
  assert.match(f.field("status").textContent, /読み取れません|入力してください|長すぎます/);
  assert.equal(f.field("details").textContent, "");
});

test("replacing the target clears earlier results before a new comparison", () => {
  const f = fixture();
  f.compare();
  f.panel.setTarget(snapshot({ blockNumber: "44", blockHash: "0x" + "ef".repeat(32) }));
  assert.equal(f.field("details").textContent, "");
  assert.match(f.field("status").textContent, /入力して比較/);
  f.field("run").click();
  assert.match(f.field("details").textContent, /42 → 44/);
});

test("a malformed target replacement cannot retain the previous valid target", () => {
  const f = fixture();
  f.compare();
  assert.throws(() => f.panel.setTarget({ readOnly: true }));
  assert.equal(f.field("run").disabled, true);
  assert.equal(f.field("details").textContent, "");
  f.field("run").click();
  assert.equal(f.field("details").textContent, "");
});

test("target values are copied instead of observing later caller mutation", () => {
  const f = fixture();
  const target = later();
  f.panel.setTarget(target);
  target.nativeBalanceBaseUnits = "999";
  f.input(encodePortfolioReport(snapshot()));
  f.field("run").click();
  assert.match(f.field("details").textContent, /wei）: \+4/);
  assert.doesNotMatch(f.field("details").textContent, /983/);
});

test("clearing target removes both historical input and displayed comparison", () => {
  const f = fixture();
  f.compare();
  f.panel.clearTarget();
  assert.equal(f.field("baseline").value, "");
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("run").disabled, true);
});

test("clear button removes input without discarding a still-valid displayed target", () => {
  const f = fixture();
  f.compare();
  f.field("clear").click();
  assert.equal(f.field("baseline").value, "");
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("run").disabled, false);
  assert.match(f.field("status").textContent, /消去しました/);
});

for (const [before, target, text] of [
  [snapshot({ agent: "EMA" }), later(), /同じエージェント/],
  [later(), snapshot(), /古いブロック/],
  [snapshot(), snapshot({ blockHash: "0x" + "cd".repeat(32) }), /ハッシュが異なる/],
  [snapshot(), snapshot({ nativeBalanceBaseUnits: "17" }), /記録が一致しない/],
]) {
  test("comparison failure uses an actionable safe label: " + text, () => {
    const f = fixture();
    f.compare(before, target);
    assert.match(f.field("status").textContent, text);
    assert.equal(f.field("details").textContent, "");
  });
}

for (const text of ["", "null", "[]", "{", "<img src=x onerror=alert(1)>", " ".repeat(65537)]) {
  test("malformed baseline stays text-only and clears results: length " + text.length, () => {
    const f = fixture();
    f.compare();
    f.input(text);
    f.field("run").click();
    assert.match(f.field("status").textContent, /読み取れません|入力してください|長すぎます/);
    assert.equal(f.field("details").textContent, "");
    assert.equal(f.parent.find("img"), null);
  });
}

test("a report with extra authorization fields cannot be compared", () => {
  const f = fixture();
  f.panel.setTarget(later());
  const report = JSON.parse(encodePortfolioReport(snapshot()));
  report.canAuthorizeTransaction = true;
  f.input(JSON.stringify(report));
  f.field("run").click();
  assert.match(f.field("status").textContent, /読み取れません|入力してください|長すぎます/);
  assert.equal(f.field("details").textContent, "");
});

test("dispose removes the component and makes retained controls inert", () => {
  const f = fixture();
  f.compare();
  const run = f.field("run"), input = f.field("baseline"), details = f.field("details");
  f.panel.dispose();
  f.panel.dispose();
  assert.equal(f.parent.children.length, 0);
  input.value = encodePortfolioReport(snapshot());
  input.dispatchEvent(new Event("input"));
  run.click();
  assert.equal(details.textContent, "");
  f.panel.setTarget(later());
  assert.equal(f.parent.children.length, 0);
});


test("empty comparison input receives a specific accessible validation error", () => {
  const f = fixture();
  f.panel.setTarget(later());
  f.input(" \t\r\n ");
  f.field("run").click();
  assert.match(f.field("status").textContent, /JSONを入力してください/);
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  assert.equal(f.field("details").textContent, "");
});

test("oversized comparison input is rejected before parsing with a size hint", () => {
  const f = fixture();
  f.panel.setTarget(later());
  f.input("x".repeat(65537));
  f.field("run").click();
  assert.match(f.field("status").textContent, /65,536文字以内/);
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  assert.equal(f.field("details").textContent, "");
});

test("valid JSON padded to the exact input limit remains comparable", () => {
  const f = fixture();
  f.panel.setTarget(later());
  const report = encodePortfolioReport(snapshot());
  f.input(report + " ".repeat(65536 - report.length));
  f.field("run").click();
  assert.match(f.field("status").textContent, /比較が完了/);
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "false");
  assert.match(f.field("details").textContent, /wei）: \+4/);
});

test("editing a rejected baseline clears the accessible error state", () => {
  const f = fixture();
  f.panel.setTarget(later());
  f.input("{");
  f.field("run").click();
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  f.input(encodePortfolioReport(snapshot()));
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "false");
  assert.equal(f.field("details").textContent, "");
  f.field("run").click();
  assert.match(f.field("status").textContent, /比較が完了/);
});

test("identity mismatch marks the input invalid until it is cleared", () => {
  const f = fixture();
  f.compare(snapshot({ agent: "EMA" }), later());
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  assert.match(f.field("status").textContent, /同じエージェント/);
  f.field("clear").click();
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "false");
  assert.equal(f.field("baseline").value, "");
});

test("disconnect-style invalidation clears validation errors and comparison data", () => {
  const f = fixture();
  f.panel.setTarget(later());
  f.input("null");
  f.field("run").click();
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  f.panel.clearTarget();
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "false");
  assert.equal(f.field("run").disabled, true);
  assert.equal(f.field("details").textContent, "");
});

test("replacing the target clears a previous input error before another comparison", () => {
  const f = fixture();
  f.panel.setTarget(later());
  f.input("{");
  f.field("run").click();
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "true");
  f.panel.setTarget(later());
  assert.equal(f.field("baseline").getAttribute("aria-invalid"), "false");
  assert.equal(f.field("details").textContent, "");
});
