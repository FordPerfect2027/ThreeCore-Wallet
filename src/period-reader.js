import { validateSiteOrigin } from "./wallet-session.js";
import { readTokenIdentity } from "./token-identity-reader.js";
import { readTransferSnapshot } from "./transfer-reader.js";
import { periodFail, PeriodError, validatePeriodPlan, periodPlanKey, periodContextKey, periodWindows } from "./period-plan.js";
import { emptyPeriodDraft, validatePeriodDraft, periodDraftAnchors, periodDraftProgress,
  appendPeriodObservation, appendPeriodRecord } from "./period-draft.js";

const METHODS = ["getBlockSnapshot", "getContractCode", "getNativeBalance", "getTokenMetadata", "getTokenBalance", "getTransferEvents"];

function binding(session, plan) {
  const state = session?.state;
  if (!state || state.connected !== true) periodFail("PERIOD_NOT_CONNECTED");
  if (state.canSign !== false || state.canSendTransactions !== false || state.canBridge !== false) {
    periodFail("PERIOD_CAPABILITIES");
  }
  if (!METHODS.every(method => typeof session[method] === "function") ||
      !Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0) periodFail("PERIOD_SESSION");
  const key = periodContextKey({ agent: state.agent, account: state.account, chainId: state.chainId });
  if (key !== periodContextKey(plan.context)) periodFail("PERIOD_CONTEXT_MISMATCH");
  let origin;
  try { origin = validateSiteOrigin(state.siteOrigin); }
  catch { periodFail("PERIOD_SESSION"); }
  return JSON.stringify([key, state.connectionEpoch, origin]);
}

function validateHeader(value, expected) {
  if (!value || typeof value.number !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value.number) ||
      BigInt(value.number).toString() !== expected || typeof value.hash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(value.hash)) periodFail("PERIOD_HEADER");
  return value.hash.toLowerCase();
}

export function periodFailureCode(error) {
  try {
    const code = error?.code;
    return typeof code === "string" && /^(PERIOD|IDENTITY|TRANSFER)_[A-Z_]+$/.test(code)
      ? code : "PERIOD_READ_FAILED";
  } catch { return "PERIOD_READ_FAILED"; }
}

/**
 * Sequential, explicitly started reads through an already connected session.
 * No automatic retry, fallback endpoint, network switch or permission request.
 * Successful steps are emitted as immutable checkpoints. Failed requests never
 * become zero balances or empty histories. A saved checkpoint is only evidence
 * supplied by that provider; resumption does not authenticate imported records.
 */
export async function collectPeriod(session, planInput, options = {}) {
  const plan = validatePeriodPlan(planInput);
  let draft = options.draft === undefined ? emptyPeriodDraft(plan) : validatePeriodDraft(options.draft);
  let draftProgress = periodDraftProgress(draft);
  if (periodPlanKey(draft.plan) !== periodPlanKey(plan)) periodFail("PERIOD_PLAN_MISMATCH");
  const initial = binding(session, plan);
  const timeoutMs = options.timeoutMs ?? 120000;
  const stepTimeoutMs = options.stepTimeoutMs ?? 30000;
  for (const value of [timeoutMs, stepTimeoutMs]) {
    if (!Number.isInteger(value) || value < 1 || value > 120000) periodFail("PERIOD_TIMEOUT_OPTION");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) periodFail("PERIOD_SIGNAL");
  for (const callback of [options.onProgress, options.onCheckpoint]) {
    if (callback !== undefined && typeof callback !== "function") periodFail("PERIOD_OBSERVER");
  }
  if (options.signal?.aborted) periodFail("PERIOD_CANCELLED");
  const aborter = new AbortController();
  let stopped = false;
  let reason = "PERIOD_CANCELLED";
  let rejectInterrupt;
  const interrupted = new Promise((resolve, reject) => { rejectInterrupt = reject; });
  function stop(code) {
    if (stopped) return;
    stopped = true;
    reason = code;
    aborter.abort();
    rejectInterrupt(new PeriodError(code));
  }
  function guard() {
    if (stopped) periodFail(reason);
    try { if (binding(session, plan) !== initial) periodFail("PERIOD_SESSION_CHANGED"); }
    catch { periodFail("PERIOD_SESSION_CHANGED"); }
  }
  function notify(callback, value) {
    guard();
    if (callback) {
      try { Promise.resolve(callback(value)).catch(() => {}); }
      catch { /* Display/save callbacks cannot replace or authorize evidence. */ }
    }
    guard();
  }
  function progress(stage, checked = 0, checks = 0, detail = null, windowIndex = null) {
    notify(options.onProgress, Object.freeze({ stage, ...draftProgress, checked, checks, detail, windowIndex }));
  }
  function checkpoint(value) {
    guard();
    draft = validatePeriodDraft(value);
    draftProgress = periodDraftProgress(draft);
    notify(options.onCheckpoint, draft);
  }
  async function read(operation) {
    guard();
    try {
      const value = await operation();
      guard();
      return value;
    } catch (error) {
      guard();
      throw new PeriodError(periodFailureCode(error));
    }
  }
  const cancel = () => stop("PERIOD_CANCELLED");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("PERIOD_TIMEOUT"), timeoutMs);
  const stepOptions = { signal: aborter.signal, timeoutMs: stepTimeoutMs };
  async function recheck(stage) {
    const anchors = periodDraftAnchors(draft);
    for (let index = 0; index < anchors.length; index++) {
      progress(stage, index, anchors.length);
      const anchor = anchors[index];
      const value = await read(() => session.getBlockSnapshot("0x" + BigInt(anchor.number).toString(16)));
      if (validateHeader(value, anchor.number) !== anchor.hash) periodFail("PERIOD_BLOCK_CHANGED");
    }
    progress(stage, anchors.length, anchors.length);
  }
  async function collect() {
    // Resumed observations can be from a previous connection. Current-session
    // continuity is guarded separately, while their original provenance remains.
    await recheck("resume-check");
    for (const part of ["earlier", "later"]) {
      if (draft[part]) continue;
      progress(part);
      const value = await read(() => readTokenIdentity(session, {
        ...stepOptions, blockNumber: plan[part + "Block"],
        onProgress: value => progress(part, 0, 0, value.stage),
      }));
      checkpoint(appendPeriodObservation(draft, part, value));
    }
    const windows = periodWindows(plan);
    for (let index = draft.records.length; index < windows.length; index++) {
      progress("history");
      const row = windows[index];
      const record = await read(() => readTransferSnapshot(session, {
        fromBlock: row.fromBlock, toBlock: row.toBlock, lookback: Number(row.blocks),
      }, { ...stepOptions,
        onProgress: value => progress("history", value.completed, value.total, value.stage, index),
      }));
      checkpoint(appendPeriodRecord(draft, record));
    }
    // Recheck every saved event hash as well as both endpoints after all windows.
    // This detects inconsistent honest-provider views, not a malicious provider.
    await recheck("final-check");
    progress("complete");
    return draft;
  }
  try { return await Promise.race([collect(), interrupted]); }
  finally {
    stopped = true;
    aborter.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
