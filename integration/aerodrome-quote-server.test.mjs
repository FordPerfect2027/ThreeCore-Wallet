import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../examples/dev-server.js';
import { quoteFixture,quoteRpc } from '../test/helpers/aerodrome-quote-fixture.js';
import { validateAerodromeQuote } from '../src/aerodrome-quote-model.js';
const input={agent:'DAT',direction:'sell',inputBaseUnits:quoteFixture().inputBaseUnits,slippageBps:50,blockNumber:null};
async function serve(fetchImpl){const server=createDemoServer({quoteFetch:fetchImpl});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;return {server,origin,post:(data=input,headers={})=>fetch(origin+'/rpc/aerodrome-quote',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)}),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}
test('ordinary quote page/module graph and fixed Base reader work; upstream implementation is not public',async()=>{
 const mock=quoteRpc(),s=await serve(mock.fetchImpl);try{const html=await (await fetch(s.origin+'/quotes/')).text();assert.match(html,/connect-src 'self'/);const todo=['/examples/aerodrome-quote-page.js'],seen=new Set();
  while(todo.length){const path=todo.pop();if(seen.has(path))continue;seen.add(path);const r=await fetch(s.origin+path);assert.equal(r.status,200,path);const text=await r.text();for(const m of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))todo.push(new URL(m[1],s.origin+path).pathname);}
  assert.equal((await fetch(s.origin+'/examples/aerodrome-quote-http.js')).status,404);const r=await s.post();assert.equal(r.status,200);const q=validateAerodromeQuote(await r.json());assert.equal(q.blockHash,quoteFixture().blockHash);assert.equal(mock.calls.length,23);
 }finally{await s.close();}
});
test('foreign origin, extra fields, injected methods, invalid numbers, oversized and invalid UTF-8 bodies cannot reach upstream',async()=>{
 let calls=0;const s=await serve(async()=>{calls++;throw Error();});try{
  for(const [data,headers,status]of [[input,{origin:'https://unrelated.invalid'},403],[input,{'sec-fetch-site':'cross-site'},403],[input,{'content-type':'text/plain'},403],[{...input,rpcUrl:'https://unrelated.invalid'},{},400],[{...input,method:'eth_sendTransaction'},{},400],[{...input,inputBaseUnits:'0'},{},400],[{...input,blockNumber:'01'},{},400],[{...input,slippageBps:10000},{},400],[{...input,agent:'x'.repeat(2000)},{},413]]){const r=await s.post(data,headers);assert.equal(r.status,status);await r.text();}
  const r=await fetch(s.origin+'/rpc/aerodrome-quote',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'},body:Uint8Array.from([0xff,0xfe])});assert.equal(r.status,400);await r.text();assert.equal(calls,0);
 }finally{await s.close();}
});
test('upstream errors are generic and partial quotes never leak',async()=>{
 const s=await serve(async()=>{throw Error('private transport detail');});try{const r=await s.post();assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'QUOTE_UNAVAILABLE'});}finally{await s.close();}
});
test('two simultaneous jobs are allowed; disconnect cancels upstream and releases capacity',async()=>{
 const signals=[],mock=quoteRpc();let held=true;const s=await serve(async(url,options)=>{if(!held)return mock.fetchImpl(url,options);signals.push(options.signal);return new Promise(()=>{});}),requests=[];
 try{for(let i=0;i<2;i++){const r=httpRequest(s.origin+'/rpc/aerodrome-quote',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'}});r.on('error',()=>{});r.end(JSON.stringify(input));requests.push(r);}
  for(let i=0;i<200&&signals.length<2;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(signals.length,2);const rejected=await s.post();assert.equal(rejected.status,429);await rejected.text();requests.forEach(r=>r.destroy());
  for(let i=0;i<200&&!signals.every(s=>s.aborted);i++)await new Promise(resolve=>setTimeout(resolve,5));assert(signals.every(s=>s.aborted));held=false;const r=await s.post();assert.equal(r.status,200);await r.text();
 }finally{requests.forEach(r=>r.destroy());await s.close();}
});
