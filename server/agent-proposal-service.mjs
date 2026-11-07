/** Server-owned capability and idempotency boundary. Not mounted by the demo. */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { AGENT_IDS, validateSiteOrigin } from "../src/wallet-session.js";
import { parseSecurityJson } from "../src/security-json.js";
import { captureDataRecord } from "../src/security-data.js";
import { observeCallbackResult, readSynchronousClock, consumeCallback } from "../src/security-callback.js";
import { assessAgentReadProposal } from "../src/agent-read-proposal.js";
import { ownStorageData } from "../src/storage-guard-policy.js";

const PATH = "/api/agent/proposal";
const STATE_KEYS = ["agent", "account", "chainId", "siteOrigin", "connected", "connectionEpoch",
  "canSign", "canSendTransactions", "canBridge"];
const digest = value => createHash("sha256").update(value).digest("hex");
const serviceErrors = new WeakMap();
function serviceError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  serviceErrors.set(error, { code, status });
  return error;
}
const fail = (code, status) => { throw serviceError(code, status); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    "content-type": "application/json;charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}
function snapshot(readContext, agent) {
  try {
    const source = readContext();
    if (observeCallbackResult(source) !== "synchronous") fail("CONTEXT_INVALID", 409);
    const c = captureDataRecord(source, ["policyText", "sessionState"]);
    const state = captureDataRecord(c.sessionState, STATE_KEYS);
    if (state.agent !== agent || typeof c.policyText !== "string" || c.policyText.length > 32768) fail("CONTEXT_INVALID", 409);
    return { policyText: c.policyText, sessionState: state };
  } catch { fail("CONTEXT_INVALID", 409); }
}

/**
 * register() is a trusted-host API, NEVER an HTTP route. A browser cannot choose
 * a policy, callback, account, expiry, model, request cap or endpoint. Returned
 * opaque tokens must use authenticated out-of-band delivery and memory-only
 * browser storage, not URLs/localStorage/logs. Revoke on logout/reconnect.
 * Limits are per process/session, NOT durable spending authorization.
 */
export function createAgentProposalService({ origin, enabled = false, now = Date.now,
  timeoutMs = 30000, maxRequests = 1, attemptJournal = null } = {}) {
  origin = validateSiteOrigin(origin);
  if (typeof enabled !== "boolean" || typeof now !== "function" || !integer(timeoutMs, 1, 60000) ||
      !integer(maxRequests, 1, 16)) fail("INVALID_SERVICE_CONFIG");
  if (attemptJournal !== null && (typeof attemptJournal?.reserve !== "function" ||
      typeof attemptJournal?.settle !== "function")) fail("INVALID_SERVICE_CONFIG");
  const journalCall = (operation, data) => {
    try {
      const result = attemptJournal[operation](data);
      if (observeCallbackResult(result) !== "synchronous") fail("JOURNAL_UNAVAILABLE", 503);
      return result;
    } catch (error) {
      const code = ownStorageData(error, "code");
      if (code === "JOURNAL_LIMIT_REACHED") fail("DURABLE_ATTEMPT_LIMIT", 429);
      if (code === "JOURNAL_REQUEST_CONFLICT") fail("DURABLE_REQUEST_CONFLICT", 409);
      fail("JOURNAL_UNAVAILABLE", 503);
    }
  };
  const sessions = new Map();
  const generations = new Map(AGENT_IDS.map(agent => [agent, {}]));
  let disposed = false, lastClock = -1;
  const endSession = agent => {
    const generation = {};
    // A revoke also cancels registration before the first session exists.
    if (generations.has(agent)) generations.set(agent, generation);
    const session = sessions.get(agent);
    sessions.delete(agent);
    if (session) {
      session.revoked = true;
      const active = session.active;
      session.active = null; session.jobs.clear();
      active?.abort();
    }
    return generation;
  };
  const revoke = agent => { endSession(agent); };
  const clock = () => {
    let value;
    try { value = readSynchronousClock(now); } catch { value = NaN; }
    if (!integer(value, 0, Number.MAX_SAFE_INTEGER) || value < lastClock) {
      for (const agent of AGENT_IDS) revoke(agent);
      fail("CLOCK_INVALID", 503);
    }
    lastClock = value; return value;
  };
  const requireRegistration = (agent, generation) => {
    if (disposed || generations.get(agent) !== generation) fail("SESSION_REVOKED", 401);
  };
  const registrationTime = (agent, generation, expiresAtMs) => {
    requireRegistration(agent, generation);
    const time = clock();
    requireRegistration(agent, generation);
    if (expiresAtMs <= time || expiresAtMs - time > 600000) fail("INVALID_SESSION_CONFIG");
    return time;
  };
  const requireCurrentSession = session => {
    if (disposed || session.revoked || sessions.get(session.agent) !== session) fail("SESSION_REVOKED", 401);
  };
  const sessionTime = session => {
    requireCurrentSession(session);
    const time = clock();
    // A clock callback can stop this session or replace it with a newer one.
    requireCurrentSession(session);
    if (time >= session.expiresAtMs) { revoke(session.agent); fail("SESSION_EXPIRED", 401); }
    return time;
  };
  const check = session => {
    sessionTime(session);
    let current;
    try { current = snapshot(session.readContext, session.agent); }
    catch (error) {
      if (sessions.get(session.agent) === session) revoke(session.agent);
      throw error;
    }
    // Returned data does not renew a grant revoked or expired by the callback.
    sessionTime(session);
    if (JSON.stringify(current) !== session.binding) { revoke(session.agent); fail("CONTEXT_CHANGED", 409); }
    return current;
  };
  const deliver = (session, result) => {
    try {
      // Capture own data without invoking result accessors, then validate scope
      // again: even a hostile Proxy cannot change identity during capture.
      try { result = captureDataRecord(result, ["status", "proposalText", "review", "executed", "grantsAuthority"]); }
      catch { result = captureDataRecord(result, ["status", "rationale", "proposalText", "executed", "grantsAuthority"]); }
    } catch { fail("INVALID_PROPOSER_RESULT", 502); }
    const context = check(session);
    if (result?.executed !== false || result?.grantsAuthority !== false) fail("INVALID_PROPOSER_RESULT", 502);
    if (result.status === "abstained") {
      if (result.proposalText !== null || typeof result.rationale !== "string" || result.rationale.length > 1024 || /[\u0000-\u001f\u007f]/.test(result.rationale)) fail("INVALID_PROPOSER_RESULT", 502);
      return { status: "abstained", rationale: result.rationale, proposalText: null, executed: false, grantsAuthority: false };
    }
    if (result.status !== "unexecuted-model-proposal") fail("INVALID_PROPOSER_RESULT", 502);
    const time = sessionTime(session);
    try {
      const review = assessAgentReadProposal(result.proposalText, context.policyText, context.sessionState, time);
      return { status: "unexecuted-model-proposal", proposalText: result.proposalText, review,
        executed: false, grantsAuthority: false };
    } catch { fail("PROPOSAL_NO_LONGER_ELIGIBLE", 409); }
  };
  return Object.freeze({
    register({ agent, readContext, propose, expiresAtMs }) {
      if (disposed || !enabled) fail("SERVICE_DISABLED", 503);
      if (!AGENT_IDS.includes(agent) || typeof readContext !== "function" || typeof propose !== "function" ||
          !integer(expiresAtMs, 0, Number.MAX_SAFE_INTEGER)) fail("INVALID_SESSION_CONFIG");
      const generation = generations.get(agent);
      const time = registrationTime(agent, generation, expiresAtMs);
      const context = snapshot(readContext, agent);
      requireRegistration(agent, generation);
      if (context.sessionState.siteOrigin !== origin) fail("CONTEXT_INVALID", 409);
      // Validate the host-owned context through the same gate before issuing a token.
      try {
        const p = parseSecurityJson(context.policyText, { bytes: 32768, depth: 5, nodes: 512 });
        assessAgentReadProposal(JSON.stringify({ schema: "threecore-agent-read-proposal-v1", id: "session-check",
          agent, account: p.account, chainId: p.chainId, siteOrigin: p.siteOrigin,
          policyRevision: p.revision, connectionEpoch: context.sessionState.connectionEpoch,
          createdAtMs: time, expiresAtMs: time + Math.min(p.maxProposalAgeMs, 60000),
          action: { kind: "inspect-spender", ...p.targets?.[0] }, rationale: "Host context validation" }),
        context.policyText, context.sessionState, time);
      } catch { fail("CONTEXT_INVALID", 409); }
      const binding = JSON.stringify(context);
      // Validate fully before replacing a usable grant, including callback time.
      registrationTime(agent, generation, expiresAtMs);
      const token = randomBytes(32).toString("hex");
      const session = { agent, readContext, propose, expiresAtMs, tokenHash: digest(token),
        binding, jobs: new Map(), active: null, revoked: false };
      const grant = Object.freeze({ agent, token, expiresAtMs, endpoint: new URL(PATH, origin).href });
      const commitGeneration = endSession(agent);
      // Aborting old work can revoke/dispose or register a newer grant synchronously.
      registrationTime(agent, commitGeneration, expiresAtMs);
      sessions.set(agent, session);
      return grant;
    },
    revoke,
    dispose() { disposed = true; for (const agent of AGENT_IDS) revoke(agent); },
    async handle(request) {
      let reader, deadline, removeAbort, abort;
      try {
        if (!enabled || disposed) fail("SERVICE_DISABLED", 503);
        const url = new URL(request.url);
        if (url.origin !== origin || url.pathname !== PATH || url.search || url.hash) fail("NOT_FOUND", 404);
        if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", 405);
        if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") fail("ORIGIN_DENIED", 403);
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) fail("JSON_REQUIRED", 415);
        const authorization = request.headers.get("authorization") ?? "";
        if (!/^Bearer [a-f0-9]{64}$/.test(authorization)) fail("SESSION_REQUIRED", 401);
        const tokenHash = digest(authorization.slice(7));
        const session = [...sessions.values()].find(s => timingSafeEqual(Buffer.from(s.tokenHash, "hex"), Buffer.from(tokenHash, "hex")));
        if (!session) fail("SESSION_REQUIRED", 401);
        check(session);
        if (request.signal.aborted) fail("REQUEST_CANCELLED", 499);
        abort = new AbortController();
        const cancelled = new Promise((_, reject) => {
          abort.signal.addEventListener("abort", () => reject(serviceError("REQUEST_CANCELLED", 499)), { once: true });
        });
        cancelled.catch(() => {});
        const onAbort = () => abort.abort();
        request.signal.addEventListener("abort", onAbort, { once: true });
        removeAbort = () => request.signal.removeEventListener("abort", onAbort);
        const timedOut = new Promise((_, reject) => {
          deadline = setTimeout(() => { reject(serviceError("REQUEST_TIMEOUT", 504)); abort.abort(); }, timeoutMs);
        });
        timedOut.catch(() => {});
        const bounded = work => Promise.race([work, cancelled, timedOut]);
        const length = request.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) fail("REQUEST_TOO_LARGE", 413);
        if (!request.body) fail("INVALID_REQUEST");
        reader = request.body.getReader();
        const chunks = []; let bytes = 0;
        while (true) {
          const { done, value } = await bounded(reader.read());
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 8192) fail("REQUEST_TOO_LARGE", 413);
          chunks.push(value);
        }
        let data;
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
          data = captureDataRecord(parseSecurityJson(text, { bytes: 8192, depth: 2, nodes: 16,
            keyCharacters: 32, stringCharacters: 2048 }), ["agent", "requestId", "objective"]);
        } catch { fail("INVALID_REQUEST"); }
        if (data.agent !== session.agent) fail("AGENT_MISMATCH", 403);
        if (typeof data.requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(data.requestId) ||
            typeof data.objective !== "string" || !data.objective.trim() || /[\u0000-\u001f\u007f]/.test(data.objective)) fail("INVALID_REQUEST");
        if (data.requestId.includes(authorization.slice(7)) || data.objective.includes(authorization.slice(7))) fail("INVALID_REQUEST");
        check(session);
        const hash = digest(data.objective);
        const previous = session.jobs.get(data.requestId);
        if (previous) {
          if (previous.hash !== hash) fail("REQUEST_ID_CONFLICT", 409);
          if (previous.status === "pending") return json({ status: "pending", requestId: data.requestId, executed: false }, 202);
          if (previous.status === "failed") fail("PREVIOUS_REQUEST_FAILED", 409);
          return json(deliver(session, previous.result));
        }
        if (session.active) fail("SESSION_BUSY", 409);
        if (session.jobs.size >= maxRequests) fail("REQUEST_LIMIT_REACHED", 429);
        const job = { hash, status: "pending", result: null };
        session.jobs.set(data.requestId, job); session.active = abort;
        let reservation = null;
        const settle = outcome => {
          if (reservation === null) return;
          const result = journalCall("settle", { agent: session.agent, requestId: data.requestId, reservation, outcome });
          if (result?.status !== outcome) fail("JOURNAL_UNAVAILABLE", 503);
          reservation = null;
        };
        const work = Promise.resolve().then(() => {
            check(session);
            if (abort.signal.aborted) fail("REQUEST_CANCELLED", 499);
            if (attemptJournal !== null) {
              let claim;
              try { claim = captureDataRecord(journalCall("reserve", {agent:session.agent,requestId:data.requestId,
                fingerprint:digest(JSON.stringify({binding:session.binding,objective:data.objective}))}), ["status","outcome","reservation"]); }
              catch (error) { if (serviceErrors.has(error)) throw error; fail("JOURNAL_UNAVAILABLE",503); }
              if (claim.status === "existing") fail("PREVIOUS_ATTEMPT_RECORDED",409);
              if (claim.status !== "reserved" || claim.outcome !== "reserved" || typeof claim.reservation !== "string" ||
                  !/^[a-f0-9]{64}$/.test(claim.reservation)) fail("JOURNAL_UNAVAILABLE",503);
              reservation = claim.reservation;
              check(session);
              if (abort.signal.aborted) fail("REQUEST_CANCELLED",499);
            }
            return session.propose({ objective: data.objective, readContext: () => check(session), signal: abort.signal });
        });
        // A timed-out transport may ignore AbortSignal. Keep this session busy
        // until it actually settles; a deadline is not proof of remote failure.
        const release = () => { if (session.active === abort) session.active = null; };
        work.then(release, release);
        try {
          const generated = await bounded(work);
          const result = deliver(session, generated);
          settle("completed");
          const finalResult = deliver(session, result);
          job.result = finalResult; job.status = "complete";
          return json(finalResult);
        } catch (error) {
          job.status = "failed";
          try { settle("failed"); } catch { fail("JOURNAL_UNAVAILABLE",503); }
          throw error;
        }
      } catch (error) {
        // Do not return arbitrary adapter messages, keys or server context.
        const detail = serviceErrors.get(error);
        return json({ error: detail?.code ?? "PROPOSAL_SERVICE_ERROR", executed: false },
          detail?.status ?? 502);
      } finally {
        clearTimeout(deadline); removeAbort?.(); abort?.abort();
        if (reader) consumeCallback(() => reader.cancel());
      }
    },
  });
}
