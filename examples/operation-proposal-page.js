import { parseSecurityJson } from "../src/security-json.js";
import { createFileReadScope } from "../src/security-file.js";
import { BUDGET_EVIDENCE_SCHEMA, BUDGET_EVIDENCE_LIMIT } from "../src/operation-budget-evidence.js";
import { OPERATION_PROPOSAL_SCHEMA, PROPOSAL_POLICY_SCHEMA, PROPOSAL_FILE_LIMIT, decodeOperationProposal, decodeProposalReviewPolicy } from "../src/operation-proposal.js";
import { PROPOSAL_REVIEW_FILE_LIMIT, prepareOperationProposalReview, inspectOperationProposalReviewFile } from "../src/operation-proposal-file.js";
import { offerWalletDownload } from "./export-download.js";
import { requireSyncExport } from "../src/export-policy.js";

import { PROPOSAL_REVIEW_REASONS as REASONS } from "../src/proposal-review-messages.js";

export function mountOperationProposalPage(document, { download=offerWalletDownload, prepare=prepareOperationProposalReview, inspectSaved=inspectOperationProposalReviewFile }={}) {
  const get=name=>document.getElementById("proposal-"+name), reader=createFileReadScope(), removers=[];
  let revision=0, disposed=false, pending=null, prepared=null, controller=null;
  const current=own=>!disposed&&own===revision;
  function reset() {
    revision++; reader.cancel(); controller?.abort(); controller=null; pending=null; prepared=null;
    get("check").disabled=true; get("save").disabled=true; get("result").hidden=true; get("preview").hidden=true;
    get("rows").replaceChildren(); get("reasons").replaceChildren(); get("recorded").textContent=""; get("save-status").textContent="";
  }
  function preview(files) {
    const p=decodeOperationProposal(files.proposalFile); decodeProposalReviewPolicy(files.policyFile);
    get("context").textContent=p.agent+" / "+(p.chainId===8453?"Base Mainnet":"Base Sepolia")+" / 口座 "+p.account+" / トークン "+p.tokenAddress;
    get("target").textContent="対象dApp："+p.dapp.origin+" / 契約 "+p.dapp.contract;
    get("amounts").textContent="トークン使用額："+p.spendUnits+" / ETH使用額（wei）："+p.nativeValueWei+" / 期限："+new Date(p.expiresAtSeconds*1000).toISOString();
    get("origin").textContent="ファイルに記載された提案元："+(p.source.kind==="ai"?"AI":"手動")+" / "+p.source.label;
    get("rationale").textContent=p.rationale; get("preview").hidden=false;
  }
  const listen=(name,event,action)=>{const handler=()=>{if(!disposed)return action();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
  listen("file","change",async()=>{
    const files=Array.from(get("file").files??[]);if(!files.length)return;
    reset();const own=revision;controller=new AbortController();get("file").value="";get("status").textContent="資料を読み込んでいます。";
    try {
      let inputs;
      if(files.length===1) {
        const text=await reader.readText(files[0],{maxBytes:PROPOSAL_REVIEW_FILE_LIMIT});if(!current(own))return;
        const saved=await inspectSaved(text,{signal:controller.signal});if(!current(own))return;inputs=saved.files;
        get("recorded").textContent="保存時の結果を再計算して一致を確認しました（"+new Date(saved.recordedResult.evaluatedAtSeconds*1000).toISOString()+"）。現在の時刻でも照合してください。";
      } else if(files.length===3) {
        inputs={};
        for(const file of files) {
          const text=await reader.readText(file,{maxBytes:BUDGET_EVIDENCE_LIMIT});if(!current(own))return;
          const raw=parseSecurityJson(text);
          const key=raw?.schema===OPERATION_PROPOSAL_SCHEMA?"proposalFile":raw?.schema===PROPOSAL_POLICY_SCHEMA?"policyFile":raw?.schema===BUDGET_EVIDENCE_SCHEMA?"budgetEvidenceFile":null;
          if(!key||Object.hasOwn(inputs,key)||(key!=="budgetEvidenceFile"&&file.size>PROPOSAL_FILE_LIMIT))throw Error("FILES");
          inputs[key]=text;
        }
      } else throw Error("COUNT");
      if(!current(own))return;preview(inputs);pending=inputs;get("check").disabled=false;get("status").textContent="資料を読み込みました。提案の内容を確認して照合してください。";
    }catch{if(current(own)){reset();get("status").textContent="読み込めませんでした。提案・使用条件・予算と残高の3ファイル、または整合した保存記録1個を選んでください。";}}
  });
  listen("check","click",async()=>{
    if(!pending)return;const files=pending;reset();const own=revision;controller=new AbortController();preview(files);
    get("status").textContent="元の資料・使用条件・期限を照合しています。";
    try {
      const checked=await prepare(files,{signal:controller.signal});if(!current(own))return;
      const r=checked.result;
      get("outcome").textContent=r.checksSatisfied?"照合時点では、保存資料と入力した使用条件が一致しました。":"使用条件との不一致・不足・期限の問題があります。";
      get("time").textContent="照合時刻："+new Date(r.evaluatedAtSeconds*1000).toISOString()+" / 取引実行の許可ではありません。";
      get("reasons").replaceChildren(...r.reasons.map(code=>{const li=document.createElement("li");li.textContent=REASONS[code]??"未対応の確認項目があります。";return li;}));
      get("rows").replaceChildren(...r.evidence.comparisons.map(item=>{
        const row=document.createElement("tr"),o=item.observation;
        for(const value of [item.agent,o?.account??"記録なし",o?(o.chainId===8453?"Base Mainnet":"Base Sepolia")+" / "+o.blockNumber+" / "+o.blockHash:"記録なし"]){const td=document.createElement("td");td.textContent=value;row.append(td);}return row;
      }));
      prepared=checked;pending=files;get("result").hidden=false;get("save").disabled=false;get("check").disabled=false;get("status").textContent="照合が終わりました。時刻を更新して再照合することもできます。";
    }catch{if(current(own)){pending=files;get("check").disabled=false;get("status").textContent="照合できませんでした。提案が参照する資料とチェックサム、元の記録を確認してください。";}}
  });
  listen("save","click",()=>{
    if(!prepared)return;const own=revision,text=prepared.text;
    try{requireSyncExport(download({document,prepared:{text,filename:"ThreeCore-proposal-review.json",mimeType:"application/json"}}));
      if(current(own))get("save-status").textContent="記録の保存を開始しました。保存先のファイルを確認してください。";
    }catch{if(current(own))get("save-status").textContent="保存できませんでした。照合結果は保持しています。";}
  });
  listen("cancel","click",()=>{reset();get("status").textContent="確認を取り消しました。元のファイルは変更していません。";});
  const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){const hide=()=>{reset();get("status").textContent="再開するときは資料を読み直してください。";};view.addEventListener("pagehide",hide);removers.push(()=>view.removeEventListener("pagehide",hide));}
  return Object.freeze({dispose(){if(disposed)return;disposed=true;reset();removers.forEach(fn=>fn());}});
}
if(typeof document!=="undefined")mountOperationProposalPage(document);
