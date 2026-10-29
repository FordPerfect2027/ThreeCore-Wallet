import { decodeRehearsalCheckSuite, runRehearsalCheckSuite, encodeRehearsalCheckReport, REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
import { formatRehearsalUnits } from "../src/operation-rehearsal.js";
import { SCENARIO_LABELS } from "./operation-rehearsal-scenario-panel.js";
export function mountRehearsalCheckPanel(document,{download,reasons={}}){
  const get=name=>document.getElementById("check-suite-"+name);let disposed=false,revision=0,input=null,report=null;const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  function reset(message="期待結果を記録したケース集を選んでください。現在の履歴やケース集は変更しません。"){
    revision++;input=null;report=null;for(const name of["rows","differences","summary","source","origin","export-status"])get(name).textContent="";
    get("save").disabled=true;get("results").hidden=true;get("status").textContent=message;get("status").className="";get("status").setAttribute("aria-busy","false");
  }
  function row(target,values){const tr=document.createElement("tr");for(const value of values){const td=document.createElement("td");td.textContent=value;tr.append(td);}get(target).append(tr);}
  const labels={...SCENARIO_LABELS,openPositions:"未決済件数",allocationBlockers:"追加予約を止める理由",withinEnteredLimits:"記録の条件判定",reasons:"記録の見送り理由"};
  function display(value,field,asset){if(Array.isArray(value))return value.map(code=>Object.hasOwn(reasons,code)?reasons[code]:code).join("・")||"該当なし";if(typeof value==="boolean")return value?"仮の条件内":"見送り";
    if(Object.hasOwn(SCENARIO_LABELS,field))return formatRehearsalUnits(value,asset.decimals)+" "+asset.symbol;return String(value);}
  function run(text,source){input=decodeRehearsalCheckSuite(text);report=runRehearsalCheckSuite(input);get("results").hidden=false;get("save").disabled=false;
    get("source").textContent="確認元: "+source;get("origin").textContent=input.expectationOrigin==="recorded-calculation"?
      "資料上の期待結果: 保存時の計算結果。変更の検出用で、計算の正しさを独立に証明するものではありません。":"資料上の期待結果: 手動で指定。指定者や根拠はこの画面では確認していません。";
    get("summary").textContent="全 "+report.summary.cases+"ケース / 一致 "+report.summary.matched+"ケース / 相違 "+report.summary.differing+"ケース。";
    get("status").textContent=report.summary.allMatched?"保存された期待結果と一致しました。実行の許可を示すものではありません。":"期待結果と異なるケースがあります。下の具体的な相違を確認してください。";
    get("status").className=report.summary.allMatched?"passed":"blocked";
    for(const item of report.rows){row("rows",[item.id+" — "+item.label,item.agent+" / "+item.chainId+" / "+item.account+" / "+item.asset.symbol+" ("+item.asset.address+")",item.matchesExpected?"一致":"相違あり",item.differenceCount+"箇所"+(item.differencesTruncated?"（先頭40箇所を表示）":"")]);
      for(const diff of item.differences)row("differences",[item.id+" / "+(diff.side==="before"?"元の条件":"比較条件")+(diff.recordId?" / 記録 "+diff.recordId:""),labels[diff.field],display(diff.expected,diff.field,item.asset),display(diff.actual,diff.field,item.asset)]);
    }
  }
  const fail=()=>reset("期待結果を確認できませんでした。1 MiB以内の期待結果ファイルを選んでください。元の履歴とケース集は保持しています。");
  listen("file","change",async()=>{if(disposed)return;const file=get("file").files?.[0];if(!file)return;
    reset("期待結果のファイルを読み込んでいます。");get("file").value="";get("text").value="";get("status").setAttribute("aria-busy","true");const own=revision;
    try{if(!Number.isSafeInteger(file.size)||file.size<1||file.size>REHEARSAL_CHECK_SUITE_LIMIT)throw Error("Size");
      const bytes=await file.arrayBuffer();if(disposed||own!==revision)return;if(bytes.byteLength!==file.size||bytes.byteLength>REHEARSAL_CHECK_SUITE_LIMIT)throw Error("Size changed");
      const name=typeof file.name==="string"?file.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,160):"期待結果ファイル";
      run(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes),name);
    }catch{if(!disposed&&own===revision)fail();}finally{if(!disposed&&own===revision)get("status").setAttribute("aria-busy","false");}
  });
  listen("paste","click",()=>{if(disposed)return;const text=get("text").value;get("text").value="";reset();try{run(text,"貼り付けた期待結果");}catch{fail();}});
  listen("text","input",()=>{if(!disposed)reset("貼り付けた期待結果を確認してください。");});
  listen("clear","click",()=>{if(disposed)return;reset();get("file").value="";get("text").value="";});
  listen("save","click",()=>{if(disposed||!input||!report)return;try{download({document,prepared:{text:encodeRehearsalCheckReport(input),filename:"ThreeCore-expected-outcome-report.json",mimeType:"application/json"}});get("export-status").textContent="期待結果の確認資料を保存し始めました。";}catch{get("export-status").textContent="確認資料を保存できませんでした。確認結果は保持しています。";}});
  reset();return Object.freeze({dispose(){if(disposed)return;reset("");disposed=true;get("file").value="";get("text").value="";for(const remove of listeners)remove();}});
}
