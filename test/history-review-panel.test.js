import test from "node:test";
import assert from "node:assert/strict";
import { mountHistoryReview } from "../examples/history-review-panel.js";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { Element } from "./helpers/panel-dom.js";
import { observation, archive, OTHER } from "./helpers/history-fixtures.js";

function fixture(options = {}) {
  const parent = new Element("section");
  let current = archive();
  let incoming = archive([observation("43")]);
  let revision = 1;
  let replace = false;
  const downloads = [];
  const panel = mountHistoryReview({
    document: { createElement: tag => new Element(tag) }, parent, agent: "DAT",
    getArchive: () => current, getRevision: () => revision,
    getIncoming: () => incoming, getReplace: () => replace,
    download: ({ prepared }) => downloads.push(prepared),
    ...options,
  });
  const field = suffix => parent.find("history-review-" + suffix);
  return { parent, panel, field, downloads, click: suffix => field(suffix).click(),
    current: value => { current = value; }, incoming: value => { incoming = value; },
    revision: value => { revision = value; }, replace: value => { replace = value; } };
}

test("review panel does nothing automatically", () => {
  let reads = 0;
  const f = fixture({ getArchive: () => { reads++; return archive(); } });
  assert.equal(reads, 0);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("details").textContent, "");
  f.panel.dispose();
});

test("current review displays coverage without changing source", () => {
  const original = archive();
  const f = fixture({ getArchive: () => original });
  f.click("current");
  assert.match(f.field("details").textContent, /記録: 1件/);
  assert.match(f.field("status").textContent, /履歴は変更していません/);
  assert.equal(f.field("save").disabled, false);
  assert.equal(JSON.parse(original).reports.length, 1);
  f.panel.dispose();
});

test("impact review explains additions before application", () => {
  const f = fixture();
  f.click("impact");
  assert.match(f.field("details").textContent, /追加予定: DAT/);
  assert.match(f.field("details").textContent, /現在 1件 → 適用後 2件/);
  assert.match(f.field("status").textContent, /まだ適用していません/);
  f.panel.dispose();
});

test("replacement review lists excluded records", () => {
  const f = fixture();
  f.replace(true);
  f.click("impact");
  assert.match(f.field("details").textContent, /除外予定: DAT/);
  assert.match(f.field("details").textContent, /既存履歴を置き換え/);
  f.panel.dispose();
});

test("explicit report download has a distinct schema and safe filename", () => {
  const f = fixture();
  f.click("current");
  f.click("save");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].filename, "ThreeCore-DAT-coverage-r1.json");
  assert.equal(JSON.parse(f.downloads[0].text).schema, "threecore-history-review-v1");
  assert.match(f.field("status").textContent, /復元用の履歴ファイルではありません/);
  f.panel.dispose();
});

test("impact report filename distinguishes import impact", () => {
  const f = fixture();
  f.click("impact");
  f.click("save");
  assert.match(f.downloads[0].filename, /-import-impact-r1\.json$/);
  assert.equal(JSON.parse(f.downloads[0].text).mode, "merge");
  f.panel.dispose();
});

test("report download cannot masquerade as a restorable archive", () => {
  const f = fixture();
  f.click("current");
  f.click("save");
  const destination = createPortfolioHistory();
  assert.throws(() => destination.importText(f.downloads[0].text));
  assert.equal(destination.state().size, 0);
  f.panel.dispose();
});

for (const mutate of [
  f => f.revision(2),
  f => f.current(archive([observation("99")])),
]) {
  test("changed source prevents stale coverage download " + mutate.toString(), () => {
    const f = fixture();
    f.click("current");
    mutate(f);
    f.click("save");
    assert.equal(f.downloads.length, 0);
    assert.equal(f.field("save").disabled, true);
    assert.equal(f.field("details").textContent, "");
    f.panel.dispose();
  });
}

for (const mutate of [
  f => f.incoming(archive([observation("99")])),
  f => f.replace(true),
  f => f.revision(2),
  f => f.current(archive([observation("99")])),
]) {
  test("changed import inputs prevent stale impact download " + mutate.toString(), () => {
    const f = fixture();
    f.click("impact");
    mutate(f);
    f.click("save");
    assert.equal(f.downloads.length, 0);
    assert.equal(f.field("save").disabled, true);
    f.panel.dispose();
  });
}

test("current coverage download does not depend on unused incoming JSON", () => {
  const f = fixture();
  f.click("current");
  f.incoming("broken");
  f.click("save");
  assert.equal(f.downloads.length, 1);
  f.panel.dispose();
});

