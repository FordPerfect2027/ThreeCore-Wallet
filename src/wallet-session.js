import { guardRpcRequest, guardRpcResponse, RpcSecurityError } from "./security-rpc.js";
import { safeProviderFailure } from "./security-provider-error.js";
/**
 * ThreeCore browser-wallet connection adapter (EIP-1193).
 *
 * This adapter NEVER signs messages, sends transactions, switches networks,
 * bridges funds, or stores private keys. It can only request account access
 * and perform read-only RPC queries after an explicit connection action.
 *
 * Each session binds exactly one of DAT / EMA / CAWELON to one selected
 * account, one decentralized-site origin and one expected EVM chain.
 */

import { readErrorCode } from "./provider-error.js";
import { METADATA_FIELDS, decodeMetadataField, identityAddress, identityFail,
  validateTokenMetadata } from "./token-identity-codec.js";
import { catalogToken } from "./token-catalog.js";
import { TRANSFER_TOPIC, MAX_TRANSFER_EVENTS, addressTopic, decodeTransferLog,
  hexQuantity, shape, transferFail, validateTransferRange } from "./transfer-codec.js";

export const AGENT_IDS = Object.freeze(["DAT", "EMA", "CAWELON"]);

export const CHAINS = Object.freeze({
  BASE_MAINNET: Object.freeze({ id: 8453, hex: "0x2105" }),
  BASE_SEPOLIA: Object.freeze({ id: 84532, hex: "0x14a34" }),
});

export class WalletConnectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletConnectionError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new WalletConnectionError(code, message);
}

export function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    reject("INVALID_ADDRESS", "A complete 20-byte EVM address is required");
  }
  return value.toLowerCase();
}

export function normalizeChainId(value) {
  if (typeof value !== "string" || value.length > 16 || !/^0x[0-9a-fA-F]+$/.test(value)) {
    reject("INVALID_CHAIN", "The wallet did not return a hexadecimal chain ID");
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) reject("INVALID_CHAIN", "Chain ID exceeds the supported integer range");
  return Number(parsed);
}

export function validateSiteOrigin(value) {
  if (typeof value !== "string") reject("INVALID_ORIGIN", "Missing site origin");
  let url;
  try {
    url = new URL(value);
  } catch {
    reject("INVALID_ORIGIN", "Invalid decentralized-site origin");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.origin !== value || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    reject("INVALID_ORIGIN", "Use a bare HTTPS origin (HTTP permitted only on localhost)");
  }
  return url.origin;
}

function validateProvider(provider) {
  let request;
  try { request = provider?.request; } catch {}
  if (typeof request !== "function") {
    reject("NO_PROVIDER", "An EIP-1193 wallet provider is required");
  }
  return request;
}

const BLOCK_NUMBER = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;

// A local timeout cannot close a Wallet's permission dialog. Keep the guard
// across session/controller replacement until the original provider settles.
const pendingPermissions = new WeakMap();
function requestPermission(provider, request) {
  if (pendingPermissions.has(provider)) {
    reject("PERMISSION_PENDING", "The Wallet still has an outstanding permission request");
  }
  const marker = {};
  pendingPermissions.set(provider, marker);
  const release = () => {
    if (pendingPermissions.get(provider) === marker) pendingPermissions.delete(provider);
  };
  try {
    return Promise.resolve(request.call(provider, { method: "eth_requestAccounts" })).then(
      value => { release(); return value; },
      error => { release(); throw error; },
    );
  } catch (error) {
    release();
    throw error;
  }
}

function blockSelector(hash) {
  if (hash === undefined) return "latest";
  if (typeof hash !== "string" || !BLOCK_HASH.test(hash)) {
    reject("INVALID_BLOCK_HASH", "A complete 32-byte block hash is required");
  }
  // Unsupported providers must reject; never retry using an unpinned state.
  return Object.freeze({ blockHash: hash.toLowerCase(), requireCanonical: true });
}

