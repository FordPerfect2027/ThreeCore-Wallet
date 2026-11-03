import test from 'node:test';import assert from 'node:assert/strict';import {checkBrowserModuleRoutes,browserModuleDependencies} from '../scripts/browser-module-preflight.js';import {createDemoServer} from '../examples/dev-server.js';
const reply=(text,type='text/javascript; charset=utf-8',status=200)=>new Response(text,{status,headers:{'Content-Type':type}});
test('preflight resolves static multiline, relative and export dependencies once without executing source',async()=>{
 const calls=[],source=new Map([['/test/browser/ui-tests.js',`import { a,\n b } from '/src/a.js';\nimport './b.js';\nimport('/src/a.js');\nthrow Error('must not execute');`],['/test/browser/b.js',`export {a} from '../../src/a.js';`],['/src/a.js','']]);const result=await checkBrowserModuleRoutes('http://127.0.0.1:12345/',{fetcher:async(url,options)=>{const path=new URL(url).pathname;calls.push(path);assert.equal(options.redirect,'error');return reply(source.get(path));}});assert.equal(result.modules,3);assert.equal(calls.length,3);assert.deepEqual(browserModuleDependencies('import value from "./a.js"; import("./b.js");'),['./a.js']);assert.deepEqual(browserModuleDependencies('test("cannot import " + agent + "",()=>{});'),[]);
});
test('a missing or wrongly typed module fails before any browser can launch',async()=>{
 for(const response of [()=>reply('Not found','text/plain',404),()=>reply('<html></html>','text/html')])await assert.rejects(checkBrowserModuleRoutes('http://127.0.0.1:12345/',{fetcher:async()=>response()}),/Browser module unavailable/);
});
test('preflight never requests nonloopback origins, cross-origin imports or RPC routes',async()=>{
 let calls=0;for(const origin of ['https://example.com/','http://localhost:12345/','http://127.0.0.1:12345/path'])await assert.rejects(checkBrowserModuleRoutes(origin,{fetcher:()=>{calls++;}}),/Expected isolated/);assert.equal(calls,0);
 for(const specifier of ['https://example.com/script.js','//example.com/script.js','/rpc/base-mainnet','node:fs']){const requested=[];await assert.rejects(checkBrowserModuleRoutes('http://127.0.0.1:12345/',{fetcher:async url=>{requested.push(url);return reply('import "'+specifier+'";');}}));assert.equal(requested.length,1);}
});
test('the actual isolated test server serves the static startup UI dependency graph',async()=>{
 const server=createDemoServer({uiTest:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});try{const result=await checkBrowserModuleRoutes('http://127.0.0.1:'+server.address().port+'/');assert(result.modules>100&&result.modules<512);assert(result.bytes>100000);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
