import { allowanceFail, AllowanceError, allowanceAddress, allowanceContext, parseAllowanceTargets,
  assertAllowanceContext, allowanceTargetsKey } from "./allowance-targets.js";
import { validateAllowanceObservation, compareAllowances } from "./allowance-observation.js";
import { readAllowanceFile, prepareAllowanceFile } from "./allowance-file.js";
import { readOwnErrorCode } from "./provider-error.js";
import { captureDataRecord } from "./security-data.js";
import { createStateNotifier } from "./state-notifier.js";

function context(input) {
  const captured = {};
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) allowanceFail("ALLOWANCE_CONTEXT");
    for (const key of ["agent", "chainId", "account", "tokenAddress"]) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor && ["account", "tokenAddress"].includes(key)) continue;
      if (!descriptor || !Object.hasOwn(descriptor, "value")) allowanceFail("ALLOWANCE_CONTEXT");
      captured[key] = descriptor.value;
    }
  } catch { allowanceFail("ALLOWANCE_CONTEXT"); }
  input = captured;
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
  let revision = 0;
  const observers = new Set([() => onChange(state)]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ revision }) });
  const owns = operation => !disposed && operation.id === generation;
  const notify = patch => {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch, baseline });
    revision++;
    notifier.notify();
  };
  function interrupt(operation) {
    const id = ++generation;
    if (operation) operation.id = id;
    const abort = active;
    active = null;
    abort?.abort();
    return id;
  }
  function reset(phase = "idle", keepBaseline = false, errorCode = null) {
    if (disposed) return;
    const id = interrupt();
    if (disposed || generation !== id) return;
    if (!keepBaseline) baseline = null;
    notify({ phase, plan: null, preview: null, observation: null, provenance: null,
      comparison: null, progress: null, file: null, errorCode });
  }
  function begin(operation, phase, changes = {}) {
    if (disposed) allowanceFail("ALLOWANCE_DISPOSED");
    interrupt(operation);
    if (!owns(operation)) return false;
    const identity = context(getContext());
    if (!owns(operation)) return false;
    Object.assign(operation, { identity, key: JSON.stringify(identity) });
    notify({ phase, progress: null, file: null, errorCode: null, comparison: null, ...changes });
    return owns(operation);
  }
  function current(operation) {
    if (!owns(operation)) return false;
    let key;
    try { key = JSON.stringify(context(getContext())); } catch {}
    if (!owns(operation)) return false;
    if (key !== operation.key) {
      reset("error", false, "ALLOWANCE_CONTEXT_CHANGED");
      return false;
    }
    return true;
  }
  function failure(operation, error) {
    if (disposed || (operation && (!owns(operation) || (operation.key !== null && !current(operation))))) return false;
    const previous = generation;
    const errorCode = readOwnErrorCode(error) ?? "ALLOWANCE_UNAVAILABLE";
    if (disposed || generation !== previous) return false;
    const id = interrupt();
    if (disposed || generation !== id) return false;
    notify({ phase: "error", observation: null, provenance: null, preview: null,
      progress: null, comparison: null, file: null,
      errorCode });
    return false;
  }
  return Object.freeze({
    state: () => state,
    invalidate() { reset(); },
    editTargets() { reset("idle", true); },
    cancel() { reset("cancelled"); },
    preview(text) {
      const operation = { id: generation, key: null };
      try {
        if (!begin(operation, "previewing", { plan: null, preview: null, observation: null, provenance: null })) return false;
        if (!current(operation)) return false;
        const plan = parseAllowanceTargets(text, operation.identity);
        notify({ phase: "preview", preview: Object.freeze({ id: operation.id, key: operation.key, plan }) });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    apply() {
      if (disposed) return false;
      const operation = { id: generation, key: null };
      try {
        const preview = state.preview;
        if (!preview || state.phase !== "preview") allowanceFail("ALLOWANCE_REVIEW_REQUIRED");
        const identity = context(getContext());
        if (!owns(operation) || state.preview !== preview) return false;
        if (preview.id !== generation || preview.key !== JSON.stringify(identity)) {
          reset("error", false, "ALLOWANCE_CONTEXT_CHANGED");
          return false;
        }
        const plan = assertAllowanceContext(preview.plan, identity);
        if (!owns(operation) || state.preview !== preview) return false;
        interrupt(operation);
        if (!owns(operation)) return false;
        notify({ phase: "configured", plan, preview: null, observation: null, provenance: null,
          file: null, progress: null, errorCode: null });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    async inspect() {
      const operation = { id: generation, key: null };
      try {
        const plan = state.plan;
        if (!plan) allowanceFail("ALLOWANCE_REVIEW_REQUIRED");
        if (!begin(operation, "reading", { preview: null, observation: null, provenance: null })) return false;
        if (!current(operation)) return false;
        assertAllowanceContext(plan, operation.identity);
        if (!operation.identity.account) allowanceFail("ALLOWANCE_NOT_CONNECTED");
        const abort = new AbortController();
        active = abort;
        let lastCompleted = -1;
        const allowedStages = ["token", "spender-code", "allowance", "row-complete", "canonical", "complete"];
        const onProgress = value => {
          if (!current(operation) || state.phase !== "reading") return;
          try { value = captureDataRecord(value, ["agent", "stage", "completed", "total", "spenderAddress"]); } catch { return; }
          if (!owns(operation) || state.phase !== "reading" ||
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
        if (!current(operation)) return false;
        active = null;
        notify({ phase: "ready", observation, provenance: "read", progress: null });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    async load(file) {
      const operation = { id: generation, key: null };
      let abort;
      try {
        if (!begin(operation, "loading", { preview: null, observation: null, provenance: null })) return false;
        if (!current(operation)) return false;
        abort = new AbortController(); active = abort;
        const result = await readAllowanceFile(file, { subtle, signal: abort.signal });
        if (!current(operation)) return false;
        if (result.kind === "targets") {
          const plan = assertAllowanceContext(result.payload, operation.identity);
          notify({ phase: "preview", plan: null,
            preview: Object.freeze({ id: operation.id, key: operation.key, plan }) });
        } else {
          if (result.payload.identity.agent !== operation.identity.agent) allowanceFail("ALLOWANCE_IMPORT_AGENT");
          notify({ phase: "ready", observation: result.payload, provenance: "imported" });
        }
        return owns(operation);
      } catch (error) { return failure(operation, error); }
      finally { if (active === abort) active = null; }
    },
    async prepare(kind) {
      const operation = { id: generation, key: null };
      let abort;
      try {
        const payload = kind === "targets" ? state.plan : kind === "observation" ? state.observation : null;
        if (!payload) allowanceFail("ALLOWANCE_NO_RESULT");
        if (!begin(operation, "preparing")) return false;
        if (!current(operation)) return false;
        abort = new AbortController(); active = abort;
        const file = await prepareAllowanceFile(kind, payload, { subtle, signal: abort.signal });
        if (!current(operation)) return false;
        notify({ phase: state.observation ? "ready" : "configured", file });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
      finally { if (active === abort) active = null; }
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
      const id = generation;
      try {
        if (state.phase !== "ready" || !baseline || !state.observation) allowanceFail("ALLOWANCE_NO_RESULT");
        const comparison = compareAllowances(baseline, state.observation);
        notify({ comparison, errorCode: null });
        return true;
      } catch (error) {
        const code = readOwnErrorCode(error) ?? "ALLOWANCE_UNAVAILABLE";
        if (!disposed && generation === id) notify({ comparison: null, errorCode: code });
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observers.clear();
      generation++;
      const abort = active;
      active = null;
      baseline = null;
      state = Object.freeze({ phase: "disposed", plan: null, preview: null, observation: null, provenance: null,
        baseline: null, comparison: null, progress: null, file: null, errorCode: null });
      abort?.abort();
    },
  });
}
