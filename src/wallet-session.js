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
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    reject("INVALID_CHAIN", "The wallet did not return a hexadecimal chain ID");
  }
  return Number(BigInt(value));
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
  if (!provider || typeof provider.request !== "function") {
    reject("NO_PROVIDER", "An EIP-1193 wallet provider is required");
  }
}

const BLOCK_NUMBER = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const BLOCK_HASH = /^0x[0-9a-fA-F]{64}$/;

// A local timeout cannot close a Wallet's permission dialog. Keep the guard
// across session/controller replacement until the original provider settles.
const pendingPermissions = new WeakMap();
function requestPermission(provider) {
  if (pendingPermissions.has(provider)) {
    reject("PERMISSION_PENDING", "The Wallet still has an outstanding permission request");
  }
  const marker = {};
  pendingPermissions.set(provider, marker);
  const release = () => {
    if (pendingPermissions.get(provider) === marker) pendingPermissions.delete(provider);
  };
  try {
    return Promise.resolve(provider.request({ method: "eth_requestAccounts" })).then(
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
    readTimeoutMs = 30_000, connectTimeoutMs = 30_000, permissionTimeoutMs = 120_000 }) {
    validateProvider(provider);
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

  #ensureEpoch(epoch) {
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
    if (!this.#connected || epoch !== this.#connectionEpoch) {
      reject("SESSION_CHANGED", "The wallet changed or disconnected during a read-only request");
    }
  }

  #waitForProvider(start, timeoutMs, timeoutCode, cancelCode) {
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
          value => finish(resolve, value), error => finish(rejectRequest, error),
        );
      } catch (error) {
        finish(rejectRequest, error);
      }
    });
  }

  async #requestConnect(epoch, args) {
    this.#ensureEpoch(epoch);
    const permission = args.method === "eth_requestAccounts";
    try {
      const result = await this.#waitForProvider(
        () => permission ? requestPermission(this.#provider) : this.#provider.request(args),
        permission ? this.#permissionTimeoutMs : this.#connectTimeoutMs,
        permission ? "PERMISSION_TIMEOUT" : "CONNECT_TIMEOUT", "SESSION_CANCELLED",
      );
      this.#ensureEpoch(epoch);
      return result;
    } catch (error) {
      this.#ensureEpoch(epoch);
      throw error;
    }
  }

  async #requestRead(epoch, args) {
    this.#assertReadEpoch(epoch);
    try {
      const result = await this.#waitForProvider(() => this.#provider.request(args),
        this.#readTimeoutMs, "READ_TIMEOUT", "SESSION_CHANGED");
      this.#assertReadEpoch(epoch);
      return result;
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
      if ([4100, 4900, 4901].includes(code) || timedOut) this.disconnect();
      throw error;
    }
  }

  async #requireReadAccess() {
    if (!this.#connected) reject("NOT_CONNECTED", "Explicit wallet connection is required");
    const epoch = this.#connectionEpoch;
    await this.#confirmChain(epoch, true);
    this.#assertReadEpoch(epoch);
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
    return epoch;
  }

  /** Read a mined header. An explicit height is used to recheck canonicality. */
  async getBlockSnapshot(blockNumber = "latest") {
    if (blockNumber !== "latest" &&
        (typeof blockNumber !== "string" || !BLOCK_NUMBER.test(blockNumber))) {
      reject("INVALID_BLOCK_NUMBER", "Use latest or a canonical hexadecimal block number");
    }
    const tag = blockNumber === "latest" ? "latest" : "0x" + BigInt(blockNumber).toString(16);
    const epoch = await this.#requireReadAccess();
    const result = await this.#requestRead(epoch, {
      method: "eth_getBlockByNumber", params: [tag, false],
    });
    this.#assertReadEpoch(epoch);
    const block = decodeBlockHeader(result);
    if (tag !== "latest" && block.number !== tag) {
      reject("INVALID_RPC_RESULT", "The provider returned a different block height");
    }
    return block;
  }

  async getNativeBalance(blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const result = await this.#requestRead(epoch, {
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
    const result = await this.#requestRead(epoch, {
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
    const result = await this.#requestRead(epoch, {
      method: "eth_call",
      params: [{ to: token, data: calldata }, block],
    });
    this.#assertReadEpoch(epoch);
    return decodeUint256Word(result);
  }

  /**
   * Read-only contract existence check for a candidate token or dApp.
   * A nonempty result only shows deployed bytecode, not that it is safe.
   */
  async getContractCode(contractAddress, blockHash) {
    const block = blockSelector(blockHash);
    const epoch = await this.#requireReadAccess();
    const contract = normalizeAddress(contractAddress);
    const result = await this.#requestRead(epoch, {
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
