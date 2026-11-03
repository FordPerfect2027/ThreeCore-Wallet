import test from "node:test";
import assert from "node:assert/strict";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { mountWalletSetupPanel } from "../examples/wallet-setup-panel.js";
import { mountCheckpointPanel } from "../examples/checkpoint-panel.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { encodeWalletSetup } from "../src/wallet-setup.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, text, fileObject, gate, tick, until } from "./helpers/workspace-fixtures.js";
import { raw, setup } from "./helpers/setup-fixtures.js";
import { memoryStorage } from "./helpers/checkpoint-fixtures.js";

for (const kind of ["workspace", "setup"]) test(kind+" captures a live file selection before clearing the picker",async()=>{
  const f=fixture(kind), file=f.field("file"), choices=[];
  Object.defineProperty(file,"value",{configurable:true,get:()=>"",set(value){if(value==="")choices.length=0;}});
  const source=kind==="workspace"
    ? (await import("../src/workspace-file.js")).prepareWorkspaceFile((await import("../src/workspace-format.js")).workspaceFromDraft(draft({block:"20"})))
    : Promise.resolve({text:encodeWalletSetup(setup())});
  const prepared=await source;choices.push(fileObject(prepared.text));file.files=choices;
  try {
    file.dispatchEvent(new Event("change"));
    await until(()=>f.root.getAttribute("aria-busy")==="false");
    assert.equal(choices.length,0);assert.notEqual(f.field("json").value,"");
    assert.match(f.field("status").textContent,/プレビュー/);assert.equal(f.writes.length,0);
  }finally{f.panel.dispose();}
});

function fixture(kind) {
  const parent = new Element("main"), document = {createElement: tag => new Element(tag)}, writes = [];
  const panel = kind === "workspace"
    ? mountWorkspacePanel({document,parent,readDraft:()=>draft({block:"10"}),writeDraft:value=>writes.push(value)})
    : mountWalletSetupPanel({document,parent,readFields:()=>raw(),applyPlan:value=>writes.push(value)});
  const root=parent.children[0], prefix=kind==="workspace"?"workspace-":"wallet-setup-";
  const field=name=>root.find(prefix+name);
  const choose=files=>{field("file").files=files;field("file").dispatchEvent(new Event("change"));};
  const preview=()=>{
    field("json").value=kind==="workspace"?text({block:"20"}):encodeWalletSetup(setup());
    field("json").dispatchEvent(new Event("input"));
    field("preview").dispatchEvent(new Event("click"));
  };
  return {panel,parent,root,field,choose,preview,writes};
}
function snapshot(root) {
  const all=[];
  const visit=node=>{all.push([node.className,node.textContent,node.value,node.disabled,[...node.attributes]]);node.children.forEach(visit);};
  visit(root);return JSON.stringify(all);
}
for(const kind of ["workspace","setup"])for(const action of ["input","multiple","replacement"])for(const newer of ["preview","dispose"]) {
  test(kind+" "+action+" retains newer "+newer+" during read cancellation",async()=>{
    const f=fixture(kind), pending=gate();let armed=false,entered=false,afterNew,reads=0;
    const baseline=walletFileReadService.state().cancelled;
    const off=walletFileReadService.subscribe(state=>{
      if(!armed||entered||state.cancelled<=baseline)return;
      entered=true;
      if(newer==="dispose")f.panel.dispose();else f.preview();
      afterNew=snapshot(f.root);
    });
    try {
      f.choose([fileObject("{}",{arrayBuffer:()=>pending.promise})]);await tick();armed=true;
      if(action==="input"){f.field("json").value="{}";f.field("json").dispatchEvent(new Event("input"));}
      else f.choose(action==="multiple"?[fileObject("{}"),fileObject("{}")]:[fileObject("{}",{arrayBuffer:async()=>{reads++;return new TextEncoder().encode("{}").buffer;}})]);
      await tick();assert.equal(entered,true);
      assert.equal(reads,0,"A superseded file choice must not start another read");
      if(newer==="dispose")assert.equal(snapshot(f.root),afterNew,"No writes after disposal");
      else {
        const detail=f.field(kind==="workspace"?"detail":"details");
        assert.notEqual(detail.textContent,"","The newer preview must remain visible");
        assert.match(f.field("status").textContent,/まだ/);
        assert.equal(f.field(kind==="workspace"?"confirmed":"confirm").disabled,false);
      }
      assert.equal(f.writes.length,0);
    } finally {armed=false;off();pending.resolve(new TextEncoder().encode("{}").buffer);f.panel.dispose();await tick();}
  });
}

for(const newer of ["cancel","dispose"])test("checkpoint replacement stops after newer "+newer,async()=>{
  const parent=new Element("main"),document={createElement:tag=>new Element(tag)},storage=memoryStorage(),staged=[];
  const panel=mountCheckpointPanel({document,parent,storage,readDraft:()=>draft(),onStage:value=>staged.push(value)});
  const root=parent.children[0],field=name=>root.find("checkpoint-"+name);
  field("refresh").click();await until(()=>root.getAttribute("aria-busy")==="false");
  const pending=gate();let armed=false,entered=false,reads=0,afterNew;
  const baseline=walletFileReadService.state().cancelled;
  const off=walletFileReadService.subscribe(state=>{
    if(!armed||entered||state.cancelled<=baseline)return;entered=true;
    if(newer==="dispose")panel.dispose();else field("import-cancel").click();
    afterNew=snapshot(root);
  });
  const choose=value=>{field("import-file").files=[value];field("import-file").dispatchEvent(new Event("change"));};
  try {
    choose(fileObject("{}",{arrayBuffer:()=>pending.promise}));await tick();armed=true;
    choose(fileObject("{}",{arrayBuffer:async()=>{reads++;return new TextEncoder().encode("{}").buffer;}}));
    await tick();assert.equal(entered,true);assert.equal(reads,0);
    assert.equal(snapshot(root),afterNew);assert.deepEqual(staged,[]);assert.equal(storage.current().entries.length,0);
  }finally{armed=false;off();pending.resolve(new TextEncoder().encode("{}").buffer);panel.dispose();await tick();}
});

