import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalRecordsPanel } from "../examples/operation-rehearsal-records-panel.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalRecordReport,rehearsalRecordCsv,encodeRehearsalContextRecordReport,rehearsalContextRecordCsv,REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const rendered=n=>[n.textContent,...n.children.map(rendered)].join(" ");
function setup(){const elements=new Map(),downloads=[];let throwDownload=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("record-browser-"+id);
  const panel=mountRehearsalRecordsPanel(document,{reasons:{WRONG_AGENT:"対象トークンが異なる"},kinds:{open:"投入",settle:"決済",deposit:"追加資金"},download:({prepared})=>{if(throwDownload)throw Error("Download");downloads.push(prepared);}});
  const change=(id,value,event=id==="search"?"input":"change")=>{field(id).value=value;field(id).dispatchEvent(new Event(event));};
  return{field,panel,change,downloads,failDownload:()=>{throwDownload=true;}};
}
const many=()=>{const source=rehearsalExampleV2();return workspace({...source,events:Array.from({length:27},(_,i)=>({id:"deposit-"+i,kind:"deposit",agent:source.agent,chainId:source.chainId,account:source.account,amount:"1"}))});};
test("empty source and missing agents are explicit, not assumed zero balances",()=>{
  const f=setup();assert.equal(f.field("save").disabled,true);f.panel.refresh(workspace({...rehearsalExampleV2(),events:[]}));assert.match(f.field("scope").textContent,/DAT: 0件 \/ EMA: 未作成/);assert.equal(f.field("select").disabled,true);
});
test("paging shows bounded rows and exports every match, not only the current page",()=>{
  const f=setup(),input=many();f.panel.refresh(input);assert.equal(f.field("rows").children.length,10);assert.equal(f.field("prev").disabled,true);
  f.field("next").click();assert.match(f.field("status").textContent,/11～20/);assert.match(f.field("detail").textContent,/11番目/);
  f.field("save").click();assert.equal(f.downloads[0].text,encodeRehearsalRecordReport(input));
  f.field("next").click();assert.equal(f.field("rows").children.length,7);assert.equal(f.field("next").disabled,true);
  f.change("size","25");assert.equal(f.field("rows").children.length,25);assert.match(f.field("status").textContent,/1～25/);
});
test("filter changes reset page; no matches clear old detail and related records",()=>{
  const f=setup();f.panel.refresh(many());f.field("next").click();f.change("search","deposit-26");assert.equal(f.field("rows").children.length,1);assert.match(f.field("status").textContent,/1～1/);
  f.change("search","absent");assert.equal(f.field("event").children.length,0);assert.equal(f.field("related-status").textContent,"");assert.equal(f.field("select").disabled,true);
  f.field("clear").click();assert.equal(f.field("rows").children.length,10);
});
test("detail shows recorded event context, six before/after amounts and related record IDs",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));assert.equal(f.field("balances").children.length,6);assert.match(rendered(f.field("related")),/settle-one/);
  f.change("select","DAT:settle-one");assert.match(f.field("detail").textContent,/2番目/);assert.match(rendered(f.field("balances")),/-1 SIM 28 SIM \+29 SIM/);
});
test("a source replacement refreshes amounts and removes a vanished selection",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.change("select","DAT:settle-one");f.panel.refresh(workspace(rehearsalExampleV2("DAT","pending")));
  assert.equal(f.field("select").value,"DAT:open-one");assert.equal(f.field("rows").children.length,1);assert.equal(f.field("related").children.length,0);
});
test("foreign event identity is shown distinctly from stored identity",()=>{
  const f=setup(),source=rehearsalExampleV2();f.panel.refresh(workspace({...source,events:[{...source.events[0],agent:"EMA"}]}));
  assert.match(f.field("detail").textContent,/保存元 DAT/);assert.match(rendered(f.field("event")),/記録上の対象 EMA/);assert.match(f.field("detail").textContent,/対象トークンが異なる/);
});
test("invalid query disables export until fixed and download failure preserves rows",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.change("search","x".repeat(81));assert.equal(f.field("save").disabled,true);
  f.change("search","");f.failDownload();f.field("save").click();assert.match(f.field("export-status").textContent,/保存できません/);assert.equal(f.field("rows").children.length,2);
});
test("dispose removes records and prevents later refresh or retained listeners from exposing them",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.panel.dispose();f.panel.refresh(many());f.field("next").click();assert.equal(f.field("rows").children.length,0);assert.equal(f.field("save").disabled,true);
});

