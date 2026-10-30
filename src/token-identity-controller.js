import { catalogToken } from "./token-catalog.js";
import { identityAddress, identityFail, identityObject, TokenIdentityError } from "./token-identity-codec.js";
import { validateTokenObservation, assessTokenObservation, compareTokenObservations } from "./token-identity-model.js";
import { prepareTokenIdentityFile, readTokenIdentityFile } from "./token-identity-report.js";
import { readOwnErrorCode } from "./provider-error.js";
import { createStateNotifier } from "./state-notifier.js";

function context(input) {
  const captured = {};
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) identityFail("IDENTITY_SHAPE");
    for (const key of ["agent", "chainId", "account", "tokenAddress"]) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor && ["account", "tokenAddress"].includes(key)) continue;
      if (!descriptor || !Object.hasOwn(descriptor, "value")) identityFail("IDENTITY_SHAPE");
      captured[key] = descriptor.value;
    }
  } catch { identityFail("IDENTITY_SHAPE"); }
  input = captured;
  const token = catalogToken({ agent: input.agent, chainId: input.chainId });
  const account = input.account ? identityAddress(input.account) : null;
  const tokenAddress = input.tokenAddress ? identityAddress(input.tokenAddress) : token.address;
  return Object.freeze({ agent: token.agent, chainId: token.chainId, account, tokenAddress });
}

