import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointController } from '../src/checkpoint-controller.js';
import { stored, preparedDraft, id, TIME } from './helpers/checkpoint-fixtures.js';
import { draft } from './helpers/workspace-fixtures.js';

for(const action of ['inspect','exportFile','exportCollection','stage']) test(`checkpoint ${action} checks the captured storage revision`,async()=>{
  const original=stored(1,(await preparedDraft()).text);let stale=false,downloads=0,stages=0;
  const different={...original,revision:2};
  const proxy=new Proxy(different,{get(target,key){return key==='revision'?1:Reflect.get(target,key);}});
  const controller=createCheckpointController({storage:{read:async()=>stale?proxy:original,change(){throw Error('unexpected write');},close(){}},
    readDraft:draft,onStage(){stages++;},download(){downloads++;},now:()=>TIME,createId:()=>id(2)});
  try{
    await controller.refresh();controller.select(id(1));if(action==='stage')await controller.inspect();
    stale=true;assert.equal(await controller[action](),false);
    assert.equal(controller.state().errorCode,'CHECKPOINT_STALE');
    assert.equal(downloads,0);assert.equal(stages,0);assert.equal(controller.state().metadata,null);
  }finally{controller.dispose();}
});
