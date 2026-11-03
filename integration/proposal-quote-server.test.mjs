import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from '../examples/dev-server.js';
test('quote review page and complete static module import graph load under offline CSP; no quote endpoint exists',async()=>{
 const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 try{const html=await (await fetch(origin+'/proposals/quote/')).text();assert.match(html,/connect-src 'none'/);assert.match(html,/proposal-quote-page.js/);
  const todo=['/examples/proposal-quote-page.js'],seen=new Set();while(todo.length){const path=todo.pop();if(seen.has(path))continue;seen.add(path);const response=await fetch(origin+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/javascript/);const text=await response.text();
   for(const match of text.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(match[1].startsWith('.'))todo.push(new URL(match[1],origin+path).pathname);}
  }
  assert(seen.size>10);assert.equal((await fetch(origin+'/rpc/aerodrome-quote')).status,404);assert.equal((await fetch(origin+'/proposals/quote/',{headers:{origin:'https://unrelated.invalid'}})).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
