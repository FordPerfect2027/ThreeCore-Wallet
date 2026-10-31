import test from "node:test";
import assert from "node:assert/strict";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import * as h from "./helpers/report-history-fixtures.js";
import * as l from "./helpers/period-library-fixtures.js";

function fixture(kind, { onChange = () => {}, beforeRead = () => {} } = {}) {
  const store = kind === "history" ? h.historyMemory(h.sampleHistory(), { beforeRead }) : l.memoryStorage(l.sampleLibrary(), { beforeRead });
  const options = { storage: store.storage, onChange };
  const controller = kind === "history" ? createReportHistoryController({ ...options, getReport: () => h.reportInput(), stageReport: () => false }) :
    createPeriodLibraryController({ ...options, getCheckpoint: () => ({ draft: l.checkpoint(3), requiresNewPlan: false }), stageCheckpoint: () => false });
  const files = [];
  return { controller, store, files,
    load: () => controller.refresh(),
    export(query, kindOverride = "csv") { return kind === "history" ? controller.exportFile(kindOverride, true, file => { files.push(file); }, query) : controller.exportFile(kindOverride, file => { files.push(file); }, query); },
    prepare() { controller.select(kind === "history" ? h.id(101) : l.id(1)); return kind === "history" ? controller.prepareOpen() : controller.prepareRestore(); },
    dispose: () => controller.dispose(),
  };
}

for (const kind of ["history", "library"]) {
  test(kind + " CSV fixes the selected archive scope before export observers run", async () => {
    const query = { archive: "active" }, f = fixture(kind, { onChange: state => { if (state.phase === "exporting") query.archive = "all"; } });
    try {
      await f.load(); const before = JSON.stringify(f.store.document);
      assert.equal(await f.export(query), true); assert.equal(query.archive, "all");
      assert.equal(f.files[0].rows, 3); assert.equal(JSON.stringify(f.store.document), before);
      assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0);
    } finally { f.dispose(); }
  });

  test(kind + " CSV fixes all query operands while a fresh storage read is pending", async () => {
    const hold = h.deferred(); let reads = 0;
    const query = { archive: "active", agent: "EMA", search: "", order: "oldest" };
    const f = fixture(kind, { beforeRead: () => { if (++reads > 1) return hold.promise; } });
    try {
      await f.load(); const operation = f.export(query);
      query.archive = "all"; query.agent = "all"; query.search = "no match"; query.order = "name";
      hold.resolve(); assert.equal(await operation, true);
      assert.equal(f.files[0].rows, kind === "history" ? 3 : 1);
    } finally { hold.resolve(); f.dispose(); }
  });

  test(kind + " invalid CSV scope does not read storage or clear a pending review", async () => {
    const f = fixture(kind);
    try {
      await f.load(); assert.equal(f.prepare(), true); const review = f.controller.state.review, reads = f.store.calls.length;
      assert.equal(await f.export({ archive: "deleted" }), false);
      assert.equal(f.store.calls.length, reads); assert.equal(f.controller.state.review, review); assert.equal(f.files.length, 0);
      assert.equal(f.controller.state.error, kind === "history" ? "PERIOD_HISTORY_QUERY" : "PERIOD_LIBRARY_QUERY");
    } finally { f.dispose(); }
  });

  test(kind + " CSV rejects a query accessor before any IO without executing it", async () => {
    const f = fixture(kind); let invoked = 0;
    try {
      await f.load(); const reads = f.store.calls.length;
      assert.equal(await f.export({ get archive() { invoked++; return "all"; } }), false);
      assert.equal(invoked, 0); assert.equal(f.store.calls.length, reads); assert.equal(f.files.length, 0);
    } finally { f.dispose(); }
  });

  test(kind + " cancellation or disposal during reflective query capture cannot start an export", async () => {
    for (const operation of ["cancel", "dispose"]) {
      const f = fixture(kind); let stopped = false;
      try {
        await f.load(); const reads = f.store.calls.filter(row => row[0] === "read").length;
        const query = new Proxy({ archive: "active" }, { ownKeys(target) { if (!stopped) { stopped = true; f.controller[operation](); } return Reflect.ownKeys(target); } });
        assert.equal(await f.export(query), false); assert.equal(f.files.length, 0);
        assert.equal(f.store.calls.filter(row => row[0] === "read").length, reads);
        assert.equal(f.controller.state.busy, false);
        if (operation === "dispose") assert.equal(f.controller.state.phase, "disposed");
      } finally { f.dispose(); }
    }
  });

  test(kind + " non-CSV backups ignore unused filter objects", async () => {
    const f = fixture(kind); let invoked = 0;
    try {
      await f.load(); const query = new Proxy({}, { ownKeys() { invoked++; throw Error("Unused"); } });
      assert.equal(await f.export(query, kind === "history" ? "backup" : "all"), true);
      assert.equal(invoked, 0); assert.equal(f.files.length, 1);
    } finally { f.dispose(); }
  });
}
