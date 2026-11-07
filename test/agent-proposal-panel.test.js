import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountAgentProposalPanel } from "../examples/agent-proposal-panel.js";
import { createAgentReadPolicyRegistry } from "../src/agent-read-policy-registry.js";
import { inspectAgentReadProposal } from "../src/agent-read-proposal.js";
import { createFileReadService } from "../src/file-read-service.js";

const A = "0x" + "11".repeat(20), TOKEN = "0x" + "22".repeat(20), SPENDER = "0x" + "33".repeat(20);
const HASH = "0x" + "ab".repeat(32), NOW = 1800000000000;
const GRANT = {agent:"DAT",token:"a".repeat(64),expiresAtMs:NOW+120000,endpoint:"https://fixture.example/api/agent/proposal"};
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
async function tick() { await new Promise(r => setImmediate(r)); }
function fixture(agent = "DAT", options = {}) {
  const document = { createElement: name => new Element(name) }, parent = new Element("div");
  const registry = options.registry ?? createAgentReadPolicyRegistry();
  const connection = { agent, account: options.account ?? A, chainId: 84532, siteOrigin: "https://fixture.example",
    connectionEpoch: 1, connected: true, canSign: false, canSendTransactions: false, canBridge: false };
  const context = { connection, tokenAddress: TOKEN, spenderAddress: SPENDER };
  const calls = [], files = []; let cancellations = 0, time = NOW;
  const session = { state: connection,
    async getBlockSnapshot() { calls.push("block"); return { number: "0x2a", hash: HASH }; },
    async getContractCode(address) { calls.push("code"); return { address, deployed: true }; },
    async getTokenBalance() { calls.push("balance"); return 7n; },
    async getTokenAllowance() { calls.push("allowance"); return 0n; },
  };
  const panel = mountAgentProposalPanel({ document, parent, agent, registry, getContext: () => context,
    read: (text, policy, clock) => inspectAgentReadProposal(session, text, policy, clock),
    onCancel: () => { cancellations++; return options.onCancel?.(); }, now: () => time,
    readFile: options.readFile ?? (async source => source.text),
    downloadFile: options.downloadFile ?? (file => files.push(file)),
    proposalTransport: options.proposalTransport ?? null,
    ...(options.newRequestId ? {newRequestId:options.newRequestId} : {}),
  });
  const q = name => parent.find("agent-proposal-" + name);
  return { parent, registry, connection, context, calls, files, session, panel, q,
    cancellations: () => cancellations, setTime: t => { time = t; },
    click(name) { assert.equal(q(name).disabled, false, name); q(name).click(); },
    input(name, value) { q(name).value = value; q(name).dispatchEvent(new Event("input")); },
    prepare() { q("apply").click(); q("build").click(); },
    async settled() { for (let i = 0; i < 100; i++) { if (q("panel").getAttribute("aria-busy") === "false") return; await tick(); } throw Error("Panel did not settle"); },
  };
}
test("mounting creates accessible collapsed UI without reading or registering policy", () => {
  const f = fixture();
  assert.equal(f.q("panel").tagName, "DETAILS");
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("inspect").disabled, true);
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.registry.read("DAT"), null);
  assert.deepEqual(f.calls, []);
  assert.equal(f.q("model-section"),null);assert.equal(f.panel.acceptProposalGrant(GRANT),false);
});