function decodeBlockHeader(value) {
  if (value === null) reject("BLOCK_UNAVAILABLE", "The selected block is unavailable");
  if (!value || typeof value.number !== "string" || !BLOCK_NUMBER.test(value.number) ||
      typeof value.hash !== "string" || !BLOCK_HASH.test(value.hash)) {
    reject("INVALID_RPC_RESULT", "Expected a mined block number and 32-byte hash");
  }
  return Object.freeze({
    number: "0x" + BigInt(value.number).toString(16),
    hash: value.hash.toLowerCase(),
  });
}

export class ThreeCoreWalletSession {
  #provider;
  #request;
  #isAccessAllowed;
  #agent;
  #origin;
  #expectedAccount;
  #chainId;
  #connected = false;
  #connectionEpoch = 0;
  #pendingConnect = null;
  #readTimeoutMs;
  #connectTimeoutMs;
  #permissionTimeoutMs;
  #pendingRequests = new Set();
  #onAccountsChanged;
  #onChainChanged;
  #onDisconnect;

  constructor({ provider, agent, siteOrigin, approvedOrigins, expectedAccount, chainId,
    isAccessAllowed = () => true, readTimeoutMs = 30_000, connectTimeoutMs = 30_000, permissionTimeoutMs = 120_000 }) {
    this.#request = validateProvider(provider);
    if (typeof isAccessAllowed !== "function") reject("INVALID_ACCESS_GUARD", "Access guard must be a function");
    this.#isAccessAllowed = isAccessAllowed;
    if (!Number.isInteger(readTimeoutMs) || readTimeoutMs < 1 || readTimeoutMs > 120_000) {
      reject("INVALID_READ_TIMEOUT", "Read timeout must be an integer from 1 to 120000 milliseconds");
    }
    this.#readTimeoutMs = readTimeoutMs;
    if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs < 1 || connectTimeoutMs > 120_000 ||
        !Number.isInteger(permissionTimeoutMs) || permissionTimeoutMs < 1 || permissionTimeoutMs > 300_000) {
      reject("INVALID_CONNECT_TIMEOUT", "Connection timeout must be 1..120000ms and permission timeout 1..300000ms");
    }
    this.#connectTimeoutMs = connectTimeoutMs;
    this.#permissionTimeoutMs = permissionTimeoutMs;
    if (!AGENT_IDS.includes(agent)) reject("INVALID_AGENT", "Unknown ThreeCore agent");
    this.#origin = validateSiteOrigin(siteOrigin);
    if (!Array.isArray(approvedOrigins) ||
        !approvedOrigins.some((origin) => validateSiteOrigin(origin) === this.#origin)) {
      reject("SITE_NOT_APPROVED", "This decentralized site has not been approved");
    }
    if (![CHAINS.BASE_MAINNET.id, CHAINS.BASE_SEPOLIA.id].includes(chainId)) {
      reject("UNSUPPORTED_CHAIN", "The requested network has not been enabled");
    }
    this.#provider = provider;
    this.#agent = agent;
    this.#expectedAccount = normalizeAddress(expectedAccount);
    this.#chainId = chainId;
  }

  get state() {
    return Object.freeze({
      agent: this.#agent,
      siteOrigin: this.#origin,
      account: this.#connected ? this.#expectedAccount : null,
      chainId: this.#chainId,
      connected: this.#connected,
      // Composite readers must compare this across all of their subreads.
      // It identifies a generation of this instance, not a chain snapshot.
      connectionEpoch: this.#connectionEpoch,
      canSign: false,
      canSendTransactions: false,
      canBridge: false,
    });
  }

