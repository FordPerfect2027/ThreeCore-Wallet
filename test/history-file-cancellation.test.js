import test from "node:test";
import assert from "node:assert/strict";
import { createTransferController } from "../src/transfer-controller.js";
import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { createPeriodController } from "../src/period-controller.js";
import { controllerFixture } from "./helpers/vault-fixtures.js";
import { context, snapshot, deferred, tick } from "./helpers/transfer-fixtures.js";
import { stalledFile } from "./helpers/file-boundary-fixtures.js";

const formats=[
  {name:"transfer",create:()=>createTransferController({getContext:context,read:async()=>snapshot()}),start:(c,f)=>c.stageFile(f)},
  {name:"archive",create:()=>createTransferArchiveController({getContext:context}),start:(c,f)=>c.stage(f)},
  {name:"vault",create:()=>controllerFixture().controller,start:(c,f)=>c.load(f)},
  {name:"vault-legacy-archive",create:()=>controllerFixture().controller,start:(c,f)=>c.loadLegacy(f,"archive","DAT")},
  {name:"vault-legacy-snapshot",create:()=>controllerFixture().controller,start:(c,f)=>c.loadLegacy(f,"snapshot","DAT")},
  {name:"vault-collection",create:()=>controllerFixture().controller,prepare:c=>c.refresh(),start:(c,f)=>c.loadCollection(f)},
  {name:"reconciliation",create:()=>createReconciliationController(),start:(c,f)=>c.importFile(f,"workspace")},
  {name:"period",create:()=>createPeriodController({getContext:context,read:async()=>null}),start:(c,f)=>c.importFile(f)},
];
for(const format of formats){
  test(`${format.name}: cancellation reaches an acquired file stream`,async()=>{
    const controller=format.create();if(format.prepare)await format.prepare(controller);
    const input=stalledFile();let fallbackReads=0;
    input.file.arrayBuffer=async()=>{fallbackReads++;return new ArrayBuffer(0);};
    const pending=format.start(controller,input.file);
    try{
      await tick();assert.equal(input.calls.read,1);controller.cancel();await tick();
      assert.equal(input.calls.cancel,1);assert.equal(await pending,false);assert.equal(fallbackReads,0);
    }finally{input.settle();await pending;controller.dispose();await tick();}
  });
  for(const stop of ["cancel","dispose"]){
    test(`${format.name}: ${stop} settles the import before an underlying file promise resolves`,async()=>{
      const controller=format.create();if(format.prepare)await format.prepare(controller);
      const gate=deferred();let reads=0,settled=false;
      const file={name:"synthetic.json",size:1,arrayBuffer(){reads++;return gate.promise;}};
      const pending=format.start(controller,file).then(value=>{settled=true;return value;});
      try{
        await tick();assert.equal(reads,1);
        controller[stop]();await tick();
        assert.equal(settled,true,"The view kept waiting for bytes after cancellation");
        assert.equal(await pending,false);
      }finally{
        gate.resolve(new Uint8Array([32]).buffer);await pending;controller.dispose();await tick();
      }
    });
  }
  test(`${format.name}: cancellation during filename validation prevents file IO`,async()=>{
    const controller=format.create();if(format.prepare)await format.prepare(controller);
    let reads=0;
    const file={get name(){controller.cancel();return "synthetic.json";},size:1,arrayBuffer:async()=>{reads++;return new Uint8Array([32]).buffer;}};
    try{assert.equal(await format.start(controller,file),false);assert.equal(reads,0);}
    finally{controller.dispose();await tick();}
  });
}
