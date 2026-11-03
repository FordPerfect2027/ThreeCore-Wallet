import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { usdcFixture } from './helpers/usdc-fixture.js';
import { requestPublicUsdc } from '../src/public-usdc-client.js';
import { mountPublicUsdcPage } from '../examples/public-usdc-page.js';
import { decodePublicUsdcFile,preparePublicUsdcFile } from '../src/public-usdc-model.js';
const request=()=>({account:usdcFixture().account,blockNumber:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error('TIMEOUT');await tick();}}
function setup(options={}){
 const elements=new Map(),downloads=[],view=new EventTarget();let calls=0;
 const document={defaultView:view,getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const get=name=>document.getElementById('usdc-'+name);get('account').value=usdcFixture().account;
 const page=mountPublicUsdcPage(document,{...options,read:async(...args)=>{calls++;return options.read?options.read(...args):usdcFixture();},download:args=>{if(options.download)return options.download(args,get);downloads.push(args.prepared);}});
 return{get,page,view,downloads,calls:()=>calls};
}
test('client restricts transport, binds account/height and rejects caller-selected networks or endpoints',async()=>{
 const result=await requestPublicUsdc(request(),{fetchImpl:async(url,options)=>{assert.equal(url,'/rpc/public-usdc');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return Response.json(usdcFixture());}});assert.equal(result.metadata.decimals,6);
 for(const change of [{account:'0x'+'22'.repeat(20)},{blockNumber:'43'}])await assert.rejects(requestPublicUsdc({...request(),...change},{fetchImpl:async()=>Response.json(usdcFixture())}),{code:'USDC_RESPONSE_CONTEXT'});
 let calls=0;const fetchImpl=()=>{calls++;throw Error();};
 for(const change of [{account:'secret'},{blockNumber:'01'},{chainId:8453},{rpcUrl:'https://evil.invalid'},{method:'eth_sendTransaction'}])await assert.rejects(requestPublicUsdc({...request(),...change},{fetchImpl}));
 const c=new AbortController();c.abort();await assert.rejects(requestPublicUsdc(request(),{fetchImpl,signal:c.signal}));assert.equal(calls,0);
});
test('client deadlines and cancellation stop a stalled fetch and stalled body',async()=>{
 for(const body of [false,true]){let signal;await assert.rejects(requestPublicUsdc(request(),{timeoutMs:10,fetchImpl:async(_url,options)=>{signal=options.signal;return body?new Response(new ReadableStream({start(){}})):new Promise(()=>{});}}));assert.equal(signal.aborted,true);}
 for(const response of [new Response('{'),new Response('failure',{status:503}),new Response('{}',{headers:{'content-length':'3000000'}}),Response.json({...usdcFixture(),chainId:1})])await assert.rejects(requestPublicUsdc(request(),{fetchImpl:async()=>response}));
});
test('screen reads only explicitly, shows exact balances, saves decodable source and rejects unnoticed context change',async()=>{
 const f=setup();assert.equal(f.calls(),0);assert.equal(f.get('save').disabled,true);f.get('read').click();await until(()=>!f.get('save').disabled);
 assert.equal(f.get('balance').textContent,'10 USDC');assert.equal(f.get('native').textContent,'0.01 ETH');f.get('save').click();assert.deepEqual((await decodePublicUsdcFile(f.downloads[0].text)).observation,usdcFixture());
 f.get('account').value='0x'+'22'.repeat(20);f.get('save').click();assert.equal(f.downloads.length,1);assert.equal(f.get('result').hidden,true);f.page.dispose();
});
test('editing, cancellation and leaving the page reject late reads and late checksums',async()=>{
 for(const action of ['account','block','cancel','pagehide','dispose','hash']){
  let release,signal;const options=action==='hash'?{prepare:(_o,{signal:s})=>{signal=s;return new Promise(r=>{release=r;});}}:{read:(_r,{signal:s})=>{signal=s;return new Promise(r=>{release=r;});}};
  const f=setup(options);f.get('read').click();await until(()=>!!release);
  if(action==='pagehide')f.view.dispatchEvent(new Event('pagehide'));else if(action==='dispose')f.page.dispose();else if(action==='cancel'||action==='hash')f.get('cancel').click();else f.get(action).dispatchEvent(new Event('input'));
  assert.equal(signal.aborted,true);release(action==='hash'?await preparePublicUsdcFile(usdcFixture()):usdcFixture());await tick();assert.equal(f.get('save').disabled,true);assert.equal(f.get('result').hidden,true);f.page.dispose();
 }
});
test('failure, wrong account and wrong height remain unavailable; explicit retry succeeds',async()=>{
 let mode='failure';const f=setup({read:async()=>{if(mode==='failure')throw Error();return usdcFixture(mode==='account'?{account:'0x'+'22'.repeat(20)}:mode==='height'?{blockNumber:'43'}:{});}});f.get('block').value='42';
 f.get('account').value='invalid';f.get('read').click();assert.equal(f.calls(),0);f.get('account').value=usdcFixture().account;
 for(mode of ['failure','account','height']){f.get('read').click();await until(()=>!f.get('read').disabled);assert.equal(f.get('save').disabled,true);}
 mode='success';f.get('read').click();await until(()=>!f.get('save').disabled);f.page.dispose();
});
test('failed download keeps a result; reentrant edits cannot report saved stale data',async()=>{
 let mode='failure';const f=setup({download(_args,get){if(mode==='failure')throw Error();get('account').dispatchEvent(new Event('input'));}});f.get('read').click();await until(()=>!f.get('save').disabled);
 f.get('save').click();assert.equal(f.get('save').disabled,false);assert.match(f.get('save-status').textContent,/結果は保持/);mode='change';f.get('save').click();assert.equal(f.get('save-status').textContent,'');f.page.dispose();
});
