import { periodFail, periodShape } from "./period-plan.js";
import { validatePeriodDraft, periodDraftKey } from "./period-draft.js";
import { emptyPeriodLibrary, validatePeriodLibrary, validateLibraryEntry, libraryId, libraryLabel,
  libraryTime, compareLibraryDrafts } from "./period-library-model.js";
import { preparePeriodLibraryFile, readPeriodLibraryFile, reviewPeriodLibraryImport } from "./period-library-file.js";
import { periodLibraryCSV } from "./period-library-query.js";
import { libraryErrorCode, libraryComparisonText } from "./period-library-view.js";

/** Explicit storage operations. Mounting and selection do not open IndexedDB. */
export function createPeriodLibraryController({ storage, getCheckpoint, stageCheckpoint,
  onChange = () => {}, now = () => new Date().toISOString(), createId = () => crypto.randomUUID(),
  readFile = readPeriodLibraryFile, prepareFile = preparePeriodLibraryFile } = {}) {
  if (!storage || ![storage.read, storage.change, storage.close, getCheckpoint, stageCheckpoint,
    onChange, now, createId, readFile, prepareFile].every(value => typeof value === "function")) periodFail("PERIOD_LIBRARY_OPTIONS");
  let document = emptyPeriodLibrary(), loaded = false, selectedId = null, review = null;
  let phase = "idle", error = null, message = "PC内の保存一覧は、開く操作をしたときだけ読み込みます。";
  let comparison = "", generation = 0, aborter = null, disposed = false;
  const busy = () => ["loading", "saving", "importing", "exporting", "restoring"].includes(phase);
  const state = () => Object.freeze({ document, loaded, selectedId, review, phase, error, message, comparison, busy: busy(), disposed });
  function emit() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); } catch { /* UI errors do not alter storage. */ }
  }
  function guard(requireLoaded = true) {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_LIBRARY_BUSY");
    if (requireLoaded && !loaded) periodFail("PERIOD_LIBRARY_NOT_LOADED");
    return true;
  }
  function fail(value) {
    if (disposed) return false;
    error = libraryErrorCode(value);
    if (!busy()) phase = "error";
    emit();
    return false;
  }
  function current() {
    const value = getCheckpoint();
    if (!value) periodFail("PERIOD_LIBRARY_NO_SOURCE");
    periodShape(value, ["draft", "requiresNewPlan"]);
    if (typeof value.requiresNewPlan !== "boolean") periodFail("PERIOD_LIBRARY_NO_SOURCE");
    return Object.freeze({ draft: validatePeriodDraft(value.draft), requiresNewPlan: value.requiresNewPlan });
  }
  const sourceKey = value => JSON.stringify([periodDraftKey(value.draft), value.requiresNewPlan]);
  function selected() {
    const entry = document.entries.find(row => row.id === selectedId);
    if (!entry) periodFail("PERIOD_LIBRARY_NOT_FOUND");
    return entry;
  }
  function adopt(value) {
    document = validatePeriodLibrary(value);
    loaded = true;
    if (selectedId && !document.entries.some(row => row.id === selectedId)) selectedId = null;
  }
  async function run(nextPhase, task, success) {
    const id = ++generation, local = new AbortController();
    aborter = local;
    phase = nextPhase; error = null;
    const same = () => !disposed && id === generation;
    emit();
    if (!same()) return false;
    try {
      const result = await task({ signal: local.signal, canCommit: same, same });
      if (!same()) return false;
      aborter = null;
      phase = "ready";
      success(result);
      emit();
      return true;
    } catch (value) {
      if (!same()) return false;
      aborter = null;
      phase = "error";
      // The cached revision cannot be reused after failed or competing writes.
      if (nextPhase === "saving") loaded = false;
      return fail(value);
    }
  }
  function cancel() {
    if (disposed) return;
    if (phase === "saving") loaded = false;
    generation++;
    aborter?.abort(); aborter = null;
    review = null; comparison = ""; error = null; phase = "idle";
    message = "処理を中止しました。保存中だった場合は一覧を再読み込みして保存状況を確認してください。";
    emit();
  }
  async function refresh() {
    try {
      if (!guard(false)) return false;
      review = null; comparison = "";
      return await run("loading", () => storage.read(), value => { adopt(value); message = "PC内の保存一覧を読み込みました。"; });
    } catch (value) { return fail(value); }
  }
  function select(id) {
    try {
      if (!guard()) return false;
      if (id !== null && !document.entries.some(row => row.id === libraryId(id))) periodFail("PERIOD_LIBRARY_NOT_FOUND");
      selectedId = id; review = null; comparison = ""; error = null; phase = "ready"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  function prepareSave(label) {
    try {
      if (!guard()) return false;
      review = null;
      const source = current(), time = libraryTime(now());
      const entry = validateLibraryEntry({ id: libraryId(createId()), label: libraryLabel(label),
        createdAt: time, updatedAt: time, archived: false, ...source });
      review = Object.freeze({ kind: "save", expectedRevision: document.revision, entry, sourceKey: sourceKey(source) });
      phase = "review"; error = null; message = "保存する控えの内容を確認してください。"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  function prepareRestore() {
    try {
      if (!guard()) return false;
      review = null;
      review = Object.freeze({ kind: "restore", expectedRevision: document.revision, entry: selected() });
      phase = "review"; error = null; message = "期間取得の画面へ渡す控えを確認してください。"; emit(); return true;
    } catch (value) { return fail(value); }
  }
  async function importFile(file) {
    try {
      if (!guard()) return false;
      review = null;
      const before = document;
      return await run("importing", () => readFile(file), value => {
        const plan = reviewPeriodLibraryImport(before, value.document);
        review = Object.freeze({ kind: "import", expectedRevision: before.revision, plan });
        phase = "review"; message = "保存一覧に追加する内容を確認してください。";
      });
    } catch (value) { return fail(value); }
  }
  async function applyReview() {
    try {
      if (!guard()) return false;
      if (!review) periodFail("PERIOD_LIBRARY_REVIEW");
      const pending = review;
      if (pending.expectedRevision !== document.revision) periodFail("PERIOD_LIBRARY_STALE");
      review = null;
      if (pending.kind === "restore") {
        return await run("restoring", async ({ same }) => {
          const fresh = validatePeriodLibrary(await storage.read());
          if (!same()) return null;
          const entry = fresh.entries.find(row => row.id === pending.entry.id);
          if (!entry || JSON.stringify(entry) !== JSON.stringify(pending.entry)) periodFail("PERIOD_LIBRARY_STALE");
          const delivery = stageCheckpoint(entry.draft, { requiresNewPlan: entry.requiresNewPlan });
          if (delivery && typeof delivery.then === "function") Promise.resolve(delivery).catch(() => {});
          if (delivery !== true) periodFail("PERIOD_LIBRARY_DELIVERY");
          return fresh;
        }, value => { adopt(value); message = "期間取得の画面に復元候補を送りました。そちらで確認して反映してください。"; });
      }
      let operation;
      if (pending.kind === "save") {
        if (sourceKey(current()) !== pending.sourceKey) periodFail("PERIOD_LIBRARY_SOURCE_CHANGED");
        const entry = pending.entry;
        operation = { kind: "save", id: entry.id, label: entry.label, time: entry.createdAt,
          draft: entry.draft, requiresNewPlan: entry.requiresNewPlan };
      } else operation = { kind: "import", entries: pending.plan.entries };
      return await run("saving", config => storage.change(pending.expectedRevision, operation, config), value => {
        adopt(value);
        if (pending.kind === "save") selectedId = pending.entry.id;
        message = "PC内の保存が完了しました。別途JSONにも保全できます。";
      });
    } catch (value) { return fail(value); }
  }
  async function edit(kind, value) {
    try {
      if (!guard()) return false;
      const entry = selected(), revision = document.revision;
      let operation;
      if (kind === "rename") operation = { kind, id: entry.id, label: libraryLabel(value), time: libraryTime(now()) };
      else if (kind === "archive") operation = { kind, id: entry.id, archived: value, time: libraryTime(now()) };
      else if (kind === "purge") operation = { kind, id: entry.id, acknowledged: value };
      else periodFail("PERIOD_LIBRARY_OPERATION");
      review = null; comparison = "";
      return await run("saving", config => storage.change(revision, operation, config), result => {
        adopt(result); message = kind === "purge" ? "選択した非表示保管の控えを削除しました。" : "保存一覧を更新しました。";
      });
    } catch (failure) { return fail(failure); }
  }
  function compare() {
    try {
      if (!guard()) return false;
      comparison = libraryComparisonText(compareLibraryDrafts(selected().draft, current().draft));
      error = null; emit(); return true;
    } catch (value) { comparison = ""; return fail(value); }
  }
  async function exportFile(kind, deliver, query) {
    try {
      if (!guard()) return false;
      if (!["all", "selected", "csv"].includes(kind) || typeof deliver !== "function") periodFail("PERIOD_FILE_KIND");
      const selectedKey = kind === "selected" ? selected().id : null;
      review = null;
      return await run("exporting", async ({ same }) => {
        const fresh = validatePeriodLibrary(await storage.read());
        if (!same()) return null;
        let file;
        if (kind === "csv") file = periodLibraryCSV(fresh, query);
        else {
          const entries = kind === "all" ? fresh.entries : fresh.entries.filter(row => row.id === selectedKey);
          if (kind === "selected" && !entries.length) periodFail("PERIOD_LIBRARY_NOT_FOUND");
          file = await prepareFile({ ...fresh, entries });
        }
        if (!same()) return null;
        const delivery = deliver(file);
        if (delivery && typeof delivery.then === "function") {
          Promise.resolve(delivery).catch(() => {});
          periodFail("PERIOD_ASYNC_DELIVERY");
        }
        return fresh;
      }, fresh => { adopt(fresh); message = "ダウンロードを開始しました。保存先でファイルを確認してください。"; });
    } catch (value) { return fail(value); }
  }
  return Object.freeze({ get state() { return state(); }, refresh, select, prepareSave, prepareRestore,
    importFile, applyReview, edit, compare, exportFile, cancel,
    dispose() { if (!disposed) { generation++; aborter?.abort(); disposed = true; review = null; storage.close(); } },
  });
}
