import { observeCallbackResult } from "./security-callback.js";
import { createPeriodPlan, periodPlanKey, periodContextKey, periodFail, periodShape } from "./period-plan.js";
import { emptyPeriodDraft, validatePeriodDraft, periodDraftKey, periodDraftProgress, periodDraftWorkspace } from "./period-draft.js";
import { periodFailureCode } from "./period-reader.js";
import { preparePeriodFile, readPeriodFile } from "./period-file.js";
import { prepareReconciliationFile } from "./reconciliation-file.js";
import { periodReportText } from "./period-view.js";
import { periodRecovery } from "./period-recovery.js";
import { validatePeriodProgress } from "./period-progress.js";
import { createStateNotifier } from "./state-notifier.js";

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
  let notificationRevision = 0;
  const observers = new Set([() => onChange(state())]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ revision: notificationRevision }) });
  function emit() {
    if (disposed) return;
    notificationRevision++;
    notifier.notify();
  }
  function interrupt() {
    const id = ++generation, previous = aborter;
    aborter = null;
    previous?.abort();
    return id;
  }
  function available() {
    if (disposed) return false;
    if (busy()) periodFail("PERIOD_BUSY");
    return true;
  }
  function fail(value, id = generation) {
    if (!same(id)) return false;
    const code = periodFailureCode(value);
    if (!same(id)) return false;
    error = code;
    if (!busy()) phase = "error";
    emit();
    return false;
  }
  function context(selected = agent) { return getContext(selected); }
  const same = id => !disposed && generation === id;
  function stage(value, source, requiresNewPlan = false, id = generation) {
    const candidate = validatePeriodDraft(value);
    if (requiresNewPlan && periodDraftProgress(candidate).completed === 0) periodFail("PERIOD_LIBRARY_ENTRY");
    if (!same(id)) return false;
    review = Object.freeze({ candidate, source, revision, sourceEpoch, requiresNewPlan,
      beforeKey: draftKey,
      requiresReplacement: draft !== null && draftKey !== periodDraftKey(candidate) &&
        periodDraftProgress(draft).completed > 0 });
    phase = "review";
    error = null;
    message = "内容を確認して控えに反映してください。";
    emit();
    return same(id);
  }
  function prepare(input) {
    let id;
    try {
      if (!available()) return false;
      review = null;
      id = ++generation;
      const epoch = sourceEpoch;
      input = periodShape(input, ["earlierBlock", "laterBlock", "windowSize"]);
      const plan = createPeriodPlan({ ...input, context: context() });
      if (!same(id)) return false;
      if (epoch !== sourceEpoch) periodFail("PERIOD_STALE_REVIEW");
      return stage(emptyPeriodDraft(plan), "plan", false, id);
    } catch (value) { return id !== undefined && !same(id) ? false : fail(value); }
  }
  function apply(acknowledged = false) {
    let id;
    try {
      if (!available()) return false;
      if (!review) periodFail("PERIOD_REVIEW_REQUIRED");
      id = generation;
      const pending = review;
      if (pending.revision !== revision || pending.beforeKey !== draftKey) {
        periodFail("PERIOD_STALE_REVIEW");
      }
      if (pending.requiresReplacement && acknowledged !== true) periodFail("PERIOD_REPLACE_ACK");
      if (pending.source === "plan") {
        const currentContext = periodContextKey(context());
        if (!same(id) || review !== pending) return false;
        if (pending.sourceEpoch !== sourceEpoch || currentContext !== periodContextKey(pending.candidate.plan.context)) {
          periodFail("PERIOD_STALE_REVIEW");
        }
      }
      id = interrupt();
      if (!same(id) || review !== pending) return false;
      draft = pending.candidate;
      draftKey = periodDraftKey(draft);
      origin = pending.source === "plan" ? "new" : "imported";
      agent = draft.plan.context.agent;
      checkedThisSession = false;
      requiresNewPlan = pending.requiresNewPlan || draftKey === rejectedDraftKey;
      if (requiresNewPlan) rejectedDraftKey = draftKey;
      revision++;
      review = null;
      phase = "ready";
      error = null;
      progress = null;
      message = "控えに反映しました。読み取りの開始は別の操作です。";
      emit();
      return same(id);
    } catch (value) { return id !== undefined && !same(id) ? false : fail(value); }
  }
  function stageSaved(value, options = {}) {
    let id;
    try {
      if (!available()) return false;
      review = null;
      id = ++generation;
      options = periodShape(options, ["requiresNewPlan"]);
      if (typeof options.requiresNewPlan !== "boolean") periodFail("PERIOD_LIBRARY_ENTRY");
      return stage(value, "library", options.requiresNewPlan, id);
    } catch (value) { return id !== undefined && !same(id) ? false : fail(value); }
  }
  function prepareRepair() {
    let id;
    try {
      if (!available()) return false;
      review = null;
      id = ++generation;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      const repair = periodRecovery(draft, error ?? (requiresNewPlan ? "PERIOD_NEW_PLAN_REQUIRED" : null));
      if (!repair.proposedPlan) periodFail("PERIOD_REPAIR_UNAVAILABLE");
      if (periodContextKey(context()) !== periodContextKey(draft.plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
      return stage(emptyPeriodDraft(repair.proposedPlan), "plan", false, id);
    } catch (value) { return id !== undefined && !same(id) ? false : fail(value); }
  }
  function cancel() {
    if (disposed) return;
    const reading = phase === "reading";
    const id = interrupt();
    if (!same(id)) return;
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
      const id = generation + 1;
      cancel();
      if (!same(id)) return;
      checkedThisSession = false;
      error = "PERIOD_SESSION_CHANGED";
      emit();
    }
  }
  function selectAgent(value) {
    if (disposed) return false;
    if (!["DAT", "EMA", "CAWELON"].includes(value)) return fail({ code: "PERIOD_CONTEXT" });
    if (value === agent) return true;
    const id = generation + 1;
    cancel();
    if (!same(id)) return false;
    agent = value;
    emit();
    return same(id);
  }
  async function start() {
    let id;
    let checkpointFailure = null;
    try {
      if (!available()) return false;
      id = ++generation;
      if (review) periodFail("PERIOD_REVIEW_REQUIRED");
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (requiresNewPlan) periodFail("PERIOD_NEW_PLAN_REQUIRED");
      const epoch = sourceEpoch;
      const currentContext = periodContextKey(context());
      if (!same(id)) return false;
      if (epoch !== sourceEpoch || agent !== draft.plan.context.agent || currentContext !== periodContextKey(draft.plan.context)) {
        periodFail("PERIOD_CONTEXT_MISMATCH");
      }
      id = interrupt();
      if (!same(id)) return false;
      const localAborter = new AbortController();
      aborter = localAborter;
      const plan = draft.plan;
      const stillCurrent = () => same(id);
      phase = "reading";
      review = null;
      error = null;
      progress = null;
      checkedThisSession = false;
      message = "接続先から読み取り中です。";
      emit();
      if (!stillCurrent()) return false;
      const result = await read(plan.context.agent, plan, {
        draft, signal: localAborter.signal,
        onProgress(value) {
          if (!stillCurrent()) return;
          let captured;
          try { captured = validatePeriodProgress(value); }
          catch { return; }
          if (!stillCurrent()) return;
          progress = captured;
          emit();
        },
        onCheckpoint(input) {
          if (!stillCurrent()) return;
          try {
            const value = validatePeriodDraft(input);
            if (!stillCurrent()) return;
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
            if (!stillCurrent()) return;
            checkpointFailure = failure;
            localAborter.abort();
          }
        },
      });
      if (!stillCurrent()) return false;
      if (checkpointFailure) throw checkpointFailure;
      const finalContext = periodContextKey(context());
      if (!stillCurrent()) return false;
      if (finalContext !== periodContextKey(plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
      const value = validatePeriodDraft(result);
      if (!stillCurrent()) return false;
      if (periodPlanKey(value.plan) !== periodPlanKey(plan) || !periodDraftProgress(value).complete ||
          periodDraftKey(value) !== draftKey) periodFail("PERIOD_INCOMPLETE");
      aborter = null;
      phase = "complete";
      checkedThisSession = true;
      progress = null;
      message = "指定期間の取得とブロック情報の再確認が完了しました。照合画面へ渡せます。";
      emit();
      return stillCurrent();
    } catch (value) {
      if (id !== undefined && (disposed || id !== generation)) return false;
      if (id === undefined) return fail(value);
      const code = periodFailureCode(checkpointFailure ?? value);
      if (!same(id)) return false;
      aborter = null;
      phase = "error";
      progress = null;
      checkedThisSession = false;
      if (["PERIOD_BLOCK_CHANGED", "IDENTITY_BLOCK_CHANGED", "TRANSFER_BLOCK_CHANGED"].includes(code)) {
        requiresNewPlan = true;
        rejectedDraftKey = draftKey;
      }
      return fail({ code }, id);
    }
  }
  async function importFile(file) {
    let id;
    let localAborter;
    try {
      if (!available()) return false;
      id = interrupt();
      if (!same(id)) return false;
      review = null;
      phase = "importing";
      error = null;
      emit();
      if (disposed || id !== generation) return false;
      localAborter = new AbortController();
      aborter = localAborter;
      const value = await readFile(file, { signal: localAborter.signal });
      if (disposed || id !== generation) return false;
      return stage(value.draft, "file", false, id);
    } catch (value) {
      if (id !== undefined && (disposed || id !== generation)) return false;
      if (id === undefined) return fail(value);
      phase = "error";
      return fail(value);
    }
    finally { if (localAborter && aborter === localAborter) aborter = null; }
  }
  function sendToReconciliation() {
    const id = generation;
    try {
      if (!available()) return false;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (requiresNewPlan) periodFail("PERIOD_NEW_PLAN_REQUIRED");
      const workspace = periodDraftWorkspace(draft);
      const delivery = stageWorkspace(workspace, draft.plan.context.agent);
      const mode = observeCallbackResult(delivery);
      if (!same(id)) return false;
      if (mode !== "synchronous" || delivery !== true) periodFail("PERIOD_DELIVERY_FAILED");
      message = "照合画面に確認用の候補を送りました。そちらで変更内容を確認して適用してください。";
      error = null;
      emit();
      return same(id);
    } catch (value) { return fail(value, id); }
  }
  async function exportFile(kind, deliver) {
    let id;
    try {
      if (!available()) return false;
      if (!draft) periodFail("PERIOD_NO_DRAFT");
      if (!["draft", "reconciliation", "text"].includes(kind) || typeof deliver !== "function") periodFail("PERIOD_FILE_KIND");
      if (requiresNewPlan && kind === "reconciliation") periodFail("PERIOD_NEW_PLAN_REQUIRED");
      id = interrupt();
      if (!same(id)) return false;
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
      observers.clear();
      phase = "disposed";
      review = null;
      interrupt();
    },
  });
}
