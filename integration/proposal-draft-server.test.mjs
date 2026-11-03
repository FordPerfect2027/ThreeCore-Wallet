import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../examples/dev-server.js';
test('draft screen and both old/new review module graphs are reachable under offline page policy',async()=>{
 const server=createDemoServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(origin+'/proposals/new/');assert.equal(response.status,200);const html=await response.text();assert.match(html,/connect-src 'none'/);assert.match(html,/operation-proposal-draft-page.js/);
  const todo=['/examples/operation-proposal-draft-page.js','/examples/operation-proposal-page.js'],seen=new Set();
  while(todo.length){const path=todo.pop();if(seen.has(path))continue;seen.add(path);const r=await fetch(origin+path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type'),/javascript/);const text=await r.text();for(const m of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(m[1].startsWith('.'))todo.push(new URL(m[1],origin+path).pathname);}
  assert(seen.size>15);assert.equal((await fetch(origin+'/proposals/new/',{headers:{origin:'https://unrelated.invalid'}})).status,403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
