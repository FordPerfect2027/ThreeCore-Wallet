import { parseSecurityJson } from '../src/security-json.js';
import { createFileReadScope } from '../src/security-file.js';
import { inspectProposalQuoteReviewFile } from '../src/proposal-quote-file.js';
import { PROPOSAL_ALLOWANCE_FILE_SCHEMA, PROPOSAL_ALLOWANCE_FILE_LIMIT, allowanceRequestFromReview, validateProposalAllowance, prepareProposalAllowanceReview, inspectProposalAllowanceReviewFile } from '../src/proposal-allowance.js';
import { requestProposalAllowance } from '../src/proposal-allowance-client.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
const REASONS={QUOTE_CONDITIONS_UNSATISFIED:'元の提案・見積もりに不足、不一致、期限超過があります。元の照合画面で確認できます。',ALLOWANCE_PROPOSAL_MISMATCH:'口座・トークン・相手先が提案と一致しません。',ALLOWANCE_BLOCK_MISMATCH:'許可額と見積もりのブロックが一致しません。',ALLOWANCE_FUTURE_TIME:'取得時刻またはブロック時刻に矛盾があります。',ALLOWANCE_STALE:'許可額の取得からの時間が上限を超えています。',ALLOWANCE_TOKEN_CODE_MISSING:'対象トークンのコードを確認できません。',ALLOWANCE_SPENDER_CODE_MISSING:'相手先のコードを確認できません。',ALLOWANCE_UNKNOWN:'許可額が不明です。',ALLOWANCE_SHORTFALL:'提案の使用額に対して既存の許可額が不足しています。',ALLOWANCE_BALANCE_SHORTFALL:'対象トークンの残高が不足または不明です。',ALLOWANCE_BUDGET_STATE_MISMATCH:'同じブロックで取得した残高が、予算の元の記録と一致しません。'};
function amount(raw,decimals) { if(raw===null)return '不明';const text=raw.padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:''); }
export function mountProposalAllowancePage(document,{read=requestProposalAllowance,prepare=prepareProposalAllowanceReview,inspectSaved=inspectProposalAllowanceReviewFile,download=offerWalletDownload}={}) {
 const get=name=>document.getElementById('allow-'+name),reader=createFileReadScope(),removers=[];
 let revision=0,disposed=false,controller=null,pending=null,observation=null,prepared=null,savedAge=null;
 const current=own=>!disposed&&revision===own;
 function buttons(busy=false) { get('read').disabled=busy||!pending;get('check').disabled=busy||!pending||!observation;get('save').disabled=!prepared; }
 function reset(clear=false) { revision++;reader.cancel();controller?.abort();controller=null;prepared=null;savedAge=null;
  if(clear){pending=null;observation=null;get('preview').hidden=true;get('recorded').textContent='';}
  get('result').hidden=true;get('save-status').textContent='';get('reasons').replaceChildren();buttons(); }
 function age() { const s=get('age').value.trim();if(!/^[1-9][0-9]{0,3}$/.test(s)||Number(s)>3600)throw Error('AGE');return Number(s); }
 function showPreview(result) { const p=result.proposalReview.proposal,q=result.quote.quote;
  get('context').textContent=p.agent+' / Base Mainnet / '+p.account;
  get('target').textContent='支出トークン：'+q.inputToken+' / 相手先：'+q.routerAddress;
  get('block').textContent='対象ブロック：'+q.blockNumber+' / '+q.blockHash;get('preview').hidden=false; }
 const listen=(name,event,fn)=>{const handler=()=>{if(!disposed)return fn();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
 listen('age','input',()=>{reset();get('status').textContent='比較条件が変わりました。再照合してください。';});
 listen('file','change',async()=>{
  const files=Array.from(get('file').files??[]);if(!files.length)return;reset(true);get('file').value='';const own=revision,c=new AbortController();controller=c;
  get('status').textContent='資料を確認しています。';
  try {
   if(files.length!==1)throw Error('FILES');const text=await reader.readText(files[0],{maxBytes:PROPOSAL_ALLOWANCE_FILE_LIMIT});if(!current(own))return;
   const schema=parseSecurityJson(text)?.schema;let source=text,stored;
   if(schema===PROPOSAL_ALLOWANCE_FILE_SCHEMA){stored=await inspectSaved(text,{signal:c.signal});if(!current(own))return;source=stored.files.quoteReviewFile;}
   const checked=await inspectProposalQuoteReviewFile(source,{signal:c.signal});if(!current(own))return;
   const request=allowanceRequestFromReview(checked.recordedResult);pending={quoteReviewFile:source,request};observation=stored?.files.observation??null;
   if(stored){get('age').value=String(stored.recordedResult.maxAllowanceAgeSeconds);get('recorded').textContent='保存時の結果を再計算して一致を確認しました。現在の時刻でも再照合してください。';}
   showPreview(checked.recordedResult);buttons();get('status').textContent='資料を読み込みました。取得または再照合を選んでください。';
  } catch { if(current(own)){reset(true);get('status').textContent='読み込めませんでした。整合した提案と見積もりの記録を選んでください。';} }
  finally { c.abort();if(current(own))controller=null; }
 });
 async function run(acquire) {
  if(!pending||(!acquire&&!observation))return;reset();const own=revision,source=pending,previous=observation;let maxAge;
  try { maxAge=age(); } catch { get('status').textContent='時間を1〜3600秒の整数で入力してください。';return; }
  const c=new AbortController();controller=c;buttons(true);get('status').textContent=acquire?'公開情報から許可額を読み取っています。':'保存資料を現在の時刻で再照合しています。';
  try {
   const value=validateProposalAllowance(acquire?await read(source.request,{signal:c.signal}):previous);if(!current(own))return;
   if(Object.keys(source.request).some(key=>source.request[key]!==value[key]))throw Error('CONTEXT');
   const checked=await prepare({quoteReviewFile:source.quoteReviewFile,observation:value},{maxAllowanceAgeSeconds:maxAge,signal:c.signal});if(!current(own))return;
   if(age()!==maxAge){reset();get('status').textContent='比較条件が変わりました。再照合してください。';return;}
   const r=checked.result,q=r.quoteReview.quote.quote,symbol=q.direction==='buy'?'USDC':q.agent;
   get('outcome').textContent=r.checksSatisfied?'保存資料と許可額の条件が一致しました。':'不足・不一致・期限の問題があります。';
   get('amount').textContent='必要額：'+amount(r.requiredBaseUnits,q.inputDecimals)+' '+symbol+' / 既存の許可額：'+amount(value.allowanceBaseUnits,q.inputDecimals)+' '+symbol+' / 不足：'+amount(r.allowanceShortfallBaseUnits,q.inputDecimals)+' '+symbol;
   get('balance').textContent='残高：'+amount(value.tokenBalanceBaseUnits,q.inputDecimals)+' '+symbol+' / '+amount(value.nativeBalanceBaseUnits,18)+' ETH';
   get('time').textContent='取得：'+new Date(value.observedAtSeconds*1000).toISOString()+' / 照合：'+new Date(r.evaluatedAtSeconds*1000).toISOString();
   get('reasons').replaceChildren(...r.reasons.map(code=>{const li=document.createElement('li');li.textContent=REASONS[code]??code;return li;}));
   observation=value;prepared=checked;savedAge=maxAge;get('result').hidden=false;get('status').textContent='照合が終わりました。元の資料と結果を保存できます。';
  } catch { if(current(own))get('status').textContent='取得・照合できませんでした。元の資料は保持しています。再試行できます。'; }
  finally { c.abort();if(current(own)){controller=null;buttons();} }
 }
 listen('read','click',()=>run(true));listen('check','click',()=>run(false));
 listen('save','click',()=>{if(!prepared)return;const own=revision;try {
  if(age()!==savedAge){reset();get('status').textContent='比較条件が変わりました。再照合してください。';return;}
  requireSyncExport(download({document,prepared:{text:prepared.text,filename:'ThreeCore-proposal-allowance-review.json',mimeType:'application/json'}}));
  if(current(own))get('save-status').textContent='保存を開始しました。保存先のファイルを確認してください。';
 } catch { if(current(own))get('save-status').textContent='保存できませんでした。結果は保持しています。'; } });
 listen('cancel','click',()=>{reset(true);get('status').textContent='取り消しました。元のファイルは変更していません。';});
 const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){const hide=()=>{reset(true);get('status').textContent='資料を読み直してください。';};view.addEventListener('pagehide',hide);removers.push(()=>view.removeEventListener('pagehide',hide));}
 buttons();return Object.freeze({dispose(){if(disposed)return;disposed=true;reset(true);removers.forEach(fn=>fn());}});
}
if(typeof document!=='undefined')mountProposalAllowancePage(document);
