/** A second, explicit capability boundary before any provider request. */
export class RpcSecurityError extends Error {
  constructor(code) {
    super(code);
    this.name = "RpcSecurityError";
    this.code = code;
  }
}
const fail = code => { throw new RpcSecurityError(code); };
export const READ_RPC_METHODS = Object.freeze([
  "eth_chainId", "eth_accounts", "eth_getBalance", "eth_getCode",
  "eth_getBlockByNumber", "eth_call", "eth_getLogs",
]);
export const RPC_SECURITY_LIMITS = Object.freeze({
  accounts: 128,
  contractCodeCharacters: 2 + 2 * 128 * 1024,
  callCharacters: 1026,
  logEntries: 500,
});
const address = value => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const hash = value => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const quantity = value => typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value);
const selectors = new Set(["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd"]);
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function object(value, fields, optional = []) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("RPC_REQUEST_SHAPE");
    const keys = Reflect.ownKeys(value);
    if (keys.length > fields.length + optional.length ||
        keys.some(key => ![...fields, ...optional].includes(key))) fail("RPC_REQUEST_SHAPE");
    const result = {};
    for (const key of [...fields, ...optional]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) {
        if (fields.includes(key)) fail("RPC_REQUEST_SHAPE");
        continue;
      }
      if (!("value" in descriptor)) fail("RPC_REQUEST_SHAPE");
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof RpcSecurityError) throw error;
    fail("RPC_REQUEST_SHAPE");
  }
}

function array(value, count, code = "RPC_REQUEST_SHAPE") {
  try {
    if (!Array.isArray(value) || value.length > count ||
        Reflect.ownKeys(value).length !== value.length + 1) fail(code);
    const copied = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !("value" in descriptor)) fail(code);
      copied.push(descriptor.value);
    }
    return copied;
  } catch (error) {
    if (error instanceof RpcSecurityError) throw error;
    fail(code);
  }
}

function blockSelector(value) {
  if (value === "latest") return value;
  const input = object(value, ["blockHash", "requireCanonical"]);
  if (!hash(input.blockHash) || input.requireCanonical !== true) fail("RPC_UNPINNED_BLOCK");
  return Object.freeze(input);
}

/** No arbitrary RPC passthrough. A permission call is separately opt-in. */
export function guardRpcRequest(input, { account, tokenAddress, allowPermission = false } = {}) {
  const args = object(input, ["method"], ["params"]);
  if (typeof args.method !== "string" ||
      !(READ_RPC_METHODS.includes(args.method) || (allowPermission && args.method === "eth_requestAccounts"))) {
    fail("RPC_METHOD_BLOCKED");
  }
  if (["eth_chainId", "eth_accounts", "eth_requestAccounts"].includes(args.method)) {
    if (Object.hasOwn(args, "params") && array(args.params, 0).length) fail("RPC_REQUEST_SHAPE");
    return Object.freeze({ method: args.method });
  }
  const params = array(args.params, 2);
  if (args.method === "eth_getLogs") {
    if (params.length !== 1 || !address(account) || !address(tokenAddress)) fail("RPC_REQUEST_SHAPE");
    const query = object(params[0], ["address", "fromBlock", "toBlock", "topics"]);
    if (query.address !== tokenAddress || !quantity(query.fromBlock) || !quantity(query.toBlock) ||
        BigInt(query.fromBlock) > BigInt(query.toBlock)) fail("RPC_LOG_FILTER");
    const topics = array(query.topics, 3);
    const owner = "0x" + account.slice(2).toLowerCase().padStart(64, "0");
    const incoming = topics.length === 3 && topics[1] === null && topics[2] === owner;
    const outgoing = topics.length === 2 && topics[1] === owner;
    if (topics[0] !== transferTopic || !(incoming || outgoing)) fail("RPC_LOG_FILTER");
    return Object.freeze({ method: args.method, params: Object.freeze([
      Object.freeze({ ...query, topics: Object.freeze(topics) }),
    ]) });
  }
  if (params.length !== 2) fail("RPC_REQUEST_SHAPE");
  if (args.method === "eth_getBlockByNumber") {
    if (!(params[0] === "latest" || quantity(params[0])) || params[1] !== false) fail("RPC_BLOCK_FILTER");
  } else {
    params[1] = blockSelector(params[1]);
    if (["eth_getBalance", "eth_getCode"].includes(args.method)) {
      if (!address(params[0])) fail("RPC_REQUEST_SHAPE");
      if (args.method === "eth_getBalance" && params[0] !== account) fail("RPC_ACCOUNT_MISMATCH");
    } else if (args.method === "eth_call") {
      const call = object(params[0], ["to", "data"]);
      if (!address(call.to) || typeof call.data !== "string" || call.data.length > 138) fail("RPC_CALL_BLOCKED");
      const owner = address(account) ? account.slice(2).toLowerCase().padStart(64, "0") : null;
      const balance = owner && call.data === "0x70a08231" + owner;
      const allowance = owner && call.data.startsWith("0xdd62ed3e" + owner) &&
        /^0xdd62ed3e[0-9a-f]{64}0{24}[0-9a-f]{40}$/.test(call.data);
      if (!selectors.has(call.data) && !balance && !allowance) fail("RPC_CALL_BLOCKED");
      params[0] = Object.freeze(call);
    }
  }
  return Object.freeze({ method: args.method, params: Object.freeze(params) });
}

