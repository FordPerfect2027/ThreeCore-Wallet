/** Optional same-origin proposal transport. Stages data, never executes a wallet action. */
import { AGENT_IDS, validateSiteOrigin } from "./wallet-session.js";
import { captureDataRecord } from "./security-data.js";
import { parseSecurityJson } from "./security-json.js";
import { assessAgentReadProposal } from "./agent-read-proposal.js";
import { consumeCallback, observeCallbackResult, readSynchronousClock } from "./security-callback.js";

const STATE_KEYS = ["agent", "account", "chainId", "siteOrigin", "connected", "connectionEpoch",
  "canSign", "canSendTransactions", "canBridge"];
const SERVER_ERRORS = new Set(["SERVICE_DISABLED", "SESSION_REQUIRED", "SESSION_REVOKED", "SESSION_EXPIRED",
  "CONTEXT_CHANGED", "CONTEXT_INVALID", "CLOCK_INVALID", "SESSION_BUSY", "REQUEST_LIMIT_REACHED",
  "REQUEST_ID_CONFLICT", "PREVIOUS_REQUEST_FAILED", "PREVIOUS_ATTEMPT_RECORDED", "DURABLE_REQUEST_CONFLICT",
  "DURABLE_ATTEMPT_LIMIT", "JOURNAL_UNAVAILABLE", "REQUEST_TIMEOUT", "REQUEST_CANCELLED",
  "PROPOSAL_NO_LONGER_ELIGIBLE", "PROPOSAL_SERVICE_ERROR", "HOST_BUSY", "HOST_REQUEST_TIMEOUT",
  "SERVICE_UNAVAILABLE", "HTTP_HOST_ERROR"]);
const clientErrors = new WeakMap();
function clientError(code) {
  const error = new Error(code);
  error.code = code;
  clientErrors.set(error, code);
  return error;
}
const fail = code => { throw clientError(code); };
const integer = (v,min,max) => Number.isSafeInteger(v) && v >= min && v <= max;
const identifier = v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v);

/**
 * Only the authenticated host may supply a grant. Never source grants from URL,
 * imported records, model output or localStorage. No request occurs on mount,
 * acceptGrant, refresh, reconnect, cancellation or state notification.
 */