  async #confirmChain(epoch, reading = false) {
    const args = { method: "eth_chainId" };
    const value = await (reading ? this.#requestRead(epoch, args) : this.#requestConnect(epoch, args));
    // Check ownership before interpreting a delayed result: an obsolete read
    // must never disconnect a later, explicitly established session.
    if (reading) this.#assertReadEpoch(epoch);
    else this.#ensureEpoch(epoch);
    let actual;
    try {
      actual = normalizeChainId(value);
    } catch (error) {
      this.disconnect();
      throw error;
    }
    if (actual !== this.#chainId) {
      this.disconnect();
      reject("WRONG_CHAIN", "Expected chain " + this.#chainId + "; wallet is on " + actual);
    }
  }

  /**
   * Call ONLY from a direct user-initiated "Connect Wallet" action.
   * siteOrigin must be taken from a trusted browser location.origin value,
   * not an untrusted query parameter or remote API response.
   */
  connect() {
    try { this.#assertAccess(); } catch (error) { return Promise.reject(error); }
    if (this.#connected) return Promise.resolve(this.state);
    // Share one account-permission prompt across simultaneous Connect clicks.
    if (this.#pendingConnect) return this.#pendingConnect;
    if (pendingPermissions.has(this.#provider)) {
      return Promise.reject(new WalletConnectionError("PERMISSION_PENDING",
        "The Wallet still has an outstanding permission request"));
    }
    const epoch = this.#connectionEpoch;
    const pending = this.#connectWithPermission(epoch);
    const guarded = pending.finally(() => {
      if (this.#pendingConnect === guarded) this.#pendingConnect = null;
    });
    if (epoch === this.#connectionEpoch) this.#pendingConnect = guarded;
    return guarded;
  }

  #assertAccess() {
    let allowed = false;
    try { allowed = this.#isAccessAllowed() === true; } catch {}
    if (!allowed) {
      this.disconnect();
      reject("ACCESS_LOCKED", "Read access is locked; explicitly reconnect after resuming");
    }
  }

  #ensureEpoch(epoch) {
    this.#assertAccess();
    if (epoch !== this.#connectionEpoch) {
      reject("SESSION_CANCELLED", "Wallet connection was cancelled before it finished");
    }
  }

  async #connectWithPermission(epoch) {
    try {
      // Observe changes during the permission prompt as well as after it.
      this.#observeProvider(epoch);
      this.#ensureEpoch(epoch);
      await this.#confirmChain(epoch);
      const accounts = await this.#requestConnect(epoch, { method: "eth_requestAccounts" });
      this.#ensureEpoch(epoch);
      this.#validateConnectionAccounts(accounts);
      await this.#confirmChain(epoch);
      const currentAccounts = await this.#requestConnect(epoch, { method: "eth_accounts" });
      this.#ensureEpoch(epoch);
      this.#validateConnectionAccounts(currentAccounts);
      this.#connected = true;
      return this.state;
    } catch (error) {
      if (epoch === this.#connectionEpoch) this.disconnect();
      throw error;
    }
  }

  #validateConnectionAccounts(accounts) {
    if (!Array.isArray(accounts) || accounts.length === 0) {
      reject("NO_ACCOUNTS", "Wallet did not expose an approved account");
    }
    if (normalizeAddress(accounts[0]) !== this.#expectedAccount) {
      reject("WRONG_ACCOUNT", "The selected wallet differs from this agent's assigned account");
    }
  }

  #observeProvider(epoch) {
    this.#onAccountsChanged = (next) => {
      if (epoch !== this.#connectionEpoch) return;
      try {
        if (!Array.isArray(next) || !next.length ||
            normalizeAddress(next[0]) !== this.#expectedAccount) this.disconnect();
      } catch {
        this.disconnect();
      }
    };
    this.#onChainChanged = (next) => {
      if (epoch !== this.#connectionEpoch) return;
      try {
        if (normalizeChainId(next) !== this.#chainId) this.disconnect();
      } catch {
        this.disconnect();
      }
    };
    this.#onDisconnect = () => {
      if (epoch === this.#connectionEpoch) this.disconnect();
    };
    if (typeof this.#provider.on === "function") {
      this.#provider.on("accountsChanged", this.#onAccountsChanged);
      this.#ensureEpoch(epoch);
      this.#provider.on("chainChanged", this.#onChainChanged);
      this.#ensureEpoch(epoch);
      this.#provider.on("disconnect", this.#onDisconnect);
    }
  }
  #assertReadEpoch(epoch) {
    this.#assertAccess();
    if (!this.#connected || epoch !== this.#connectionEpoch) {
      reject("SESSION_CHANGED", "The wallet changed or disconnected during a read-only request");
    }
  }

  #waitForProvider(start, timeoutMs, timeoutCode, cancelCode) {
    if (this.#pendingRequests.size >= 32) {
      return Promise.reject(new WalletConnectionError("RPC_INFLIGHT_LIMIT", "Too many pending Wallet reads"));
    }
    return new Promise((resolve, rejectRequest) => {
      let settled = false;
      const finish = (complete, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#pendingRequests.delete(cancel);
        complete(value);
      };
      const cancel = () => finish(rejectRequest,
        new WalletConnectionError(cancelCode, "The Wallet session changed while waiting"));
      const timer = setTimeout(() => finish(rejectRequest,
        new WalletConnectionError(timeoutCode, "The Wallet did not respond before the waiting deadline")), timeoutMs);
      this.#pendingRequests.add(cancel);
      try {
        // EIP-1193 has no standard request cancellation. End the local wait
        // and consume late outcomes without publishing or retrying them.
        Promise.resolve(start()).then(
          value => finish(resolve, value), error => finish(rejectRequest, safeProviderFailure(error)),
        );
      } catch (error) {
        finish(rejectRequest, safeProviderFailure(error));
      }
    });
  }

  #guardRequest(args, allowPermission = false) {
    try {
      return guardRpcRequest(args, { account: this.#expectedAccount,
        tokenAddress: args.method === "eth_getLogs"
          ? catalogToken({ agent: this.#agent, chainId: this.#chainId }).address : undefined,
        allowPermission });
    } catch (error) {
      if (error instanceof RpcSecurityError) reject(error.code, "Wallet request refused by the read-only policy");
      throw error;
    }
  }

  #guardResponse(method, value) {
    try { return guardRpcResponse(method, value); }
    catch (error) {
      if (error instanceof RpcSecurityError) reject(error.code, "Wallet response exceeded the supported data boundary");
      throw error;
    }
  }

  async #requestConnect(epoch, args) {
    this.#ensureEpoch(epoch);
    args = this.#guardRequest(args, true);
    const permission = args.method === "eth_requestAccounts";
    try {
      const result = await this.#waitForProvider(
        () => permission ? requestPermission(this.#provider, this.#request) : this.#request.call(this.#provider, args),
        permission ? this.#permissionTimeoutMs : this.#connectTimeoutMs,
        permission ? "PERMISSION_TIMEOUT" : "CONNECT_TIMEOUT", "SESSION_CANCELLED",
      );
      this.#ensureEpoch(epoch);
      return this.#guardResponse(args.method, result);
    } catch (error) {
      this.#ensureEpoch(epoch);
      throw error;
    }
  }

  async #requestRead(epoch, args) {
    this.#assertReadEpoch(epoch);
    args = this.#guardRequest(args);
    try {
      const result = await this.#waitForProvider(() => this.#request.call(this.#provider, args),
        this.#readTimeoutMs, "READ_TIMEOUT", "SESSION_CHANGED");
      this.#assertReadEpoch(epoch);
      return this.#guardResponse(args.method, result);
    } catch (error) {
      // A delayed rejection belongs to its original connection, just like a
      // delayed successful response. It must not invalidate a new connection.
      this.#assertReadEpoch(epoch);
      // EIP-1193 authorization loss or transport/chain disconnection may be
      // reported before (or without) an event. Require explicit reconnection.
      const code = readErrorCode(error);
      let timedOut = false;
      try { timedOut = code === "READ_TIMEOUT" && error instanceof WalletConnectionError; } catch {}
      // Inspecting provider-owned properties can itself trigger a state change.
      this.#assertReadEpoch(epoch);
      if ([4100, 4900, 4901, "RPC_RESULT_LIMIT", "RPC_RESULT_SHAPE"].includes(code) || timedOut) this.disconnect();
      throw error;
    }
  }

  async #confirmReadAccount(epoch) {
    const accounts = await this.#requestRead(epoch, { method: "eth_accounts" });
    this.#assertReadEpoch(epoch);
    let matches;
    try {
      matches = Array.isArray(accounts) && accounts.length > 0 &&
        normalizeAddress(accounts[0]) === this.#expectedAccount;
    } catch (error) {
      this.disconnect();
      throw error;
    }
    if (!matches) {
      this.disconnect();
      reject("ACCOUNT_CHANGED", "The wallet no longer exposes the assigned account");
    }
  }

  async #requireReadAccess() {
    if (!this.#connected) reject("NOT_CONNECTED", "Explicit wallet connection is required");
    const epoch = this.#connectionEpoch;
    await this.#confirmChain(epoch, true);
    await this.#confirmReadAccount(epoch);
    return epoch;
  }

  // Providers may silently change chain or account during a pending RPC read.
  // Recheck both before returning its value; never retry or expose stale data.
  async #readOnVerifiedState(epoch, args) {
    const value = await this.#requestRead(epoch, args);
    this.#assertReadEpoch(epoch);
    await this.#confirmChain(epoch, true);
    await this.#confirmReadAccount(epoch);
    return value;
  }

