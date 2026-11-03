import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";

test("proposal comparison serves complete offline module graph without exposing local inputs",async()=>{
  const server=createDemoServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin="http://127.0.0.1:"+server.address().port;
  try{
    const response=await fetch(origin+"/proposals/");assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    const html=await response.text();assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);assert.match(html,/現在の時刻で照合する/);
    assert.match(await(await fetch(origin+"/budget/evidence/")).text(),/href="\/proposals\/"/);
    const pending=["/examples/operation-proposal-page.js"],visited=new Set();
    while(pending.length){
      const path=pending.pop();if(visited.has(path))continue;visited.add(path);assert(visited.size<60);
      const file=await fetch(origin+path);assert.equal(file.status,200,path);assert.match(file.headers.get("content-type"),/text\/javascript/);
      for(const match of (await file.text()).matchAll(/from\s+["']([^"']+)["']/g)){const url=new URL(match[1],origin+path);assert.equal(url.origin,origin);pending.push(url.pathname);}
    }
    assert(visited.has("/src/operation-proposal-file.js"));assert(visited.has("/src/operation-budget-evidence.js"));assert(visited.has("/src/security-file.js"));
    for(const path of ["/proposals/.env","/proposals/review.json","/test/helpers/proposal-fixtures.js","/scripts/check-operation-proposal.js"])assert.equal((await fetch(origin+path)).status,404,path);
    assert.equal((await fetch(origin+"/proposals/",{method:"POST",body:"{}"})).status,404);
    assert.equal((await fetch(origin+"/proposals/",{headers:{origin:"https://other.invalid"}})).status,403);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