const rowButton=(f,index)=>f.field('rows').children[index].children[5].children[0];
test('a record row opens its exact detail and moves focus without changing the query export',()=>{
  const f=setup(),input=many();let focus=0;f.field('select').focus=()=>{focus++;};
  try{f.panel.refresh(input);f.field('next').click();f.field('save').click();const before=f.downloads.pop().text;
    const pick=rowButton(f,7);assert.match(pick.getAttribute('aria-label'),/DAT.*18番目.*deposit-17/);pick.click();
    assert.equal(f.field('select').value,'DAT:deposit-17');assert.match(f.field('detail').textContent,/18番目.*deposit-17/);assert.equal(focus,1);
    assert.match(f.field('status').textContent,/11～20/);f.field('save').click();assert.equal(f.downloads.pop().text,before);
  }finally{f.panel.dispose();}
});
for(const change of ['filter','page','size','refresh','dispose'])test('detached record row cannot undo '+change,()=>{
  const f=setup();try{f.panel.refresh(many());const old=rowButton(f,3);
    if(change==='filter')f.change('search','deposit-26');if(change==='page')f.field('next').click();if(change==='size')f.change('size','25');
    if(change==='refresh')f.panel.refresh(workspace(rehearsalExampleV2()));if(change==='dispose')f.panel.dispose();
    const selection=f.field('select').value,detail=f.field('detail').textContent;old.click();assert.equal(f.field('select').value,selection);assert.equal(f.field('detail').textContent,detail);
  }finally{f.panel.dispose();}
});
test('a focus observer that replaces the record source retains its newer detail',()=>{
  const f=setup();try{f.panel.refresh(workspace(rehearsalExampleV2()));const pick=rowButton(f,1);
    f.field('select').focus=()=>f.panel.refresh(workspace(rehearsalExampleV2('DAT','pending')));pick.click();
    assert.equal(f.field('select').value,'DAT:open-one');assert.match(f.field('detail').textContent,/1番目.*open-one/);assert.equal(f.field('rows').children.length,1);
  }finally{f.panel.dispose();}
});

test("CSV export includes matches beyond the visible page and preserves JSON inputs",()=>{
  const f=setup(),input=many();try{assert.equal(f.field("csv-save").disabled,true);f.panel.refresh(input);f.field("next").click();
    f.field("csv-save").click();const saved=f.downloads.pop();assert.equal(saved.filename,"ThreeCore-record-query.csv");assert.equal(saved.mimeType,"text/csv;charset=utf-8");
    assert.equal(saved.text,rehearsalRecordCsv(input));assert.match(f.field("export-status").textContent,/全27件/);assert.match(f.field("status").textContent,/11～20/);
    f.field("save").click();assert.equal(f.downloads.pop().text,encodeRehearsalRecordReport(input));
  }finally{f.panel.dispose();}
});
test("no-match CSV is explicitly header-only while invalid queries disable the action",()=>{
  const f=setup(),input=many();try{f.panel.refresh(input);f.change("search","absent");f.field("csv-save").click();
    assert.equal(f.downloads.pop().text,rehearsalRecordCsv(input,{...REHEARSAL_RECORD_QUERY,search:"absent"}));assert.match(f.field("export-status").textContent,/全0件.*列名だけ/);
    f.change("search","x".repeat(81));assert.equal(f.field("csv-save").disabled,true);f.field("csv-save").click();assert.equal(f.downloads.length,0);
    f.change("search","");assert.equal(f.field("csv-save").disabled,false);
  }finally{f.panel.dispose();assert.equal(f.field("csv-save").disabled,true);}
});
test("CSV delivery failure preserves the selected query and rows for a retry",()=>{
  const f=setup();try{f.panel.refresh(many());f.change("search","deposit-2");f.failDownload();f.field("csv-save").click();
    assert.match(f.field("export-status").textContent,/CSVを保存できません/);assert.equal(f.field("rows").children.length,8);assert.equal(f.field("search").value,"deposit-2");
    assert.equal(f.field("csv-save").disabled,false);
  }finally{f.panel.dispose();}
});

