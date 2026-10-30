import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { emptyPeriodLibrary } from "../src/period-library-model.js";
import { emptyReportHistory } from "../src/report-history-model.js";
import { deferred,tick,stalledFile } from "./helpers/file-boundary-fixtures.js";

const formats=[
  {name:"period-library",create:()=>createPeriodLibraryController({storage:{read:async()=>emptyPeriodLibrary(),change(){throw Error('unexpected write');},close(){}},getCheckpoint:()=>null,stageCheckpoint(){}})},
  {name:"report-history",create:()=>createReportHistoryController({storage:{read:async()=>emptyReportHistory(),change(){throw Error('unexpected write');},close(){}},getReport:()=>null,stageReport(){}})},
];
for(const format of formats){
  for(const stop of ["cancel","dispose"]){
    test(`${format.name}: ${stop} settles a blocked import before bytes return`,async()=>{
      const controller=format.create();await controller.refresh();const before=controller.state.document;
      const gate=deferred();let settled=false,reads=0;
      const file={name:"synthetic.json",size:1,arrayBuffer(){reads++;return gate.promise;}};
      const pending=controller.importFile(file).then(value=>{settled=true;return value;});
      try{
        await tick();assert.equal(reads,1);controller[stop]();await tick();
        assert.equal(settled,true);assert.equal(await pending,false);assert.equal(controller.state.document,before);
      }finally{gate.resolve(new Uint8Array([32]).buffer);await pending;controller.dispose();await tick();}
    });
  }
  test(`${format.name}: cancellation reaches an acquired stream`,async()=>{
    const controller=format.create();await controller.refresh();const input=stalledFile();
    input.file.arrayBuffer=async()=>{throw Error('unexpected fallback');};
    const pending=controller.importFile(input.file);
    try{
      await tick();assert.equal(input.calls.read,1);controller.cancel();await tick();
      assert.equal(input.calls.cancel,1);assert.equal(await pending,false);assert.equal(controller.state.review,null);
    }finally{input.settle();await pending;controller.dispose();await tick();}
  });
  test(`${format.name}: cancellation during filename capture prevents IO`,async()=>{
    const controller=format.create();await controller.refresh();let reads=0;
    const file={get name(){controller.cancel();return "synthetic.json";},size:1,arrayBuffer:async()=>{reads++;return new Uint8Array([32]).buffer;}};
    try{assert.equal(await controller.importFile(file),false);assert.equal(reads,0);}
    finally{controller.dispose();await tick();}
  });
}
