import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { newReportFixtures } from "./helpers/rehearsal-report-fixtures.js";
import { reviewRehearsalReport, reviewRehearsalEvidence, encodeRehearsalReviewEvidence, encodeRehearsalReviewReceipt,
  inspectReviewedRehearsalDifference, inspectRehearsalEvidenceReceiptDifference } from "../src/operation-rehearsal-report-review.js";
const options={subtle:webcrypto.subtle}, original=newReportFixtures().filtered;
import { describeRehearsalFileTarget } from "../src/file-read-status.js";
for(const schema of ["threecore.operation-rehearsal-difference-page.v1","threecore.operation-rehearsal-difference-detail.v1","threecore.operation-rehearsal-difference-values.v1"])
  test(schema+" is labelled as inspection output rather than a restore input",()=>{
    for(const target of ["record","workspace","session","cases","expectations","report","evidence"])
      assert.match(describeRehearsalFileTarget(JSON.stringify({schema,simulationOnly:true}),target),/確認用.*元の資料.*復元できません/);
  });
async function changed(change){const value=structuredClone(original);change(value);return reviewRehearsalReport(JSON.stringify(value),options);}

test("difference detail preserves exact atomic strings and distinguishes recomputed from recorded",async()=>{
  const receipt=await changed(v=>v.rows[0].changes[0].delta="-900719925474099399999");
  const detail=inspectReviewedRehearsalDifference(receipt,0);
  assert.equal(detail.path,"/rows/0/changes/0/delta");assert.equal(detail.kind,"value");
  assert.equal(detail.expected.json,JSON.stringify(original.rows[0].changes[0].delta));
  assert.equal(detail.actual.json,'"-900719925474099399999"');
  assert.equal(detail.actual.type,"string");assert.ok(Object.isFrozen(detail)&&Object.isFrozen(detail.actual));
});
for(const [name,change,kind,path]of [
  ["missing",v=>delete v.totalRecords,"missing","/totalRecords"],
  ["unexpected",v=>v["a~/b"]=null,"unexpected","/a~0~1b"],
  ["type",v=>v.totalRecords="5","type","/totalRecords"],
  ["array",v=>v.rows.push(structuredClone(v.rows[0])),"array-length","/rows"]
])test("difference detail describes "+name+" without changing its receipt",async()=>{
  const receipt=await changed(change),before=encodeRehearsalReviewReceipt(receipt),detail=inspectReviewedRehearsalDifference(receipt,0);
  assert.equal(detail.path,path);assert.equal(detail.kind,kind);
  if(name==="missing"){assert.equal(detail.actual.present,false);assert.equal(detail.actual.json,null);}
  if(name==="unexpected"){assert.equal(detail.expected.present,false);assert.equal(detail.actual.present,true);assert.equal(detail.actual.type,"null");assert.equal(detail.actual.json,"null");}
  if(name==="array"){assert.equal(detail.actual.arrayLength,original.rows.length+1);assert.equal(detail.expected.arrayLength,original.rows.length);}
  assert.equal(encodeRehearsalReviewReceipt(receipt),before);
});

