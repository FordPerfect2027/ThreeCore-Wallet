import { parseSecurityJson } from '../src/security-json.js';
import { createFileReadScope } from '../src/security-file.js';
import { PROPOSAL_REVIEW_FILE_SCHEMA,PROPOSAL_REVIEW_FILE_LIMIT,inspectOperationProposalReviewFile } from '../src/operation-proposal-file.js';
import { AERODROME_QUOTE_FILE_SCHEMA,AERODROME_QUOTE_FILE_LIMIT,inspectAerodromeQuoteFile } from '../src/aerodrome-quote-model.js';
import { PROPOSAL_QUOTE_FILE_LIMIT,prepareProposalQuoteReview,inspectProposalQuoteReviewFile } from '../src/proposal-quote-file.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';

const REASONS={PROPOSAL_CONDITIONS_UNSATISFIED:'提案の使用条件・予算・期限に問題があります。元の提案照合も確認してください。',
  QUOTE_PROPOSAL_MISMATCH:'提案と見積もりのトークン・使用額・対象dApp・ネットワークが一致しません。',
  QUOTE_BUDGET_BLOCK_MISMATCH:'予算の元になった残高と見積もりのブロック番号・ハッシュが一致しません。',
  QUOTE_FUTURE_TIME:'見積もりまたはブロックの時刻に矛盾があります。',QUOTE_STALE:'見積もり取得からの時間が上限を超えています。',
  QUOTE_BLOCK_STALE:'元のブロック時刻からの時間が上限を超えています。',QUOTE_OUTPUT_SHORTFALL_LIMIT:'残高比に対する受取額の減少が上限を超えています。',
  QUOTE_SLIPPAGE_LIMIT:'見積もりに設定された受取額の許容変動が上限を超えています。',QUOTE_MINIMUM_OUTPUT_ZERO:'最小受取額がゼロになります。'};
function units(value,decimals){const s=value.padStart(decimals+1,'0'),fraction=s.slice(-decimals).replace(/0+$/,'');return s.slice(0,-decimals)+(fraction?'.'+fraction:'');}
function percent(bps){return (bps/100).toFixed(2);}
function integer(value){if(!/^(0|[1-9][0-9]{0,3})$/.test(value))throw Error('LIMIT');return Number(value);}
function percentage(value){if(!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$/.test(value))throw Error('LIMIT');const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));}