export function createAgentProposalClient({ agent, origin, enabled = false, readContext, stageProposal,
  fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000, maxRequests = 16, onChange = () => {} } = {}) {
  origin = validateSiteOrigin(origin);
  const endpoint = origin + "/api/agent/proposal";
  if (!AGENT_IDS.includes(agent) || typeof enabled !== "boolean" ||
      [readContext, stageProposal, fetchImpl, now, onChange].some(fn => typeof fn !== "function") ||
      !integer(timeoutMs,1,60000) || !integer(maxRequests,1,64)) fail("INVALID_CLIENT_CONFIG");
  let grant = null, binding = null, disposed = false, generation = 0, active = null, lastTime = -1, sent = 0;
  const requests = new Map();
  let state = Object.freeze({agent,status:enabled?"unavailable":"disabled",requestId:null,errorCode:null,attempts:0});
  const publish = (status,requestId=null,errorCode=null) => {
    state = Object.freeze({agent,status,requestId,errorCode,attempts:sent});
    consumeCallback(() => onChange(state));
  };
  const clock = () => {
    let value;
    try { value = readSynchronousClock(now); } catch { fail("CLIENT_CLOCK_INVALID"); }
    if (!integer(value,0,Number.MAX_SAFE_INTEGER) || value < lastTime) fail("CLIENT_CLOCK_INVALID");
    lastTime = value; return value;
  };
  const context = () => {
    try {
      const value = readContext();
      if (observeCallbackResult(value) !== "synchronous") fail("CLIENT_CONTEXT_INVALID");
      const c = captureDataRecord(value,["policyText","sessionState"]);
      const sessionState = captureDataRecord(c.sessionState,STATE_KEYS);
      if (typeof c.policyText !== "string" || c.policyText.length > 32768 || sessionState.agent !== agent) fail("CLIENT_CONTEXT_INVALID");
      return {policyText:c.policyText,sessionState};
    } catch { fail("CLIENT_CONTEXT_INVALID"); }
  };
  const invalidate = status => {
    const previous = active;
    generation++; grant = null; binding = null;
    active = null;
    publish(status);
    // Publish the detached state before abort listeners can accept a new grant
    // or explicitly start new work. Old cleanup must not overwrite that work.
    previous?.abort.abort();
  };
  const current = operation => {
    if (disposed || !enabled || !grant || operation && active !== operation) fail("CLIENT_UNAVAILABLE");
    if (clock() >= grant.expiresAtMs) fail("CLIENT_GRANT_EXPIRED");
    const c = context();
    if (JSON.stringify(c) !== binding) fail("CLIENT_CONTEXT_CHANGED");
    if (disposed || !grant || operation && active !== operation) fail("CLIENT_UNAVAILABLE");
    return c;
  };
  return Object.freeze({
    get state() { return state; },
    acceptGrant(input) {
      if (disposed || !enabled) return false;
      const version = generation;
      let commitVersion = null;
      try {
        const incoming = captureDataRecord(input,["agent","token","expiresAtMs","endpoint"]);
        const time = clock();
        if (incoming.agent !== agent || incoming.endpoint !== endpoint || typeof incoming.token !== "string" ||
            !/^[a-f0-9]{64}$/.test(incoming.token) || !integer(incoming.expiresAtMs,time+1,time+600000)) fail("INVALID_CLIENT_GRANT");
        const c = context(), p = parseSecurityJson(c.policyText,{bytes:32768,depth:5,nodes:512});
        if (c.sessionState.siteOrigin !== origin) fail("CLIENT_CONTEXT_INVALID");
        const checkedTime = clock();
        if (incoming.expiresAtMs <= checkedTime) fail("INVALID_CLIENT_GRANT");
        assessAgentReadProposal(JSON.stringify({schema:"threecore-agent-read-proposal-v1",id:"client-grant-check",agent,
          account:p.account,chainId:p.chainId,siteOrigin:p.siteOrigin,connectionEpoch:c.sessionState.connectionEpoch,
          policyRevision:p.revision,createdAtMs:checkedTime,expiresAtMs:checkedTime+Math.min(p.maxProposalAgeMs,60000),
          action:{kind:"inspect-spender",...p.targets?.[0]},rationale:"Validate host binding"}),c.policyText,c.sessionState,checkedTime);
        const nextBinding = JSON.stringify(c);
        if (disposed || version !== generation) return false;
        const previous = active;
        commitVersion = ++generation;
        active = null; grant = null; binding = null;
        previous?.abort.abort();
        if (disposed || generation !== commitVersion) return false;
        const commitTime = clock();
        if (disposed || generation !== commitVersion) return false;
        if (incoming.expiresAtMs <= commitTime) fail("INVALID_CLIENT_GRANT");
        grant = incoming; binding = nextBinding; sent = 0; requests.clear();
        publish("ready"); return !disposed && grant === incoming;
      } catch {
        // Invalid input preserves the previous grant. Once replacement has
        // detached it, failure revokes only this still-owned pending commit.
        if (commitVersion !== null && !disposed && generation === commitVersion) invalidate("revoked");
        return false;
      }
    },
    refresh() {
      if (disposed || !grant) return false;
      const version = generation, observedGrant = grant;
      const ownsGrant = () => !disposed && generation === version && grant === observedGrant;
      try {
        current();
        if (!ownsGrant()) return false;
        const time = clock();
        if (!ownsGrant()) return false;
        if (time >= observedGrant.expiresAtMs) fail("CLIENT_GRANT_EXPIRED");
        return true;
      } catch {
        // An old observation cannot revoke a grant accepted by its callbacks.
        if (ownsGrant()) invalidate("revoked");
        return false;
      }
    },
    cancel() {
      if (disposed || !active) return;
      const previous = active;
      generation++;active = null;publish("cancelled",previous.requestId);
      previous.abort.abort();
    },
    revoke() {if (!disposed) invalidate("revoked");},
    dispose() {if (!disposed) {disposed = true;invalidate("disposed");}},
    async request(input) {
      if (disposed || !enabled || !grant) return Object.freeze({status:"rejected",errorCode:"CLIENT_UNAVAILABLE",executed:false});
      if (active) return Object.freeze({status:"rejected",errorCode:"CLIENT_BUSY",executed:false});
      let data, operation, reader, response, timer;
      // Reserve before invoking validation callbacks: they can synchronously
      // reenter, cancel, or replace the grant without starting another request.
      operation = {abort:new AbortController(),requestId:null,version:generation};
      active = operation;
      try {
        data = captureDataRecord(input,["requestId","objective"]);
        if (!identifier(data.requestId) || data.requestId.includes(grant.token) || typeof data.objective !== "string" || !data.objective.trim() ||
            data.objective.length > 2048 || /[\u0000-\u001f\u007f]/.test(data.objective) || data.objective.includes(grant.token)) fail("INVALID_CLIENT_REQUEST");
        if (requests.has(data.requestId) && requests.get(data.requestId) !== data.objective) fail("CLIENT_REQUEST_CONFLICT");
        operation.requestId = data.requestId;
        current(operation);
        if (sent >= maxRequests) fail("CLIENT_REQUEST_LIMIT");
        const credential = grant.token;
        const cancelled = new Promise((_,reject) => operation.abort.signal.addEventListener("abort",()=>reject(clientError("CLIENT_CANCELLED")),{once:true}));
        cancelled.catch(()=>{});
        const timeout = new Promise((_,reject) => {timer = setTimeout(()=>{reject(clientError("CLIENT_TIMEOUT"));operation.abort.abort();},timeoutMs);});
        timeout.catch(()=>{});
        const bounded = work => Promise.race([work,cancelled,timeout]);
        sent++;requests.set(data.requestId,data.objective);publish("requesting",data.requestId);
        current(operation);
        const transport = Promise.resolve().then(()=>{
          current(operation);
          return fetchImpl(endpoint,{method:"POST",mode:"same-origin",credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer",
            headers:{"content-type":"application/json",authorization:`Bearer ${credential}`},
            body:JSON.stringify({agent,requestId:data.requestId,objective:data.objective}),signal:operation.abort.signal});
        }).then(value => {
          // Some transports ignore AbortSignal. Own every returned body, even
          // after the caller has already timed out or revoked this operation.
          if (disposed || active !== operation || operation.abort.signal.aborted ||
              generation !== operation.version) {
            consumeCallback(() => value?.body?.cancel());
            fail("CLIENT_CANCELLED");
          }
          response = value;
          return value;
        });
        response = await bounded(transport);
        current(operation);
        if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type")??"")) fail("INVALID_SERVICE_RESPONSE");
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length)>131072)) fail("SERVICE_RESPONSE_TOO_LARGE");
        if (!response.body) fail("INVALID_SERVICE_RESPONSE");
        reader = response.body.getReader();let size = 0,text = "";
        const decoder = new TextDecoder("utf-8",{fatal:true});
        while (true) {
          const chunk = await bounded(reader.read());current(operation);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size>131072) fail("SERVICE_RESPONSE_TOO_LARGE");
          text += decoder.decode(chunk.value,{stream:true});
        }
        text += decoder.decode();
        if (text.includes(credential)) fail("INVALID_SERVICE_RESPONSE");
        const result = parseSecurityJson(text,{bytes:131072,depth:8,nodes:1024,stringCharacters:65536});
        if (JSON.stringify(result).includes(credential)) fail("INVALID_SERVICE_RESPONSE");
        const c = current(operation);
        if (response.status === 202) {
          const pending = captureDataRecord(result,["status","requestId","executed"]);
          if (pending.status !== "pending" || pending.requestId !== data.requestId || pending.executed !== false) fail("INVALID_SERVICE_RESPONSE");
          publish("pending",data.requestId);current(operation);return Object.freeze({status:"pending",requestId:data.requestId,executed:false});
        }
        if (response.status !== 200) {
          const error = captureDataRecord(result,["error","executed"]);
          fail(error.executed === false && SERVER_ERRORS.has(error.error)?error.error:"SERVICE_REJECTED");
        }
        if (result.status === "abstained") {
          const abstained = captureDataRecord(result,["status","rationale","proposalText","executed","grantsAuthority"]);
          if (abstained.executed !== false || abstained.grantsAuthority !== false || abstained.proposalText !== null ||
              typeof abstained.rationale !== "string" || abstained.rationale.length>1024 || /[\u0000-\u001f\u007f]/.test(abstained.rationale)) fail("INVALID_SERVICE_RESPONSE");
          publish("abstained",data.requestId);current(operation);return Object.freeze({status:"abstained",requestId:data.requestId,executed:false});
        }
        const proposal = captureDataRecord(result,["status","proposalText","review","executed","grantsAuthority"]);
        if (proposal.status !== "unexecuted-model-proposal" || proposal.executed !== false || proposal.grantsAuthority !== false) fail("INVALID_SERVICE_RESPONSE");
        assessAgentReadProposal(proposal.proposalText,c.policyText,c.sessionState,clock());
        current(operation);
        const accepted = stageProposal(proposal.proposalText);
        if (observeCallbackResult(accepted) !== "synchronous" || accepted !== true) fail("CLIENT_DELIVERY_REJECTED");
        current(operation);
        publish("staged",data.requestId);current(operation);return Object.freeze({status:"staged",requestId:data.requestId,executed:false});
      } catch (error) {
        // Never traverse adapter exception prototypes while settling a request.
        const code = clientErrors.get(error) ?? "CLIENT_REQUEST_FAILED";
        if (!disposed && (!operation || active === operation)) {
          if (["CLIENT_CONTEXT_CHANGED","CLIENT_CONTEXT_INVALID","CLIENT_GRANT_EXPIRED","CLIENT_CLOCK_INVALID"].includes(code)) invalidate("revoked");
          else publish("rejected",identifier(data?.requestId) && !data.requestId.includes(grant?.token??"\u0000") ? data.requestId : null,code);
        }
        return Object.freeze({status:"rejected",errorCode:code,executed:false});
      } finally {
        clearTimeout(timer);operation?.abort.abort();
        if (reader) consumeCallback(()=>reader.cancel());
        else if (response) consumeCallback(()=>response.body?.cancel());
        if (active === operation) active = null;
      }
    },
  });
}
