import test from "node:test";
import assert from "node:assert/strict";
import { mountOperationRehearsal } from "../examples/operation-rehearsal-page.js";
import { rehearsalExample } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsal, decodeRehearsal, evaluateRehearsal, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { Element } from "./helpers/panel-dom.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
class Node extends Element {
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text; }
}
function setup() {
  const elements = new Map(), downloads = [];
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Node("div")); return elements.get(id); },
    createElement: tag => new Node(tag),
  };
  const field = id => document.getElementById(id);
  field("agent").value = "DAT"; field("scenario").value = "profit";
  field("save").disabled = true; field("apply").disabled = true;
  const page = mountOperationRehearsal(document, ({ prepared }) => downloads.push(prepared));
  const change = (id, value) => { field(id).value = value; field(id).dispatchEvent(new Event("input")); };
  const file = (text, extras = {}) => {
    field("file").files = [{ size: text.length, text: async () => text, ...extras }];
    field("file").dispatchEvent(new Event("change"));
  };
  return { field, page, change, downloads, file };
}
test("explicit sample action is required; calculations never request a provider", () => {
  const f = setup();
  assert.equal(f.downloads.length, 0); assert.equal(f.field("save").disabled, true);
  f.field("example").click();
  assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
  assert.equal(f.field("rows").children.length, 2);
  assert.equal(f.field("save").disabled, false);
});
test("editing makes old results and exports unavailable until recalculated", () => {
  const f = setup(); f.field("example").click();
  f.change("principal", "150");
  assert.equal(f.field("metrics").children.length, 0);
  assert.equal(f.field("save").disabled, true);
  f.field("save").click(); assert.equal(f.downloads.length, 0);
  f.field("calculate").click();
  assert.match(f.field("status").textContent, /見送り/);
  assert.match(f.field("allocation-note").textContent, /0/);
});
test("save produces re-importable input, not a trusted result", () => {
  const f = setup(); f.field("example").click(); f.field("save").click();
  const saved = f.downloads[0];
  assert.equal(saved.filename, "ThreeCore-DAT-operation-rehearsal.json");
  const data = decodeRehearsal(saved.text);
  assert.equal(evaluateRehearsal(data).realizedPnl, "28000000");
  assert.equal(Object.hasOwn(data, "rows"), false);
});
test("import needs a distinct apply action and cannot apply twice", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample("EMA", "loss")));
  await tick();
  assert.equal(f.field("save").disabled, true); assert.equal(f.field("apply").disabled, false);
  assert.match(f.field("preview").textContent, /EMA/);
  f.field("apply").click();
  assert.equal(f.field("agent").value, "EMA"); assert.equal(f.field("apply").disabled, true);
  assert.match(f.field("allocation-note").textContent, /利益なし/);
  assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
});
test("cancelled file read cannot restore a candidate or old report", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) });
  f.field("cancel").click();
  resolve(encodeRehearsal(rehearsalExample()));
  await tick();
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("save").disabled, true);
  assert.match(f.field("status").textContent, /クリア/);
});
test("a newer file wins even if an older read finishes later", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) });
  f.file(encodeRehearsal(rehearsalExample("CAWELON")));
  await tick(); resolve(encodeRehearsal(rehearsalExample("DAT"))); await tick();
  assert.match(f.field("preview").textContent, /CAWELON/);
  f.field("apply").click(); assert.equal(f.field("agent").value, "CAWELON");
});
test("changing an agent revokes an imported candidate", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample()));
  await tick(); f.field("agent").value = "EMA"; f.field("agent").dispatchEvent(new Event("change"));
  assert.equal(f.field("apply").disabled, true); assert.equal(f.field("preview").textContent, "");
});
test("large files are refused before reading bytes", async () => {
  const f = setup(); let called = false;
  f.file("x", { size: REHEARSAL_LIMIT + 1, text: async () => { called = true; return ""; } });
  await tick(); assert.equal(called, false); assert.equal(f.field("apply").disabled, true);
});
test("foreign precision or asset cannot silently become editable SIM amounts", async () => {
  const f = setup(); const data = JSON.parse(encodeRehearsal(rehearsalExample()));
  data.asset.decimals = 18; f.file(encodeRehearsal(data)); await tick();
  assert.equal(f.field("apply").disabled, true); assert.match(f.field("status").textContent, /確認できません/);
});
test("unsupported percentages and excess monetary precision are refused", () => {
  const f = setup(); f.field("example").click(); f.change("allocation", "100.01");
  f.field("calculate").click(); assert.equal(f.field("save").disabled, true);
  f.field("example").click(); f.change("principal", "0.0000001");
  f.field("calculate").click(); assert.equal(f.field("save").disabled, true);
});
test("dispose prevents a pending file or stale handler from bringing back results", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) });
  f.page.dispose(); resolve(encodeRehearsal(rehearsalExample())); await tick();
  f.field("example").click();
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("metrics").children.length, 0);
});