export function mountProposalQuotePage(document,{download=offerWalletDownload,prepare=prepareProposalQuoteReview,inspectSaved=inspectProposalQuoteReviewFile}={}){
  const get=name=>document.getElementById('quote-'+name),reader=createFileReadScope(),removers=[];
  let revision=0,disposed=false,pending=null,prepared=null,controller=null;
  const current=own=>!disposed&&own===revision;
  function reset(clearFiles=false){revision++;reader.cancel();controller?.abort();controller=null;prepared=null;
    if(clearFiles){pending=null;get('preview').hidden=true;get('recorded').textContent='';}
    get('check').disabled=!pending;get('save').disabled=true;get('result').hidden=true;get('reasons').replaceChildren();get('save-status').textContent='';}
  function limits(){return {maxQuoteAgeSeconds:integer(get('max-age').value.trim()),maxBlockAgeSeconds:integer(get('block-age').value.trim()),maxOutputShortfallBps:percentage(get('shortfall').value.trim()),maxSlippageBps:percentage(get('slippage').value.trim())};}
  function setLimits(s){get('max-age').value=String(s.maxQuoteAgeSeconds);get('block-age').value=String(s.maxBlockAgeSeconds);get('shortfall').value=percent(s.maxOutputShortfallBps);get('slippage').value=percent(s.maxSlippageBps);}
  async function preview(files,signal){
    const proposal=await inspectOperationProposalReviewFile(files.proposalReviewFile,{signal});
    const quote=await inspectAerodromeQuoteFile(files.quoteFile,{signal});return {proposal,quote};
  }
  function showPreview({proposal,quote}){const p=proposal.recordedResult.proposal,q=quote.quote;
    get('context').textContent='提案：'+p.agent+' / '+(p.chainId===8453?'Base Mainnet':'Base Sepolia')+' / '+p.account;
    get('target').textContent='見積もり：'+q.agent+' / Aerodrome / Base Mainnet / '+q.routerAddress;
    get('block').textContent='見積もりのブロック：'+q.blockNumber+' / '+q.blockHash;
    get('amount').textContent='見積もりの入力額：'+units(q.inputBaseUnits,q.inputDecimals)+' '+(q.direction==='buy'?'USDC':q.agent);
    get('estimate').textContent='見積もりの受取額：'+units(q.poolOutputBaseUnits,q.outputDecimals)+' '+(q.direction==='buy'?q.agent:'USDC')+' / 許容変動 '+percent(q.slippageBps)+'%';
    get('source-time').textContent='取得時刻：'+new Date(q.observedAtSeconds*1000).toISOString()+' / ブロック時刻：'+new Date(q.blockTimestampSeconds*1000).toISOString();get('preview').hidden=false;
  }
  const listen=(name,event,action)=>{const handler=()=>{if(!disposed)return action();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
  for(const name of ['max-age','block-age','shortfall','slippage'])listen(name,'input',()=>{reset();get('status').textContent='比較条件が変わりました。もう一度照合してください。';});
  listen('file','change',async()=>{
    const selected=Array.from(get('file').files??[]);if(!selected.length)return;
    reset(true);const own=revision,aborter=new AbortController();controller=aborter;get('file').value='';get('status').textContent='資料を読み込んでいます。';
    try{let files,stored;
      if(selected.length===1){const text=await reader.readText(selected[0],{maxBytes:PROPOSAL_QUOTE_FILE_LIMIT});if(!current(own))return;
        stored=await inspectSaved(text,{signal:aborter.signal});if(!current(own))return;files=stored.files;
      }else if(selected.length===2){files={};for(const file of selected){const text=await reader.readText(file,{maxBytes:PROPOSAL_REVIEW_FILE_LIMIT});if(!current(own))return;
        const raw=parseSecurityJson(text),key=raw?.schema===PROPOSAL_REVIEW_FILE_SCHEMA?'proposalReviewFile':raw?.schema===AERODROME_QUOTE_FILE_SCHEMA?'quoteFile':null;
        if(!key||Object.hasOwn(files,key)||(key==='quoteFile'&&file.size>AERODROME_QUOTE_FILE_LIMIT))throw Error('FILES');files[key]=text;}
      }else throw Error('FILES');
      const info=await preview(files,aborter.signal);if(!current(own))return;
      if(stored){setLimits(stored.limits);get('recorded').textContent='保存時の結果を再計算して一致を確認しました（'+new Date(stored.recordedResult.evaluatedAtSeconds*1000).toISOString()+'）。現在の時刻でも照合してください。';}
      showPreview(info);pending=files;get('check').disabled=false;get('status').textContent='資料を読み込みました。比較条件を確認して照合してください。';
    }catch{if(current(own)){reset(true);get('status').textContent='読み込めませんでした。整合した提案記録と見積もりの2ファイル、または保存記録1個を選んでください。';}}
    finally{aborter.abort();if(current(own))controller=null;}
  });
  listen('check','click',async()=>{
    if(!pending)return;reset();const own=revision,files=pending;let settings;
    try{settings=limits();}catch{get('status').textContent='時間は整数、割合は小数2桁までで、4つの比較条件を入力してください。';return;}
    const aborter=new AbortController();controller=aborter;get('check').disabled=true;get('status').textContent='提案と見積もりを照合しています。';
    try{const checked=await prepare(files,{...settings,signal:aborter.signal});if(!current(own))return;const r=checked.result,q=r.quote.quote;
      get('outcome').textContent=r.checksSatisfied?'照合時点では、保存資料と今回の比較条件が一致しました。':'条件との不一致・不足・期限の問題があります。';
      get('time').textContent='照合時刻：'+new Date(r.evaluatedAtSeconds*1000).toISOString();
      get('minimum').textContent='設定された最小受取額：'+units(r.quote.minimumOutputBaseUnits,q.outputDecimals)+' '+(q.direction==='buy'?q.agent:'USDC');
      get('shortfall-result').textContent='残高比に対する受取額の減少：'+percent(r.quote.outputShortfallBpsCeil)+'%（小数2桁へ切上げ、手数料と丸めを含む）';
      get('reasons').replaceChildren(...r.reasons.map(code=>{const li=document.createElement('li');li.textContent=REASONS[code]??'未対応の確認項目があります。';return li;}));
      prepared=checked;get('result').hidden=false;get('save').disabled=false;get('status').textContent='照合が終わりました。結果と元の資料を保存できます。';
    }catch{if(current(own))get('status').textContent='照合できませんでした。時間は1〜3600秒、減少は0〜100%、許容変動は0〜99.99%で指定し、元の資料も確認してください。';}
    finally{aborter.abort();if(current(own)){controller=null;get('check').disabled=false;}}
  });
  listen('save','click',()=>{if(!prepared)return;const own=revision;try{
    requireSyncExport(download({document,prepared:{text:prepared.text,filename:'ThreeCore-proposal-quote-review.json',mimeType:'application/json'}}));
    if(current(own))get('save-status').textContent='保存を開始しました。保存先のファイルを確認してください。';
  }catch{if(current(own))get('save-status').textContent='保存できませんでした。結果は保持しています。';}});
  listen('cancel','click',()=>{reset(true);get('status').textContent='確認を取り消しました。元のファイルは変更していません。';});
  const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){const hide=()=>{reset(true);get('status').textContent='再開するときは資料を読み直してください。';};view.addEventListener('pagehide',hide);removers.push(()=>view.removeEventListener('pagehide',hide));}
  return Object.freeze({dispose(){if(disposed)return;disposed=true;reset(true);removers.forEach(fn=>fn());}});
}
if(typeof document!=='undefined')mountProposalQuotePage(document);