/** Ephemeral presentation state. No automatic reads, storage, or reconnection. */
export function createTokenIdentityController({ getContext, read, onChange = () => {}, subtle } = {}) {
  if (typeof getContext !== "function" || typeof read !== "function" || typeof onChange !== "function") {
    identityFail("IDENTITY_ADAPTER");
  }
  let generation = 0;
  let disposed = false;
  let active = null;
  let baseline = null;
  let state = Object.freeze({ phase: "idle", observation: null, provenance: null,
    assessment: null, baseline: null, comparison: null, file: null, errorCode: null, progress: null });
  let revision = 0;
  const observers = new Set([() => onChange(state)]);
  const notifier = createStateNotifier({ observers, read: () => Object.freeze({ revision }) });

  function publish(patch) {
    if (disposed) return;
    state = Object.freeze({ ...state, ...patch, baseline });
    revision++;
    notifier.notify();
  }
  const owns = operation => !disposed && operation.id === generation;
  function invalidate(phase = "idle", errorCode = null) {
    if (disposed) return;
    const id = ++generation;
    const abort = active;
    active = null;
    abort?.abort();
    if (disposed || generation !== id) return;
    baseline = null;
    publish({ phase, observation: null, provenance: null, assessment: null,
      comparison: null, file: null, errorCode, progress: null });
  }
  function start(phase, operation) {
    if (disposed) identityFail("IDENTITY_DISPOSED");
    operation.id = ++generation;
    const abort = active;
    active = null;
    abort?.abort();
    if (!owns(operation)) return false;
    const identity = context(getContext());
    if (!owns(operation)) return false;
    Object.assign(operation, { identity, key: JSON.stringify(identity) });
    const clear = phase === "reading" || phase === "loading"
      ? { observation: null, provenance: null, assessment: null } : {};
    publish({ phase, file: null, errorCode: null, comparison: null, progress: null, ...clear });
    return owns(operation);
  }
  function current(operation) {
    if (!owns(operation)) return false;
    let same;
    try { same = JSON.stringify(context(getContext())) === operation.key; }
    catch { same = false; }
    if (!owns(operation)) return false;
    if (!same) {
      invalidate("error", "IDENTITY_STALE");
    }
    return same;
  }
  function failure(operation, error) {
    if (operation && (!owns(operation) || (operation.key !== null && !current(operation)))) return false;
    if (disposed) return false;
    const id = generation;
    const code = readOwnErrorCode(error);
    if (disposed || generation !== id) return false;
    active = null;
    publish({ phase: "error", observation: null, provenance: null,
      assessment: null, file: null, comparison: null, progress: null,
      errorCode: typeof code === "string" ? code : "IDENTITY_UNAVAILABLE" });
    return false;
  }
  return Object.freeze({
    state: () => state,
    invalidate,
    cancel() { invalidate("cancelled"); },
    async inspect() {
      const operation = { id: generation, key: null };
      try {
        if (!start("reading", operation)) return false;
        if (!current(operation)) return false;
        if (!operation.identity.account) identityFail("IDENTITY_NOT_CONNECTED");
        if (operation.identity.tokenAddress !== catalogToken({
          agent: operation.identity.agent, chainId: operation.identity.chainId,
        }).address) identityFail("IDENTITY_CONTRACT_MISMATCH");
        const abort = new AbortController();
        active = abort;
        const stages = ["block", "code", "native", "metadata", "balance", "canonical", "complete"];
        let lastStage = -1;
        const onProgress = update => {
          if (!current(operation) || state.phase !== "reading") return;
          try { update = identityObject(update, ["agent", "stage"]); } catch { return; }
          if (!owns(operation) || state.phase !== "reading" ||
              update.agent !== operation.identity.agent) return;
          const index = stages.indexOf(update.stage);
          if (index < 0 || index <= lastStage) return;
          lastStage = index;
          publish({ progress: update.stage });
        };
        const result = await read({ tokenAddress: operation.identity.tokenAddress, signal: abort.signal, onProgress });
        if (!current(operation)) return false;
        const observation = validateTokenObservation(result);
        if (["agent", "account", "chainId", "tokenAddress"].some(key =>
          observation[key] !== operation.identity[key])) identityFail("IDENTITY_SESSION_CHANGED");
        if (!current(operation)) return false;
        active = null;
        publish({ phase: "ready", observation, assessment: assessTokenObservation(observation), provenance: "read", progress: null });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    async load(file) {
      const operation = { id: generation, key: null };
      try {
        if (!start("loading", operation)) return false;
        if (!current(operation)) return false;
        const loaded = await readTokenIdentityFile(file, { subtle });
        if (!current(operation)) return false;
        if (loaded.observation.agent !== operation.identity.agent) identityFail("IDENTITY_IMPORT_AGENT");
        publish({ phase: "ready", observation: loaded.observation,
          assessment: assessTokenObservation(loaded.observation), provenance: "imported" });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    async prepareFile() {
      const operation = { id: generation, key: null };
      try {
        if (!state.observation) identityFail("IDENTITY_NO_RESULT");
        const observation = state.observation;
        if (!start("preparing", operation)) return false;
        if (!current(operation)) return false;
        const file = await prepareTokenIdentityFile(observation, { subtle });
        if (!current(operation)) return false;
        publish({ phase: "ready", file });
        return owns(operation);
      } catch (error) { return failure(operation, error); }
    },
    useAsBaseline() {
      if (disposed) return false;
      if (!["ready"].includes(state.phase) || !state.observation) return failure(null, new TokenIdentityError("IDENTITY_NO_RESULT"));
      baseline = state.observation;
      publish({ comparison: null, file: null, errorCode: null });
      return true;
    },
    compare() {
      if (disposed) return false;
      const id = generation;
      try {
        if (state.phase !== "ready" || !baseline || !state.observation) identityFail("IDENTITY_NO_RESULT");
        const comparison = compareTokenObservations(baseline, state.observation);
        publish({ comparison, errorCode: null });
        return true;
      } catch (error) {
        // A failed comparison should not discard either inspected record.
        const code = readOwnErrorCode(error) ?? "IDENTITY_UNAVAILABLE";
        if (!disposed && generation === id) publish({ comparison: null, errorCode: code });
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      observers.clear();
      const abort = active;
      active = null;
      baseline = null;
      state = Object.freeze({ phase: "disposed", observation: null, provenance: null,
        assessment: null, baseline: null, comparison: null, file: null, errorCode: null, progress: null });
      abort?.abort();
    },
  });
}
