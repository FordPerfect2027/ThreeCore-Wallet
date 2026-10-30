import { createFileReadScope } from "../src/security-file.js";
import { describeFileReadError, displayFileName } from "../src/file-read-status.js";
import { observeCallbackResult } from "../src/security-callback.js";
import { requireSyncExport } from "../src/export-policy.js";
import { decodeRehearsalSession,encodeRehearsalSession,createRehearsalSaveCheckpoint,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
export function mountRehearsalSessionPanel(document,{session,download,onRestored,renderWorkspaceComparison}){
  const offerDownload = payload => requireSyncExport(download(payload));
  const fileReader = createFileReadScope();
  const checkpoint = createRehearsalSaveCheckpoint();
  const get=name=>document.getElementById("session-"+name);let pending=null,revision=0,disposed=false,source="",sourceKind=null;const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  function reset(message){fileReader.cancel();revision++;pending=null;source="";sourceKind=null;for(const name of["source","summary","cases","workspace-details","export-status"])get(name).textContent="";
    get("review").hidden=true;get("apply").disabled=true;get("status").textContent=message;get("status").setAttribute("aria-busy","false");}
  function available(){
    const state=checkpoint.inspect(session.snapshot());get("save").disabled=state.state==="empty";
    const message=state.state==="empty"?"保存する確定済みの履歴・比較ケースはありません。"
      :state.state==="unrecorded"?"このページの履歴とケース集は、まだまとめ保存を開始していません。ページを閉じる前に保存してください。"
      :state.state==="changed"?"最後のまとめ保存・ファイル復旧の後に、履歴またはケース集が変わっています。残す場合はもう一度まとめ保存してください。"
      :state.source==="file"?"履歴とケース集の内容は、直前に読み込んだ保存ファイルと同じです。"
      :"履歴とケース集の内容は、直前にまとめ保存を開始した時と同じです。保存先にファイルができたことを確認してください。";
    get("save-state").textContent=message+(state.state==="empty"?"":" 確定記録 "+state.records+"件 / 比較ケース "+state.cases+"件。");
    get("save-state").setAttribute("data-state",state.state);
  }
  function beforeUnload(event){
    if(disposed)return;
    if(checkpoint.inspect(session.snapshot()).hasChanges){event.preventDefault();event.returnValue="";}
  }
  const view=document.defaultView;
  view?.addEventListener("beforeunload",beforeUnload);
  const unsubscribe=session.subscribe(()=>{if(disposed)return;reset("履歴またはケースの操作がありました。まとめて復旧する場合は保存したファイルをもう一度確認してください。");available();});
  function cancel(message){session.cancel();reset(message);}
  const describe=item=>item?item.label+" / "+item.before.agent+" / ネットワーク "+item.before.chainId+" / 口座 "+item.before.account+" / 資産 "+item.before.asset.symbol+" ("+item.before.asset.address+") / 元記録 "+item.before.events.length+"件":"なし";
  function review(text,name,kind="paste"){const data=decodeRehearsalSession(text);
    if(data.workspace.ledgers.some(item=>item.asset.symbol!=="SIM"||item.asset.decimals!==6))throw Error("SIM required");
    pending=session.preview(data);source=name;sourceKind=kind;get("source").textContent="確認元: "+name;get("review").hidden=false;
    const comparison=pending.comparison;get("summary").textContent="作成済みの履歴 "+comparison.before.workspace.ledgers.length+" → "+comparison.after.workspace.ledgers.length+"対象 / 比較ケース "+comparison.before.cases.cases.length+" → "+comparison.after.cases.cases.length+"件。"+
      (comparison.changed?"まだ反映していません。履歴とケース集の両方を置き換え、両方の取り消し履歴をクリアします。":"入力内容は同じです。置き換えは不要です。");
    renderWorkspaceComparison(comparison.workspace);
    for(const item of comparison.cases){const tr=document.createElement("tr");const action={added:"追加",removed:"削除",replaced:"変更",unchanged:"同じ"}[item.action];
      for(const value of[item.id,action,describe(item.before),describe(item.after),[item.originalInputChanged?"元入力が変わる":"",item.hypotheticalInputChanged?"比較条件の入力が変わる":""].filter(Boolean).join(" / ")||"—"]){const td=document.createElement("td");td.textContent=value;tr.append(td);}get("cases").append(tr);}
    get("apply").disabled=!comparison.changed;get("status").textContent="変更する履歴とケース集を確認してください。まだ現在の記録は変わっていません。";
    if(kind==="file"&&!comparison.changed){checkpoint.record(data,"file");available();}
  }
  function failed(error){cancel((describeFileReadError(error,"2 MiB")??"まとめた記録を確認できませんでした。2 MiB以内の保存ファイルを選んでください。")+" 現在の履歴とケース集は保持しています。");}
  listen("save","click",()=>{if(disposed)return;const own=revision; try{const data=session.snapshot();if(!data.workspace.ledgers.length&&!data.cases.cases.length)return;
    offerDownload({document,prepared:{text:encodeRehearsalSession(data),filename:"ThreeCore-rehearsal-session.json",mimeType:"application/json"}});if(disposed||own!==revision)return;checkpoint.record(data,"download");available();get("export-status").textContent="3トークンの履歴と全比較ケースをまとめた保存を開始しました。";
  }catch{if(disposed||own!==revision)return;get("export-status").textContent="まとめた記録を保存できませんでした。画面の履歴とケース集は保持しています。";}});
  listen("file","change",async()=>{if(disposed)return;const file=get("file").files?.[0];if(!file)return;cancel("まとめた記録を読み込んでいます。");get("file").value="";get("text").value="";get("status").setAttribute("aria-busy","true");const own=revision;
    try{const text = await fileReader.readText(file, { maxBytes: REHEARSAL_SESSION_LIMIT });if(disposed||own!==revision)return;
      const name = displayFileName(file, "まとめた記録");
      if (disposed || own !== revision) return;
      review(text,name,"file");
    }catch(error){if(!disposed&&own===revision)failed(error);}finally{if(!disposed&&own===revision)get("status").setAttribute("aria-busy","false");}
  });
  listen("paste","click",()=>{if(disposed)return;const text=get("text").value;get("text").value="";cancel("貼り付けた記録を確認しています。");try{review(text,"貼り付けたまとめ記録");}catch{failed();}});
  listen("text","input",()=>{if(!disposed)cancel("貼り付けたまとめ記録を確認してください。");});
  listen("apply","click",()=>{if(disposed||!pending)return;const reviewed=pending,name=source,kind=sourceKind;
    let restored;try{restored=session.commit(reviewed);}catch{failed();return;}
    if(disposed)return;
    if(kind==="file")checkpoint.record(restored,"file");
    try{const result=observeCallbackResult(onRestored(restored));if(disposed)return;
      if(result!=="synchronous")throw Error("UNCONFIRMED_RESTORE_VIEW");
      reset("履歴とケース集をまとめて復旧しました。両方の取り消し履歴は新しく開始します。");}
    catch{if(disposed)return;reset("記録の復旧は完了しましたが、画面の更新に問題がありました。まとめ保存で復旧した記録を保管できます。");}
    get("receipt").textContent="直前のまとめ復旧: "+name+" / "+restored.workspace.ledgers.map(item=>item.agent+" "+item.events.length+"件").join(" / ")+" / 比較ケース "+restored.cases.cases.length+"件。";
    available();
  });
  listen("cancel","click",()=>{if(disposed)return;cancel("まとめ復旧の確認を取り消しました。現在の履歴とケース集は保持しています。");get("text").value="";get("file").value="";});
  reset("履歴と比較ケースを一つのファイルに保存・復旧できます。保存済みの資料や期待結果の確認表示は含みません。");available();
  return Object.freeze({dispose(){if(disposed)return;unsubscribe();session.cancel();reset("");checkpoint.clear();view?.removeEventListener("beforeunload",beforeUnload);get("save-state").textContent="";get("save-state").removeAttribute("data-state");get("receipt").textContent="";get("file").value="";get("text").value="";get("save").disabled=true;disposed=true;for(const remove of listeners)remove();}});
}