test("bounded detail previews neither split surrogate pairs nor conceal truncation",async()=>{
  const receipt=await changed(v=>v.extra="x".repeat(2046)+"🚀"+"y".repeat(100)),detail=inspectReviewedRehearsalDifference(receipt,0);
  assert.equal(detail.previewLimit,2048);assert.equal(detail.actual.truncated,true);
  assert.equal(detail.actual.json.length,2047);assert.ok(detail.actual.characters>detail.actual.json.length);
  assert.doesNotMatch(detail.actual.json,/[\uD800-\uDBFF]$/);
});
test("detail JSON makes directional controls visible without interpreting markup",async()=>{
  const text="<img src=x>\u202evalue\u2066";
  const receipt=await changed(v=>v.extra=text),detail=inspectReviewedRehearsalDifference(receipt,0);
  assert.equal(JSON.parse(detail.actual.json),text);assert.match(detail.actual.json,/\\u202e/);
  assert.doesNotMatch(detail.actual.json,/[\u202e\u2066]/);
});
test("every difference including those after the first forty has a stable detail index",async()=>{
  const receipt=await changed(v=>{for(let i=0;i<103;i++)v["extra"+String(i).padStart(3,"0")]=i;});
  for(const index of [0,39,40,80,102]){
    const detail=inspectReviewedRehearsalDifference(receipt,index);assert.equal(detail.index,index);assert.equal(detail.number,index+1);
    assert.equal(detail.totalDifferences,103);assert.equal(detail.actual.json,String(index));assert.equal(detail.path,"/extra"+String(index).padStart(3,"0"));
  }
});
test("receipt detail is bound independently from its report detail",async()=>{
  const receipt=await changed(v=>v.totalRecords=99),saved=JSON.parse(encodeRehearsalReviewEvidence(receipt));
  saved.receipt.differenceCount=91;
  const checked=await reviewRehearsalEvidence(JSON.stringify(saved),options),before=JSON.stringify(checked);
  const detail=inspectRehearsalEvidenceReceiptDifference(checked,0);
  assert.equal(detail.path,"/differenceCount");assert.equal(detail.expected.json,"1");assert.equal(detail.actual.json,"91");
  assert.equal(inspectReviewedRehearsalDifference(checked.reportReview,0).path,"/totalRecords");assert.equal(JSON.stringify(checked),before);
});
test("foreign identities and invalid indices cannot select another source or invoke accessors",async()=>{
  const receipt=await changed(v=>v.extra=true),checked=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(receipt),options);
  for(const [fn,own,code]of [[inspectReviewedRehearsalDifference,receipt,"UNRECOGNIZED_REVIEW_RECEIPT"],[inspectRehearsalEvidenceReceiptDifference,checked,"UNRECOGNIZED_EVIDENCE_REVIEW"]]){
    for(const value of [null,{},JSON.parse(JSON.stringify(own)),Object.create(own)])assert.throws(()=>fn(value,0),{code});
    for(const index of [-1,1.2,NaN,Infinity,"0",null,{},Number.MAX_SAFE_INTEGER+1])assert.throws(()=>fn(own,index),{code:"INVALID_REVIEW_DIFFERENCE_INDEX"});
    assert.throws(()=>fn(own,Number.MAX_SAFE_INTEGER),{code:"REVIEW_DIFFERENCE_NOT_FOUND"});
  }
});
test("no-difference reports have no invented first detail and do not perform new hashes",async()=>{
  let hashes=0;const receipt=await reviewRehearsalReport(JSON.stringify(original),{subtle:{digest(...args){hashes++;return webcrypto.subtle.digest(...args);}}});
  assert.throws(()=>inspectReviewedRehearsalDifference(receipt,0),{code:"REVIEW_DIFFERENCE_NOT_FOUND"});assert.equal(hashes,1);
});


import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalReviewPanel } from "../examples/operation-rehearsal-review-panel.js";
class Node extends Element {set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
function panelFixture(){
  const nodes=new Map(),downloads=[];let delivery=()=>undefined;
  const document={activeElement:null,getElementById(id){if(!nodes.has(id)){const node=new Node("div");node.focus=()=>{document.activeElement=node;};nodes.set(id,node);}return nodes.get(id);},createElement:tag=>new Node(tag)};
  const panel=mountRehearsalReviewPanel(document,{subtle:webcrypto.subtle,download:({prepared})=>{downloads.push(prepared);return delivery();}});
  const field=(name,target="review")=>document.getElementById("report-"+target+"-"+name);
  const edit=(name,value,target="review")=>{field(name,target).value=value;field(name,target).dispatchEvent(new Event(name==="difference-kind"?"change":"input"));};
  const load=async(value,target="review")=>{
    edit("text",value,target);field("paste",target).click();
    const end=Date.now()+2000;while(field("status",target).getAttribute("aria-busy")==="true"&&Date.now()<end)await new Promise(setImmediate);
    assert.equal(field("status",target).getAttribute("aria-busy"),"false");assert.equal(field("save",target).disabled,false);
  };
  const button=(index=0,target="review")=>field("differences",target).children[index].children.at(-1).children[0];
  return{panel,field,edit,load,button,document,downloads,setDelivery:fn=>{delivery=fn;}};
}
const many=structuredClone(original);for(let i=0;i<83;i++)many["extra"+String(i).padStart(3,"0")]=i;
for(const target of ["review","evidence"])test(target+" detail uses the current page and focuses a plain-text comparison",async()=>{
  const f=panelFixture();
  try{
    let input=JSON.stringify(many);
    if(target==="evidence"){
      const saved=JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(input,options)));
      for(let i=0;i<83;i++)saved.receipt["extra"+String(i).padStart(3,"0")]=i;
      input=JSON.stringify(saved);
    }
    await f.load(input,target);f.button(0,target).click();
    assert.match(f.field("difference-detail",target).textContent,/相違 1 \/ 83/);assert.match(f.field("difference-detail",target).textContent,/項目なし/);
    assert.equal(f.document.activeElement,f.field("difference-detail",target));
    const retired=f.button(0,target);
    f.field("next",target).click();assert.equal(f.field("difference-detail",target).hidden,true);
    retired.click();assert.equal(f.field("difference-detail",target).hidden,true);
    f.field("next",target).click();f.button(2,target).click();
    assert.match(f.field("difference-detail",target).textContent,/相違 83 \/ 83/);
    assert.match(f.field("difference-detail",target).textContent,/extra082/);
    f.field("save",target).click();assert.equal(JSON.parse(f.downloads.at(-1).text).differenceCount,83);
    if(target==="evidence"){
      const old=f.button(2,target);f.edit("difference-kind","source",target);old.click();
      assert.equal(f.field("difference-detail",target).hidden,true);f.button(0,target).click();
      assert.match(f.field("difference-detail",target).textContent,/元資料にある値/);
    }
  }finally{f.panel.dispose();}
});
for(const target of ["review","evidence"])for(const action of ["edit","clear","replace","dispose"])test(target+" retired detail cannot return after "+action,async()=>{
  const f=panelFixture();let text=JSON.stringify(many);
  if(target==="evidence")text=encodeRehearsalReviewEvidence(await reviewRehearsalReport(text,options));
  try{
    await f.load(text,target);const old=f.button(0,target);old.click();
    if(action==="edit")f.edit("text","{}",target);if(action==="clear")f.field("clear",target).click();
    if(action==="replace")await f.load(text,target);if(action==="dispose")f.panel.dispose();
    const before=f.field("difference-detail",target).textContent;old.click();
    assert.equal(f.field("difference-detail",target).textContent,before);assert.equal(f.field("difference-detail",target).hidden,true);
  }finally{f.panel.dispose();}
});
test("visible long values are labelled as shortened text and never create HTML",async()=>{
  const f=panelFixture(),value=structuredClone(original);value.extra="<img src=x>"+"a".repeat(3000);
  try{await f.load(JSON.stringify(value));f.button().click();const node=f.field("difference-detail");
    assert.match(node.textContent,/<img src=x>/);assert.match(node.textContent,/表示を省略/);assert.equal(node.children.length,0);
  }finally{f.panel.dispose();}
});