for (const incoming of ["", "broken", "{}", "[]", "null", "<img src=x>"]) {
  test("bad incoming data removes an older valid review " + incoming, () => {
    const f = fixture();
    f.click("current");
    f.incoming(incoming);
    f.click("impact");
    assert.equal(f.field("save").disabled, true);
    assert.equal(f.field("details").textContent, "");
    assert.match(f.field("status").textContent, /元の履歴は変更していません/);
    assert.ok(!f.field("status").textContent.includes("<img"));
    f.panel.dispose();
  });
}

test("merge conflict is explained without generating a downloadable report", () => {
  const f = fixture();
  f.incoming(archive([observation("42", { nativeBalanceBaseUnits: "99" })]));
  f.click("impact");
  assert.equal(f.field("save").disabled, true);
  assert.match(f.field("status").textContent, /確認できませんでした/);
  f.panel.dispose();
});

test("replace mode can explicitly review a changed same-position record", () => {
  const f = fixture();
  f.incoming(archive([observation("42", { nativeBalanceBaseUnits: "99" })]));
  f.replace(true);
  f.click("impact");
  assert.match(f.field("details").textContent, /同じ位置の変更 1件/);
  assert.equal(f.field("save").disabled, false);
  f.panel.dispose();
});

for (const revision of [-1, "1", Infinity, 0.5, NaN]) {
  test("invalid revision cannot become a downloaded name " + String(revision), () => {
    const f = fixture();
    f.revision(revision);
    f.click("current");
    f.click("save");
    assert.equal(f.downloads.length, 0);
    f.panel.dispose();
  });
}

for (const agent of ["", "../../DAT", "BTC", undefined]) {
  test("invalid card agent is refused at mount " + String(agent), () => {
    assert.throws(() => fixture({ agent }), TypeError);
  });
}

test("other-agent current archive is not described under the wrong card", () => {
  const f = fixture();
  f.current(archive([observation("42", { agent: "EMA" })]));
  f.click("current");
  assert.equal(f.field("save").disabled, true);
  f.panel.dispose();
});

test("other-agent incoming archive is refused before a report download", () => {
  const f = fixture();
  f.incoming(archive([observation("43", { agent: "EMA" })]));
  f.click("impact");
  assert.equal(f.field("save").disabled, true);
  f.panel.dispose();
});

test("reset discards only the report and leaves collection data alone", () => {
  const original = archive();
  const f = fixture({ getArchive: () => original });
  f.click("current");
  f.click("clear");
  assert.equal(f.field("details").textContent, "");
  assert.equal(f.field("save").disabled, true);
  assert.equal(JSON.parse(original).reports.length, 1);
  f.panel.dispose();
});

test("external invalidation disables a report before source controls change", () => {
  const f = fixture();
  f.click("impact");
  f.panel.invalidate();
  f.click("save");
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("details").textContent, "");
  f.panel.dispose();
});

test("download exception clears stale report state", () => {
  const f = fixture({ download() { throw Error("PRIVATE ERROR"); } });
  f.click("current");
  f.click("save");
  assert.equal(f.field("save").disabled, true);
  assert.ok(!f.field("status").textContent.includes("PRIVATE"));
  f.panel.dispose();
});

test("disposed controls have no effects and disposal is idempotent", () => {
  const f = fixture();
  f.click("current");
  const save = f.field("save"), inspect = f.field("current");
  f.panel.dispose();
  f.panel.dispose();
  f.panel.invalidate();
  save.click();
  inspect.click();
  assert.equal(f.downloads.length, 0);
  assert.equal(f.parent.children.length, 0);
});

test("coverage description does not add unrelated account data", () => {
  const f = fixture();
  f.click("current");
  assert.ok(!f.field("details").textContent.includes(OTHER));
  f.panel.dispose();
});

test("human-readable report download contains the displayed text", () => {
  const f = fixture();
  f.click("current");
  const text = f.field("details").textContent;
  f.click("save-text");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].filename, "ThreeCore-DAT-coverage-r1.txt");
  assert.equal(f.downloads[0].mimeType, "text/plain;charset=utf-8");
  assert.equal(f.downloads[0].text, text);
  assert.match(f.field("status").textContent, /別の説明ファイル/);
  f.panel.dispose();
});

test("stale import description cannot be downloaded as plain text", () => {
  const f = fixture();
  f.click("impact");
  f.incoming(archive([observation("100")]));
  f.click("save-text");
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("save-text").disabled, true);
  f.panel.dispose();
});

test("invalidating or clearing review disables both report formats", () => {
  const f = fixture();
  f.click("current");
  assert.equal(f.field("save-text").disabled, false);
  f.click("clear");
  assert.equal(f.field("save-text").disabled, true);
  assert.equal(f.field("save").disabled, true);
  f.panel.dispose();
});