test("search scope finds recorded context and exports the same versioned query in JSON and CSV",()=>{
  const f=setup(),source=rehearsalExampleV2(),account="0x"+"2".repeat(40),input=workspace({...source,events:[{...source.events[0],account},source.events[1]]});
  try{f.panel.refresh(input);f.change("search",account);assert.equal(f.field("rows").children.length,0);f.change("search-scope","recorded");assert.equal(f.field("rows").children.length,1);
    const query={...REHEARSAL_RECORD_QUERY,search:account,searchScope:"recorded"};f.field("save").click();assert.equal(f.downloads.pop().text,encodeRehearsalContextRecordReport(input,query));
    f.field("csv-save").click();assert.equal(f.downloads.pop().text,rehearsalContextRecordCsv(input,query));
    f.field("clear").click();assert.equal(f.field("search-scope").value,"stored");f.field("save").click();assert.equal(JSON.parse(f.downloads.pop().text).schema,"threecore.operation-rehearsal-record-query.v1");
  }finally{f.panel.dispose();}
});

test("related navigation restores the recorded-context search and retires old row buttons",()=>{
  const f=setup(),source=rehearsalExampleV2(),account="0x"+"2".repeat(40);try{f.panel.refresh(workspace({...source,events:[{...source.events[0],account},source.events[1]]}));
    f.change("search-scope","recorded");f.change("search",account);const old=rowButton(f,0),related=f.field("related").children[0].children[3].children[0];
    related.click();assert.equal(f.field("search-scope").value,"stored");assert.equal(f.field("select").value,"DAT:settle-one");old.click();assert.equal(f.field("select").value,"DAT:settle-one");
    f.field("back").click();assert.equal(f.field("search-scope").value,"recorded");assert.equal(f.field("search").value,account);assert.equal(f.field("select").value,"DAT:open-one");
  }finally{f.panel.dispose();}
});

test("an invalid scope disables exports until the user chooses a supported scope",()=>{
  const f=setup();try{f.panel.refresh(many());f.change("search-scope","unexpected");assert.equal(f.field("save").disabled,true);assert.equal(f.field("csv-save").disabled,true);
    f.change("search-scope","both");assert.equal(f.field("save").disabled,false);assert.equal(f.field("csv-save").disabled,false);
  }finally{f.panel.dispose();}
});

test("an overview destination opens the exact original record beyond page one and Back restores the old query",()=>{
  const f=setup(),input=many(),source=input.ledgers[0];source.events.push(rehearsalExampleV2().events[0]);
  f.panel.refresh(input);f.change("search","deposit");f.field("next").click();f.change("select","DAT:deposit-15");
  const before=f.field("status").textContent;assert.equal(f.panel.openRecord("DAT:open-one"),true);
  assert.equal(f.field("select").value,"DAT:open-one");assert.match(f.field("status").textContent,/21～28/);
  assert.equal(f.field("search").value,"");f.field("back").click();
  assert.equal(f.field("search").value,"deposit");assert.equal(f.field("select").value,"DAT:deposit-15");assert.equal(f.field("status").textContent,before);
  assert.equal(input.ledgers[0].events.length,28);f.panel.dispose();
});
test("external record navigation keeps agent identity and rejects missing, invalid and disposed destinations",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2(),rehearsalExampleV2("EMA")));
  assert.equal(f.panel.openRecord("EMA:settle-one"),true);assert.equal(f.field("agent").value,"EMA");assert.equal(f.field("select").value,"EMA:settle-one");
  const before=f.field("status").textContent;assert.equal(f.panel.openRecord("DAT:missing"),false);assert.equal(f.panel.openRecord({toString(){throw Error("Do not coerce");}}),false);
  assert.equal(f.field("status").textContent,before);f.field("size").value="999";assert.equal(f.panel.openRecord("DAT:open-one"),false);
  f.panel.dispose();assert.equal(f.panel.openRecord("DAT:open-one"),false);
});