function transportFixture(options={}) {
  const requests=[];let ids=0,f;
  const proposal=()=>new Response(JSON.stringify({status:"unexecuted-model-proposal",executed:false,grantsAuthority:false,
    review:{untrusted:true},proposalText:f.proposal}),{headers:{"content-type":"application/json"}});
  f=fixture("DAT",{newRequestId:options.newRequestId??(()=>"request-"+(++ids)),proposalTransport:{origin:"https://fixture.example",enabled:true,
    fetchImpl:(url,init)=>{requests.push(JSON.parse(init.body));return options.fetchImpl?options.fetchImpl(url,init):proposal();}}});
  f.prepare();f.proposal=f.q("draft").value;
  assert.equal(f.panel.acceptProposalGrant(GRANT),true);f.input("objective","Inspect target");
  return Object.assign(f,{requests,response:proposal,ids:()=>ids});
}
test("optional transport is inert until clicked; repeated objective keeps ID and stages without reading",async()=>{
  const f=transportFixture();assert.equal(f.requests.length,0);assert.equal(f.calls.length,0);
  f.click("model-request");await f.settled();f.click("model-request");await f.settled();
  assert.equal(f.ids(),1);assert.equal(f.requests[0].requestId,f.requests[1].requestId);assert.equal(f.calls.length,0);
  assert.equal(f.q("draft").value,f.proposal);
  f.input("objective","Inspect another question");f.click("model-request");await f.settled();assert.equal(f.ids(),2);
  assert.notEqual(f.requests[1].requestId,f.requests[2].requestId);f.panel.dispose();
});
for(const action of ["cancel","invalidate","dispose","replace"])
test(`optional transport ${action} ignores late reply and retains historical result`,async()=>{
  const gate=deferred();const f=transportFixture({fetchImpl:()=>gate.promise});
  f.click("inspect");await f.settled();const result=f.q("result"),draft=f.q("draft"),saved=result.textContent,prior=draft.value;
  f.click("model-request");await tick();
  if(action==="cancel")f.click("cancel");else if(action==="replace")f.panel.acceptProposalGrant({...GRANT,token:"b".repeat(64)});else f.panel[action]();
  gate.resolve(f.response());await tick();await tick();
  assert.equal(result.textContent,saved);assert.equal(draft.value,prior);
  if(action!=="dispose"){await f.settled();f.click("save");await f.settled();assert.equal(f.files.length,1);f.panel.dispose();}
});
test("old cancelled request cannot unlock a newer pending request",async()=>{
  const first=deferred(),second=deferred();let count=0;
  const f=transportFixture({fetchImpl:()=>++count===1?first.promise:second.promise});
  f.click("model-request");await tick();f.click("cancel");f.click("model-request");await tick();
  first.resolve(f.response());await tick();assert.equal(f.q("panel").getAttribute("aria-busy"),"true");
  assert.equal(f.q("model-request").disabled,true);second.resolve(f.response());await f.settled();
  assert.equal(f.requests[0].requestId,f.requests[1].requestId);f.panel.dispose();
});
test("target mutation while requesting cannot overwrite draft",async()=>{
  const gate=deferred(),f=transportFixture({fetchImpl:()=>gate.promise}),prior=f.q("draft").value;
  f.click("model-request");await tick();f.context.spenderAddress=A;gate.resolve(f.response());await f.settled();
  assert.equal(f.q("draft").value,prior);assert.equal(f.calls.length,0);assert.equal(f.q("model-request").disabled,true);f.panel.dispose();
});
test("asynchronous request-ID callback is observed but never sends",async()=>{
  const f=transportFixture({newRequestId:()=>Promise.reject(Error("synthetic failure"))});
  f.click("model-request");await f.settled();await tick();assert.equal(f.requests.length,0);f.panel.dispose();
});
test("request-ID callback cancellation cannot send or relock UI",async()=>{
  let f;f=transportFixture({newRequestId:()=>{f.q("cancel").click();return "cancelled-id";}});
  f.click("model-request");await f.settled();assert.equal(f.requests.length,0);assert.equal(f.q("panel").getAttribute("aria-busy"),"false");f.panel.dispose();
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(`${agent}: save and restore historical record in a fresh disconnected panel without RPC`, async () => {
    const original = fixture(agent); original.prepare(); original.click("inspect"); await original.settled();
    original.click("save"); await original.settled();
    const fresh = fixture(agent); fresh.connection.connected = false; fresh.setTime(NOW + 1000000);
    fresh.q("file").files = [{ text: original.files[0].text }];
    fresh.q("file").dispatchEvent(new Event("change")); await fresh.settled();
    assert.equal(fresh.q("result").textContent, "");
    assert.equal(fresh.q("save").disabled, true);
    assert.match(fresh.q("import-preview").textContent, /過去の記録/);
    fresh.click("restore");
    assert.equal(JSON.parse(fresh.q("result").textContent).result.observation.agent, agent);
    assert.match(fresh.q("status").textContent, /権限は復元していません/);
    assert.equal(fresh.registry.read(agent), null); assert.equal(fresh.connection.connected, false);
    assert.equal(fresh.q("draft").value, ""); assert.deepEqual(fresh.calls, []);
    fresh.click("save"); await fresh.settled();
    assert.equal(fresh.files[0].text, original.files[0].text);
  });
}
test("invalid historical import preserves previous result and policy", async () => {
  const f = fixture(); f.prepare(); f.click("inspect"); await f.settled();
  const previous = f.q("result").textContent, policy = f.registry.readPolicyText("DAT");
  f.q("file").files = [{ text: previous.replace('"authenticated": false', '"authenticated": true') }];
  f.q("file").dispatchEvent(new Event("change")); await f.settled();
  assert.equal(f.q("result").textContent, previous); assert.equal(f.registry.readPolicyText("DAT"), policy);
  assert.equal(f.q("restore").disabled, true); assert.match(f.q("status").textContent, /INVALID_RECORD/);
});
for (const action of ["cancel", "invalidate", "dispose"]) {
  test(`late file result after ${action} cannot revive import`, async () => {
    const gate = deferred(); let signal;
    const f = fixture("DAT", { readFile: (_, options) => { signal = options.signal; return gate.promise; } });
    f.prepare(); f.click("inspect"); await f.settled(); const previous = f.q("result").textContent;
    f.q("file").files = [{}]; f.q("file").dispatchEvent(new Event("change"));
    const resultNode = f.q("result"), previewNode = f.q("import-preview");
    if (action === "cancel") f.click("cancel"); else f.panel[action]();
    assert.equal(signal.aborted, true); gate.resolve(previous); await tick(); await tick();
    assert.equal(resultNode.textContent, previous); assert.equal(previewNode.textContent, "");
    if (action !== "dispose") assert.equal(f.q("restore").disabled, true);
  });
}
test("model delivery hook stages a valid proposal but performs no read", () => {
  const f = fixture(); f.prepare(); const text = f.q("draft").value; f.input("draft", "");
  assert.equal(f.panel.stageProposal(text), true); assert.equal(f.q("draft").value, text);
  assert.match(f.q("status").textContent, /まだ読み取りは実行していません/); assert.deepEqual(f.calls, []);
  f.setTime(NOW + 60000);
  assert.equal(f.panel.stageProposal(text), false); assert.equal(f.q("draft").value, text);
});
test("model delivery cannot overwrite an in-flight draft or restore its own policy", async () => {
  const f = fixture(); f.prepare(); const text = f.q("draft").value;
  const gate = deferred(); f.session.getBlockSnapshot = () => gate.promise;
  f.click("inspect"); assert.equal(f.panel.stageProposal(text), false); f.click("cancel");
  f.click("revoke"); assert.equal(f.panel.stageProposal(text), false);
  assert.equal(f.registry.read("DAT"), null); gate.resolve({ number: "0x2a", hash: HASH }); await tick();
});

test("native File imports through the production budgeted reader", async () => {
  const service = createFileReadService();
  const f = fixture("DAT", { readFile: (file, options) => service.readText(file, options) });
  try {
    f.prepare(); f.click("inspect"); await f.settled();
    const previous = f.q("result").textContent;
    f.q("file").files = [new File([previous], "proposal.json", { type: "application/json" })];
    f.q("file").dispatchEvent(new Event("change")); await f.settled();
    assert.equal(f.q("restore").disabled, false); assert.equal(service.state().completed, 1);
    f.click("restore"); assert.equal(f.q("result").textContent, previous);
    f.q("file").files = [new File(["x".repeat(131073)], "oversize.json")];
    f.q("file").dispatchEvent(new Event("change")); await f.settled();
    assert.match(f.q("status").textContent, /FILE_SIZE/);
    assert.equal(f.q("result").textContent, previous);
  } finally { f.panel.dispose(); service.dispose(); }
});

test("shared file-read protection cancels import and preserves earlier evidence", async () => {
  const service = createFileReadService(), gate = deferred();
  const f = fixture("DAT", { readFile: (file, options) => service.readText(file, options) });
  try {
    f.prepare(); f.click("inspect"); await f.settled(); const previous = f.q("result").textContent;
    f.q("file").files = [{ size: 1, arrayBuffer: () => gate.promise }];
    f.q("file").dispatchEvent(new Event("change")); service.cancelAll(); await f.settled();
    assert.equal(f.q("restore").disabled, true); assert.equal(f.q("result").textContent, previous);
    gate.resolve(new Uint8Array([0]).buffer); await tick();
  } finally { f.panel.dispose(); service.dispose(); }
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(`${agent}: configure, prepare, inspect, save explicit evidence without privileged actions`, async () => {
    const f = fixture(agent); f.prepare();
    assert.deepEqual(f.calls, []);
    const proposal = JSON.parse(f.q("draft").value);
    assert.equal(proposal.agent, agent);
    assert.match(proposal.rationale, /not an AI decision/);
    f.click("inspect"); await f.settled();
    assert.match(f.q("status").textContent, /読み取りを確認/);
    assert.equal(f.q("save").disabled, false);
    f.click("save"); await f.settled();
    const record = JSON.parse(f.files[0].text);
    assert.equal(record.authenticated, false);
    assert.equal(record.historicalObservation, true);
    assert.equal(record.result.observation.agent, agent);
    assert.equal(record.result.observation.blockHash, HASH);
    assert.equal(record.result.transactionExecuted, false);
    assert.equal(f.files[0].byteLength, new TextEncoder().encode(f.files[0].text).length);
    assert.match(f.q("status").textContent, /ダウンロード完了を確認/);
  });
}
test("a transaction proposal is rejected before the first read", async () => {
  const f = fixture(); f.prepare(); const p = JSON.parse(f.q("draft").value);
  p.action.kind = "transfer"; f.input("draft", JSON.stringify(p));
  f.click("inspect"); await f.settled();
  assert.match(f.q("status").textContent, /ACTION_NOT_ALLOWED/);
  assert.deepEqual(f.calls, []);
});
test("expired and reconnected proposals need regeneration, not automatic renewal", async () => {
  const f = fixture(); f.prepare(); f.setTime(NOW + 60000);
  f.click("inspect"); await f.settled();
  assert.match(f.q("status").textContent, /EXPIRED_PROPOSAL/);
  f.setTime(NOW); f.connection.connectionEpoch++;
  f.click("inspect"); await f.settled();
  assert.match(f.q("status").textContent, /SESSION_GENERATION_MISMATCH/);
  assert.deepEqual(f.calls, []);
});
test("duplicate clicks during a read cannot start another request", async () => {
  const f = fixture(); f.prepare(); const gate = deferred(); let reads = 0;
  f.session.getBlockSnapshot = () => { reads++; return gate.promise; };
  f.click("inspect"); f.q("inspect").click();
  assert.equal(reads, 1);
  gate.resolve({ number: "0x2a", hash: HASH }); await f.settled();
  assert.equal(reads, 2); // Initial snapshot and final canonicality check only.
});
for (const stop of ["cancel", "revoke", "invalidate", "dispose"]) {
  test(`${stop} keeps an earlier record and ignores a delayed new read`, async () => {
    const f = fixture(); f.prepare(); f.click("inspect"); await f.settled();
    const earlier = f.q("result").textContent; const resultNode = f.q("result");
    const gate = deferred(); f.session.getBlockSnapshot = () => gate.promise;
    f.click("inspect");
    if (["invalidate", "dispose"].includes(stop)) f.panel[stop](); else f.click(stop);
    gate.resolve({ number: "0x2a", hash: HASH }); await tick(); await tick();
    assert.equal(resultNode.textContent, earlier);
    assert.equal(f.cancellations(), 1);
    if (stop !== "dispose") { assert.equal(f.q("save").disabled, false); assert.equal(f.q("panel").getAttribute("aria-busy"), "false"); }
  });
}
for (const agent of ["DAT", "EMA", "CAWELON"]) for (const stop of ["cancel", "revoke", "invalidate", "dispose"])
for (const kind of ["promise", "async-then"])
test(`${agent}: ${stop} consumes rejected ${kind} cancellation and preserves evidence`, async () => {
  const f = fixture(agent, { onCancel: () => kind === "promise" ? Promise.reject(Error("private cancellation detail")) :
    { async then() { throw Error("private cancellation detail"); } } });
  f.prepare(); f.click("inspect"); await f.settled();
  const node = f.q("result"), previous = node.textContent;
  const original = f.session.getBlockSnapshot;
  const gate = deferred(); f.session.getBlockSnapshot = () => gate.promise;
  f.click("inspect");
  if (stop === "dispose" || stop === "invalidate") f.panel[stop](); else f.click(stop);
  gate.resolve({ number: "0x2a", hash: HASH }); await tick(); await tick();
  assert.equal(node.textContent, previous); assert.equal(f.cancellations(), 1);
  if (stop !== "dispose") {
    assert.equal(f.q("panel").getAttribute("aria-busy"), "false");
    f.click("save"); await f.settled(); assert.equal(f.files.length, 1);
    f.session.getBlockSnapshot = original;
    f.prepare(); f.click("inspect"); await f.settled();
    assert.match(f.q("status").textContent, /読み取りを確認/);
    f.panel.dispose();
  }
});
test("duplicate active account across two agents is refused by shared UI policy registry", () => {
  const registry = createAgentReadPolicyRegistry();
  const a = fixture("DAT", { registry }), b = fixture("EMA", { registry });
  a.click("apply"); b.click("apply");
  assert.match(b.q("status").textContent, /DEDICATED_ACCOUNT_REQUIRED/);
  assert.equal(registry.read("EMA"), null);
  assert.notEqual(registry.read("DAT"), null);
});
test("invalid configuration does not request wallet access", () => {
  const f = fixture(); f.connection.connected = false; f.click("apply");
  assert.equal(f.registry.read("DAT"), null);
  f.connection.connected = true; f.q("age").value = "601"; f.click("apply");
  assert.equal(f.registry.read("DAT"), null);
  assert.deepEqual(f.calls, []);
});
test("download failure retains evidence and does not claim persistence", async () => {
  const f = fixture("DAT", { downloadFile: async () => { throw Error("private failure"); } });
  f.prepare(); f.click("inspect"); await f.settled(); const previous = f.q("result").textContent;
  f.click("save"); await f.settled();
  assert.match(f.q("status").textContent, /ダウンロードできません/);
  assert.equal(f.q("result").textContent, previous);
  assert.equal(f.q("status").textContent.includes("private failure"), false);
});
test("late download completion cannot overwrite a later revoke message", async () => {
  const gate = deferred(); const f = fixture("DAT", { downloadFile: () => gate.promise });
  f.prepare(); f.click("inspect"); await f.settled(); f.click("save"); f.click("revoke");
  const status = f.q("status").textContent; gate.resolve(); await f.settled();
  assert.equal(f.q("status").textContent, status);
});
test("programmatic target changes without input events cannot use the old registered target", async () => {
  const f = fixture(); f.prepare(); f.context.spenderAddress = TOKEN;
  f.click("inspect"); await f.settled();
  assert.match(f.q("status").textContent, /TARGET_FIELDS_CHANGED/);
  assert.deepEqual(f.calls, []);
});
