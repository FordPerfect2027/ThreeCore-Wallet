import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountOperationBudgetPage } from "../examples/operation-budget-page.js";
import { operationBudgetExample, encodeOperationBudget, decodeOperationBudget } from "../src/operation-budget.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const elements = new Map(), downloads = [], view = new EventTarget();
  const document = { defaultView: view, createElement: tag => new Element(tag), getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element("div")); return elements.get(id);
  } };
  const get = name => document.getElementById("budget-" + name);
  const panel = mountOperationBudgetPage(document, { download: request => {
    if (options.download) return options.download(request, get); downloads.push(request.prepared);
  } });
  const edit = (name, value) => { get(name).value = value; get(name).dispatchEvent(new Event("input")); };
  const choose = (text, extras = {}) => {
    const bytes = new TextEncoder().encode(text);
    get("file").files = [{ name: "budget.json", size: bytes.length, arrayBuffer: async () => bytes.buffer, ...extras }];
    get("file").dispatchEvent(new Event("change"));
  };
  get("example").click();
  return { get, panel, edit, choose, view, downloads, calculate: () => get("calculate").click() };
}
test("page distinguishes an unknown fee from an explicitly entered zero and invalidates old results", () => {
  const f = setup(); f.calculate();
  assert.match(f.get("reasons").textContent, /不明な費用/); assert.equal(f.get("save").disabled, false);
  f.edit("operator", "0"); assert.equal(f.get("result").hidden, true); assert.equal(f.get("save").disabled, true);
  f.calculate(); assert.match(f.get("outcome").textContent, /予算が足ります/);
  f.edit("native-balance", "0"); f.calculate(); assert.match(f.get("reasons").textContent, /ETHが不足/);
  f.panel.dispose();
});
test("page rejects excess precision and blank required fields without retaining an old pass", () => {
  const f = setup(); f.edit("operator", "0"); f.calculate();
  for (const [field, value] of [["fee", "0.0000000001"], ["decimals", "18x"], ["token-balance", ""]]) {
    f.get("example").click(); f.edit(field, value); f.calculate();
    assert.equal(f.get("result").hidden, true); assert.equal(f.get("save").disabled, true);
    assert.match(f.get("status").textContent, /入力を確認/);
  }
  f.panel.dispose();
});
test("saved inputs round-trip and unnoticed programmatic edits cannot export stale results", () => {
  const f = setup(); f.calculate(); f.get("save").click();
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].text, encodeOperationBudget(operationBudgetExample()));
  assert.equal(decodeOperationBudget(f.downloads[0].text).simulationOnly, true);
  f.get("native-balance").value = "0"; f.get("save").click();
  assert.equal(f.downloads.length, 1); assert.equal(f.get("save").disabled, true);
  f.panel.dispose();
});
test("file preview preserves current input until explicit restore and then recalculates", async () => {
  const f = setup(); f.calculate(); const data = structuredClone(operationBudgetExample());
  data.agent = "EMA"; data.fees.operatorFeeBudgetWei = "0";
  f.choose(encodeOperationBudget(data)); await tick();
  assert.equal(f.get("agent").value, "DAT"); assert.equal(f.get("apply").disabled, false);
  assert.equal(f.get("preview-rows").children.length, 16);
  f.get("apply").click(); assert.equal(f.get("agent").value, "EMA");
  assert.match(f.get("outcome").textContent, /予算が足ります/); assert.equal(f.get("apply").disabled, true);
  f.get("save").click(); assert.equal(f.downloads[0].text, encodeOperationBudget(data));
  f.panel.dispose();
});
for (const action of ["edit", "cancel", "pagehide", "dispose", "new-file"]) test(action + " prevents late file completion replacing the current review", async () => {
  const f = setup(); let release;
  const data = structuredClone(operationBudgetExample()); data.agent = "EMA";
  const text = encodeOperationBudget(data);
  f.choose(text, { arrayBuffer: () => new Promise(resolve => { release = resolve; }) }); await tick();
  if (action === "edit") f.edit("token-balance", "7");
  if (action === "cancel") f.get("cancel").click();
  if (action === "pagehide") f.view.dispatchEvent(new Event("pagehide"));
  if (action === "dispose") f.panel.dispose();
  if (action === "new-file") { f.choose(encodeOperationBudget(operationBudgetExample())); await tick(); }
  release(new TextEncoder().encode(text).buffer); await tick();
  assert.equal(f.get("agent").value, "DAT");
  assert.equal(f.get("apply").disabled, action !== "new-file");
  if (action === "new-file") { f.get("apply").click(); assert.equal(f.get("agent").value, "DAT"); }
  f.panel.dispose();
});
test("invalid or overflowing imported data does not replace an existing calculation", async () => {
  const f = setup(); f.calculate();
  for (const text of ["{", encodeOperationBudget({ ...operationBudgetExample(), fees: {
    ...operationBudgetExample().fees, gasLimit: ((1n << 256n) - 1n).toString() } })]) {
    f.choose(text); await tick(); assert.equal(f.get("apply").disabled, true);
    assert.equal(f.get("agent").value, "DAT"); assert.match(f.get("import-status").textContent, /読み込めません/);
    assert.equal(f.get("result").hidden, false);
  }
  f.panel.dispose();
});
test("failed or reentrant download cannot falsely report a saved current input", () => {
  const fail = setup({ download() { throw Error("failed"); } }); fail.calculate(); fail.get("save").click();
  assert.match(fail.get("save-status").textContent, /保存できません/); assert.equal(fail.get("save").disabled, false); fail.panel.dispose();
  const reentrant = setup({ download(request, get) { get("native-balance").value = "0"; get("native-balance").dispatchEvent(new Event("input")); } });
  reentrant.calculate(); reentrant.get("save").click(); assert.equal(reentrant.get("save-status").textContent, "");
  assert.equal(reentrant.get("save").disabled, true); reentrant.panel.dispose();
});
