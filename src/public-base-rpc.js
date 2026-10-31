import { consumeCallback } from "./security-callback.js";
import { readStateRpcJson } from "./state-rpc-http.js";
import { RPC_SECURITY_LIMITS } from "./security-rpc.js";
import { captureDataRecord, captureDataArray, captureOptionalDataFields } from "./security-data.js";

const ENDPOINTS = new Set(["https://mainnet.base.org", "https://sepolia.base.org"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const ADDRESS_WORD = /^0{24}[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export class PublicBaseRpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicBaseRpcError";
    this.code = code;
  }
}
function fail(code, message) { throw new PublicBaseRpcError(code, message); }
function cancel(body) {
  consumeCallback(() => body?.cancel());
}

// This diagnostic reader accepts only the selectors used by the existing
// balance/allowance and Classic-pool inspections. No wallet transport is used.
function allowedCall(call) {
  if (!call || Object.getPrototypeOf(call) !== Object.prototype ||
      Object.keys(call).length !== 2 || !Object.hasOwn(call, "to") ||
      !Object.hasOwn(call, "data") || typeof call.to !== "string" || !ADDRESS.test(call.to) ||
      typeof call.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(call.data)) return false;
  const selector = call.data.slice(0, 10).toLowerCase();
  const data = call.data.slice(10);
  if (["0x0dfe1681", "0xd21220a7", "0x0902f1ac"].includes(selector)) return data.length === 0;
  if (selector === "0x70a08231") return data.length === 64 && ADDRESS_WORD.test(data);
  if (selector === "0xdd62ed3e") return data.length === 128 &&
    ADDRESS_WORD.test(data.slice(0, 64)) && ADDRESS_WORD.test(data.slice(64));
  return selector === "0x79bc57d5" && data.length === 192 &&
    ADDRESS_WORD.test(data.slice(0, 64)) && ADDRESS_WORD.test(data.slice(64, 128)) &&
    /^0{63}[01]$/.test(data.slice(128));
}
function validateRequest(method, params) {
  if (!["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(method))
    fail("METHOD_BLOCKED", "Only supported diagnostic read methods are permitted");
  try { params = captureDataArray(params, 2); }
  catch { fail("INVALID_PARAMS", "Invalid diagnostic read parameters"); }
  if (method === "eth_chainId" || method === "eth_blockNumber") {
    if (params.length !== 0) fail("INVALID_PARAMS", "This diagnostic read has no parameters");
    return params;
  }
  if (method === "eth_getBlockByNumber") {
    if (params.length !== 2 || typeof params[0] !== "string" || !QUANTITY.test(params[0]) || params[1] !== false)
      fail("INVALID_PARAMS", "Diagnostic headers require an explicit height without full transactions");
    return params;
  }
  let selector = params[1], call = params[0];
  try {
    if (typeof selector !== "string") {
      selector = captureDataRecord(selector, ["blockHash", "requireCanonical"]);
      if (typeof selector.blockHash !== "string" || !HASH.test(selector.blockHash) || selector.requireCanonical !== true)
        throw Error();
    } else if (!QUANTITY.test(selector)) throw Error();
    if (method === "eth_call") call = { ...captureDataRecord(call, ["to", "data"]) };
    if (params.length !== 2 || (method === "eth_getCode" ?
      typeof call !== "string" || !ADDRESS.test(call) : !allowedCall(call))) throw Error();
  } catch { fail("INVALID_PARAMS", "Diagnostic state reads require a supported input and explicit block selector"); }
  return [call, selector];
}

/** Bounded per-request deadlines and caller cancellation for fixed public Base diagnostics. */
export function createPublicBaseRpcReader(input = {}) {
  let options;
  try { options=captureOptionalDataFields(input,["rpcUrl","fetchImpl","timeoutMs","signal"]); }
  catch { fail("INVALID_OPTIONS","Diagnostic options must contain own data fields"); }
  const {rpcUrl,fetchImpl=globalThis.fetch,timeoutMs=10000,signal}=options;
  if (!ENDPOINTS.has(rpcUrl)) fail("UNSUPPORTED_ENDPOINT", "Only fixed public Base endpoints are supported");
  if (typeof fetchImpl !== "function") fail("INVALID_TRANSPORT", "Fetch transport is missing");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    fail("INVALID_TIMEOUT", "Timeout must be 100–30000 milliseconds");
  // Genuine AbortSignal state and event methods remain authoritative when shadowed.
  const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,"aborted").get;
  const isAborted=()=>{
    if(signal===undefined)return false;
    try{return Reflect.apply(nativeAborted,signal,[]);}
    catch{fail("INVALID_SIGNAL","Expected an AbortSignal");}
  };
  isAborted();
  let id = 0;
  return async function read(method, params = []) {
    if(isAborted())fail("RPC_CANCELLED","Public diagnostic read was cancelled");
    params = validateRequest(method, params);
    if(isAborted())fail("RPC_CANCELLED","Public diagnostic read was cancelled");
    const requestId = ++id;
    const body = JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params });
    const controller = new AbortController();
    let stopCode=null,timer,attached=false,rejectStop;
    const interruption=new Promise((_,reject)=>{rejectStop=reject;});
    const stop=code=>{
      if(stopCode)return;
      stopCode=code;rejectStop(new PublicBaseRpcError(code,code==="RPC_TIMEOUT"?"Base RPC did not finish within the per-request time limit":"Public diagnostic read was cancelled"));
      controller.abort();
    };
    const onAbort=()=>stop("RPC_CANCELLED");
    if(signal!==undefined){EventTarget.prototype.addEventListener.call(signal,"abort",onAbort,{once:true});attached=true;}
    if(isAborted())onAbort();
    if(!stopCode)timer=setTimeout(()=>stop("RPC_TIMEOUT"),timeoutMs);
    const work = (async () => {
      if(stopCode)fail(stopCode,"Public diagnostic read stopped before transport");
      const response = await fetchImpl(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" }, body,
        credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (stopCode || !response?.ok || response.redirected) {
        cancel(response?.body);
        fail(stopCode??"HTTP_ERROR", "Base RPC did not return an accepted HTTP response");
      }
      let json;
      try { json = await readStateRpcJson(response, { signal: controller.signal }); }
      catch { fail(stopCode??"INVALID_RPC_RESPONSE", "Base RPC returned an invalid or oversized response"); }
      if(stopCode)fail(stopCode,"Public diagnostic read stopped before result delivery");
      if (!json || json.jsonrpc !== "2.0" || json.id !== requestId ||
          !Object.hasOwn(json, "result") || Object.hasOwn(json, "error"))
        fail("INVALID_RPC_RESPONSE", "Unexpected or failed Base JSON-RPC response");
      if (method === "eth_getBlockByNumber") {
        const header = json.result;
        if (!header || typeof header.number !== "string" || !QUANTITY.test(header.number) ||
            BigInt(header.number) !== BigInt(params[0]) || typeof header.hash !== "string" || !HASH.test(header.hash))
          fail("INVALID_RPC_RESPONSE", "Base RPC returned an invalid or mismatched block header");
        return Object.freeze({ number: "0x" + BigInt(header.number).toString(16), hash: header.hash.toLowerCase() });
      }
      if (typeof json.result !== "string") fail("INVALID_RPC_RESPONSE", "Expected a diagnostic string result");
      if ((method === "eth_chainId" || method === "eth_blockNumber") && !QUANTITY.test(json.result))
        fail("INVALID_RPC_RESPONSE", "Expected a canonical hexadecimal EVM quantity");
      if (method === "eth_getCode" && (json.result.length > RPC_SECURITY_LIMITS.contractCodeCharacters ||
          !/^0x(?:[0-9a-fA-F]{2})*$/.test(json.result)))
        fail("INVALID_RPC_RESPONSE", "Invalid contract-code RPC result");
      return json.result;
    })();
    try {
      const result=await Promise.race([work,interruption]);
      if(stopCode)fail(stopCode,"Public diagnostic read stopped before result delivery");
      return result;
    } catch (error) {
      if(stopCode)fail(stopCode,stopCode==="RPC_TIMEOUT"?"Base RPC did not finish within the per-request time limit":"Public diagnostic read was cancelled");
      if (error instanceof PublicBaseRpcError) throw error;
      fail("RPC_TRANSPORT", "Base RPC transport failed");
    } finally {
      clearTimeout(timer);if(attached)EventTarget.prototype.removeEventListener.call(signal,"abort",onAbort);
      controller.abort();
    }
  };
}
