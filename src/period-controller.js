import { observeCallbackResult } from "./security-callback.js";
import { createPeriodPlan, periodPlanKey, periodContextKey, periodFail, periodShape } from "./period-plan.js";
import { emptyPeriodDraft, validatePeriodDraft, periodDraftKey, periodDraftProgress, periodDraftWorkspace } from "./period-draft.js";
import { periodFailureCode } from "./period-reader.js";
import { preparePeriodFile, readPeriodFile } from "./period-file.js";
import { prepareReconciliationFile } from "./reconciliation-file.js";
import { periodReportText } from "./period-view.js";
import { periodRecovery } from "./period-recovery.js";
import { validatePeriodProgress } from "./period-progress.js";

/** A single working checkpoint; changing plans requires a review before replacement. */
export function createPeriodController({
  getContext, read, onChange = () => {}, stageWorkspace = () => false,
  readFile = readPeriodFile, prepareFile = preparePeriodFile,
} = {}) {
  if ([getContext, read, onChange, stageWorkspace, readFile, prepareFile].some(value => typeof value !== "function")) {
    periodFail("PERIOD_CONTROLLER_OPTIONS");
  }
  let agent = "DAT";
  let draft = null;
  let draftKey = null;
  let review = null;
  let phase = "idle";
  let error = null;
  let progress = null;
  let generation = 0;
  let sourceEpoch = 0;
  let revision = 0;
  let aborter = null;
  let disposed = false;
  let checkedThisSession = false;
  let origin = null;
  let savedKey = null;
  let requiresNewPlan = false;
  // Keep the last rejected checkpoint blocked if it is reimported in this screen.
  let rejectedDraftKey = null;
  let message = "期間を入力し、計画を確認してください。";
  const busy = () => ["reading", "importing", "exporting"].includes(phase);
  function state() {
    return Object.freeze({ agent, draft, review, phase, error, progress, revision, disposed,
      checkedThisSession, origin, message, requiresNewPlan, busy: busy(),
      savedCurrent: draft !== null && draftKey === savedKey });
  }
  function emit() {
    if (disposed) return;
    try { Promise.resolve(onChange(state())).catch(() => {}); }
    catch { /* Presentation failure cannot change the stored checkpoint. */ }
  }
  function interrupt() {
    generation++;
    aborter?.abort();
    aborter = null;
  }
  function available() {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_BUSY");
    return true;
  }
  function fail(value) {
    if (disposed) return false;
    error = periodFailureCode(value);
    if (!busy()) phase = "error";
    emit();
    return false;
  }
  function context(selected = agent) { return getContext(selected); }
  function stage(value, source, requiresNewPlan = false) {
    const candidate = validatePeriodDraft(value);
    if (requiresNewPlan && periodDraftProgress(candidate).completed === 0) periodFail("PERIOD_LIBRARY_ENTRY");
    review = Object.freeze({ candidate, source, revision, sourceEpoch, requiresNewPlan,
      beforeKey: draftKey,
      requiresReplacement: draft !== null && draftKey !== periodDraftKey(candidate) &&
        periodDraftProgress(draft).completed > 0 });
    phase = "review";
    error = null;
    message = "内容を確認して控えに反映してください。";
    emit();
    return true;
  }
  function prepare(input) {
    try {
      if (!available()) return false;
      review = null;
      const plan = createPeriodPlan({ ...input, context: context() });
      return stage(emptyPeriodDraft(plan), "plan");
    } catch (value) { return fail(value); }
  }
  function apply(acknowledged = false) {
    try {
      if (!available()) return false;
      if (!review) periodFail("PERIOD_REVIEW_REQUIRED");
      if (review.revision !== revision || review.beforeKey !== draftKey) {
        periodFail("PERIOD_STALE_REVIEW");
      }
      if (review.source === "plan" && (review.sourceEpoch !== sourceEpoch ||
          periodContextKey(context()) !== periodContextKey(review.candidate.plan.context))) {
        periodFail("PERIOD_STALE_REVIEW");
      }
      if (review.requiresReplacement && acknowledged !== true) periodFail("PERIOD_REPLACE_ACK");
      interrupt();
      draft = review.candidate;
      draftKey = periodDraftKey(draft);
      origin = review.source === "plan" ? "new" : "imported";
      agent = draft.plan.context.agent;
      checkedThisSession = false;
      requiresNewPlan = review.requiresNewPlan || draftKey === rejectedDraftKey;
      if (requiresNewPlan) rejectedDraftKey = draftKey;
      revision++;
      review = null;
      phase = "ready";
      error = null;
      progress = null;
      message = "控えに反映しました。読み取りの開始は別の操作です。";
      emit();
      return true;
    } catch (value) { return fail(value); }
  }
  function stageSaved(value, options = {}) {
    try {
      if (!available()) return false;
      review = null;
      periodShape(options, ["requiresNewPlan"]);
      if (typeof options.requiresNewPlan !== "boolean") periodFail("PERIOD_LIBRARY_ENTRY");
      return stage(value, "library", options.requiresNewPlan);
    } catch (value) { return fail(value); }
  }
  function prepareRepair() {
    try {
      if (!available()) return false;
      review = null;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      const repair = periodRecovery(draft, error ?? (requiresNewPlan ? "PERIOD_NEW_PLAN_REQUIRED" : null));
      if (!repair.proposedPlan) periodFail("PERIOD_REPAIR_UNAVAILABLE");
      if (periodContextKey(context()) !== periodContextKey(draft.plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
      return stage(emptyPeriodDraft(repair.proposedPlan), "plan");
    } catch (value) { return fail(value); }
  }
  function cancel() {
    if (disposed) return;
    const reading = phase === "reading";
    interrupt();
    phase = draft ? "ready" : "idle";
    review = null;
    progress = null;
    error = null;
    if (reading) checkedThisSession = false;
    message = "処理を停止しました。取得済みの控えは保持しています。";
    emit();
  }
  function invalidate() {
    if (disposed) return;
    sourceEpoch++;
    // A source change also invalidates a plan reviewed before any RPC was sent.
    if (phase === "reading" || review?.source === "plan") {
      cancel();
      checkedThisSession = false;
      error = "PERIOD_SESSION_CHANGED";
      emit();
    }
  }
  function selectAgent(value) {
    if (disposed) return false;
    if (!["DAT", "EMA", "CAWELON"].includes(value)) return fail({ code: "PERIOD_CONTEXT" });
    if (value === agent) return true;
    cancel();
    agent = value;
    emit();
    return true;
  }
  async function start() {
    let id;
    let checkpointFailure = null;
    try {
      if (!available()) return false;
      if (review) periodFail("PERIOD_REVIEW_REQUIRED");
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (requiresNewPlan) periodFail("PERIOD_NEW_PLAN_REQUIRED");
      if (agent !== draft.plan.context.agent || periodContextKey(context()) !== periodContextKey(draft.plan.context)) {
        periodFail("PERIOD_CONTEXT_MISMATCH");
      }
      interrupt();
      id = generation;
      const localAborter = new AbortController();
      aborter = localAborter;
      const plan = draft.plan;
      const same = () => !disposed && id === generation;
      phase = "reading";
      review = null;
      error = null;
      progress = null;
      checkedThisSession = false;
      message = "接続先から読み取り中です。";
      emit();
      if (!same()) return false;
      const result = await read(plan.context.agent, plan, {
        draft, signal: localAborter.signal,
        onProgress(value) {
          if (!same()) return;
          try { progress = validatePeriodProgress(value); }
          catch { return; }
          emit();
        },
        onCheckpoint(input) {
          if (!same()) return;
          try {
            const value = validatePeriodDraft(input);
            if (periodPlanKey(value.plan) !== periodPlanKey(plan)) periodFail("PERIOD_PLAN_MISMATCH");
            // Readers may append, never rewrite observations already accepted in this run.
            if ((draft.earlier && JSON.stringify(draft.earlier) !== JSON.stringify(value.earlier)) ||
                (draft.later && JSON.stringify(draft.later) !== JSON.stringify(value.later)) ||
                value.records.length < draft.records.length ||
                draft.records.some((row, index) => JSON.stringify(row) !== JSON.stringify(value.records[index]))) {
              periodFail("PERIOD_CHECKPOINT_CONFLICT");
            }
            draft = value;
            draftKey = periodDraftKey(draft);
            revision++;
            origin = origin === "imported" ? "resumed-import" : "session";
            emit();
          } catch (failure) {
            checkpointFailure = failure;
            localAborter.abort();
          }
        },
      });
      if (!same()) return false;
      if (checkpointFailure) throw checkpointFailure;
      if (periodContextKey(context()) !== periodContextKey(plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
      const value = validatePeriodDraft(result);
      if (periodPlanKey(value.plan) !== periodPlanKey(plan) || !periodDraftProgress(value).complete ||
          periodDraftKey(value) !== draftKey) periodFail("PERIOD_INCOMPLETE");
      aborter = null;
      phase = "complete";
      checkedThisSession = true;
      progress = null;
      message = "指定期間の取得とブロック情報の再確認が完了しました。照合画面へ渡せます。";
      emit();
      return true;
    } catch (value) {
      if (id !== undefined && (disposed || id !== generation)) return false;
      if (id === undefined) return fail(value);
      aborter = null;
      phase = "error";
      progress = null;
      checkedThisSession = false;
      if (["PERIOD_BLOCK_CHANGED", "IDENTITY_BLOCK_CHANGED", "TRANSFER_BLOCK_CHANGED"].includes(periodFailureCode(value))) {
        requiresNewPlan = true;
        rejectedDraftKey = draftKey;
      }
      return fail(checkpointFailure ?? value);
    }
  }
  async function importFile(file) {
    let id;
    try {
      if (!available()) return false;
      interrupt();
      id = generation;
      review = null;
      phase = "importing";
      error = null;
      emit();
      if (disposed || id !== generation) return false;
      const value = await readFile(file);
      if (disposed || id !== generation) return false;
      return stage(value.draft, "file");
    } catch (value) {
      if (id !== undefined && (disposed || id !== generation)) return false;
      if (id === undefined) return fail(value);
      phase = "error";
      return fail(value);
    }
  }
  function sendToReconciliation() {
    try {
      if (!available()) return false;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (requiresNewPlan) periodFail("PERIOD_NEW_PLAN_REQUIRED");
      const workspace = periodDraftWorkspace(draft);
      if (stageWorkspace(workspace, draft.plan.context.agent) !== true) periodFail("PERIOD_DELIVERY_FAILED");
      message = "照合画面に確認用の候補を送りました。そちらで変更内容を確認して適用してください。";
      error = null;
      emit();
      return true;
    } catch (value) { return fail(value); }
  }
  async function exportFile(kind, deliver) {
    let id;
    try {
      if (!available()) return false;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (!["draft", "reconciliation", "text"].includes(kind) || typeof deliver !== "function") periodFail("PERIOD_FILE_KIND");
      if (requiresNewPlan && kind === "reconciliation") periodFail("PERIOD_NEW_PLAN_REQUIRED");
      interrupt();
      id = generation;
      phase = "exporting";
      error = null;
      emit();
      if (disposed || id !== generation) return false;
      const before = draft;
      const beforeKey = draftKey;
      const file = kind === "draft" ? await prepareFile(before) : kind === "reconciliation"
        ? await prepareReconciliationFile(periodDraftWorkspace(before)) : {
          text: periodReportText(before), filename: "ThreeCore-period-summary.txt", mimeType: "text/plain;charset=utf-8",
        };
      if (disposed || id !== generation) return false;
      const result = deliver(file);
      if (observeCallbackResult(result) !== "synchronous") {
        periodFail("PERIOD_ASYNC_DELIVERY");
      }
      if (result === false) periodFail("PERIOD_EXPORT_REFUSED");
      if (disposed || id !== generation) return false;
      if (kind === "draft") savedKey = beforeKey;
      phase = "ready";
      message = "ダウンロードを開始しました。保存先にファイルがあることを確認してください。";
      emit();
      return true;
    } catch (value) {
      if (id !== undefined && (disposed || id !== generation)) return false;
      if (id === undefined) return fail(value);
      phase = "error";
      return fail(value);
    }
  }
  return Object.freeze({ get state() { return state(); }, prepare, prepareRepair, stageSaved, apply, start, cancel, invalidate,
    selectAgent, importFile, exportFile, sendToReconciliation,
    dispose() {
      if (disposed) return;
      disposed = true;
      phase = "disposed";
      review = null;
      interrupt();
    },
  });
}