test("selected operation detail shows the whole lifecycle even when the filter hides its settlement",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.change("search","open-one");
  assert.equal(f.field("reference-summary").hidden,false);
  assert.match(f.field("reference-summary").textContent,/決済済み（試算）/);assert.match(f.field("reference-summary").textContent,/関連する全2件/);
  assert.match(f.field("reference-summary").textContent,/累計実現損益: 28 SIM/);assert.match(f.field("reference-summary").textContent,/費用合計: 2 SIM/);
  f.field("reference-save").click();const report=JSON.parse(f.downloads[0].text);assert.equal(report.selectedKey,"DAT:open-one");assert.equal(report.recordCount,2);
  f.change("search","absent");assert.equal(f.field("reference-summary").textContent,"");assert.equal(f.field("reference-summary").hidden,true);assert.equal(f.field("reference-save").disabled,true);f.panel.dispose();
});
test("reference exports handle a refused delivery without changing source records",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2("DAT","pending")));f.failDownload();f.field("reference-save").click();
  assert.match(f.field("export-status").textContent,/保存できません/);assert.match(f.field("reference-summary").textContent,/未決済/);assert.match(f.field("reference-summary").textContent,/戻り額: 記録なし/);
  f.panel.dispose();assert.equal(f.field("reference-summary").textContent,"");assert.equal(f.field("reference-save").disabled,true);
});

test("reference CSV exports hidden related rows and is retired with an empty or closed view",()=>{
 const f=setup();try{f.panel.refresh(workspace(rehearsalExampleV2()));f.change("search","open-one");
  f.field("reference-csv-save").click();const file=f.downloads.pop();assert.equal(file.mimeType,"text/csv;charset=utf-8");assert.equal(file.text.trim().split("\r\n").length,3);
  assert.match(file.text,/"settle-one"/);assert.match(f.field("export-status").textContent,/CSVは閲覧用/);
  f.failDownload();f.field("reference-csv-save").click();assert.match(f.field("export-status").textContent,/保存できません/);
  f.change("search","absent");assert.equal(f.field("reference-csv-save").disabled,true);
 }finally{f.panel.dispose();assert.equal(f.field("reference-csv-save").disabled,true);}
});

test("exact reason selection differs from text search, preserves decision and exports all matches",()=>{
  const f=setup(),source=rehearsalExampleV2(),events=Array.from({length:27},(_,i)=>({...source.events[0],id:"wrong-"+i,account:"0x"+"9".repeat(40)}));
  try{f.panel.refresh(workspace({...source,events}));f.change("reason","WRONG_ACCOUNT");
    assert.equal(f.field("rows").children.length,10);assert.match(f.field("status").textContent,/一致 27件/);
    f.field("save").click();const report=JSON.parse(f.downloads.pop().text);assert.equal(report.matchedRecords,27);assert.equal(report.query.reason,"WRONG_ACCOUNT");
    f.field("csv-save").click();assert.equal(f.downloads.pop().text.trim().split("\r\n").length,28);
    f.change("decision","accepted");assert.equal(f.field("decision").value,"accepted");assert.equal(f.field("rows").children.length,0);
    f.field("save").click();assert.equal(JSON.parse(f.downloads.pop().text).matchedRecords,0);
    f.field("clear").click();assert.equal(f.field("reason").value,"all");
  }finally{f.panel.dispose();}
});

test("overview and related navigation restore the exact reason-filtered view on Back",()=>{
  const f=setup(),source=rehearsalExampleV2(),bad={...source.events[0],id:"wrong-open",account:"0x"+"9".repeat(40)};
  try{f.panel.refresh(workspace({...source,events:[bad,...source.events]}));f.change("reason","WRONG_ACCOUNT");
    assert.equal(f.field("select").value,"DAT:wrong-open");const before=f.field("status").textContent;
    assert.equal(f.panel.openRecord("DAT:settle-one"),true);assert.equal(f.field("reason").value,"all");
    f.field("back").click();assert.equal(f.field("reason").value,"WRONG_ACCOUNT");assert.equal(f.field("select").value,"DAT:wrong-open");assert.equal(f.field("status").textContent,before);
    const related=f.field("related").children[0].children[3].children[0];related.click();assert.equal(f.field("reason").value,"all");
    f.field("back").click();assert.equal(f.field("reason").value,"WRONG_ACCOUNT");assert.equal(f.field("status").textContent,before);
    f.change("reason","UNKNOWN");assert.equal(f.field("save").disabled,true);assert.equal(f.field("reference-save").disabled,true);
  }finally{f.panel.dispose();}
});
