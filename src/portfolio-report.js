import { parseSecurityJson } from "./security-json.js";
import { AGENT_IDS, normalizeAddress, validateSiteOrigin } from "./wallet-session.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_REPORT_LENGTH = 65536;
const SCHEMA = "threecore-portfolio-snapshot-v1";

export class PortfolioReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "PortfolioReportError";
    this.code = "INVALID_PORTFOLIO_REPORT";
  }
}

function invalid(message) {
  throw new PortfolioReportError(message);
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected an object");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid("Unexpected object prototype");
  return value;
}

function keys(value, expected) {
  plain(value);
  const names = Reflect.ownKeys(value);
  if (names.length !== expected.length || names.some(name => !expected.includes(name))) {
    invalid("Unexpected or missing report fields");
  }
  // Reports are data. Never execute an accessor while validating a report.
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !("value" in descriptor)) invalid("Accessor fields are forbidden");
  }
}

function uint(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX_UINT256) {
    invalid("Expected canonical decimal uint256 units");
  }
  return value;
}

function safeInteger(value, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid("Expected a safe integer");
  return value;
}

const SNAPSHOT_KEYS = [
  "agent", "account", "chainId", "siteOrigin", "connectionEpoch", "blockNumber", "blockHash",
  "nativeBalanceBaseUnits", "holdings", "readOnly", "securityAudit",
];
const HOLDING_KEYS = ["address", "hasCode", "balanceBaseUnits", "notice"];

/**
 * Validate and copy report data without accepting unknown fields or accessors.
 * Local imports are historical observations, never current authorizations.
 * No validation here authenticates an RPC provider or proves token identity.
 */
export function validatePortfolioSnapshot(input) {
  try {
    keys(input, SNAPSHOT_KEYS);
    if (!AGENT_IDS.includes(input.agent)) invalid("Unknown ThreeCore agent");
    const account = normalizeAddress(input.account);
    const siteOrigin = validateSiteOrigin(input.siteOrigin);
    const chainId = safeInteger(input.chainId, 1);
    const connectionEpoch = safeInteger(input.connectionEpoch, 0);
    if (input.readOnly !== true || input.securityAudit !== false) invalid("Unsafe snapshot flags");
    const blockNumber = uint(input.blockNumber);
    if (typeof input.blockHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.blockHash)) {
      invalid("Expected a complete block hash");
    }
    const nativeBalanceBaseUnits = uint(input.nativeBalanceBaseUnits);
    if (!Array.isArray(input.holdings) || input.holdings.length < 1 || input.holdings.length > 32) {
      invalid("Expected one to 32 holdings");
    }
    const seen = new Set();
    for (let index = 0; index < input.holdings.length; index++) {
      if (!Object.hasOwn(input.holdings, index)) invalid("Sparse holdings are forbidden");
    }
    const holdings = input.holdings.map(row => {
      keys(row, HOLDING_KEYS);
      const address = normalizeAddress(row.address);
      if (seen.has(address)) invalid("Duplicate token contract");
      seen.add(address);
      if (typeof row.hasCode !== "boolean") invalid("Invalid code-presence flag");
      if (row.hasCode) {
        if (row.notice !== null) invalid("Unexpected token notice");
        return Object.freeze({ address, hasCode: true, balanceBaseUnits: uint(row.balanceBaseUnits), notice: null });
      }
      if (row.balanceBaseUnits !== null || row.notice !== "TOKEN_CODE_MISSING") {
        invalid("Missing code must have unknown balance");
      }
      return Object.freeze({ address, hasCode: false, balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" });
    });
    return Object.freeze({
      agent: input.agent,
      account,
      chainId,
      siteOrigin,
      connectionEpoch,
      blockNumber,
      blockHash: input.blockHash.toLowerCase(),
      nativeBalanceBaseUnits,
      holdings: Object.freeze(holdings),
      readOnly: true,
      securityAudit: false,
    });
  } catch (error) {
    if (error instanceof PortfolioReportError) throw error;
    invalid("Malformed snapshot data");
  }
}

/**
 * Pure serialization only: the caller decides whether/where to save it.
 * No timestamp implies freshness, no private keys or arbitrary extra fields
 * are accepted, and no filesystem or network action occurs in this module.
 */
export function encodePortfolioReport(snapshot) {
  return JSON.stringify({
    schema: SCHEMA,
    historicalObservation: true,
    snapshot: validatePortfolioSnapshot(snapshot),
  }, null, 2);
}

export function decodePortfolioReport(text) {
  if (typeof text !== "string" || text.length > MAX_REPORT_LENGTH || text.length === 0) {
    invalid("Expected a bounded JSON report");
  }
  let document;
  try { document = parseSecurityJson(text); }
  catch { invalid("Invalid JSON"); }
  keys(document, ["schema", "historicalObservation", "snapshot"]);
  if (document.schema !== SCHEMA || document.historicalObservation !== true) {
    invalid("Unknown schema or observation status");
  }
  return Object.freeze({
    schema: SCHEMA,
    historicalObservation: true,
    snapshot: validatePortfolioSnapshot(document.snapshot),
    // Importing a report must not revive a session or clear a current error.
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
  });
}

/** Fixed-point display helper; never round through JavaScript Number. */
export function formatBaseUnits(raw, decimals) {
  uint(raw);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    invalid("Expected explicitly supplied decimals from zero to 255");
  }
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole;
}
