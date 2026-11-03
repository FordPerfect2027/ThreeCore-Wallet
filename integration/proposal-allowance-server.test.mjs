import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createDemoServer } from '../examples/dev-server.js';
import { allowanceFixture,allowanceRpc } from '../test/helpers/proposal-allowance-fixture.js';
async function serve(fetchImpl) { const server=createDemoServer({allowanceFetch:fetchImpl});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;return {origin,post:(data,headers={})=>fetch(origin+'/rpc/proposal-allowance',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(data)}),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}}; }
test('allowance screen and complete browser module graph load, reader remains private and endpoint reads canonical state',async()=>{
 const f=await allowanceFixture({buy:true}),rpc=allowanceRpc(f.observation),s=await serve(rpc.fetchImpl);
 try {
  const page=await fetch(s.origin+'/proposals/allowance/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/connect-src 'self'/);
  const todo=['/examples/proposal-allowance-page.js'],seen=new Set();while(todo.length){const path=todo.pop();if(seen.has(path))continue;seen.add(path);const r=await fetch(s.origin+path);assert.equal(r.status,200,path);const text=await r.text();for(const m of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))todo.push(new URL(m[1],s.origin+path).pathname);}
  assert(seen.size>20);assert.equal((await fetch(s.origin+'/src/proposal-allowance-reader.js')).status,404);
  const response=await s.post(f.request);assert.equal(response.status,200);assert.equal((await response.json()).allowanceBaseUnits,f.observation.allowanceBaseUnits);assert.equal(rpc.calls.length,9);
 } finally { await s.close(); }
});
test('external origin, duplicate keys, invalid UTF8, extra RPC/contract fields and oversized bodies make no upstream calls',async()=>{
 const f=await allowanceFixture();let calls=0;const s=await serve(async()=>{calls++;throw Error();});
 try {
  for(const [data,headers,status]of [[f.request,{origin:'http://evil.invalid'},403],[f.request,{'sec-fetch-site':'cross-site'},403],[f.request,{'content-type':'text/plain'},403],[{...f.request,rpcUrl:'https://invalid'},{},400],[{...f.request,spenderAddress:'0x'+'11'.repeat(20)},{},400],[{...f.request,blockHash:'x'.repeat(2000)},{},413]]){const r=await s.post(data,headers);assert.equal(r.status,status);await r.text();}
  for(const body of ['{"agent":"DAT","agent":"EMA"}',new Uint8Array([255])]){const r=await fetch(s.origin+'/rpc/proposal-allowance',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'},body});assert.equal(r.status,400);await r.text();}assert.equal((await fetch(s.origin+'/rpc/proposal-allowance')).status,403);assert.equal(calls,0);
 } finally { await s.close(); }
});
test('two active jobs limit concurrency, disconnect releases capacity and errors reveal no transport details',async()=>{
 const f=await allowanceFixture(),rpc=allowanceRpc(f.observation),signals=[],jobs=[];let mode='hold';const s=await serve(async(u,o)=>{if(mode==='ok')return rpc.fetchImpl(u,o);if(mode==='error')throw Error('PRIVATE');signals.push(o.signal);return new Promise(()=>{});});
 try {
  for(let i=0;i<2;i++){const r=httpRequest(s.origin+'/rpc/proposal-allowance',{method:'POST',headers:{origin:s.origin,'content-type':'application/json'}});r.on('error',()=>{});r.end(JSON.stringify(f.request));jobs.push(r);}
  for(let i=0;i<200&&signals.length<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(signals.length,2);const limited=await s.post(f.request);assert.equal(limited.status,429);await limited.text();jobs.forEach(j=>j.destroy());
  for(let i=0;i<100&&!signals.every(s=>s.aborted);i++)await new Promise(r=>setTimeout(r,5));assert(signals.every(s=>s.aborted));mode='ok';const good=await s.post(f.request);assert.equal(good.status,200);await good.text();mode='error';const bad=await s.post(f.request);assert.equal(bad.status,502);assert.deepEqual(await bad.json(),{error:'ALLOWANCE_UNAVAILABLE'});
 } finally { jobs.forEach(j=>j.destroy());await s.close(); }
});
