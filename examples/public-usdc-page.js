import { requestPublicUsdc } from '../src/public-usdc-client.js';
import { validatePublicUsdcRequest } from '../src/public-usdc-request.js';
import { preparePublicUsdcFile,validatePublicUsdc } from '../src/public-usdc-model.js';
import { formatRehearsalUnits } from '../src/operation-rehearsal.js';
import { offerWalletDownload } from './export-download.js';
import { requireSyncExport } from '../src/export-policy.js';
export function mountPublicUsdcPage(document,{read=requestPublicUsdc,prepare=preparePublicUsdcFile,download=offerWalletDownload}={}){
 const get=name=>document.getElementById('usdc-'+name),removers=[];
 let revision=0,disposed=false,controller=null,prepared=null,savedRequest=null;
 const current=own=>!disposed&&own===revision;
 const request=()=>validatePublicUsdcRequest({account:get('account').value.trim(),blockNumber:get('block').value.trim()||null});
 function reset(){revision++;controller?.abort();controller=null;prepared=null;savedRequest=null;get('read').disabled=false;get('cancel').disabled=true;get('save').disabled=true;get('result').hidden=true;get('save-status').textContent='';}
 const listen=(name,event,action)=>{const handler=()=>{if(!disposed)return action();};get(name).addEventListener(event,handler);removers.push(()=>get(name).removeEventListener(event,handler));};
 for(const name of ['account','block'])for(const event of ['input','change'])listen(name,event,()=>{reset();get('status').textContent='入力が変わりました。もう一度読み取ってください。';});
 listen('read','click',async()=>{
  reset();const own=revision;let data;try{data=request();}catch{get('status').textContent='公開アドレスと整数のブロック番号を確認してください。';return;}
  const aborter=new AbortController();controller=aborter;get('read').disabled=true;get('cancel').disabled=false;get('status').textContent='USDCとETHを同じブロックから読み取っています。最大約2分です。';
  try{
   const o=validatePublicUsdc(await read(data,{signal:aborter.signal}));if(!current(own))return;
   if(o.account!==data.account||(data.blockNumber!==null&&o.blockNumber!==data.blockNumber)||JSON.stringify(request())!==JSON.stringify(data))throw Error('CONTEXT');
   const file=await prepare(o,{signal:aborter.signal});if(!current(own))return;
   get('account-result').textContent=o.account;get('block-result').textContent=o.blockNumber+' / '+o.blockHash;
   get('token').textContent=o.tokenAddress;get('balance').textContent=formatRehearsalUnits(o.balanceBaseUnits,6)+' USDC';get('native').textContent=formatRehearsalUnits(o.nativeBalanceBaseUnits,18)+' ETH';
   get('source').textContent='取得先：'+o.rpcUrl+'　同じブロックのハッシュを取得後も確認済み';
   prepared=file;savedRequest=data;get('result').hidden=false;get('save').disabled=false;get('status').textContent='USDCとETHの取得・情報照合が完了しました。保存できます。';
  }catch{if(current(own))get('status').textContent='取得できませんでした。途中の結果は採用していません。再試行できます。';}
  finally{aborter.abort();if(current(own)){controller=null;get('read').disabled=false;get('cancel').disabled=true;}}
 });
 listen('cancel','click',()=>{reset();get('status').textContent='読み取りを中止しました。';});
 listen('save','click',()=>{
  if(!prepared)return;const own=revision;
  try{if(JSON.stringify(request())!==JSON.stringify(savedRequest)){reset();get('status').textContent='入力が変わりました。もう一度読み取ってください。';return;}
   requireSyncExport(download({document,prepared}));if(current(own))get('save-status').textContent='保存を開始しました。保存先のファイルを確認してください。';
  }catch{if(current(own))get('save-status').textContent='保存できませんでした。結果は保持しています。';}
 });
 const view=document.defaultView;if(view?.addEventListener&&view?.removeEventListener){view.addEventListener('pagehide',reset);removers.push(()=>view.removeEventListener('pagehide',reset));}
 reset();return Object.freeze({dispose(){if(disposed)return;disposed=true;reset();removers.forEach(fn=>fn());}});
}
if(typeof document!=='undefined')mountPublicUsdcPage(document);
