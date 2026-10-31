import { observeCallbackResult, consumeCallback } from "./security-callback.js";
import { periodFail } from "./period-plan.js";
import { emptyReportHistory, validateReportHistory } from "./report-history-model.js";
import { validateSetSelection, validateReportSet, createReportSet, inspectSetSources,
  assertSetSourcesUnchanged, validateSetExportOptions } from "./report-set-model.js";
import { analyzeReportSet, compareReportSets, compareReportSetEvents } from "./report-set-engine.js";
import { prepareReportSetFile, readReportSetFile } from "./report-set-file.js";
import { diagnosticQuery } from "./report-set-diagnostics.js";
import { reportSetHTML, reportSetCSV, reportSetDiagnosticsCSV, prepareReportSetChecksFile,
  readReportSetChecksText, reviewReportSetChecksFile, prepareReportSetSourceFile, prepareMissingHistoryDraftFile,
  prepareReportSetComparisonFile, prepareReportSetCoverageFile, readReportSetComparisonText, reviewReportSetComparisonFile, prepareReportSetComparisonEvidenceFile,
  readReportSetComparisonEvidenceText, reviewReportSetComparisonEvidence, prepareComparisonEvidenceSourceFile, prepareReportSetEventComparisonFile } from "./report-set-export.js";
import { setErrorCode } from "./report-set-view.js";
import { createStateNotifier } from "./state-notifier.js";

