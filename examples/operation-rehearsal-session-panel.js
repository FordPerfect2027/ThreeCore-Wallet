import { decodeRehearsalSession,encodeRehearsalSession,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
export function mountRehearsalSessionPanel(document,{session,download,onRestored,renderWorkspaceComparison}){
  const get=name=>document.getElementById("session-"+name);let pending=null,revision=0,disposed=false,source="";const listeners=[];
  function listen(name,event,fn){get(name).addEventListener(event,fn);listeners.push(()=>get(name).removeEventListener(event,fn));}
  function reset(message){revision++;pending=null;source="";for(const name of["source","summary","cases","workspace-details","export-status"])get(name).textContent="";
    get("review").hidden=true;get("apply").disabled=true;get("status").textContent=message;get("status").setAttribute("aria-busy","false");}
  function available(){get("save").disabled=!session.cases.state().current.cases.length&&!session.workspace.snapshot().ledgers.length;}
  const unsubscribe=session.subscribe(()=>{if(disposed)return;reset("履歴またはケースの操作がありました。まとめて復旧する場合は保存したファイルをもう一度確認してください。");available();});
  function cancel(message){session.cancel();reset(message);}
  const describe=item=>item?item.label+" / "+item.before.agent+" / ネットワーク "+item.before.chainId+" / 口座 "+item.before.account+" / 資産 "+item.before.asset.symbol+" ("+item.before.asset.address+") / 元記録 "+item.before.events.length+"件":"なし";
  function review(text,name){const data=decodeRehearsalSession(text);
    if(data.workspace.ledgers.some(item=>item.asset.symbol!=="SIM"||item.asset.decimals!==6))throw Error("SIM required");
    pending=session.preview(data);source=name;get("source").textContent="確認元: "+name;get("review").hidden=false;
    const comparison=pending.comparison;get("summary").textContent="作成済みの履歴 "+comparison.before.workspace.ledgers.length+" → "+comparison.after.workspace.ledgers.length+"対象 / 比較ケース "+comparison.before.cases.cases.length+" → "+comparison.after.cases.cases.length+"件。"+
      (comparison.changed?"まだ反映していません。履歴とケース集の両方を置き換え、両方の取り消し履歴をクリアします。":"入力内容は同じです。置き換えは不要です。");
    renderWorkspaceComparison(comparison.workspace);
    for(const item of comparison.cases){const tr=document.createElement("tr");const action={added:"追加",removed:"削除",replaced:"変更",unchanged:"同じ"}[item.action];
      for(const value of[item.id,action,describe(item.before),describe(item.after),[item.originalInputChanged?"元入力が変わる":"",item.hypotheticalInputChanged?"比較条件の入力が変わる":""].filter(Boolean).join(" / ")||"—"]){const td=document.createElement("td");td.textContent=value;tr.append(td);}get("cases").append(tr);}
    get("apply").disabled=!comparison.changed;get("status").textContent="変更する履歴とケース集を確認してください。まだ現在の記録は変わっていません。";
  }
  function failed(){cancel("まとめた記録を確認できませんでした。2 MiB以内の保存ファイルを選んでください。現在の履歴とケース集は保持しています。");}
  listen("save","click",()=>{if(disposed)return;try{const data=session.snapshot();if(!data.workspace.ledgers.length&&!data.cases.cases.length)return;
    download({document,prepared:{text:encodeRehearsalSession(data),filename:"ThreeCore-rehearsal-session.json",mimeType:"application/json"}});get("export-status").textContent="3トークンの履歴と全比較ケースをまとめた保存を開始しました。";
  }catch{get("export-status").textContent="まとめた記録を保存できませんでした。画面の履歴とケース集は保持しています。";}});
  listen("file","change",async()=>{if(disposed)return;const file=get("file").files?.[0];if(!file)return;cancel("まとめた記録を読み込んでいます。");get("file").value="";get("text").value="";get("status").setAttribute("aria-busy","true");const own=revision;
    try{if(!Number.isSafeInteger(file.size)||file.size<1||file.size>REHEARSAL_SESSION_LIMIT)throw Error("Size");const buffer=await file.arrayBuffer();if(disposed||own!==revision)return;
      if(buffer.byteLength!==file.size||buffer.byteLength>REHEARSAL_SESSION_LIMIT)throw Error("Size changed");const name=typeof file.name==="string"?file.name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,"").slice(0,160):"まとめた記録";
      review(new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(buffer),name);
    }catch{if(!disposed&&own===revision)failed();}finally{if(!disposed&&own===revision)get("status").setAttribute("aria-busy","false");}
  });
  listen("paste","click",()=>{if(disposed)return;const text=get("text").value;get("text").value="";cancel("貼り付けた記録を確認しています。");try{review(text,"貼り付けたまとめ記録");}catch{failed();}});
  listen("text","input",()=>{if(!disposed)cancel("貼り付けたまとめ記録を確認してください。");});
  listen("apply","click",()=>{if(disposed||!pending)return;const reviewed=pending,name=source;
    let restored;try{restored=session.commit(reviewed);}catch{failed();return;}
    try{onRestored(restored);reset("履歴とケース集をまとめて復旧しました。両方の取り消し履歴は新しく開始します。");}
    catch{reset("記録の復旧は完了しましたが、画面の更新に問題がありました。まとめ保存で復旧した記録を保管できます。");}
    get("receipt").textContent="直前のまとめ復旧: "+name+" / "+restored.workspace.ledgers.map(item=>item.agent+" "+item.events.length+"件").join(" / ")+" / 比較ケース "+restored.cases.cases.length+"件。";
  });
  listen("cancel","click",()=>{if(disposed)return;cancel("まとめ復旧の確認を取り消しました。現在の履歴とケース集は保持しています。");get("text").value="";get("file").value="";});
  reset("履歴と比較ケースを一つのファイルに保存・復旧できます。保存済みの資料や期待結果の確認表示は含みません。");available();
  return Object.freeze({dispose(){if(disposed)return;unsubscribe();session.cancel();reset("");get("receipt").textContent="";get("file").value="";get("text").value="";get("save").disabled=true;disposed=true;for(const remove of listeners)remove();}});
}
