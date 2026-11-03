import { createFileSelectionNotice } from "./file-read-panel.js";
import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError, displayFileName, decodeRehearsalForPanel } from "../src/file-read-status.js";
import { requireSyncExport } from "../src/export-policy.js";
import { decodeRehearsalCheckSuite, runRehearsalCheckSuite, pageRehearsalCheckDifferences, encodeRehearsalCheckReport, REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { SCENARIO_LABELS } from "./operation-rehearsal-scenario-panel.js";
export function mountRehearsalCheckPanel(document,{download,reasons={}}){
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope();
  const get=name=>document.getElementById("check-suite-"+name);let disposed=false,revision=0,input=null,report=null;const listeners=[];let detailOffset=0,differencePage=null,viewRevision=0;
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  const fileNotice = createFileSelectionNotice(get("file"), get("file-note"));
  listeners.push(() => fileNotice.dispose());
  function reset(message="期待結果を記録したケース集を選んでください。現在の履歴やケース集は変更しません。"){
    const own=++revision;viewRevision++;fileNotice.clear();input=null;report=null;detailOffset=0;differencePage=null;
    get("filter").value="all";get("case").value="*";get("case").textContent="";
    for(const name of ["filter","case","previous","next"])get(name).disabled=true;
    get("visible-status").textContent="";get("difference-status").textContent="";for(const name of["rows","differences","summary","source","origin","export-status"])get(name).textContent="";
    get("save").disabled=true;get("results").hidden=true;get("status").textContent=message;get("status").className="";get("status").setAttribute("aria-busy","false");
    fileReader.cancel();return disposed||own!==revision?null:own;
  }
  function row(target,values){const tr=document.createElement("tr");for(const value of values){const td=document.createElement("td");td.textContent=value;tr.append(td);}get(target).append(tr);return tr;}
  const labels={...SCENARIO_LABELS,openPositions:"未決済件数",allocationBlockers:"追加予約を止める理由",withinEnteredLimits:"記録の条件判定",reasons:"記録の見送り理由"};
  function display(value,field,asset){if(Array.isArray(value))return value.map(code=>Object.hasOwn(reasons,code)?reasons[code]:code).join("・")||"該当なし";if(typeof value==="boolean")return value?"仮の条件内":"見送り";
    if(Object.hasOwn(SCENARIO_LABELS,field))return formatRehearsalUnits(value,asset.decimals)+" "+asset.symbol;return String(value);}
  function run(text,source){input=decodeRehearsalForPanel(text, "expectations", decodeRehearsalCheckSuite);report=runRehearsalCheckSuite(input);get("results").hidden=false;get("save").disabled=false;
    get("source").textContent="確認元: "+source;get("origin").textContent=input.expectationOrigin==="recorded-calculation"?
      "資料上の期待結果: 保存時の計算結果。変更の検出用で、計算の正しさを独立に証明するものではありません。":"資料上の期待結果: 手動で指定。指定者や根拠はこの画面では確認していません。";
    get("summary").textContent="全 "+report.summary.cases+"ケース / 一致 "+report.summary.matched+"ケース / 相違 "+report.summary.differing+"ケース。";
    get("status").textContent=report.summary.allMatched?"保存された期待結果と一致しました。実行の許可を示すものではありません。":"期待結果と異なるケースがあります。下の具体的な相違を確認してください。";
    get("status").className=report.summary.allMatched?"passed":"blocked";
    renderResults();
  }
  function renderResults(){
    const ownView=++viewRevision;get("rows").textContent="";get("differences").textContent="";differencePage=null;
    get("previous").disabled=true;get("next").disabled=true;if(!report)return;
    const filter=get("filter").value||"all";
    const shown=report.rows.filter(item=>filter==="all"||(filter==="matched"&&item.matchesExpected)||(filter==="differing"&&!item.matchesExpected));
    get("filter").disabled=false;get("case").disabled=!shown.length;
    let selected=get("case").value||"*";if(!shown.some(item=>item.id===selected))selected="*";
    get("case").textContent="";const all=document.createElement("option");all.value="*";all.textContent="表示中の全ケース（概要）";get("case").append(all);
    for(const item of shown){const option=document.createElement("option");option.value=item.id;option.textContent=item.id+" — "+item.label;get("case").append(option);
      const tr=row("rows",[item.id+" — "+item.label,item.agent+" / "+item.chainId+" / "+item.account+" / "+item.asset.symbol+" ("+item.asset.address+")",item.matchesExpected?"一致":"相違あり",item.differenceCount+"箇所"]);
      const cell=document.createElement("td"),button=document.createElement("button");button.type="button";button.textContent="相違を確認";
      button.setAttribute("aria-label",item.id+" の相違を確認");button.addEventListener("click",()=>{if(disposed||ownView!==viewRevision)return;get("case").value=item.id;detailOffset=0;renderResults();get("case").focus?.();});cell.append(button);tr.append(cell);
    }
    get("case").value=selected;
    get("visible-status").textContent="表示 "+shown.length+" / 全 "+report.rows.length+"ケース。保存は絞り込みに関係なく全ケースが対象です。";
    function appendDifferences(item,entries){for(const diff of entries)row("differences",[item.id+" / "+(diff.side==="before"?"元の条件":"比較条件")+(diff.recordId?" / 記録 "+diff.recordId:""),labels[diff.field],display(diff.expected,diff.field,item.asset),display(diff.actual,diff.field,item.asset)]);}
    if(selected==="*"){
      for(const item of shown)appendDifferences(item,item.differences);
      const count=shown.reduce((sum,item)=>sum+item.differenceCount,0),truncated=shown.some(item=>item.differencesTruncated);
      get("difference-status").textContent=!shown.length?"この表示条件に該当するケースはありません。":!count?"表示中のケースに相違はありません。":
        "表示中のケースの相違は全"+count+"箇所です。"+(truncated?"概要はケースごとに先頭40箇所までです。ケースを選ぶと残りも順番に確認できます。":"すべての相違を表示しています。");
    }else{
      const item=shown.find(row=>row.id===selected);differencePage=pageRehearsalCheckDifferences(input,selected,detailOffset);detailOffset=differencePage.offset;
      appendDifferences(item,differencePage.rows);get("previous").disabled=differencePage.previousOffset===null;get("next").disabled=differencePage.nextOffset===null;
      get("difference-status").textContent=item.id+"："+(differencePage.totalDifferences?"相違 "+(detailOffset+1)+"〜"+(detailOffset+differencePage.rows.length)+" / 全"+differencePage.totalDifferences+"箇所。":"期待結果と一致しており、相違はありません。");
    }
  }
  listen("filter","change",()=>{if(disposed||!report)return;get("case").value="*";detailOffset=0;renderResults();});
  listen("case","change",()=>{if(disposed||!report)return;detailOffset=0;renderResults();});
  for(const [name,key]of [["previous","previousOffset"],["next","nextOffset"]])listen(name,"click",()=>{if(disposed||!differencePage||differencePage[key]===null)return;detailOffset=differencePage[key];renderResults();});

  const fail=error=>reset((describeFileReadError(error,"1 MiB")??"期待結果を確認できませんでした。1 MiB以内の期待結果ファイルを選んでください。")+" 元の履歴とケース集は保持しています。");
  listen("file","change",async()=>{if(disposed)return;const file=get("file").files?.[0];if(!file){fileNotice.noSelection();return;}
    const own=reset("期待結果のファイルを読み込んでいます。");if(own===null)return;get("file").value="";get("text").value="";get("status").setAttribute("aria-busy","true");
    try{
      const text = await fileReader.readText(file, { maxBytes: REHEARSAL_CHECK_SUITE_LIMIT });if(disposed||own!==revision)return;
      const name = displayFileName(file, "期待結果ファイル");
      if (disposed || own !== revision) return;
      run(text,name);
    }catch(error){if(!disposed&&own===revision)fail(error);}finally{if(!disposed&&own===revision)get("status").setAttribute("aria-busy","false");}
  });
  listen("paste","click",()=>{if(disposed)return;const text=get("text").value;get("text").value="";const own=reset();if(own===null)return;try{run(text,"貼り付けた期待結果");}catch(error){if(!disposed&&own===revision)fail(error);}});
  listen("text","input",()=>{if(!disposed)reset("貼り付けた期待結果を確認してください。");});
  listen("clear","click",()=>{if(disposed||reset()===null)return;get("file").value="";get("text").value="";});
  listen("save","click",()=>{if(disposed||!input||!report)return;const own=revision; try{offerDownload({document,prepared:{text:encodeRehearsalCheckReport(input),filename:"ThreeCore-expected-outcome-report.json",mimeType:"application/json"}});if(disposed||own!==revision)return;get("export-status").textContent="期待結果の確認資料を保存し始めました。";}catch{if(disposed||own!==revision)return;get("export-status").textContent="確認資料を保存できませんでした。確認結果は保持しています。";}});
  reset();return Object.freeze({dispose(){if(disposed)return;disposed=true;reset("");get("file").value="";get("text").value="";for(const remove of listeners)remove();}});
}
