import { allowanceFail, AllowanceError, allowanceAddress, allowanceContext, parseAllowanceTargets,
  assertAllowanceContext, allowanceTargetsKey } from "./allowance-targets.js";
import { validateAllowanceObservation, compareAllowances } from "./allowance-observation.js";
import { readAllowanceFile, prepareAllowanceFile } from "./allowance-file.js";
import { readErrorCode } from "./provider-error.js";

function context(input) {
  return Object.freeze({ ...allowanceContext(input),
    account: input.account ? allowanceAddress(input.account) : null });
}

/** Explicit, ephemeral UI operations. No timers, automatic storage or RPC. */
export function createAllowanceController({ getContext, read, onChange = () => {}, subtle } = {}) {
  if (typeof getContext !== "function" || typeof read !== "function" || typeof onChange !== "function") {
    allowanceFail("ALLOWANCE_ADAPTER");
  }
  let disposed = false;
  let generation = 0;
  let active = null;
  let baseline = null;
  let state = Object.freeze({
    phase: "idle", plan: null, preview: null, observation: null, provenance: null,
    baseline: null, comparison: null, progress: null, file: null, errorCode: null,
  });
  const notify = patch => {
    state = Object.freeze({ ...state, ...patch, baseline });
    try { Promise.resolve(onChange(state)).catch(() => {}); } catch {}
  };
  function interrupt() { generation++; active?.abort(); active = null; }
  function reset(phase = "idle", keepBaseline = false) {
    if (disposed) return;
    interrupt();
    if (!keepBaseline) baseline = null;
    notify({ phase, plan: null, preview: null, observation: null, provenance: null,
      comparison: null, progress: null, file: null, errorCode: null });
  }
  function begin(phase, changes = {}) {
    if (disposed) allowanceFail("ALLOWANCE_DISPOSED");
    interrupt();
    const identity = context(getContext());
    const operation = { id: generation, identity, key: JSON.stringify(identity) };
    notify({ phase, progress: null, file: null, errorCode: null, comparison: null, ...changes });
    return operation;
  }
  function current(operation) {
    if (disposed || operation.id !== generation) return false;
    let key;
    try { key = JSON.stringify(context(getContext())); } catch {}
    if (key !== operation.key) {
      reset();
      notify({ phase: "error", errorCode: "ALLOWANCE_CONTEXT_CHANGED" });
      return false;
    }
    return true;
  }
  function failure(operation, error) {
    if (disposed || (operation && !current(operation))) return false;
    interrupt();
    notify({ phase: "error", observation: null, provenance: null, preview: null,
      progress: null, comparison: null, file: null,
      errorCode: readErrorCode(error) ?? "ALLOWANCE_UNAVAILABLE" });
    return false;
  }
  return Object.freeze({
    state: () => state,
    invalidate() { reset(); },
    editTargets() { reset("idle", true); },
    cancel() { reset("cancelled"); },
    preview(text) {
      let operation;
      try {
        operation = begin("previewing", { plan: null, preview: null, observation: null, provenance: null });
        if (!current(operation)) return false;
        const plan = parseAllowanceTargets(text, operation.identity);
        notify({ phase: "preview", preview: Object.freeze({ id: operation.id, key: operation.key, plan }) });
        return true;
      } catch (error) { return failure(operation, error); }
    },
    apply() {
      if (disposed) return false;
      try {
        const preview = state.preview;
        if (!preview || state.phase !== "preview") allowanceFail("ALLOWANCE_REVIEW_REQUIRED");
        if (preview.id !== generation || preview.key !== JSON.stringify(context(getContext()))) {
          reset();
          allowanceFail("ALLOWANCE_CONTEXT_CHANGED");
        }
        const plan = assertAllowanceContext(preview.plan, getContext());
        interrupt();
        notify({ phase: "configured", plan, preview: null, observation: null, provenance: null,
          file: null, progress: null, errorCode: null });
        return true;
      } catch (error) { return failure(null, error); }
    },
    async inspect() {
      let operation;
      try {
        const plan = state.plan;
        if (!plan) allowanceFail("ALLOWANCE_REVIEW_REQUIRED");
        operation = begin("reading", { preview: null, observation: null, provenance: null });
        if (!current(operation)) return false;
        assertAllowanceContext(plan, operation.identity);
        if (!operation.identity.account) allowanceFail("ALLOWANCE_NOT_CONNECTED");
        const abort = new AbortController();
        active = abort;
        let lastCompleted = -1;
        const allowedStages = ["token", "spender-code", "allowance", "row-complete", "canonical", "complete"];
        const onProgress = value => {
          if (!current(operation) || state.phase !== "reading" || !value ||
              value.agent !== plan.agent || !allowedStages.includes(value.stage) ||
              value.total !== plan.targets.length || !Number.isInteger(value.completed) ||
              value.completed < 0 || value.completed > value.total || value.completed < lastCompleted) return;
          if (value.spenderAddress !== null && !plan.targets.some(target => target.address === value.spenderAddress)) return;
          lastCompleted = value.completed;
          notify({ progress: Object.freeze({ stage: value.stage, completed: value.completed,
            total: value.total, spenderAddress: value.spenderAddress }) });
        };
        const result = await read(plan, { signal: abort.signal, onProgress });
        if (!current(operation)) return false;
        const observation = validateAllowanceObservation(result);
        if (["agent", "chainId", "tokenAddress", "account"].some(key =>
          observation.identity[key] !== operation.identity[key]) ||
          allowanceTargetsKey(observation.targets) !== allowanceTargetsKey(plan)) allowanceFail("ALLOWANCE_RESULT_CONTEXT");
        active = null;
        notify({ phase: "ready", observation, provenance: "read", progress: null });
        return true;
      } catch (error) { return failure(operation, error); }
    },
    async load(file) {
      let operation;
      try {
        operation = begin("loading", { preview: null, observation: null, provenance: null });
        if (!current(operation)) return false;
        const result = await readAllowanceFile(file, { subtle });
        if (!current(operation)) return false;
        if (result.kind === "targets") {
          const plan = assertAllowanceContext(result.payload, operation.identity);
          notify({ phase: "preview", plan: null,
            preview: Object.freeze({ id: operation.id, key: operation.key, plan }) });
        } else {
          if (result.payload.identity.agent !== operation.identity.agent) allowanceFail("ALLOWANCE_IMPORT_AGENT");
          notify({ phase: "ready", observation: result.payload, provenance: "imported" });
        }
        return true;
      } catch (error) { return failure(operation, error); }
    },
    async prepare(kind) {
      let operation;
      try {
        const payload = kind === "targets" ? state.plan : kind === "observation" ? state.observation : null;
        if (!payload) allowanceFail("ALLOWANCE_NO_RESULT");
        operation = begin("preparing");
        if (!current(operation)) return false;
        const file = await prepareAllowanceFile(kind, payload, { subtle });
        if (!current(operation)) return false;
        notify({ phase: state.observation ? "ready" : "configured", file });
        return true;
      } catch (error) { return failure(operation, error); }
    },
    useAsBaseline() {
      if (disposed) return false;
      if (state.phase !== "ready" || !state.observation) return failure(null, new AllowanceError("ALLOWANCE_NO_RESULT"));
      baseline = state.observation;
      notify({ comparison: null, errorCode: null, file: null });
      return true;
    },
    compare() {
      if (disposed) return false;
      try {
        if (state.phase !== "ready" || !baseline || !state.observation) allowanceFail("ALLOWANCE_NO_RESULT");
        const comparison = compareAllowances(baseline, state.observation);
        notify({ comparison, errorCode: null });
        return true;
      } catch (error) {
        notify({ comparison: null, errorCode: readErrorCode(error) ?? "ALLOWANCE_UNAVAILABLE" });
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      state = Object.freeze({ ...state, phase: "disposed" });
    },
  });
}
