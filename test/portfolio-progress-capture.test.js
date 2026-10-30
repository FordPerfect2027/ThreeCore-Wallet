import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioProgressTracker } from '../src/portfolio-progress.js';
const A='0x'+'11'.repeat(20), B='0x'+'22'.repeat(20);
const event=(stage='block',n=0)=>({stage,completedTokens:n,totalTokens:1,tokenIndex:null,tokenAddress:null});
test('progress captures event descriptors without reading proxy values',()=>{
  let reads=0;const input=new Proxy(event(),{get(){reads++;throw Error('value trap');}});
  const result=createPortfolioProgressTracker([A]).accept(input);
  assert.equal(result.stage,'block');assert.equal(reads,0);
});
test('progress captures each event field once even if direct reads disagree',()=>{
  const input=new Proxy(event(),{get(target,key){return key==='completedTokens'?9000:Reflect.get(target,key);}});
  const result=createPortfolioProgressTracker([A]).accept(input);
  assert.equal(result.completedTokens,0);assert.equal(result.totalTokens,1);
});
test('progress captures plan length without direct array reads',()=>{
  let reads=0;const input=new Proxy([A],{get(){reads++;throw Error('array trap');}});
  const tracker=createPortfolioProgressTracker(input);
  assert.equal(tracker.accept(event()).totalTokens,1);assert.equal(reads,0);
});
test('progress rejects augmented arrays instead of ignoring extra plan fields',()=>{
  const input=[A];input.extra=B;
  assert.throws(()=>createPortfolioProgressTracker(input),{code:'INVALID_PORTFOLIO_PROGRESS'});
});
test('progress reentrant event capture cannot advance a stale outer event',()=>{
  const tracker=createPortfolioProgressTracker([A]);let armed=true;
  const input=new Proxy(event('native'),{getOwnPropertyDescriptor(target,key){
    if(armed){armed=false;tracker.accept(event());}return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.throws(()=>tracker.accept(input),{code:'INVALID_PORTFOLIO_PROGRESS'});
  assert.equal(tracker.accept(event('native')).stage,'native');
});
test('progress rejection does not consume the next valid event',()=>{
  const tracker=createPortfolioProgressTracker([A]);tracker.accept(event());
  assert.throws(()=>tracker.accept(event('complete',1)),{code:'INVALID_PORTFOLIO_PROGRESS'});
  assert.equal(tracker.accept(event('native')).stage,'native');
});