  /** Read a mined header. An explicit height is used to recheck canonicality. */
  async getBlockSnapshot(blockNumber = "latest") {
    if (blockNumber !== "latest" &&
        (typeof blockNumber !== "string" || !BLOCK_NUMBER.test(blockNumber))) {
      reject("INVALID_BLOCK_NUMBER", "Use latest or a canonical hexadecimal block number");
    }
    const tag = blockNumber === "latest" ? "latest" : "0x" + BigInt(blockNumber).toString(16);
    const epoch = await this.#requireReadAccess();
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_getBlockByNumber", params: [tag, false],
    });
    this.#assertReadEpoch(epoch);
    const block = decodeBlockHeader(result);
    if (tag !== "latest" && block.number !== tag) {
      reject("INVALID_RPC_RESULT", "The provider returned a different block height");
    }
    return block;
  }

  /** Fixed Transfer topic, registered token and assigned account; no arbitrary log query. */
  async getTransferEvents(options) {
    shape(options, ["fromBlock", "toBlock", "direction"]);
    const range = validateTransferRange(options.fromBlock, options.toBlock);
    const direction = options.direction;
    if (!["incoming", "outgoing"].includes(direction)) transferFail("TRANSFER_FILTER_MISMATCH");
    const context = { agent: this.#agent, chainId: this.#chainId, account: this.#expectedAccount };
    const token = catalogToken({ agent: context.agent, chainId: context.chainId });
    const topic = addressTopic(context.account);
    const epoch = await this.#requireReadAccess();
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_getLogs",
      params: [{
        address: token.address,
        fromBlock: hexQuantity(range.fromBlock),
        toBlock: hexQuantity(range.toBlock),
        topics: direction === "incoming" ? [TRANSFER_TOPIC, null, topic] : [TRANSFER_TOPIC, topic],
      }],
    });
    this.#assertReadEpoch(epoch);
    if (!Array.isArray(result) || result.length > MAX_TRANSFER_EVENTS) transferFail("TRANSFER_EVENT_LIMIT");
    const keys = new Set();
    return Object.freeze(result.map(value => {
      const event = decodeTransferLog(value, context, range, direction);
      const key = event.transactionHash + ":" + event.logIndex;
      if (keys.has(key)) transferFail("TRANSFER_DUPLICATE_RESPONSE");
      keys.add(key);
      return event;
    }));
  }

  async getNativeBalance(blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_getBalance",
      params: [this.#expectedAccount, block],
    });
    this.#assertReadEpoch(epoch);
    return decodeQuantity(result);
  }

  /** Read-only balanceOf(address) against an explicitly supplied ERC-20 contract. */
  async getTokenBalance(tokenContractAddress, blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const token = normalizeAddress(tokenContractAddress);
    const calldata = "0x70a08231" + this.#expectedAccount.slice(2).padStart(64, "0");
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_call",
      params: [{ to: token, data: calldata }, block],
    });
    this.#assertReadEpoch(epoch);
    return decodeUint256Word(result);
  }

  /**
   * Inspect the allowance granted by this agent account to a specified
   * decentralized-service spender. This never requests or changes approval.
   */
  async getTokenAllowance(tokenContractAddress, spenderAddress, blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const token = normalizeAddress(tokenContractAddress);
    const spender = normalizeAddress(spenderAddress);
    const calldata = "0xdd62ed3e" +
      this.#expectedAccount.slice(2).padStart(64, "0") +
      spender.slice(2).padStart(64, "0");
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_call",
      params: [{ to: token, data: calldata }, block],
    });
    this.#assertReadEpoch(epoch);
    return decodeUint256Word(result);
  }

  /** Four fixed view selectors only. A pinned block is mandatory for metadata. */
  async getTokenMetadata(tokenContractAddress, blockHash) {
    const token = identityAddress(tokenContractAddress);
    if (blockHash === undefined) identityFail("IDENTITY_BLOCK_REQUIRED");
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const metadata = {};
    for (const [field, selector] of Object.entries(METADATA_FIELDS)) {
      this.#assertReadEpoch(epoch);
      const raw = await this.#readOnVerifiedState(epoch, {
        method: "eth_call",
        params: [{ to: token, data: selector }, block],
      });
      this.#assertReadEpoch(epoch);
      metadata[field] = decodeMetadataField(field, raw);
    }
    return validateTokenMetadata(metadata);
  }

  /**
   * Read-only contract existence check for a candidate token or dApp.
   * A nonempty result only shows deployed bytecode, not that it is safe.
   */
  async getContractCode(contractAddress, blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const contract = normalizeAddress(contractAddress);
    const result = await this.#readOnVerifiedState(epoch, {
      method: "eth_getCode",
      params: [contract, block],
    });
    this.#assertReadEpoch(epoch);
    if (typeof result !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) {
      reject("INVALID_RPC_RESULT", "Unexpected contract bytecode response");
    }
    return Object.freeze({ address: contract, deployed: result !== "0x" });
  }
  disconnect() {
    this.#connectionEpoch++;
    this.#connected = false;
    this.#pendingConnect = null;
    // Settle local waits immediately even if the underlying provider never
    // resolves. Each callback also removes its deadline and itself from the set.
    for (const cancel of this.#pendingRequests) cancel();
    const listeners = [
      ["accountsChanged", this.#onAccountsChanged],
      ["chainChanged", this.#onChainChanged],
      ["disconnect", this.#onDisconnect],
    ];
    this.#onAccountsChanged = undefined;
    this.#onChainChanged = undefined;
    this.#onDisconnect = undefined;
    let removeListener;
    try { removeListener = this.#provider.removeListener; } catch {}
    if (typeof removeListener === "function") {
      for (const [event, listener] of listeners) {
        if (!listener) continue;
        // An extension cleanup error cannot retain local access. Stale
        // callbacks are inert because their connection epoch no longer matches.
        try { removeListener.call(this.#provider, event, listener); } catch {}
      }
    }
  }
}

function decodeQuantity(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    reject("INVALID_RPC_RESULT", "Unexpected hexadecimal RPC balance response");
  }
  return BigInt(value);
}

function decodeUint256Word(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    reject("INVALID_RPC_RESULT", "Expected one complete ABI-encoded uint256 word");
  }
  return BigInt(value);
}
