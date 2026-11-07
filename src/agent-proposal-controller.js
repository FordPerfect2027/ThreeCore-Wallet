/** Application-owned lifecycle for one agent's explicit read-only proposal. */
import { AGENT_IDS } from "./wallet-session.js";
import { AgentProposalError, agentProposalErrorCode, inspectAgentReadProposal } from "./agent-read-proposal.js";
import { consumeCallback, observeCallbackResult } from "./security-callback.js";

export function createAgentProposalController({ agent, getSession, readPolicyText, now, onChange = () => {} }) {
  if (!AGENT_IDS.includes(agent) || [getSession, readPolicyText, now, onChange].some(fn => typeof fn !== "function")) {
    throw new AgentProposalError("INVALID_CONTEXT");
  }
  let disposed = false;
  let active = null;
  let state = Object.freeze({ agent, status: "idle", result: null, errorCode: null });
  const readSession = () => {
    const value = getSession();
    if (observeCallbackResult(value) !== "synchronous" || !value || typeof value !== "object") {
      throw new AgentProposalError("INVALID_SESSION");
    }
    return value;
  };
  const publish = (status, result = null, errorCode = null) => {
    state = Object.freeze({ agent, status, result, errorCode });
    consumeCallback(() => onChange(state));
  };
  const stop = () => {
    if (disposed) return;
    active = null;
    publish("stopped");
  };
  return Object.freeze({
    get state() { return state; },
    async inspect(proposalText) {
      if (disposed || active) return false;
      const token = {};
      active = token;
      publish("checking");
      const assertActive = () => {
        if (disposed || active !== token) throw new AgentProposalError("OPERATION_STOPPED");
      };
      try {
        assertActive();
        const session = readSession();
        assertActive();
        if (session?.state?.agent !== agent) throw new AgentProposalError("CONTROLLER_AGENT_MISMATCH");
        const context = fn => () => {
          assertActive();
          if (readSession() !== session) throw new AgentProposalError("SESSION_REPLACED");
          assertActive();
          const value = fn();
          // A callback may stop/dispose this controller before returning a
          // rejected promise. Observe it even when the operation is now stale.
          if (disposed || active !== token) observeCallbackResult(value);
          assertActive();
          return value;
        };
        const result = await inspectAgentReadProposal(session, proposalText, context(readPolicyText), context(now));
        assertActive();
        publish("observed-read-only", result);
        // Publication can synchronously stop, dispose or replace this operation.
        // Its caller may accept the result only while this token still owns it.
        assertActive();
        active = null;
        return true;
      } catch (error) {
        if (disposed || active !== token) return false;
        active = null;
        // Only locally generated proposal codes are public; adapter messages,
        // provider details and arbitrary error objects are not displayed.
        const errorCode = agentProposalErrorCode(error) ?? "READ_INSPECTION_FAILED";
        publish("rejected", null, errorCode);
        return false;
      }
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      active = null;
      publish("stopped");
    },
  });
}
