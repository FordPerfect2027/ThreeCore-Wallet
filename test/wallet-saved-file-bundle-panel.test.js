import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountSavedFileInspectionPanel, mountSavedComparisonBundlePanel } from "../examples/file-read-panel.js";
import { prepareWalletSavedBundle, reviewWalletSavedBundle, inspectWalletSavedText, compareWalletSavedInspections } from "../src/file-read-status.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { sampleHistory, fileFrom, waitUntil, deferred } from "./helpers/report-history-fixtures.js";
const document = { createElement: tag => new Element(tag) };
const choose = (field,text) => { field.files=[fileFrom(text)];field.dispatchEvent(new Event("change")); };
const check = field => { field.checked=true;field.dispatchEvent(new Event("change")); };
function fixture(options={}) {
  const parent=new Element("div"),files=[];
  const panel=mountSavedComparisonBundlePanel({document,parent,download:file=>files.push(file),...options});
  return {panel,files,q:name=>parent.find("saved-bundle-"+name),async load(text){choose(this.q("file"),text);await waitUntil(()=>!panel.getState().busy);},dispose:()=>panel.dispose()};
}
async function sourcePair() {
  const before=(await prepareReportHistoryFile(sampleHistory())).text,after=JSON.stringify(JSON.parse(before),null,2)+"\r\n";
  const comparison=compareWalletSavedInspections(await inspectWalletSavedText(before),await inspectWalletSavedText(after));
  return {before,after,pair:{comparison,beforeFile:fileFrom(before),afterFile:fileFrom(after)}};
}
test("bundle export requires its own acknowledgement, reopens both originals and resets acknowledgement",async()=>{
  const {pair,before,after}=await sourcePair(),f=fixture({getPair:()=>pair});
  try{
    assert.equal(f.q("export").disabled,true);check(f.q("export-ack"));f.q("export").click();await waitUntil(()=>!f.panel.getState().busy);
    assert.equal(f.files.length,1);assert.equal(f.q("export-ack").checked,false);
    const bundle=JSON.parse(f.files[0].text);assert.equal(bundle.beforeFileText,before);assert.equal(bundle.afterFileText,after);
    assert.equal((await reviewWalletSavedBundle(f.files[0].text)).originalsAvailable,true);
  }finally{f.dispose();}
});
test("bundle viewer is independent of the current comparison and each extraction needs fresh acknowledgement",async()=>{
  const {before,after}=await sourcePair(),f=fixture();
  try{
    await f.load((await prepareWalletSavedBundle(before,after)).text);assert.equal(f.panel.getState().receipt.originalsAvailable,true);
    assert.equal(f.q("before").disabled,true);check(f.q("source-ack"));f.q("before").click();assert.equal(f.files[0].text,before);
    assert.equal(f.q("after").disabled,true);check(f.q("source-ack"));f.q("after").click();assert.equal(f.files[1].text,after);
    f.q("file").dispatchEvent(new Event("cancel"));assert.equal(f.panel.getState().receipt.originalsAvailable,true);
    await f.load("{}");assert.equal(f.panel.getState().receipt,null);assert.equal(f.q("before").disabled,true);
  }finally{f.dispose();}
});
test("changed file bytes and changed comparison selection prevent stale exports",async()=>{
  const {pair,before,after}=await sourcePair();let current=pair;
  const f=fixture({getPair:()=>current,readText:async()=>after});
  try{check(f.q("export-ack"));f.q("export").click();await waitUntil(()=>!f.panel.getState().busy);
    assert.equal(f.files.length,0);assert.match(f.q("status").textContent,/比較した後に元資料が変わった/);
  }finally{f.dispose();}
  const gate=deferred(),g=fixture({getPair:()=>current,readText:()=>gate.promise});
  try{check(g.q("export-ack"));g.q("export").click();assert.equal(g.panel.getState().busy,true);
    current=null;g.panel.updatePair();gate.resolve(before);await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(g.files.length,0);assert.equal(g.panel.getState().busy,false);assert.match(g.q("status").textContent,/中止/);
  }finally{g.dispose();}
});
test("mismatching comparison, refused delivery and late cancelled reviews cannot release source files",async()=>{
  const {before,after}=await sourcePair(),bundle=JSON.parse((await prepareWalletSavedBundle(before,after)).text);
  const comparison=JSON.parse(bundle.comparisonText);comparison.sameOriginal=false;bundle.comparisonText=JSON.stringify(comparison);
  const f=fixture();try{await f.load(JSON.stringify(bundle));assert.equal(f.panel.getState().receipt.originalsAvailable,false);
    check(f.q("source-ack"));f.q("before").click();assert.equal(f.files.length,0);
  }finally{f.dispose();}
  const g=fixture({download:()=>Promise.reject(Error("PRIVATE"))});try{await g.load((await prepareWalletSavedBundle(before,after)).text);
    check(g.q("source-ack"));g.q("after").click();assert.match(g.q("status").textContent,/取り出しを確認できません/);assert.doesNotMatch(g.q("status").textContent,/PRIVATE/);
  }finally{g.dispose();}
  const gate=deferred(),h=fixture({readText:()=>gate.promise});const pending=h.load("{}");h.q("stop").click();gate.resolve((await prepareWalletSavedBundle(before,after)).text);await pending;
  assert.equal(h.panel.getState().receipt,null);assert.equal(h.files.length,0);h.dispose();
});
test("the combined guide binds bundle export to the selected files and clears it on replacement",async()=>{
  const parent=new Element("div"),files=[],panel=mountSavedFileInspectionPanel({document,parent,download:file=>files.push(file)});
  const q=name=>parent.find("saved-file-guide-"+name),b=name=>parent.find("saved-bundle-"+name);
  async function load(name,text){choose(q(name),text);await waitUntil(()=>!panel.getState().busy);}
  try{
    const {before,after}=await sourcePair();await load("file",before);await load("compare-file",after);
    check(b("export-ack"));b("export").click();await waitUntil(()=>b("stop").disabled);assert.equal(files.length,1);
    check(b("export-ack"));await load("file",before);assert.equal(b("export-ack").checked,false);assert.equal(b("export").disabled,true);
    choose(b("file"),files[0].text);await waitUntil(()=>b("stop").disabled);check(b("source-ack"));b("after").click();assert.equal(files[1].text,after);
  }finally{panel.dispose();}
});
