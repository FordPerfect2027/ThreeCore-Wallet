import { catalogToken } from "./token-catalog.js";
import { identityAddress, identityFail, TokenIdentityError } from "./token-identity-codec.js";
import { validateTokenObservation, assessTokenObservation, compareTokenObservations } from "./token-identity-model.js";
import { prepareTokenIdentityFile, readTokenIdentityFile } from "./token-identity-report.js";
import { readErrorCode } from "./provider-error.js";

function context(input) {
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

  function publish(patch) {
    state = Object.freeze({ ...state, ...patch, baseline });
    try { onChange(state); } catch { /* A display callback cannot change results. */ }
  }
  function invalidate(phase = "idle") {
    if (disposed) return;
    generation++;
    active?.abort();
    active = null;
    baseline = null;
    publish({ phase, observation: null, provenance: null, assessment: null,
      comparison: null, file: null, errorCode: null, progress: null });
  }
  function start(phase) {
    if (disposed) identityFail("IDENTITY_DISPOSED");
    generation++;
    active?.abort();
    active = null;
    const identity = context(getContext());
    const operation = { id: generation, identity, key: JSON.stringify(identity) };
    const clear = phase === "reading" || phase === "loading"
      ? { observation: null, provenance: null, assessment: null } : {};
    publish({ phase, file: null, errorCode: null, comparison: null, progress: null, ...clear });
    return operation;
  }
  function current(operation) {
    if (disposed || generation !== operation.id) return false;
    let same;
    try { same = JSON.stringify(context(getContext())) === operation.key; }
    catch { same = false; }
    if (!same) {
      invalidate();
      publish({ phase: "error", errorCode: "IDENTITY_STALE" });
    }
    return same;
  }
  function failure(operation, error) {
    if (operation && !current(operation)) return false;
    if (disposed) return false;
    const code = readErrorCode(error);
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
      let operation;
      try {
        operation = start("reading");
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
          if (!current(operation) || state.phase !== "reading" || !update ||
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
        active = null;
        publish({ phase: "ready", observation, assessment: assessTokenObservation(observation), provenance: "read", progress: null });
        return true;
      } catch (error) { return failure(operation, error); }
    },
    async load(file) {
      let operation;
      try {
        operation = start("loading");
        if (!current(operation)) return false;
        const loaded = await readTokenIdentityFile(file, { subtle });
        if (!current(operation)) return false;
        if (loaded.observation.agent !== operation.identity.agent) identityFail("IDENTITY_IMPORT_AGENT");
        publish({ phase: "ready", observation: loaded.observation,
          assessment: assessTokenObservation(loaded.observation), provenance: "imported" });
        return true;
      } catch (error) { return failure(operation, error); }
    },
    async prepareFile() {
      let operation;
      try {
        if (!state.observation) identityFail("IDENTITY_NO_RESULT");
        const observation = state.observation;
        operation = start("preparing");
        if (!current(operation)) return false;
        const file = await prepareTokenIdentityFile(observation, { subtle });
        if (!current(operation)) return false;
        publish({ phase: "ready", file });
        return true;
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
      try {
        if (state.phase !== "ready" || !baseline || !state.observation) identityFail("IDENTITY_NO_RESULT");
        const comparison = compareTokenObservations(baseline, state.observation);
        publish({ comparison, errorCode: null });
        return true;
      } catch (error) {
        // A failed comparison should not discard either inspected record.
        publish({ comparison: null, errorCode: readErrorCode(error) ?? "IDENTITY_UNAVAILABLE" });
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      state = Object.freeze({ ...state, phase: "disposed" });
    },
  });
}
