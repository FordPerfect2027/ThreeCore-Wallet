import { parseSecurityJson } from "../src/security-json.js";
import { createFileReadScope } from "../src/security-file.js";
import { OPERATION_BUDGET_SCHEMA, USDC_OPERATION_BUDGET_SCHEMA } from "../src/operation-budget.js";
import { PUBLIC_USDC_FILE_SCHEMA } from "../src/public-usdc-model.js";
import { SHARED_BUDGET_SCHEMA, SHARED_BUDGET_LIMIT } from "../src/shared-operation-budget.js";
import { IDENTITY_FILE_SCHEMA } from "../src/token-identity-report.js";
import { PUBLIC_TOKEN_BATCH_FILE_SCHEMA } from "../src/public-token-batch-model.js";
import { BUDGET_EVIDENCE_SCHEMA, BUDGET_EVIDENCE_LIMIT, inspectBudgetEvidence, encodeBudgetEvidence, decodeBudgetEvidence } from "../src/operation-budget-evidence.js";
import { offerWalletDownload } from "./export-download.js";
import { requireSyncExport } from "../src/export-policy.js";
const REASONS = { SOURCE_SET_MISMATCH:"予算と参照記録のトークンの組み合わせが異なります。", SOURCE_ACCOUNT_MISMATCH:"参照記録の口座が異なります。",
  SOURCE_NETWORK_MISMATCH:"参照記録のネットワークが異なります。", SOURCE_BLOCK_MISMATCH:"参照記録のブロック番号またはハッシュが異なります。", SOURCE_ETH_MISMATCH:"参照記録のETH残高が異なります。",
  SOURCE_MISSING:"対応する記録なし", TOKEN_IDENTITY_UNCONFIRMED:"トークン情報に不一致・未確認あり", BUDGET_NETWORK_MISMATCH:"予算のネットワークが異なる",
  BUDGET_DECIMALS_MISMATCH:"小数桁数が異なる", BUDGET_TOKEN_BALANCE_MISMATCH:"トークン残高が異なる", BUDGET_ETH_BALANCE_MISMATCH:"ETH残高が異なる", BUDGET_ASSET_MISMATCH:"使用する資産が異なる" };
export function mountBudgetEvidencePage(document, { download=offerWalletDownload, inspect=inspectBudgetEvidence }={}) {
  const get=name=>document.getElementById("evidence-"+name), reader=createFileReadScope(), removers=[];
  let revision=0, disposed=false, pending=null, calculated=null, controller=null;
  const current=own=>!disposed&&own===revision;
  function reset() { revision++; reader.cancel(); controller?.abort(); controller=null; pending=null; calculated=null;
    get("check").disabled=true; get("save").disabled=true; get("result").hidden=true; get("rows").replaceChildren(); get("save-status").textContent=""; }
  const listen=(name,event,action)=>{const handler=()=>{if(!disposed)return action();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
  listen("file","change",async()=>{
    const files=Array.from(get("file").files??[]);if(!files.length)return; reset();const own=revision;get("file").value="";
    get("status").textContent="選択したファイルを読み込んでいます。";
    try {
      if(files.length>4)throw Error("COUNT");let data;
      if(files.length===1)data=decodeBudgetEvidence(await reader.readText(files[0],{maxBytes:BUDGET_EVIDENCE_LIMIT}));
      else {
        let budgetFile=null;const observationFiles=[];
        for(const file of files){
          if(!current(own))return;const text=await reader.readText(file,{maxBytes:SHARED_BUDGET_LIMIT});if(!current(own))return;
          const raw=parseSecurityJson(text);
          if([IDENTITY_FILE_SCHEMA,PUBLIC_TOKEN_BATCH_FILE_SCHEMA,PUBLIC_USDC_FILE_SCHEMA].includes(raw?.schema))observationFiles.push(text);
          else if([OPERATION_BUDGET_SCHEMA,USDC_OPERATION_BUDGET_SCHEMA,SHARED_BUDGET_SCHEMA].includes(raw?.schema)&&budgetFile===null)budgetFile=text;
          else throw Error("FORMAT");
        }
        data=decodeBudgetEvidence(encodeBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile,observationFiles}));
      }
      if(!current(own))return;pending=data;get("check").disabled=false;
      get("status").textContent="予算1個と残高ファイル"+data.observationFiles.length+"個を読み込みました。照合すると内容とチェックサムを確認します。";
    }catch{if(current(own))get("status").textContent="読み込めませんでした。予算1個と残高記録1〜3個、または保存した照合ファイル1個を選んでください。";}
  });
  listen("check","click",async()=>{
    if(!pending)return;const source=pending;reset();const own=revision;controller=new AbortController();
    get("status").textContent="記録の整合性とチェックサムを確認しています。";
    try{
      const r=await inspect(source,{signal:controller.signal});if(!current(own))return;
      const text=encodeBudgetEvidence(r.input);
      get("outcome").textContent=r.consistent?"予算の残高と保存記録は整合しています。":"予算と保存記録に不一致・不足があります。";
      get("budget").textContent=r.budgetResult.constraintsSatisfied?"予算計算：入力した仮定では足ります。":"予算計算：不足または未確認の項目があります。";
      get("reasons").textContent=r.groupReasons.map(code=>REASONS[code]).join(" ");
      get("rows").replaceChildren(...r.comparisons.map(item=>{
        const row=document.createElement("tr"),o=item.observation;
        const values=[item.agent+(o?.spendingAsset==="USDC"?" / 支出USDC":"")+(o?.source==="public-rpc"?"（公開RPC）":""),o?.account??"記録なし",o?(o.chainId===8453?"Base Mainnet":"Base Sepolia")+" / "+o.blockNumber+" / "+o.blockHash:"記録なし",
          item.consistent?"残高・トークン情報が一致":item.reasons.map(code=>REASONS[code]).join(" / ")];
        for(const value of values){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}return row;
      }));
      if(!current(own))return;calculated=text;get("result").hidden=false;get("save").disabled=false;
      get("status").textContent="照合が終わりました。過去の記録との整合性を確認した結果です。";
    }catch{if(current(own))get("status").textContent="照合できませんでした。対応形式・チェックサム・重複トークン・金額の上限を確認してください。";}
  });
  listen("save","click",()=>{
    if(!calculated)return;const own=revision,text=calculated;
    try{requireSyncExport(download({document,prepared:{text,filename:"ThreeCore-budget-evidence.json",mimeType:"application/json"}}));
      if(current(own))get("save-status").textContent="照合ファイルの保存を開始しました。保存先のファイルを確認してください。";
    }catch{if(current(own))get("save-status").textContent="保存できませんでした。照合結果は保持しています。";}
  });
  listen("cancel","click",()=>{reset();get("status").textContent="確認を取り消しました。元の保存ファイルは変更していません。";});
  const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){view.addEventListener("pagehide",reset);removers.push(()=>view.removeEventListener("pagehide",reset));}
  return Object.freeze({dispose(){if(disposed)return;disposed=true;reset();removers.forEach(fn=>fn());}});
}
if(typeof document!=="undefined")mountBudgetEvidencePage(document);
