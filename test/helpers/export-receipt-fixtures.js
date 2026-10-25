import { createReconciliationController } from "../../src/reconciliation-controller.js";
import { createPeriodController } from "../../src/period-controller.js";
import { createPeriodLibraryController } from "../../src/period-library-controller.js";
import { createPeriodReportController } from "../../src/period-report-controller.js";
import { createReportHistoryController } from "../../src/report-history-controller.js";
import { createReportSetController } from "../../src/report-set-controller.js";
import { createEncryptedLibraryController } from "../../src/encrypted-library-controller.js";
import { workspace, context } from "./reconciliation-fixtures.js";
import { memoryStorage as periodMemory, sampleLibrary, checkpoint, LATER } from "./period-library-fixtures.js";
import { reportLibrary, selection } from "./period-report-fixtures.js";
import { historyMemory, sampleHistory, reportInput } from "./report-history-fixtures.js";
import { sequenceHistory, AFTER } from "./report-set-fixtures.js";
import { memoryStorage as encryptedMemory, library } from "./encrypted-library-fixtures.js";

export const DELIVERY_CASES = ["reconciliation", "period", "period-library", "period-report",
  "report-history", "report-set", "encrypted-library"];
const requireTrue = value => { if (value !== true) throw Error("export fixture setup failed"); };

/** Production controllers with synthetic records; no provider or persistent storage. */
export async function exportReceiptFixture(name) {
  let controller, store, formats, send, setupAgain;
  if (name === "reconciliation") {
    controller = createReconciliationController({ initial: workspace() });
    requireTrue(controller.calculate());
    formats = ["json", "summary", "events", "text", "ledger", "windows"];
    send = (format, callback) => controller.exportFile(format, callback);
  } else if (name === "period") {
    controller = createPeriodController({ getContext: () => context(),
      read: () => { throw Error("fixture must not use a wallet"); } });
    requireTrue(controller.stageSaved(checkpoint(5), { requiresNewPlan: false }));
    requireTrue(controller.apply());
    formats = ["draft", "reconciliation", "text"];
    send = (format, callback) => controller.exportFile(format, callback);
  } else if (name === "period-library") {
    store = periodMemory(sampleLibrary());
    controller = createPeriodLibraryController({ storage: store.storage,
      getCheckpoint: () => ({ draft: checkpoint(3), requiresNewPlan: false }),
      stageCheckpoint: () => true, now: () => LATER });
    requireTrue(await controller.refresh());
    requireTrue(controller.select(store.document.entries[0].id));
    formats = ["all", "selected", "csv"];
    send = (format, callback) => controller.exportFile(format, callback);
  } else if (name === "period-report") {
    store = periodMemory(reportLibrary());
    controller = createPeriodReportController({ storage: store.storage, now: () => LATER });
    requireTrue(await controller.refresh());
    for (const [agent, value] of Object.entries(selection())) requireTrue(controller.select(agent, value));
    requireTrue(controller.prepare("Synthetic security verification"));
    requireTrue(await controller.applyReview());
    formats = ["json", "csv", "html"];
    send = (format, callback) => controller.exportFile(format, true, callback);
  } else if (name === "report-history") {
    store = historyMemory(sampleHistory());
    controller = createReportHistoryController({ storage: store.storage,
      getReport: () => reportInput(), stageReport: () => true, now: () => LATER });
    requireTrue(await controller.refresh());
    requireTrue(controller.select(store.document.entries[0].id));
    formats = ["backup", "selected", "csv"];
    send = (format, callback) => controller.exportFile(format, true, callback);
  } else if (name === "report-set") {
    store = historyMemory(sequenceHistory());
    controller = createReportSetController({ storage: store.storage, now: () => AFTER });
    requireTrue(await controller.refresh());
    requireTrue(controller.select(store.document.entries.map(entry => entry.id)));
    requireTrue(controller.prepare("Synthetic security verification"));
    requireTrue(await controller.applyReview());
    formats = ["json", "html", "csv"];
    send = (format, callback) => controller.exportFile(format, true, callback);
  } else if (name === "encrypted-library") {
    store = encryptedMemory(await library([1]));
    controller = createEncryptedLibraryController({ storage: store });
    requireTrue(await controller.load());
    requireTrue(controller.select(controller.state().summary.entries[0].id));
    setupAgain = async format => requireTrue(await (format === "selected" ?
      controller.prepareExport() : controller.prepareArchive()));
    formats = ["selected", "archive"];
    send = async (format, callback) => { await setupAgain(format); return controller.offer(callback); };
  } else throw Error("unknown export fixture");
  return { controller, store, formats, send,
    state: () => typeof controller.state === "function" ? controller.state() : controller.state,
    source: () => JSON.stringify(store ? (store.snapshot ? store.snapshot() : store.document) :
      (controller.state.workspace ?? controller.state.draft)),
    dispose: () => controller.dispose(),
    cancel: () => controller.cancel(),
  };
}
