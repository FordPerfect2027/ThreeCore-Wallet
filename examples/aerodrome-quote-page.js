import { requestAerodromeQuote } from '../src/aerodrome-quote-client.js';
import { validateAerodromeQuoteRequest } from '../src/aerodrome-quote-request.js';
import { prepareAerodromeQuoteFile,calculateAerodromeQuote } from '../src/aerodrome-quote-model.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
function decimalUnits(value,decimals){if(typeof value!=='string'||!new RegExp('^(0|[1-9][0-9]{0,77})(\\.[0-9]{1,'+decimals+'})?$').test(value))throw Error('INPUT');const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(decimals,'0')).toString();}
function units(value,decimals){const s=value.padStart(decimals+1,'0'),f=s.slice(-decimals).replace(/0+$/,'');return s.slice(0,-decimals)+(f?'.'+f:'');}
export function mountAerodromeQuotePage(document,{read=requestAerodromeQuote,prepare=prepareAerodromeQuoteFile,download=offerWalletDownload}={}){
 const get=name=>document.getElementById('market-'+name),removers=[];let revision=0,disposed=false,controller=null,prepared=null;
 const current=own=>!disposed&&own===revision;
 function unit(){get('unit').textContent=get('direction').value==='buy'?'USDC単位で入力してください（小数6桁まで）。':get('agent').value+'単位で入力してください（小数18桁まで）。';}
 function reset(){revision++;controller?.abort();controller=null;prepared=null;get('read').disabled=false;get('cancel').disabled=true;get('save').disabled=true;get('result').hidden=true;get('save-status').textContent='';}
 const listen=(name,event,action)=>{const handler=()=>{if(!disposed)return action();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
 for(const name of ['agent','direction','amount','slippage','block'])listen(name,'input',()=>{reset();unit();get('status').textContent='条件が変わりました。見積もりを取り直してください。';});
 listen('read','click',async()=>{
  reset();const own=revision;let request;
  try{request=validateAerodromeQuoteRequest({agent:get('agent').value,direction:get('direction').value,inputBaseUnits:decimalUnits(get('amount').value.trim(),get('direction').value==='buy'?6:18),slippageBps:Number(decimalUnits(get('slippage').value.trim(),2)),blockNumber:get('block').value.trim()||null});}
  catch{get('status').textContent='入力額・許容変動・ブロック番号を確認してください。入力額は正の数、許容変動は0〜99.99%です。';return;}
  const aborter=new AbortController();controller=aborter;get('read').disabled=true;get('cancel').disabled=false;get('status').textContent='同じブロックから見積もりを読み取っています。最大約2分です。';
  try{const quote=await read(request,{signal:aborter.signal});if(!current(own))return;
   if(quote.agent!==request.agent||quote.direction!==request.direction||quote.inputBaseUnits!==request.inputBaseUnits||quote.slippageBps!==request.slippageBps||(request.blockNumber!==null&&quote.blockNumber!==request.blockNumber))throw Error('CONTEXT');
   const result=calculateAerodromeQuote(quote),file=await prepare(quote,{signal:aborter.signal});if(!current(own))return;
   const inputSymbol=quote.direction==='buy'?'USDC':quote.agent,outputSymbol=quote.direction==='buy'?quote.agent:'USDC';
   get('context').textContent=units(quote.inputBaseUnits,quote.inputDecimals)+' '+inputSymbol+' → '+outputSymbol+' / Base Mainnet';
   get('output').textContent='見積もりの受取額：'+units(quote.poolOutputBaseUnits,quote.outputDecimals)+' '+outputSymbol;
   get('minimum').textContent='最小受取額の設定値：'+units(result.minimumOutputBaseUnits,quote.outputDecimals)+' '+outputSymbol+' / 許容変動 '+(quote.slippageBps/100).toFixed(2)+'%';
   get('shortfall').textContent='残高比に対する受取額の減少：'+(result.outputShortfallBpsCeil/100).toFixed(2)+'%（切上げ、手数料・価格変化・丸めを含む）';
   get('block-result').textContent='ブロック '+quote.blockNumber+' / '+quote.blockHash;
   get('time').textContent='取得時刻：'+new Date(quote.observedAtSeconds*1000).toISOString()+' / ブロック時刻：'+new Date(quote.blockTimestampSeconds*1000).toISOString();
   get('contract').textContent='プール：'+quote.poolAddress+' / Router：'+quote.routerAddress;
   prepared=file;get('result').hidden=false;get('save').disabled=false;get('status').textContent='取得と照合が完了しました。見積もりを保存できます。';
  }catch{if(current(own))get('status').textContent='見積もりを取得できませんでした。入力額が小さすぎる場合、プールや接続に問題がある場合も含みます。途中の結果は採用していません。';}
  finally{aborter.abort();if(current(own)){controller=null;get('read').disabled=false;get('cancel').disabled=true;}}
 });
 listen('cancel','click',()=>{reset();get('status').textContent='読み取りを中止しました。途中の結果は保存しません。';});
 listen('save','click',()=>{if(!prepared)return;const own=revision;try{requireSyncExport(download({document,prepared:{text:prepared.text,filename:'ThreeCore-Aerodrome-'+prepared.quote.agent+'-'+prepared.quote.direction+'-quote.json',mimeType:'application/json'}}));if(current(own))get('save-status').textContent='保存を開始しました。保存先のファイルを確認してください。';}catch{if(current(own))get('save-status').textContent='保存できませんでした。結果は保持しています。';}});
 const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){const hide=()=>{reset();get('status').textContent='読み取りを終了しました。再開するには読み取りボタンを押してください。';};view.addEventListener('pagehide',hide);removers.push(()=>view.removeEventListener('pagehide',hide));}
 reset();unit();return Object.freeze({dispose(){if(disposed)return;disposed=true;reset();removers.forEach(fn=>fn());}});
}
if(typeof document!=='undefined')mountAerodromeQuotePage(document);