function boundedString(value, limit) {
  if (typeof value === "string" && value.length > limit) fail("RPC_RESULT_LIMIT");
  // Existing semantic decoders retain responsibility for malformed values.
  if (value !== null && typeof value === "object") fail("RPC_RESULT_SHAPE");
  return value;
}

/** Snapshot data descriptors; provider getters never run during interpretation. */
function responseObject(value, fields, exact = false) {
  if (value === null) return null;
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("RPC_RESULT_SHAPE");
    if (exact) {
      const keys = Reflect.ownKeys(value);
      if (keys.length !== fields.length || keys.some(key => !fields.some(([field]) => field === key))) {
        fail("RPC_RESULT_SHAPE");
      }
    }
    const result = {};
    for (const [field, maximum] of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor) continue;
      if (!("value" in descriptor)) fail("RPC_RESULT_SHAPE");
      result[field] = maximum === "topics"
        ? Object.freeze(array(descriptor.value, 4, "RPC_RESULT_SHAPE").map(item => boundedString(item, 66)))
        : boundedString(descriptor.value, maximum);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof RpcSecurityError) throw error;
    fail("RPC_RESULT_SHAPE");
  }
}

export function guardRpcResponse(method, value) {
  if (method === "eth_chainId") return boundedString(value, 18);
  if (method === "eth_getBalance") return boundedString(value, 1026);
  if (method === "eth_getCode") return boundedString(value, RPC_SECURITY_LIMITS.contractCodeCharacters);
  if (method === "eth_call") return boundedString(value, RPC_SECURITY_LIMITS.callCharacters);
  if (method === "eth_accounts" || method === "eth_requestAccounts") {
    if (!Array.isArray(value)) return null;
    return Object.freeze(array(value, RPC_SECURITY_LIMITS.accounts, "RPC_RESULT_LIMIT")
      .map(item => boundedString(item, 42)));
  }
  if (method === "eth_getBlockByNumber") {
    return responseObject(value, [["number", 66], ["hash", 66]]);
  }
  if (method === "eth_getLogs") {
    // Keep TRANSFER_EVENT_LIMIT as the public limit error from the session.
    if (!Array.isArray(value) || value.length > RPC_SECURITY_LIMITS.logEntries) return value;
    return Object.freeze(array(value, RPC_SECURITY_LIMITS.logEntries, "RPC_RESULT_LIMIT").map(log =>
      responseObject(log, [["address", 42], ["topics", "topics"], ["data", 66],
        ["blockNumber", 66], ["blockHash", 66], ["transactionHash", 66],
        ["transactionIndex", 66], ["logIndex", 66], ["removed", 1]], true)));
  }
  fail("RPC_METHOD_BLOCKED");
}
