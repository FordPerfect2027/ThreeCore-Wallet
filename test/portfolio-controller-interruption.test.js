import test from 'node:test';import assert from 'node:assert/strict';import {getEventListeners} from 'node:events';
import {createPortfolioController} from '../src/portfolio-controller.js';
const result=label=>Object.freeze({readOnly:true,securityAudit:false,holdings:Object.freeze([]),label});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function settles(promise){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve('still-waiting'),200);})]);}finally{clearTimeout(timer);}}
for(const action of ['cancel','clear','dispose','replace','external'])test('portfolio controller releases its local pending wait on '+action,async()=>{
 const gate=deferred(),external=new AbortController();let calls=0,signal;const c=createPortfolioController({reader(_session,options){signal=options.signal;return ++calls===1?gate.promise:Promise.resolve(result('new'));}});
 const pending=c.refresh({}, {signal:external.signal});try{
  if(action==='external')external.abort();else if(action==='replace')await c.refresh({});else c[action]();
  assert.deepEqual(await settles(pending),{accepted:false,result:null});assert.equal(getEventListeners(external.signal,'abort').length,0);
  const current=c.state;gate.resolve(result('late'));await pending;await new Promise(r=>setTimeout(r,0));assert.equal(c.state,current);if(action!=='replace')assert.equal(signal.aborted,true);
 }finally{gate.resolve(result('cleanup'));await pending.catch(()=>{});c.dispose();}
});
for(const field of ['aborted','addEventListener','removeEventListener'])test('portfolio controller ignores signal instance override '+field,async()=>{
 const external=new AbortController();let gets=0,reads=0;Object.defineProperty(external.signal,field,{get(){gets++;throw Error('private override');}});const c=createPortfolioController({reader:async()=>{reads++;return result('ok');}});
 try{assert.equal((await c.refresh({}, {signal:external.signal})).accepted,true);assert.equal(gets,0);assert.equal(reads,1);assert.equal(getEventListeners(external.signal,'abort').length,0);}finally{c.dispose();}
});
test('portfolio controller checks native pre-cancellation before reader invocation',async()=>{
 const external=new AbortController();external.abort();Object.defineProperty(external.signal,'aborted',{value:false});let reads=0;const c=createPortfolioController({reader:async()=>{reads++;return result('wrong');}});
 try{assert.equal((await c.refresh({}, {signal:external.signal})).accepted,false);assert.equal(reads,0);assert.equal(c.state.status,'cancelled');}finally{c.dispose();}
});
test('portfolio loading observer cancellation prevents even a custom reader call',async()=>{
 const external=new AbortController();let reads=0;const c=createPortfolioController({reader:async()=>{reads++;return result('wrong');}});c.subscribe(state=>{if(state.status==='loading')external.abort();});
 try{assert.equal((await c.refresh({}, {signal:external.signal})).accepted,false);assert.equal(reads,0);assert.equal(c.state.status,'cancelled');}finally{c.dispose();}
});
test('portfolio artificial abort event cannot stop a read or consume genuine cancellation',async()=>{
 const external=new AbortController(),gate=deferred();let signal;const c=createPortfolioController({reader(_session,options){signal=options.signal;return gate.promise;}}),pending=c.refresh({}, {signal:external.signal});
 try{external.signal.dispatchEvent(new Event('abort'));assert.equal(signal.aborted,false);assert.equal(c.state.status,'loading');external.abort();assert.equal(signal.aborted,true);assert.deepEqual(await settles(pending),{accepted:false,result:null});assert.equal(getEventListeners(external.signal,'abort').length,0);}finally{gate.resolve(result('late'));await pending.catch(()=>{});c.dispose();}
});
test('portfolio ready observer cancellation cannot return an accepted snapshot',async()=>{
 const external=new AbortController(),c=createPortfolioController({reader:async()=>result('obsolete')});c.subscribe(state=>{if(state.status==='ready')external.abort();});
 try{assert.equal((await c.refresh({}, {signal:external.signal})).accepted,false);assert.equal(c.state.status,'cancelled');assert.equal(c.state.result,null);}finally{c.dispose();}
});
for(const kind of ['prototype','proxy','revoked'])test('invalid native signal '+kind+' preserves existing ready state',async()=>{
 const c=createPortfolioController({reader:async()=>result('kept')});try{await c.refresh({});const previous=c.state;let signal;
  if(kind==='prototype')signal=Object.create(AbortSignal.prototype);else{const r=Proxy.revocable(Object.create(AbortSignal.prototype),{});if(kind==='revoked')r.revoke();signal=r.proxy;}
  await assert.rejects(c.refresh({}, {signal}),TypeError);assert.equal(c.state,previous);
 }finally{c.dispose();}
});
test('reader rewriting its received signal cannot hide cancellation',async()=>{
 const gate=deferred(),external=new AbortController(),c=createPortfolioController({reader(_session,{signal}){Object.defineProperty(signal,'aborted',{value:false});return gate.promise;}}),pending=c.refresh({}, {signal:external.signal});
 try{external.abort();assert.deepEqual(await settles(pending),{accepted:false,result:null});assert.equal(c.state.status,'cancelled');}finally{gate.resolve(result('late'));await pending.catch(()=>{});c.dispose();}
});
for(const outcome of ['resolve','reject'])test('cancelled waiter observes late reader '+outcome+' without a stale result',async()=>{
 const gate=deferred(),external=new AbortController(),c=createPortfolioController({reader:()=>gate.promise}),pending=c.refresh({}, {signal:external.signal});
 try{c.cancel();assert.deepEqual(await settles(pending),{accepted:false,result:null});assert.equal(getEventListeners(external.signal,'abort').length,0);const state=c.state;gate[outcome](outcome==='resolve'?result('late'):Error('late rejection'));await new Promise(r=>setTimeout(r,10));assert.equal(c.state,state);}finally{gate.resolve(result('cleanup'));await pending;c.dispose();}
});
