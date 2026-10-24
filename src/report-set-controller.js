import { periodFail } from "./period-plan.js";
import { emptyReportHistory, validateReportHistory } from "./report-history-model.js";
import { validateSetSelection, validateReportSet, createReportSet, inspectSetSources,
  assertSetSourcesUnchanged, validateSetExportOptions } from "./report-set-model.js";
import { analyzeReportSet } from "./report-set-engine.js";
import { prepareReportSetFile, readReportSetFile } from "./report-set-file.js";
import { reportSetHTML, reportSetCSV } from "./report-set-export.js";
import { setErrorCode } from "./report-set-view.js";

/** Read-only storage consumer. Selected evidence is pinned before presentation. */
export function createReportSetController({ storage, onChange = () => {},
  now = () => new Date().toISOString(), readFile = readReportSetFile,
  prepareFile = prepareReportSetFile } = {}) {
  if (!storage || ![storage.read, storage.close, onChange, now, readFile, prepareFile]
    .every(value => typeof value === "function")) periodFail("PERIOD_SET_OPTIONS");
  let document = emptyReportHistory(), loaded = false, selection = Object.freeze([]);
  let input = null, result = null, review = null, inspection = null, origin = null;
  let phase = "idle", error = null, generation = 0, disposed = false;
  let active = null;
  let message = "保存した報告を読み込み、まとめて確認する対象を選んでください。";
  const busy = () => ["loading", "importing", "checking", "exporting", "inspecting"].includes(phase);
  const state = () => Object.freeze({ document, loaded, selection, input, result, review, inspection,
    origin, phase, error, message, busy: busy(), disposed });

  function emit() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); } catch { /* UI observers cannot write evidence. */ }
  }
  function guard(requireLoaded = false) {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_SET_BUSY");
    if (requireLoaded && !loaded) periodFail("PERIOD_SET_NOT_LOADED");
    return true;
  }
  function fail(value) {
    if (disposed) return false;
    error = setErrorCode(value);
    if (!busy()) phase = "error";
    emit(); return false;
  }
  async function run(next, task, complete) {
    const token = ++generation;
    const aborter = new AbortController();
    active = aborter;
    const same = () => !disposed && generation === token;
    phase = next; error = null; emit();
    if (!same()) return false;
    try {
      const value = await task(same, aborter.signal);
      if (!same()) return false;
      phase = "ready"; error = null; complete(value); emit(); return true;
    } catch (value) {
      if (!same()) return false;
      phase = "error";
      return fail(value);
    } finally { if (active === aborter) active = null; }
  }
  function cancel() {
    if (disposed) return;
    generation++; review = null; error = null; phase = input ? "ready" : "idle";
    const previous = active; active = null; previous?.abort();
    message = "処理を中止しました。作成済みの確認結果と元の履歴はそのままです。";
    emit();
  }
  function invalidateReview() {
    if (disposed || busy()) return;
    review = null; error = null; phase = input ? "ready" : "idle";
    emit();
  }
  async function refresh() {
    try {
      if (!guard()) return false;
      review = null; loaded = false;
      return await run("loading", (_same, signal) => storage.read({ signal }), value => {
        document = validateReportHistory(value); loaded = true;
        selection = Object.freeze(selection.filter(id => document.entries.some(entry => entry.id === id)));
        inspection = input ? inspectSetSources(input, document) : null;
        message = "報告の一覧を読み込みました。選択を変えても作成済みの結果は変わりません。";
      });
    } catch (value) { return fail(value); }
  }
  function select(ids) {
    try {
      if (!guard(true)) return false;
      const proposed = validateSetSelection(ids);
      if (proposed.some(id => !document.entries.some(entry => entry.id === id))) periodFail("PERIOD_SET_SOURCE_MISSING");
      selection = proposed; review = null; error = null; phase = input ? "ready" : "idle";
      message = "対象を変更しました。選択内容を確認してから結果を作成してください。";
      emit(); return true;
    } catch (value) { return fail(value); }
  }
  function prepare(title) {
    try {
      if (!guard(true)) return false;
      review = null;
      const candidate = createReportSet(document, selection, title, now());
      review = Object.freeze({ input: candidate, result: analyzeReportSet(candidate), origin: "history", checksumVerified: false });
      phase = "review"; error = null; message = "選択した報告、期間と確認が必要な箇所を確認してください。";
      emit(); return true;
    } catch (value) { return fail(value); }
  }
  async function importFile(file) {
    try {
      if (!guard()) return false;
      review = null;
      return await run("importing", (_same, signal) => readFile(file, { signal }), decoded => {
        const candidate = validateReportSet(decoded.input);
        review = Object.freeze({ input: candidate, result: analyzeReportSet(candidate), origin: "file",
          checksumVerified: decoded.checksumVerified === true });
        phase = "review";
        message = "JSONの元記録から再計算しました。確認後に開きます。保存履歴へは追加しません。";
      });
    } catch (value) { return fail(value); }
  }
  async function applyReview() {
    try {
      if (!guard()) return false;
      if (!review) periodFail("PERIOD_SET_NO_REVIEW");
      const pending = review; review = null;
      return await run("checking", async (same, signal) => {
        let fresh = null;
        if (pending.origin === "history") {
          fresh = validateReportHistory(await storage.read({ signal }));
          if (!same()) return null;
          assertSetSourcesUnchanged(pending.input, fresh);
        }
        return { fresh, input: validateReportSet(pending.input), result: analyzeReportSet(pending.input) };
      }, value => {
        if (value.fresh) { document = value.fresh; loaded = true; }
        input = value.input; result = value.result; origin = pending.origin; inspection = null;
        message = "確認セットを作成しました。選択した時点の証拠を固定して表示しています。";
      });
    } catch (value) { return fail(value); }
  }
  async function inspectSources() {
    try {
      if (!guard()) return false;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      const snapshot = input; inspection = null; review = null;
      return await run("inspecting", async (_same, signal) => inspectSetSources(snapshot, await storage.read({ signal })), value => {
        inspection = value;
        message = "PC内の現在の保存一覧と照合しました。確認結果は書き換えていません。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportFile(format, acknowledged, deliver, optionsValue = {}) {
    try {
      if (!guard()) return false;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (!["json", "html", "csv"].includes(format) || typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const snapshot = input, options = validateSetExportOptions(optionsValue);
      review = null;
      return await run("exporting", async same => {
        const file = format === "json" ? await prepareFile(snapshot) : format === "html" ?
          reportSetHTML(snapshot, options) : reportSetCSV(snapshot, options);
        if (!same()) return null;
        const delivery = deliver(file);
        if (delivery && typeof delivery.then === "function") {
          Promise.resolve(delivery).catch(() => {}); periodFail("PERIOD_ASYNC_DELIVERY");
        }
        return file;
      }, () => { message = "固定した確認セットをファイルに出力しました。ダウンロード先をご確認ください。"; });
    } catch (value) { return fail(value); }
  }
  function dispose() {
    if (disposed) return;
    generation++; disposed = true; review = null; inspection = null;
    const previous = active; active = null; previous?.abort();
    try { storage.close(); } catch { /* No writes exist in this controller. */ }
  }
  return Object.freeze({ get state() { return state(); }, refresh, select, prepare, importFile, applyReview,
    inspectSources, exportFile, cancel, invalidateReview, dispose });
}