/** Read-only storage consumer. Selected evidence is pinned before presentation. */
export function createReportSetController({ storage, onChange = () => {},
  now = () => new Date().toISOString(), readFile = readReportSetFile,
  prepareFile = prepareReportSetFile, readChecksText = readReportSetChecksText, readComparisonText = readReportSetComparisonText, readEvidenceText = readReportSetComparisonEvidenceText } = {}) {
  if (!storage || ![storage.read, storage.close, onChange, now, readFile, prepareFile, readChecksText, readComparisonText, readEvidenceText]
    .every(value => typeof value === "function")) periodFail("PERIOD_SET_OPTIONS");
  let document = emptyReportHistory(), loaded = false, selection = Object.freeze([]);
  let input = null, result = null, review = null, inspection = null, origin = null;
  let checkReview = null, comparisonReview = null, evidenceReview = null;
  let phase = "idle", error = null, generation = 0, disposed = false;
  let active = null;
  let message = "保存した報告を読み込み、まとめて確認する対象を選んでください。";
  const busy = () => ["loading", "importing", "checking", "exporting", "inspecting", "checking-details", "checking-comparison", "checking-evidence"].includes(phase);
  const state = () => Object.freeze({ document, loaded, selection, input, result, review, inspection, checkReview, comparisonReview, evidenceReview,
    origin, phase, error, message, busy: busy(), disposed });
  let notificationRevision = 0;
  const observers = new Set([() => onChange(state())]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ revision: notificationRevision }) });
  const sameGeneration = token => !disposed && generation === token;

  function emit() {
    if (disposed) return;
    notificationRevision++;
    notifier.notify();
  }
  function guard(requireLoaded = false) {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_SET_BUSY");
    if (requireLoaded && !loaded) periodFail("PERIOD_SET_NOT_LOADED");
    return true;
  }
  function fail(value, token = generation) {
    if (!sameGeneration(token)) return false;
    const code = setErrorCode(value);
    if (!sameGeneration(token)) return false;
    error = code;
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
      phase = "ready"; error = null; complete(value, same);
      if (!same()) return false;
      emit(); return same();
    } catch (value) {
      if (!same()) return false;
      phase = "error";
      return fail(value, token);
    } finally { if (active === aborter) active = null; }
  }
  function cancel() {
    if (disposed) return;
    const token = ++generation;
    review = null; comparisonReview = null; error = null; phase = input ? "ready" : "idle";
    const previous = active; active = null; previous?.abort();
    if (!sameGeneration(token)) return;
    message = "処理を中止しました。作成済みの確認結果と元の履歴はそのままです。";
    emit();
  }
  function invalidateReview() {
    if (disposed || busy()) return;
    generation++;
    review = null; comparisonReview = null; error = null; phase = input ? "ready" : "idle";
    emit();
  }
  async function refresh() {
    try {
      if (!guard()) return false;
      review = null; comparisonReview = null; loaded = false;
      return await run("loading", (_same, signal) => storage.read({ signal }), (value, same) => {
        const captured = validateReportHistory(value);
        if (!same()) return;
        document = captured; loaded = true;
        selection = Object.freeze(selection.filter(id => document.entries.some(entry => entry.id === id)));
        inspection = input ? inspectSetSources(input, document) : null;
        message = "報告の一覧を読み込みました。選択を変えても作成済みの結果は変わりません。";
      });
    } catch (value) { return fail(value); }
  }
  function select(ids) {
    let token = generation;
    try {
      if (!guard(true)) return false;
      token = ++generation;
      const proposed = validateSetSelection(ids);
      if (!sameGeneration(token)) return false;
      if (proposed.some(id => !document.entries.some(entry => entry.id === id))) periodFail("PERIOD_SET_SOURCE_MISSING");
      selection = proposed; review = null; comparisonReview = null; error = null; phase = input ? "ready" : "idle";
      message = "対象を変更しました。選択内容を確認してから結果を作成してください。";
      emit(); return sameGeneration(token);
    } catch (value) { return fail(value, token); }
  }
  function prepare(title) {
    let token = generation;
    try {
      if (!guard(true)) return false;
      token = ++generation;
      review = null; comparisonReview = null;
      const createdAt = now();
      if (!sameGeneration(token)) return false;
      const candidate = createReportSet(document, selection, title, createdAt);
      comparisonReview = null; review = Object.freeze({ input: candidate, result: analyzeReportSet(candidate), origin: "history", checksumVerified: false,
        comparison: input ? compareReportSets(input, candidate) : null });
      phase = "review"; error = null; message = "選択した報告、期間と確認が必要な箇所を確認してください。";
      emit(); return sameGeneration(token);
    } catch (value) { return fail(value, token); }
  }
  async function importFile(file) {
    try {
      if (!guard()) return false;
      review = null; comparisonReview = null;
      return await run("importing", (_same, signal) => readFile(file, { signal }), (decoded, same) => {
        const candidate = validateReportSet(decoded.input);
        const analysis = analyzeReportSet(candidate), checksumVerified = decoded.checksumVerified === true;
        if (!same()) return;
        comparisonReview = null; review = Object.freeze({ input: candidate, result: analysis, origin: "file", checksumVerified,
          comparison: input ? compareReportSets(input, candidate) : null });
        phase = "review";
        message = "JSONの元記録から再計算しました。確認後に開きます。保存履歴へは追加しません。";
      });
    } catch (value) { return fail(value); }
  }
  async function applyReview() {
    try {
      if (!guard()) return false;
      if (!review) periodFail("PERIOD_SET_NO_REVIEW");
      const pending = review; review = null; comparisonReview = null;
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
        input = value.input; result = value.result; origin = pending.origin; inspection = null; checkReview = null;
        message = "確認セットを作成しました。選択した時点の証拠を固定して表示しています。";
      });
    } catch (value) { return fail(value); }
  }
  async function inspectSources() {
    try {
      if (!guard()) return false;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      const snapshot = input; inspection = null; review = null; comparisonReview = null;
      return await run("inspecting", async (_same, signal) => inspectSetSources(snapshot, await storage.read({ signal })), value => {
        inspection = value;
        message = "PC内の現在の保存一覧と照合しました。確認結果は書き換えていません。";
      });
    } catch (value) { return fail(value); }
  }
  async function reviewCheckFile(file) {
    try {
      if (!guard()) return false;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      const snapshot = input; review = null; comparisonReview = null;
      return await run("checking-details", async (same, signal) => {
        const text = await readChecksText(file, { signal });
        if (!same()) return null;
        return reviewReportSetChecksFile(snapshot, text, { signal });
      }, value => {
        checkReview = value;
        message = value.matchesRecomputation ? "保存した確認箇所が、元資料からの再計算と一致しました。" :
          "保存した確認箇所と再計算に食い違いがあります。元の資料は変更していません。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportFile(format, acknowledged, deliver, optionsValue = {}, queryValue = {}) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (!["json", "html", "csv", "checks-csv", "checks-json", "check-review", "coverage-json", "coverage-csv"].includes(format) || typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      if (format === "check-review" && !checkReview) periodFail("PERIOD_SET_CHECKS_NO_REVIEW");
      const checked = checkReview;
      const snapshot = input, options = validateSetExportOptions(optionsValue);
      const query = format.startsWith("checks-") ? diagnosticQuery(queryValue) : null;
      if (!sameGeneration(token)) return false;
      review = null; comparisonReview = null;
      return await run("exporting", async (same, signal) => {
        const checkText = format === "check-review" ? JSON.stringify(checked, null, 2) + "\n" : null;
        const file = checkText !== null ? Object.freeze({ text: checkText, filename: "ThreeCore-report-set-check-review.json",
          mimeType: "application/json;charset=utf-8", byteLength: new TextEncoder().encode(checkText).byteLength,
          encrypted: false, restorable: false, containsOriginalEvidence: false }) :
          format.startsWith("coverage-") ? await prepareReportSetCoverageFile(snapshot, format.slice(9), options, { signal }) :
          format === "json" ? await prepareFile(snapshot, { signal }) : format === "html" ?
          reportSetHTML(snapshot, options) : format === "checks-csv" ? reportSetDiagnosticsCSV(snapshot, query, options) :
          format === "checks-json" ? await prepareReportSetChecksFile(snapshot, query, options, { signal }) : reportSetCSV(snapshot, options);
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") {
          periodFail("PERIOD_ASYNC_DELIVERY");
        }
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { message = "固定した確認セットをファイルに出力しました。ダウンロード先をご確認ください。"; });
    } catch (value) { return fail(value, token); }
  }
  async function exportSourceReport(idValue, acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const snapshot = input, id = validateSetSelection([idValue], { allowEmpty: false })[0];
      if (!snapshot.entries.some(entry => entry.id === id)) periodFail("PERIOD_SET_REPORT_MISSING");
      if (!sameGeneration(token)) return false;
      review = null; comparisonReview = null;
      return await run("exporting", async (same, signal) => {
        const file = await prepareReportSetSourceFile(snapshot, id, { signal });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { message = "選んだ元レポートを保存しました。期間レポート画面で開いて確認できます。"; });
    } catch (value) { return fail(value, token); }
  }
  async function exportMissingDraft(query, number, acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const snapshot = input;
      review = null; comparisonReview = null;
      return await run("exporting", async (same, signal) => {
        const file = await prepareMissingHistoryDraftFile(snapshot, query, number, { signal });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { message = "未取得の期間控えを保存しました。期間読み取り画面で開き、内容を確認してから読み取りを開始できます。"; });
    } catch (value) { return fail(value, token); }
  }
  async function exportReviewComparison(acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input || !review?.comparison) periodFail("PERIOD_SET_NO_COMPARISON");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const before = input, after = review.input;
      return await run("exporting", async (same, signal) => {
        const file = await prepareReportSetComparisonFile(before, after, { signal });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = "review"; message = "差し替え前後の比較を保存しました。表示中の確認セットは変更していません。"; });
    } catch (value) { return fail(value, token); }
  }
  async function reviewComparisonFile(file) {
    try {
      if (!guard()) return false;
      if (!input || !review?.comparison) periodFail("PERIOD_SET_NO_COMPARISON");
      const before = input, pending = review;
      return await run("checking-comparison", async (same, signal) => {
        const text = await readComparisonText(file, { signal });
        if (!same()) return null;
        return reviewReportSetComparisonFile(before, pending.input, text, { signal });
      }, value => {
        comparisonReview = value; phase = "review";
        message = value.matchesRecomputation ? "比較ファイルが、差し替え前と候補の元資料からの再計算と一致しました。" :
          "比較ファイルと再計算に食い違いがあります。表示中の資料も候補も変更していません。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportComparisonReview(acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!review?.comparison || !comparisonReview) periodFail("PERIOD_SET_COMPARISON_NO_REVIEW");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const checked = comparisonReview;
      return await run("exporting", async same => {
        const text = JSON.stringify(checked, null, 2) + "\n";
        const file = Object.freeze({ text, filename: "ThreeCore-report-set-comparison-review.json",
          mimeType: "application/json;charset=utf-8", byteLength: new TextEncoder().encode(text).byteLength,
          authenticated: false, encrypted: false, restorable: false, containsOriginalEvidence: false });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = "review"; message = "比較ファイルの照合結果を保存しました。資料の差し替えは行っていません。"; });
    } catch (value) { return fail(value, token); }
  }

  async function exportComparisonEvidence(acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input || !review?.comparison) periodFail("PERIOD_SET_NO_COMPARISON");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const before = input, after = review.input;
      return await run("exporting", async (same, signal) => {
        const file = await prepareReportSetComparisonEvidenceFile(before, after, { signal });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = "review"; message = "差し替え前・候補の元資料と比較結果を一式で保存しました。資料の差し替えは行っていません。"; });
    } catch (value) { return fail(value, token); }
  }
  async function reviewComparisonEvidenceFile(file) {
    try {
      if (!guard()) return false;
      return await run("checking-evidence", async (same, signal) => {
        const text = await readEvidenceText(file, { signal });
        if (!same()) return null;
        return reviewReportSetComparisonEvidence(text, { signal });
      }, value => {
        evidenceReview = value; phase = review ? "review" : input ? "ready" : "idle";
        message = value.comparisonReview.matchesRecomputation ? "証拠一式の元資料と比較結果が、再計算と一致しました。" :
          "証拠一式に入っている比較結果と再計算が一致しません。元資料は表示中の確認セットに取り込んでいません。";
      });
    } catch (value) { return fail(value); }
  }
  async function exportEvidenceReview(acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!evidenceReview) periodFail("PERIOD_SET_EVIDENCE_NO_REVIEW");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const checked = evidenceReview;
      return await run("exporting", async same => {
        const text = JSON.stringify(checked, null, 2) + "\n";
        const file = Object.freeze({ text, filename: "ThreeCore-report-set-comparison-evidence-review.json",
          mimeType: "application/json;charset=utf-8", byteLength: new TextEncoder().encode(text).byteLength,
          authenticated: false, encrypted: false, restorable: false, containsOriginalEvidence: false });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = review ? "review" : input ? "ready" : "idle"; message = "証拠一式の検証結果を保存しました。元の資料は取り込んでいません。"; });
    } catch (value) { return fail(value, token); }
  }

  async function exportEvidenceSource(role, acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!evidenceReview) periodFail("PERIOD_SET_EVIDENCE_NO_REVIEW");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const file = prepareComparisonEvidenceSourceFile(evidenceReview, role);
      return await run("exporting", async same => {
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = review ? "review" : input ? "ready" : "idle";
        message = "検証した証拠一式から、選んだ元の確認セットJSONを保存しました。表示中の資料には取り込んでいません。"; });
    } catch (value) { return fail(value, token); }
  }


  async function exportEventComparison(query, acknowledged, deliver) {
    let token = generation;
    try {
      if (!guard()) return false;
      token = ++generation;
      if (!input) periodFail("PERIOD_SET_NO_RESULT");
      if (acknowledged !== true) periodFail("PERIOD_SET_ACK");
      if (typeof deliver !== "function") periodFail("PERIOD_SET_FORMAT");
      const snapshot = input, captured = compareReportSetEvents(snapshot, query).query;
      if (!sameGeneration(token)) return false;
      return await run("exporting", async (same, signal) => {
        const file = await prepareReportSetEventComparisonFile(snapshot, captured, { signal });
        if (!same()) return null;
        const delivery = deliver(file);
        if (observeCallbackResult(delivery) !== "synchronous") periodFail("PERIOD_ASYNC_DELIVERY");
        if (delivery === false) periodFail("PERIOD_EXPORT_REFUSED");
        return file;
      }, () => { phase = review ? "review" : "ready"; message = "保存済み履歴の比較を全件保存しました。元資料は変更していません。"; });
    } catch (value) { return fail(value, token); }
  }

  function dispose() {
    if (disposed) return;
    generation++; disposed = true; phase = "disposed"; review = null; comparisonReview = null; inspection = null; checkReview = null; evidenceReview = null;
    observers.clear();
    const previous = active; active = null; previous?.abort();
    consumeCallback(() => storage.close());
  }
  return Object.freeze({ get state() { return state(); }, refresh, select, prepare, importFile, applyReview,
    inspectSources, reviewCheckFile, exportFile, exportSourceReport, exportMissingDraft, exportReviewComparison, reviewComparisonFile, exportComparisonReview, exportComparisonEvidence, reviewComparisonEvidenceFile, exportEvidenceReview, exportEvidenceSource, exportEventComparison, cancel, invalidateReview, dispose });
}
