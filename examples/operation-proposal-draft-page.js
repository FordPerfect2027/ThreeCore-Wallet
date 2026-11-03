import { BUDGET_EVIDENCE_LIMIT } from '../src/operation-budget-evidence.js';
import { inspectProposalDraftSource,prepareManualOperationProposal } from '../src/operation-proposal-draft.js';
import { PROPOSAL_REVIEW_REASONS } from '../src/proposal-review-messages.js';
import { formatRehearsalUnits } from '../src/operation-rehearsal.js';
import { createFileReadScope } from '../src/security-file.js';
import { AERODROME_BASE } from '../src/aerodrome-readonly.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
const FIELDS=['agent','id','label','rationale','origin','contract','max-spend','max-native','max-fee','minutes'];
export function mountProposalDraftPage(document,{inspectSource=inspectProposalDraftSource,prepare=prepareManualOperationProposal,download=offerWalletDownload,nowSeconds=()=>Math.floor(Date.now()/1000)}={}){
 const get=name=>document.getElementById('draft-'+name),reader=createFileReadScope(),removers=[];
 let revision=0,disposed=false,controller=null,source=null,sourceText=null,prepared=null,snapshot=null;
 const current=own=>!disposed&&own===revision;
 const context=()=>source?.contexts.find(c=>c.agent===get('agent').value);
 const form=()=>Object.fromEntries(FIELDS.map(name=>[name,get(name).value]));
 const stamp=()=>JSON.stringify({fields:form(),sourceText});
 function invalidate(){revision++;reader.cancel();controller?.abort();controller=null;prepared=null;snapshot=null;get('result').hidden=true;get('reasons').replaceChildren();get('save').disabled=true;get('save-status').textContent='';get('generate').disabled=!context();}
 function showSource(){
  const c=context();get('source-preview').hidden=!c;get('fill').disabled=!c;get('aerodrome').disabled=c?.chainId!==8453;get('generate').disabled=!c;
  if(!c){get('source-status').textContent=source?'この対象トークンは読み込んだ予算にありません。対象を選び直してください。':'予算と残高の照合ファイルを選んでください。';return;}
  const fmt=formatRehearsalUnits;get('context').textContent=c.agent+' / 支出 '+c.asset+' / '+(c.chainId===8453?'Base Mainnet':'Base Sepolia');
  get('account').textContent=c.account;get('token').textContent=c.tokenAddress;get('block').textContent=c.blockNumber+' / '+c.blockHash;
  get('spend').textContent=fmt(c.spendUnits,c.decimals)+' '+c.asset;get('native').textContent=fmt(c.nativeValueWei,18)+' ETH';get('fee').textContent=c.plannedFeeBudgetWei===null?'未確定':fmt(c.plannedFeeBudgetWei,18)+' ETH';
  get('source-status').textContent=source.budgetConstraintsSatisfied?'予算と残高の原本が一致しています。入力した仮定では予算も足ります。':'予算と残高の原本は一致していますが、予算に不足・未確認があります。作成後の照合結果にも表示します。';
 }
 const listen=(name,event,fn)=>{const handler=()=>{if(!disposed)return fn();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
 for(const name of FIELDS)for(const event of ['input','change'])listen(name,event,()=>{invalidate();showSource();get('status').textContent='入力が変わりました。作成・照合をやり直してください。';});
 listen('file','change',async()=>{
  const file=get('file').files?.[0];if(!file)return;source=null;sourceText=null;invalidate();showSource();const own=revision,aborter=new AbortController();controller=aborter;get('file').value='';get('source-status').textContent='予算と残高の原本を照合しています。';get('status').textContent='資料が変わりました。読み込み後に作成・照合をやり直してください。';
  try{const text=await reader.readText(file,{maxBytes:BUDGET_EVIDENCE_LIMIT});if(!current(own))return;const checked=await inspectSource(text,{signal:aborter.signal});if(!current(own))return;source=checked;sourceText=text;showSource();}
  catch{if(current(own))get('source-status').textContent='原本を照合できませんでした。予算と残高の照合画面で保存した、一致しているファイルを選んでください。';}
  finally{aborter.abort();if(current(own))controller=null;}
 });
 listen('fill','click',()=>{
  const c=context();if(!c)return;invalidate();get('max-spend').value=formatRehearsalUnits(c.spendUnits,c.decimals);get('max-native').value=formatRehearsalUnits(c.nativeValueWei,18);get('max-fee').value=c.plannedFeeBudgetWei===null?'':formatRehearsalUnits(c.plannedFeeBudgetWei,18);
  if(!get('id').value)get('id').value='manual-'+globalThis.crypto.randomUUID();
  get('status').textContent='予算の額を比較上限に転記しました。上限と期限を確認してください。費用が未確定なら、その上限は空欄のままです。';
 });
 listen('aerodrome','click',()=>{if(context()?.chainId!==8453)return;invalidate();get('origin').value='https://aerodrome.finance';get('contract').value=AERODROME_BASE.router;get('status').textContent='Base MainnetのAerodrome Routerを比較対象に入れました。接続や取引は行いません。';});
 listen('generate','click',async()=>{
  if(!context())return;invalidate();const own=revision,captured=stamp(),f=form(),aborter=new AbortController();controller=aborter;get('generate').disabled=true;get('status').textContent='提案と使用条件を作成し、原本・予算・上限・期限を照合しています。';
  try{
   const result=await prepare({budgetEvidenceFile:sourceText,agent:f.agent,proposalId:f.id,label:f.label,rationale:f.rationale,dappOrigin:f.origin,dappContract:f.contract,maxSpendAmount:f['max-spend'],maxNativeAmount:f['max-native'],maxFeeAmount:f['max-fee'],lifetimeMinutes:f.minutes},{nowSeconds:nowSeconds(),signal:aborter.signal});
   if(!current(own))return;if(stamp()!==captured){invalidate();get('status').textContent='入力が変わりました。もう一度作成してください。';return;}
   const r=result.result;get('outcome').textContent=r.checksSatisfied?'入力した条件と予算が一致しました。':'入力した条件に、不足・上限超過・未確認があります。';
   get('reasons').replaceChildren(...r.reasons.map(code=>{const li=document.createElement('li');li.textContent=PROPOSAL_REVIEW_REASONS[code]??'確認できない条件があります。';return li;}));
   get('time').textContent='作成：'+new Date(r.proposal.createdAtSeconds*1000).toLocaleString()+' ／ 期限：'+new Date(r.proposal.expiresAtSeconds*1000).toLocaleString()+'（この端末の時刻）';
   get('summary').textContent='手動提案 '+r.proposal.proposalId+' ／ '+r.proposal.dapp.origin+' ／ '+r.proposal.dapp.contract;
   prepared=result;snapshot=captured;get('result').hidden=false;get('save').disabled=false;get('status').textContent='作成と照合が完了しました。元の予算資料を含めて1ファイルに保存できます。';
  }catch{if(current(own))get('status').textContent='作成できませんでした。提案名・説明・HTTPSの接続先・契約アドレス・金額・1〜1440分の期限を確認してください。入力は保持しています。';}
  finally{aborter.abort();if(current(own)){controller=null;get('generate').disabled=!context();}}
 });
 listen('save','click',()=>{if(!prepared)return;const own=revision;
  try{if(stamp()!==snapshot){invalidate();get('status').textContent='入力が変わりました。もう一度作成してください。';return;}
   requireSyncExport(download({document,prepared:{text:prepared.text,filename:'ThreeCore-manual-proposal-review.json',mimeType:'application/json'}}));if(current(own))get('save-status').textContent='保存を開始しました。保存先のファイルを確認してください。';
  }catch{if(current(own))get('save-status').textContent='保存できませんでした。作成した内容は保持しています。';}
 });
 listen('cancel','click',()=>{invalidate();showSource();get('status').textContent='確認結果を取り消しました。入力は保持しています。';});
 const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){view.addEventListener('pagehide',invalidate);removers.push(()=>view.removeEventListener('pagehide',invalidate));}
 invalidate();showSource();return Object.freeze({dispose(){if(disposed)return;disposed=true;invalidate();removers.forEach(fn=>fn());}});
}
if(typeof document!=='undefined')mountProposalDraftPage(document);
