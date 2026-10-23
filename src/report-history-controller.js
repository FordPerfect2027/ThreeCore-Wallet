import { periodFail } from "./period-plan.js";
import { libraryId, libraryLabel, libraryTime } from "./period-library-model.js";
import { validatePeriodReportInput, periodReportInputKey } from "./period-report-model.js";
import { comparePeriodReports, periodReportComparisonText } from "./period-report-comparison.js";
import { emptyReportHistory, validateReportHistory, validateHistoryEntry, historyEntry,
  historyNote, historyTags, planHistoryMerge, mutateReportHistory } from "./report-history-model.js";
import { prepareReportHistoryFile, readReportHistoryFile } from "./report-history-file.js";
import { preparePeriodReportFile } from "./period-report-file.js";
import { reportHistoryCSV } from "./report-history-query.js";
import { historyErrorCode } from "./report-history-view.js";
import { inspectReportSources } from "./report-history-sources.js";
import { inspectReportContinuity } from "./report-history-continuity.js";

/** No wallet dependency: this controller operates only on previously captured evidence. */
export function createReportHistoryController({ storage, getReport, stageReport, readSources = null, onChange = () => {},
  now = () => new Date().toISOString(), createId = () => crypto.randomUUID(),
  readFile = readReportHistoryFile, prepareFile = prepareReportHistoryFile } = {}) {
  if (!storage || ![storage.read, storage.change, storage.close, getReport, stageReport,
    onChange, now, createId, readFile, prepareFile].every(value => typeof value === "function")) periodFail("PERIOD_HISTORY_OPTIONS");
  if (readSources !== null && typeof readSources !== "function") periodFail("PERIOD_HISTORY_OPTIONS");
  let document = emptyReportHistory(), loaded = false, selectedId = null, baselineId = null;
  let review = null, comparison = null, sourceInspection = null, phase = "idle", error = null, disposed = false;
  let message = "報告履歴は、読み込む操作をしたときにだけPC内から取得します。";
  let generation = 0, aborter = null;
  const busy = () => ["loading", "saving", "opening", "importing", "exporting", "inspecting"].includes(phase);
  const state = () => Object.freeze({ document, loaded, selectedId, baselineId, review, comparison,
    sourceInspection, canInspectSources: readSources !== null, phase, error, message, busy: busy(), disposed });
  function emit() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); } catch { /* Observers cannot mutate persisted evidence. */ }
  }
  function guard(requireLoaded = true) {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_HISTORY_BUSY");
    if (requireLoaded && !loaded) periodFail("PERIOD_HISTORY_NOT_LOADED");
    return true;
  }
  function fail(value) {
    if (disposed) return false;
    error = historyErrorCode(value);
    if (!busy()) phase = "error";
    emit(); return false;
  }
  function current(required = true) {
    const input = getReport();
    if (!input) {
      if (required) periodFail("PERIOD_HISTORY_NO_SOURCE");
      return null;
    }
    return validatePeriodReportInput(input);
  }
  const currentKey = () => { const input = current(false); return input ? periodReportInputKey(input) : null; };
  function adopt(value) {
    document = validateReportHistory(value); loaded = true;
    if (!document.entries.some(row => row.id === selectedId)) selectedId = null;
    if (!document.entries.some(row => row.id === baselineId)) baselineId = null;
    comparison = null; sourceInspection = null;
  }
  async function run(nextPhase, task, success) {
    const own = ++generation, local = new AbortController(); aborter = local;
    const same = () => !disposed && generation === own;
    phase = nextPhase; error = null; emit();
    if (!same()) return false;
    try {
      const result = await task({ same, canCommit: same, signal: local.signal });
      if (!same()) return false;
      aborter = null; phase = "ready"; success(result); emit(); return true;
    } catch (value) {
      if (!same()) return false;
      aborter = null; phase = "error";
      if (nextPhase === "saving" || nextPhase === "loading") loaded = false;
      return fail(value);
    }
  }
  function cancel() {
    if (disposed) return;
    if (phase === "saving") loaded = false;
    generation++; aborter?.abort(); aborter = null; review = null; comparison = null; sourceInspection = null; error = null; phase = "idle";
    message = "処理を中止しました。保存中だった場合は、履歴を再読み込みして結果を確認してください。";
    emit();
  }
  function invalidateReview() {
    if (disposed || busy()) return;
    review = null; error = null; phase = loaded ? "ready" : "idle"; emit();
  }
  async function refresh() {
    try {
      if (!guard(false)) return false;
      review = null; comparison = null; sourceInspection = null;
      return await run("loading", () => storage.read(), value => {
        adopt(value); message = "報告履歴を読み込みました。";
      });
    } catch (value) { return fail(value); }
  }
  function select(id, baseline = false) {
    try {
      if (!guard()) return false;
      if (id !== null) historyEntry(document, id);
      if (baseline) baselineId = id; else selectedId = id;
      review = null; comparison = null; sourceInspection = null; error = null; phase = "ready"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  function prepareSave({ label, note = "", tags = [] } = {}) {
    try {
      if (!guard()) return false;
      review = null;
      const report = current(), time = libraryTime(now());
      const entry = validateHistoryEntry({ id: libraryId(createId()), label: libraryLabel(label),
        note: historyNote(note), tags: historyTags(tags), savedAt: time, updatedAt: time, archived: false, report });
      // Validate duplicate and capacity conditions before offering an applicable review.
      mutateReportHistory(document, document.revision, { kind: "save", entry });
      review = Object.freeze({ kind: "save", entry, expectedRevision: document.revision, sourceKey: periodReportInputKey(report) });
      phase = "review"; error = null; message = "PC内に保存する報告を確認してください。"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  function prepareOpen() {
    try {
      if (!guard()) return false;
      review = null;
      const entry = historyEntry(document, selectedId), source = current(false);
      review = Object.freeze({ kind: "open", entry, expectedRevision: document.revision,
        sourceKey: source ? periodReportInputKey(source) : null,
        comparisonText: source ? periodReportComparisonText(comparePeriodReports(source, entry.report)) : "" });
      phase = "review"; error = null; message = "開く報告と、現在の表示との差を確認してください。"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  async function importFile(file) {
    try {
      if (!guard()) return false;
      review = null;
      const before = document;
      return await run("importing", () => readFile(file), decoded => {
        const incoming = validateReportHistory(decoded.document), plan = planHistoryMerge(before, incoming);
        review = Object.freeze({ kind: "merge", expectedRevision: before.revision, incoming, plan,
          skipConflicts: false, checksumVerified: decoded.checksumVerified === true });
        phase = "review"; message = "追加される報告、重複、競合を確認してください。";
      });
    } catch (value) { return fail(value); }
  }
  function setSkipConflicts(value) {
    try {
      if (!guard()) return false;
      if (review?.kind !== "merge" || typeof value !== "boolean") periodFail("PERIOD_HISTORY_REVIEW");
      review = Object.freeze({ ...review, skipConflicts: value }); error = null; emit(); return true;
    } catch (value) { return fail(value); }
  }
  async function applyReview() {
    try {
      if (!guard()) return false;
      if (!review) periodFail("PERIOD_HISTORY_REVIEW");
      const pending = review;
      if (pending.expectedRevision !== document.revision) periodFail("PERIOD_HISTORY_STALE");
      if (["save", "open"].includes(pending.kind) && currentKey() !== pending.sourceKey) {
        review = null; periodFail("PERIOD_HISTORY_SOURCE_CHANGED");
      }
      if (pending.kind === "merge") {
        if (pending.plan.capacityExceeded) periodFail("PERIOD_HISTORY_CAPACITY");
        if (pending.plan.conflicts.length && !pending.skipConflicts) periodFail("PERIOD_HISTORY_CONFLICT");
      }
      review = null;
      if (pending.kind === "open") {
        return await run("opening", async ({ same }) => {
          const fresh = validateReportHistory(await storage.read());
          if (!same()) return null;
          const entry = historyEntry(fresh, pending.entry.id);
          if (JSON.stringify(entry) !== JSON.stringify(pending.entry)) periodFail("PERIOD_HISTORY_STALE");
          if (currentKey() !== pending.sourceKey) periodFail("PERIOD_HISTORY_SOURCE_CHANGED");
          const delivered = stageReport(entry.report);
          if (delivered && typeof delivered.then === "function") Promise.resolve(delivered).catch(() => {});
          if (delivered !== true) periodFail("PERIOD_HISTORY_DELIVERY");
          return fresh;
        }, fresh => {
          adopt(fresh); message = "上の期間レポートに復元候補を渡しました。そちらで確認して表示してください。";
        });
      }
      const operation = pending.kind === "save" ? { kind: "save", entry: pending.entry } :
        { kind: "merge", document: pending.incoming, skipConflicts: pending.skipConflicts };
      return await run("saving", config => storage.change(pending.expectedRevision, operation, {
        ...config, canCommit: () => {
          if (!config.same()) return false;
          if (pending.kind !== "save") return true;
          try { return currentKey() === pending.sourceKey; } catch { return false; }
        },
      }), fresh => {
        adopt(fresh);
        if (pending.kind === "save") selectedId = pending.entry.id;
        message = "PC内の報告履歴に保存しました。JSONにもバックアップできます。";
      });
    } catch (value) { return fail(value); }
  }
  async function annotate({ label, note, tags }) {
    try {
      if (!guard()) return false;
      const entry = historyEntry(document, selectedId);
      const operation = { kind: "annotate", id: entry.id, label, note, tags, time: now() };
      mutateReportHistory(document, document.revision, operation);
      return await write(operation, "名前・メモ・タグを更新しました。報告の元データはそのままです。");
    } catch (value) { return fail(value); }
  }
  async function archive(value) {
    try {
      if (!guard()) return false;
      const operation = { kind: "archive", id: historyEntry(document, selectedId).id, archived: value, time: now() };
      mutateReportHistory(document, document.revision, operation);
      return await write(operation, value ? "非表示保管に移しました。保管中の一覧から戻せます。" : "通常の一覧に戻しました。");
    } catch (value) { return fail(value); }
  }
  async function write(operation, text) {
    review = null; comparison = null;
    return run("saving", config => storage.change(document.revision, operation, config), fresh => {
      adopt(fresh); message = text;
    });
  }
  function compare() {
    try {
      if (!guard()) return false;
      if (!selectedId || !baselineId || selectedId === baselineId) periodFail("PERIOD_HISTORY_COMPARE");
      const before = historyEntry(document, baselineId).report, after = historyEntry(document, selectedId).report;
      comparison = Object.freeze({ ...comparePeriodReports(before, after), continuity: inspectReportContinuity(before, after) });
      review = null; error = null; emit(); return true;
    } catch (value) { comparison = null; return fail(value); }
  }
  async function inspectSources() {
    try {
      if (!guard()) return false;
      if (!readSources) periodFail("PERIOD_HISTORY_SOURCES_UNAVAILABLE");
      const selected = historyEntry(document, selectedId);
      sourceInspection = null; review = null;
      return await run("inspecting", async ({ same }) => {
        const fresh = validateReportHistory(await storage.read());
        if (!same()) return null;
        const entry = historyEntry(fresh, selected.id);
        if (JSON.stringify(entry) !== JSON.stringify(selected)) periodFail("PERIOD_HISTORY_STALE");
        const sources = await readSources();
        if (!same()) return null;
        return inspectReportSources(entry.report, sources, now());
      }, result => {
        sourceInspection = result;
        message = "元の期間の控えと照合しました。保存済み報告は変更していません。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportFile(format, acknowledged, deliver, query) {
    try {
      if (!guard()) return false;
      if (acknowledged !== true) periodFail("PERIOD_HISTORY_ACK");
      if (!["backup", "selected", "csv"].includes(format) || typeof deliver !== "function") periodFail("PERIOD_HISTORY_FORMAT");
      const selected = format === "selected" ? historyEntry(document, selectedId) : null;
      review = null;
      return await run("exporting", async ({ same }) => {
        const fresh = validateReportHistory(await storage.read());
        if (!same()) return null;
        if (selected && JSON.stringify(historyEntry(fresh, selected.id)) !== JSON.stringify(selected)) periodFail("PERIOD_HISTORY_STALE");
        const file = format === "backup" ? await prepareFile(fresh) : format === "selected" ?
          await preparePeriodReportFile(selected.report) : reportHistoryCSV(fresh, query);
        if (!same()) return null;
        const delivery = deliver(file);
        if (delivery && typeof delivery.then === "function") {
          Promise.resolve(delivery).catch(() => {}); periodFail("PERIOD_ASYNC_DELIVERY");
        }
        return fresh;
      }, fresh => { adopt(fresh); message = "保存処理を開始しました。ダウンロード先をご確認ください。"; });
    } catch (value) { return fail(value); }
  }
  return Object.freeze({ get state() { return state(); }, refresh, select, prepareSave, prepareOpen,
    importFile, setSkipConflicts, applyReview, annotate, archive, compare, inspectSources, exportFile, cancel, invalidateReview,
    dispose() {
      if (disposed) return;
      generation++; aborter?.abort(); disposed = true; review = null; comparison = null; storage.close();
    },
  });
}