import { encodeRehearsalDifferenceValues } from "../src/operation-rehearsal-report-review.js";
test("complete difference exports retain long exact values and can be independently parsed",async()=>{
  const long="<img src=x>"+"x".repeat(3000)+"🚀\u202e";
  const receipt=await changed(value=>value.extra=long),before=encodeRehearsalReviewReceipt(receipt);
  const text=encodeRehearsalDifferenceValues(receipt,0),result=JSON.parse(text);
  assert.equal(result.schema,"threecore.operation-rehearsal-difference-values.v1");
  assert.equal(result.valuesComplete,true);assert.equal(result.actual.value,long);assert.equal(result.expected.present,false);
  assert.equal(Object.hasOwn(result.expected,"value"),false);assert.equal(result.sourceSha256,receipt.sha256);
  assert.equal(result.summary.matchesRecomputation,false);assert.equal(result.authorizesExecution,false);assert.equal(result.sourceVerified,false);
  assert.match(text,/\\u202e/);assert.doesNotMatch(text,/\u202e/);
  result.actual.value="changed";assert.equal(encodeRehearsalDifferenceValues(receipt,0),text);
  assert.equal(encodeRehearsalReviewReceipt(receipt),before);
});
for(const kind of ["missing","null","array","type"])test("complete difference export distinguishes "+kind,async()=>{
  const receipt=await changed(value=>{
    if(kind==="missing")delete value.totalRecords;
    if(kind==="null")value.extra=null;
    if(kind==="array")value.rows.push(structuredClone(value.rows[0]));
    if(kind==="type")value.totalRecords=String(value.totalRecords);
  });
  const result=JSON.parse(encodeRehearsalDifferenceValues(receipt,0));
  if(kind==="missing"){assert.equal(result.actual.present,false);assert.equal(Object.hasOwn(result.actual,"value"),false);}
  if(kind==="null"){assert.equal(result.actual.present,true);assert.equal(result.actual.value,null);assert.equal(result.actual.type,"null");}
  if(kind==="array"){assert.deepEqual(result.expected.value,original.rows);assert.equal(result.actual.value.length,original.rows.length+1);}
  if(kind==="type"){assert.equal(typeof result.expected.value,"number");assert.equal(typeof result.actual.value,"string");}
});
test("evidence exports retain both receipt and source discrepancy status",async()=>{
  const receipt=await changed(value=>value.totalRecords=99),saved=JSON.parse(encodeRehearsalReviewEvidence(receipt));saved.receipt.differenceCount=91;
  const checked=await reviewRehearsalEvidence(JSON.stringify(saved),options);
  for(const target of ["evidence-source","evidence-receipt"]){
    const result=JSON.parse(encodeRehearsalDifferenceValues(checked,0,target));
    assert.equal(result.target,target);assert.equal(result.summary.matchesReceipt,false);assert.equal(result.summary.matchesRecomputation,false);
    assert.equal(result.actual.value,target==="evidence-source"?99:91);assert.equal(result.sourceSha256,receipt.sha256);
  }
});
test("complete values reject forged sources and invalid selections without accessors",async()=>{
  const receipt=await changed(value=>value.extra=true),checked=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(receipt),options);
  for(const target of ["report","evidence-source","evidence-receipt"]){
    const review=target==="report"?receipt:checked;
    for(const invalid of [null,{},JSON.parse(JSON.stringify(review)),Object.create(review)])
      assert.throws(()=>encodeRehearsalDifferenceValues(invalid,0,target),{code:target==="report"?"UNRECOGNIZED_REVIEW_RECEIPT":"UNRECOGNIZED_EVIDENCE_REVIEW"});
    for(const index of [-1,1.5,NaN,Infinity,"0",null,{},Number.MAX_SAFE_INTEGER+1])
      assert.throws(()=>encodeRehearsalDifferenceValues(review,index,target),{code:"INVALID_REVIEW_DIFFERENCE_INDEX"});
  }
  for(const target of ["source","receipt","",null,{}])assert.throws(()=>encodeRehearsalDifferenceValues(receipt,0,target),{code:"INVALID_REVIEW_DIFFERENCE_TARGET"});
  assert.throws(()=>encodeRehearsalDifferenceValues(receipt,1),{code:"REVIEW_DIFFERENCE_NOT_FOUND"});
});
test("exporting a value does not request another checksum or invent a zero-result selection",async()=>{
  let calls=0;const receipt=await reviewRehearsalReport(JSON.stringify({...original,extra:"x"}),{subtle:{digest(...args){calls++;return webcrypto.subtle.digest(...args);}}});
  encodeRehearsalDifferenceValues(receipt,0);encodeRehearsalDifferenceValues(receipt,0);assert.equal(calls,1);
  const good=await reviewRehearsalReport(JSON.stringify(original),options);assert.throws(()=>encodeRehearsalDifferenceValues(good,0),{code:"REVIEW_DIFFERENCE_NOT_FOUND"});
});
for(const target of ["review","evidence"])test(target+" saves the selected complete value while retaining the short preview",async()=>{
  const f=panelFixture(),report={...original,extra:"x".repeat(3000)};let text=JSON.stringify(report);
  if(target==="evidence")text=encodeRehearsalReviewEvidence(await reviewRehearsalReport(text,options));
  try{
    await f.load(text,target);assert.equal(f.field("difference-save",target).disabled,true);
    f.button(0,target).click();assert.match(f.field("difference-detail",target).textContent,/表示を省略/);
    f.field("difference-save",target).click();const result=JSON.parse(f.downloads.at(-1).text);
    assert.equal(result.actual.value.length,3000);assert.equal(result.valuesComplete,true);assert.match(f.field("export-status",target).textContent,/保存し始め/);
    assert.equal(f.field("difference-save",target).disabled,false);
    f.edit("text","{}",target);assert.equal(f.field("difference-save",target).disabled,true);
  }finally{f.panel.dispose();}
});
for(const target of ["review","evidence"])for(const failure of ["false","throw","promise","rejection","thenable"])test(target+" complete value export refuses "+failure+" and remains retryable",async()=>{
  const f=panelFixture();let text=JSON.stringify(many);
  if(target==="evidence")text=encodeRehearsalReviewEvidence(await reviewRehearsalReport(text,options));
  try{
    await f.load(text,target);f.button(0,target).click();const before=f.field("difference-detail",target).textContent;
    f.setDelivery(()=>{
      if(failure==="false")return false;if(failure==="throw")throw Error("private");
      if(failure==="promise")return Promise.resolve(true);if(failure==="rejection")return Promise.reject(Error("private"));
      return{then(resolve){resolve(true);}};
    });
    f.field("difference-save",target).click();await new Promise(setImmediate);
    assert.match(f.field("export-status",target).textContent,/できません/);assert.doesNotMatch(f.field("export-status",target).textContent,/private/);
    assert.equal(f.field("difference-detail",target).textContent,before);assert.equal(f.field("difference-save",target).disabled,false);
    f.setDelivery(()=>true);f.field("difference-save",target).click();assert.match(f.field("export-status",target).textContent,/保存し始め/);
  }finally{f.panel.dispose();}
});
for(const target of ["review","evidence"])for(const action of ["next","clear","dispose","select"])test(target+" complete value export cannot overwrite newer "+action,async()=>{
  const f=panelFixture();let text=JSON.stringify(many);
  if(target==="evidence")text=encodeRehearsalReviewEvidence(await reviewRehearsalReport(text,options));
  try{
    await f.load(text,target);f.button(0,target).click();let after;
    f.setDelivery(()=>{
      if(action==="dispose")f.panel.dispose();
      else if(action==="select")f.button(1,target).click();
      else f.field(action,target).click();
      after=f.field("export-status",target).textContent;return true;
    });
    f.field("difference-save",target).click();assert.equal(f.field("export-status",target).textContent,after);
  }finally{f.panel.dispose();}
});
