import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { operationBudgetExample, encodeOperationBudget } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, encodeSharedOperationBudget, decodeSharedOperationBudget } from "../src/shared-operation-budget.js";
import { mountSharedBudgetPage } from "../examples/shared-operation-budget-page.js";
const tick = () => new Promise(resolve => setImmediate(resolve));
const plans = () => ["DAT", "EMA", "CAWELON"].map(agent => {
  const b = structuredClone(operationBudgetExample()); b.agent = agent; b.fees.operatorFeeBudgetWei = "0";
  b.native.balanceWei = "3060000000000000"; return b;
});
const bundle = budgets => encodeSharedOperationBudget({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true, budgets });
function setup(options = {}) {
  const elements = new Map(), downloads = [], view = new EventTarget();
  const document = { defaultView: view, createElement: tag => new Element(tag), getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element("div")); return elements.get(id);
  } };
  const get = name => document.getElementById("shared-" + name);
  get("assume").checked = false; get("apply").disabled = true; get("save").disabled = true;
  get("result").hidden = true; get("preview").hidden = true;
  const panel = mountSharedBudgetPage(document, { download: request => {
    if (options.download) return options.download(request, get); downloads.push(request.prepared);
  } });
  const choose = (texts, extras = []) => {
    get("file").files = texts.map((text, i) => { const bytes = new TextEncoder().encode(text);
      return { size: bytes.length, arrayBuffer: async () => bytes.buffer, ...extras[i] }; });
    get("file").dispatchEvent(new Event("change"));
  };
  const assume = value => { get("assume").checked = value; get("assume").dispatchEvent(new Event("change")); };
  return { get, panel, choose, assume, downloads, view };
}
test("three separate files require explicit shared-account assumption and reveal aggregate shortfall", async () => {
  const f = setup(); f.choose(plans().map(encodeOperationBudget)); await tick();
  assert.equal(f.get("preview-rows").children.length, 3); assert.equal(f.get("apply").disabled, true);
  assert.equal(f.get("result").hidden, true); assert.match(f.get("context").textContent, /Base Sepolia/);
  f.assume(true); f.get("apply").click(); assert.equal(f.get("result").hidden, false);
  assert.match(f.get("outcome").textContent, /単独では足りても/);
  f.get("save").click(); assert.equal(f.downloads.length, 1);
  assert.equal(decodeSharedOperationBudget(f.downloads[0].text).budgets.length, 3);
  f.assume(false); assert.equal(f.get("result").hidden, true); assert.equal(f.get("save").disabled, true);
  f.panel.dispose();
});
test("saved shared inputs require renewed assumption and reproduce exact inputs", async () => {
  const f = setup(), text = bundle(plans()); f.choose([text]); await tick();
  assert.equal(f.get("apply").disabled, true); f.assume(true); f.get("apply").click(); f.get("save").click();
  assert.equal(f.downloads[0].text, text);
  f.get("assume").checked = false; f.get("save").click(); assert.equal(f.downloads.length, 1);
  assert.equal(f.get("result").hidden, true); f.panel.dispose();
});
test("unknown fees remain unknown; changing selection clears the old result and assumption", async () => {
  const f = setup(); f.choose([bundle(plans())]); await tick(); f.assume(true); f.get("apply").click();
  const data = plans(); data[1].fees.operatorFeeBudgetWei = null;
  f.choose(data.map(encodeOperationBudget)); assert.equal(f.get("result").hidden, true);
  assert.equal(f.get("assume").checked, false); await tick(); f.assume(true); f.get("apply").click();
  assert.match(f.get("reasons").textContent, /不明な費用/);
  assert.equal(f.get("rows").children[0].children[1].textContent, "未確定"); f.panel.dispose();
});
test("mixed, duplicated, inconsistent and oversized sets cannot be applied", async () => {
  const f = setup();
  for (const [change, pattern] of [
    [d => { d[1].chainId = 8453; }, /ネットワークが異なり/],
    [d => { d[1].agent = "DAT"; }, /重複/],
    [d => { d[1].native.balanceWei = "0"; }, /一致しません/],
    [d => { d.push(d[0]); }, /読み込めません/]]) {
    const data = plans(); change(data); f.choose(data.map(encodeOperationBudget)); await tick();
    assert.equal(f.get("apply").disabled, true); assert.equal(f.get("preview").hidden, true);
    assert.match(f.get("status").textContent, pattern);
  }
  f.choose([" ".repeat(49153)]); await tick(); assert.match(f.get("status").textContent, /読み込めません/);
  f.panel.dispose();
});
for (const action of ["cancel", "new-file", "pagehide", "dispose"]) test(action + " cancels unfinished imports without applying late content", async () => {
  const f = setup(), text = bundle(plans()); let release;
  f.choose([text], [{ arrayBuffer: () => new Promise(resolve => { release = resolve; }) }]); await tick();
  if (action === "cancel") f.get("cancel").click();
  if (action === "pagehide") f.view.dispatchEvent(new Event("pagehide"));
  if (action === "dispose") f.panel.dispose();
  if (action === "new-file") { f.choose([bundle(plans().slice(0, 2))]); await tick(); }
  release(new TextEncoder().encode(text).buffer); await tick();
  assert.equal(f.get("result").hidden, true); assert.equal(f.get("apply").disabled, true);
  assert.equal(f.get("preview").hidden, action !== "new-file");
  if (action === "new-file") assert.equal(f.get("preview-rows").children.length, 2);
  f.panel.dispose();
});
test("failed or reentrant export never falsely reports a completed save", async () => {
  const fail = setup({ download() { throw Error("failed"); } }); fail.choose([bundle(plans())]); await tick();
  fail.assume(true); fail.get("apply").click(); fail.get("save").click();
  assert.match(fail.get("save-status").textContent, /保存できません/); fail.panel.dispose();
  const reentrant = setup({ download(request, get) { get("cancel").click(); } });
  reentrant.choose([bundle(plans())]); await tick(); reentrant.assume(true); reentrant.get("apply").click(); reentrant.get("save").click();
  assert.equal(reentrant.get("save-status").textContent, ""); assert.equal(reentrant.get("save").disabled, true); reentrant.panel.dispose();
});
