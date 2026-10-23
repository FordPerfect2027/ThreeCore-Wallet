import { comparePeriodReports } from "./period-report-comparison.js";
import { periodFail } from "./period-plan.js";
import { emptyPeriodLibrary, validatePeriodLibrary, libraryId } from "./period-library-model.js";
import { emptyReportSelection, reportAgent, createPeriodReportInput, validatePeriodReportInput,
  assertReportSourcesUnchanged } from "./period-report-model.js";
import { analyzePeriodReport } from "./period-report-engine.js";
import { preparePeriodReportFile, readPeriodReportFile } from "./period-report-file.js";
import { periodReportCSV, periodReportHTML } from "./period-report-export.js";
import { reportErrorCode } from "./period-report-view.js";

/** Read-only consumer of the period library. There is intentionally no storage.change call. */
export function createPeriodReportController({ storage, onChange = () => {},
  now = () => new Date().toISOString(), readFile = readPeriodReportFile,
  prepareFile = preparePeriodReportFile } = {}) {
  if (!storage || ![storage.read, storage.close, onChange, now, readFile, prepareFile]
    .every(value => typeof value === "function")) periodFail("PERIOD_REPORT_OPTIONS");
  let document = emptyPeriodLibrary(), selection = emptyReportSelection(), loaded = false;
  let input = null, report = null, review = null, origin = null, phase = "idle", error = null;
  let message = "保存済みの控えを読み込み、報告に使う記録を選んでください。";
  let generation = 0, disposed = false;
  const busy = () => ["loading", "importing", "checking", "exporting"].includes(phase);
  const state = () => Object.freeze({ document, selection, loaded, input, report, review,
    origin, phase, error, message, busy: busy(), disposed });
  function emit() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); } catch { /* Observer errors have no data effects. */ }
  }
  function guard(needsLibrary = false) {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_REPORT_BUSY");
    if (needsLibrary && !loaded) periodFail("PERIOD_REPORT_NOT_LOADED");
    return true;
  }
  function fail(value) {
    if (disposed) return false;
    error = reportErrorCode(value);
    if (!busy()) phase = "error";
    emit();
    return false;
  }
  function clearResult() { input = null; report = null; origin = null; }
  async function run(next, task, success) {
    const own = ++generation, same = () => !disposed && generation === own;
    phase = next; error = null; emit();
    if (!same()) return false;
    try {
      const result = await task(same);
      if (!same()) return false;
      phase = "ready";
      success(result);
      emit();
      return true;
    } catch (value) {
      if (!same()) return false;
      phase = "error";
      return fail(value);
    }
  }
  function cancel() {
    if (disposed) return;
    generation++; review = null; error = null; phase = input ? "ready" : "idle";
    message = "処理を中止しました。保存一覧は変更していません。";
    emit();
  }
  async function refresh() {
    try {
      if (!guard()) return false;
      review = null; loaded = false; clearResult();
      return await run("loading", () => storage.read(), value => {
        document = validatePeriodLibrary(value); loaded = true;
        selection = Object.freeze(Object.fromEntries(Object.entries(selection).map(([agent, id]) =>
          [agent, document.entries.some(row => row.id === id && row.draft.plan.context.agent === agent) ? id : null])));
        message = "保存一覧を読み込みました。各トークンの控えを選んでください。";
      });
    } catch (value) { return fail(value); }
  }
  function select(agent, id) {
    try {
      if (!guard(true)) return false;
      reportAgent(agent);
      if (id !== null) {
        libraryId(id);
        const entry = document.entries.find(row => row.id === id);
        if (!entry) periodFail("PERIOD_REPORT_SOURCE_MISSING");
        if (entry.draft.plan.context.agent !== agent) periodFail("PERIOD_REPORT_AGENT");
      }
      selection = Object.freeze({ ...selection, [agent]: id });
      review = null; clearResult(); error = null; phase = "ready";
      message = "選択を変更しました。報告内容をもう一度確認してください。";
      emit(); return true;
    } catch (value) { return fail(value); }
  }
  function invalidateReview() {
    if (disposed || busy()) return;
    review = null; error = null; phase = input ? "ready" : "idle"; emit();
  }
  function prepare(title) {
    try {
      if (!guard(true)) return false;
      review = null;
      const candidate = createPeriodReportInput(document, selection, title, now());
      review = Object.freeze({ origin: "library", input: candidate, report: analyzePeriodReport(candidate),
        checksumVerified: false, authenticated: false, comparison: input ? comparePeriodReports(input, candidate) : null });
      phase = "review"; error = null; message = "対象・期間・取得状態を確認してから報告を作成してください。";
      emit(); return true;
    } catch (value) { return fail(value); }
  }
  async function importFile(file) {
    try {
      if (!guard()) return false;
      review = null;
      return await run("importing", () => readFile(file), decoded => {
        const candidate = validatePeriodReportInput(decoded.input);
        review = Object.freeze({ origin: "file", input: candidate, report: analyzePeriodReport(candidate),
          checksumVerified: decoded.checksumVerified === true, authenticated: false,
          comparison: input ? comparePeriodReports(input, candidate) : null });
        phase = "review"; message = "ファイルから再計算しました。報告を開く前に内容を確認してください。保存一覧への追加は行いません。";
      });
    } catch (value) { return fail(value); }
  }
  async function applyReview() {
    try {
      if (!guard()) return false;
      if (!review) periodFail("PERIOD_REPORT_REVIEW");
      const pending = review; review = null;
      return await run("checking", async () => {
        const fresh = pending.origin === "library" ? assertReportSourcesUnchanged(pending.input, await storage.read()) : null;
        return { fresh, input: pending.input, report: analyzePeriodReport(pending.input) };
      }, result => {
        if (result.fresh) { document = result.fresh; loaded = true; }
        input = result.input; report = result.report; origin = pending.origin;
        if (origin === "file") {
          selection = Object.freeze(Object.fromEntries(input.slots.map(({ agent, entry }) => [agent,
            loaded && entry && document.entries.some(row => JSON.stringify(row) === JSON.stringify(entry))
              ? entry.id : null])));
        }
        message = "報告を作成しました。保存した時点の記録を固定して表示しています。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportFile(format, acknowledged, deliver) {
    try {
      if (!guard()) return false;
      if (!input) periodFail("PERIOD_REPORT_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_REPORT_ACK");
      if (!["json", "csv", "html"].includes(format)) periodFail("PERIOD_REPORT_FORMAT");
      if (typeof deliver !== "function") periodFail("PERIOD_REPORT_DELIVERY");
      const source = input; review = null;
      return await run("exporting", async same => {
        const file = format === "json" ? await prepareFile(source) :
          format === "csv" ? periodReportCSV(source) : periodReportHTML(source);
        if (!same()) return null;
        const delivery = deliver(file);
        // Browser download initiation must be synchronous; late async callbacks cannot report success.
        if (delivery && typeof delivery.then === "function") {
          Promise.resolve(delivery).catch(() => {});
          periodFail("PERIOD_REPORT_DELIVERY");
        }
        if (delivery === false) periodFail("PERIOD_REPORT_DELIVERY");
        return file;
      }, () => { message = "保存処理を開始しました。ダウンロード先でファイルをご確認ください。"; });
    } catch (value) { return fail(value); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; review = null;
    try { storage.close(); } catch { /* A closed adapter cannot change an accepted snapshot. */ }
  }
  return Object.freeze({ get state() { return state(); }, refresh, select, prepare,
    invalidateReview, importFile, applyReview, exportFile, cancel, dispose });
}
