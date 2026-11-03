import test from "node:test";
import assert from "node:assert/strict";
import { createTransferController } from "../src/transfer-controller.js";
import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { createPeriodController } from "../src/period-controller.js";
import { preparePeriodFile } from "../src/period-file.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { emptyPeriodLibrary } from "../src/period-library-model.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { emptyReportHistory } from "../src/report-history-model.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { context, snapshot, REQUEST } from "./helpers/transfer-fixtures.js";
import { controllerFixture } from "./helpers/vault-fixtures.js";
import { checkpoint, context as periodContext } from "./helpers/period-fixtures.js";
import { reportInput } from "./helpers/period-report-fixtures.js";
import { sequenceSet } from "./helpers/report-set-fixtures.js";
import { deferred, tick } from "./helpers/file-boundary-fixtures.js";

const storage = value => ({ read: async () => value, change() { throw Error("unexpected write"); }, close() {} });
const formats = [
  { name: "transfer", create: async subtle => { const c=createTransferController({getContext:context,read:async()=>snapshot(),subtle}); assert.equal(await c.inspect(REQUEST),true); return c; }, start:c=>c.prepare(), cancelled:null },
  { name: "archive", create: async subtle => { const c=createTransferArchiveController({getContext:context,subtle}); assert.equal(c.add(snapshot()),true); return c; }, start:c=>c.prepare(), cancelled:null },
  { name: "vault", create: async subtle => { const f=controllerFixture({subtle}); await f.capture(); return f.controller; }, start:c=>c.prepare(), cancelled:null },
  { name: "vault collection", create: async subtle => { const f=controllerFixture({subtle}); await f.capture(); await f.save(); return f.controller; }, start:c=>c.prepareCollection(), cancelled:null },
  { name: "reconciliation", create: async subtle => createReconciliationController({prepareFile:(value,options)=>prepareReconciliationFile(value,{...options,subtle})}), start:(c,deliver)=>c.exportFile("json",deliver), cancelled:false },
  { name: "period", create: async subtle => { const c=createPeriodController({getContext:periodContext,read:async()=>null,prepareFile:(value,options)=>preparePeriodFile(value,{...options,subtle})}); assert.equal(c.stageSaved(checkpoint(5),{requiresNewPlan:false}),true); assert.equal(c.apply(),true); return c; }, start:(c,deliver)=>c.exportFile("draft",deliver), cancelled:false },
  { name: "library", create: async subtle => { const c=createPeriodLibraryController({storage:storage(emptyPeriodLibrary()),getCheckpoint:()=>null,stageCheckpoint:()=>true,prepareFile:(value,options)=>preparePeriodLibraryFile(value,{...options,subtle})}); await c.refresh(); return c; }, start:(c,deliver)=>c.exportFile("all",deliver), cancelled:false },
  { name: "report history", create: async subtle => { const c=createReportHistoryController({storage:storage(emptyReportHistory()),getReport:()=>null,stageReport:()=>true,prepareFile:(value,options)=>prepareReportHistoryFile(value,{...options,subtle})}); await c.refresh(); return c; }, start:(c,deliver)=>c.exportFile("backup",true,deliver), cancelled:false },
  { name: "period report", create: async subtle => { const c=createPeriodReportController({storage:storage(emptyPeriodLibrary()),prepareFile:(value,options)=>preparePeriodReportFile(value,{...options,subtle})}); assert.equal(c.stageHistory(reportInput()),true); assert.equal(await c.applyReview(),true); return c; }, start:(c,deliver)=>c.exportFile("json",true,deliver), cancelled:false },
  { name: "report set", create: async subtle => { const c=createReportSetController({storage:storage(emptyReportHistory()),readFile:async()=>({input:sequenceSet(),checksumVerified:false}),prepareFile:(value,options)=>prepareReportSetFile(value,{...options,subtle})}); assert.equal(await c.importFile({}),true); assert.equal(await c.applyReview(),true); return c; }, start:(c,deliver)=>c.exportFile("json",true,deliver), cancelled:false },
];
for (const format of formats) {
  for (const action of ["cancel", "dispose"]) {
    test(`${format.name}: ${action} ends output preparation before crypto settles`, async () => {
      const gate=deferred(), started=deferred(); let settled=false, deliveries=0;
      const c=await format.create({digest(){started.resolve();return gate.promise;}});
      const pending=format.start(c,()=>{deliveries++;return true;}).then(value=>{settled=true;return value;});
      try {
        await started.promise; c[action](); await tick();
        assert.equal(settled,true); assert.equal(await pending,format.cancelled); assert.equal(deliveries,0);
      } finally { gate.resolve(new ArrayBuffer(32)); await pending; c.dispose(); await tick(); }
    });
  }
}
