import test from "node:test";
import assert from "node:assert/strict";
import { mountOperationRehearsal } from "../examples/operation-rehearsal-page.js";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsalWorkspace, decodeRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA,
  REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
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

function prepareAppend(f, kind, amount = "2.8", reference = "reward-one") {
  f.field("append-kind").value = kind;
  f.field("append-kind").dispatchEvent(new Event("change"));
  f.change("append-reference", reference); f.change("append-amount", amount);
  f.change("append-fee", "1"); f.change("append-exit-reserve", "2");
  f.field("append-preview").click();
}
const workspaceFile = (f, ledgers, activeAgent = "DAT", extras = {}) => {
  const text = encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent, ledgers });
  f.field("workspace-file").files = [{ size: text.length, text: async () => text, ...extras }];
  f.field("workspace-file").dispatchEvent(new Event("change"));
};
const selectAgent = (f, name) => { f.field("agent").value = name; f.field("agent").dispatchEvent(new Event("change")); };
const savedWorkspace = f => { f.field("workspace-save").click(); return decodeRehearsalWorkspace(f.downloads.at(-1).text); };

test("workspace overview labels missing agents and disables an empty export", () => {
  const f = setup(); assert.equal(f.field("workspace-save").disabled, true);
  assert.equal(f.field("workspace-rows").children.length, 3);
  assert.equal(f.field("workspace-rows").children[1].children[1].textContent, "未作成");
  f.field("example").click(); assert.equal(f.field("workspace-save").disabled, false);
});
test("three-agent switching preserves records, allocation and agent-specific undo", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  selectAgent(f, "EMA"); f.field("scenario").value = "loss"; f.field("example").click();
  selectAgent(f, "CAWELON"); f.field("scenario").value = "pending"; f.field("example").click();
  selectAgent(f, "DAT"); assert.equal(f.field("rows").children.length, 3);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "2.8 SIM");
  f.field("undo").click(); assert.equal(f.field("rows").children.length, 2);
  selectAgent(f, "EMA"); assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
  assert.equal(f.field("undo").disabled, true);
  const saved = savedWorkspace(f); assert.equal(saved.ledgers.length, 3); assert.equal(saved.activeAgent, "EMA");
});
test("editing one agent removes only that result; other records remain exportable", () => {
  const f = setup(); f.field("example").click(); selectAgent(f, "EMA"); f.field("example").click();
  f.change("opening", "900"); const data = savedWorkspace(f);
  assert.deepEqual(data.ledgers.map(x => x.agent), ["DAT"]); assert.equal(data.activeAgent, "EMA");
  selectAgent(f, "DAT"); assert.equal(f.field("save").disabled, false);
});
test("single-agent import never discards another agent's applied ledger", async () => {
  const f = setup(); f.field("example").click();
  f.file(encodeRehearsal(rehearsalExampleV2("EMA", "loss"))); await tick(); f.field("apply").click();
  const data = savedWorkspace(f); assert.deepEqual(data.ledgers.map(x => x.agent), ["DAT", "EMA"]);
  assert.equal(data.activeAgent, "EMA");
});
test("workspace review leaves the old export intact; cancel restores its displayed result", async () => {
  const f = setup(); f.field("example").click(); const before = encodeRehearsalWorkspace(savedWorkspace(f));
  workspaceFile(f, [rehearsalExampleV2("EMA", "loss")], "EMA"); await tick();
  assert.equal(f.field("workspace-apply").disabled, false);
  assert.match(f.field("workspace-preview").textContent, /DAT: 未作成に戻す/);
  assert.match(f.field("workspace-preview").textContent, /まだ反映していません/);
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), before);
  f.field("workspace-cancel").click(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "DAT"); assert.equal(f.field("rows").children.length, 2);
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), before);
});
test("confirmed workspace replaces all three histories exactly once, clearing undo", async () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  workspaceFile(f, [rehearsalExample("DAT"), rehearsalExampleV2("EMA", "loss"), rehearsalExampleV2("CAWELON", "pending")], "EMA");
  await tick(); f.field("workspace-apply").click(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "EMA"); assert.equal(f.field("undo").disabled, true);
  assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
  selectAgent(f, "DAT"); assert.equal(f.field("append-preview").disabled, true);
  assert.equal(f.field("undo").disabled, true); assert.equal(savedWorkspace(f).ledgers.length, 3);
});
test("workspace with one unsupported asset is rejected without replacing any current history", async () => {
  const f = setup(); f.field("example").click();
  const wrong = { ...rehearsalExampleV2("EMA"), asset: { ...rehearsalExampleV2().asset, decimals: 18 } };
  workspaceFile(f, [rehearsalExampleV2("CAWELON"), wrong]); await tick();
  assert.equal(f.field("workspace-apply").disabled, true);
  assert.deepEqual(savedWorkspace(f).ledgers.map(x => x.agent), ["DAT"]);
});
for (const action of ["cancel", "switch", "edit", "dispose"]) test(action + " prevents a late workspace read from reviving a review", async () => {
  const f = setup(); f.field("example").click(); let resolve;
  workspaceFile(f, [rehearsalExampleV2("EMA")], "EMA", { text: () => new Promise(done => { resolve = done; }) });
  if (action === "cancel") f.field("workspace-cancel").click();
  else if (action === "switch") selectAgent(f, "CAWELON");
  else if (action === "edit") f.change("append-reference", "changed");
  else f.page.dispose();
  resolve(encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "EMA", ledgers: [rehearsalExampleV2("EMA")] }));
  await tick(); assert.equal(f.field("workspace-apply").disabled, true);
  assert.equal(f.field("workspace-preview").textContent, "");
  if (action === "dispose") assert.equal(f.field("workspace-rows").children.length, 0);
});
test("a newer workspace file wins over a late older read", async () => {
  const f = setup(); f.field("example").click(); let resolve;
  workspaceFile(f, [], "DAT", { text: () => new Promise(done => { resolve = done; }) });
  workspaceFile(f, [rehearsalExampleV2("CAWELON")], "CAWELON"); await tick();
  resolve(encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "DAT", ledgers: [] }));
  await tick(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "CAWELON"); assert.equal(savedWorkspace(f).ledgers[0].agent, "CAWELON");
});
test("oversized workspace is not read and an empty restore requires explicit confirmation", async () => {
  const f = setup(); f.field("example").click(); let called = false;
  workspaceFile(f, [], "DAT", { size: REHEARSAL_WORKSPACE_LIMIT + 1, text: async () => { called = true; return ""; } });
  await tick(); assert.equal(called, false); assert.equal(savedWorkspace(f).ledgers.length, 1);
  workspaceFile(f, [], "CAWELON"); await tick(); assert.equal(savedWorkspace(f).ledgers.length, 1);
  f.field("workspace-apply").click(); assert.equal(f.field("agent").value, "CAWELON");
  assert.equal(f.field("workspace-save").disabled, true); assert.equal(f.field("save").disabled, true);
});

test("append preview is explicit and cancellation never changes saved inputs", () => {
  const f = setup(); f.field("example").click();
  prepareAppend(f, "reserve");
  assert.equal(f.field("rows").children.length, 2); assert.equal(f.field("append-confirm").disabled, false);
  assert.match(f.field("append-summary").textContent, /まだ履歴には反映/);
  f.field("append-cancel").click(); f.field("append-confirm").click();
  f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).events.length, 2);
});
test("append confirm reserves once; undo restores amount and cancels a newer preview", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.field("append-confirm").click(); f.field("append-confirm").click();
  assert.equal(f.field("rows").children.length, 3);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "2.8 SIM");
  assert.equal(f.field("undo").disabled, false);
  prepareAppend(f, "release"); f.field("undo").click();
  assert.equal(f.field("append-confirm").disabled, true);
  assert.equal(f.field("rows").children.length, 2);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "0 SIM");
  assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
});
test("edited append fields revoke confirmation while retaining the applied ledger", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.change("append-amount", "3"); assert.equal(f.field("append-confirm").disabled, true);
  assert.equal(f.field("save").disabled, false); assert.equal(f.field("rows").children.length, 2);
  f.field("append-confirm").click(); assert.equal(f.field("rows").children.length, 2);
});
test("a rejected reservation is explained before adding it; undo removes its blocker", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve", "3");
  assert.match(f.field("append-summary").textContent, /見送り/);
  f.field("append-confirm").click(); assert.match(f.field("allocation-note").textContent, /条件に合わない記録/);
  f.field("undo").click(); assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
});
test("CSV exports the applied ledger, never an unconfirmed preview", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.field("csv-save").click(); assert.match(f.downloads[0].filename, /\.csv$/);
  assert.doesNotMatch(f.downloads[0].text, /"step-3"/);
  f.field("append-confirm").click(); f.field("csv-save").click();
  assert.match(f.downloads[1].text, /"step-3","reserve"/);
});
test("v1 import is preserved with append disabled instead of inventing fee limits", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample())); await tick(); f.field("apply").click();
  assert.equal(f.field("append-preview").disabled, true); assert.match(f.field("ledger-details").textContent, /旧形式/);
  f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).schema, "threecore.operation-rehearsal.v1");
});
test("switching agents and clearing revokes a ledger preview and undo", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  prepareAppend(f, "release"); f.field("agent").value = "EMA"; f.field("agent").dispatchEvent(new Event("change"));
  assert.equal(f.field("append-confirm").disabled, true); assert.equal(f.field("undo").disabled, true);
  f.field("example").click(); f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).agent, "EMA");
  assert.equal(f.field("rows").children.length, 2);
});
test("pending fee reserve and settlement append use the original operation id", () => {
  const f = setup(); f.field("scenario").value = "pending"; f.field("example").click();
  assert.equal(f.field("metrics").children[4].children[1].textContent, "2 SIM");
  prepareAppend(f, "settle", "130", "one"); f.field("append-confirm").click();
  assert.equal(f.field("metrics").children[4].children[1].textContent, "0 SIM");
  assert.equal(f.field("metrics").children[2].children[1].textContent, "28 SIM");
});
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
