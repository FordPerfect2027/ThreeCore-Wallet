import { captureDataRecord, captureDataArray, sha256Hex } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { catalogToken } from "./token-catalog.js";
import { identityAddress, identityUnits, validateTokenMetadata } from "./token-identity-codec.js";

export const PUBLIC_TOKEN_BATCH_SCHEMA = "threecore.public-token-batch.v1";
export const PUBLIC_TOKEN_BATCH_FILE_SCHEMA = "threecore.public-token-batch-file.v1";
export const PUBLIC_TOKEN_BATCH_FILE_LIMIT = 32768;
export const PUBLIC_TOKEN_ENDPOINTS = Object.freeze({ 8453: "https://mainnet.base.org", 84532: "https://sepolia.base.org" });
const AGENTS = ["DAT", "EMA", "CAWELON"];
export class PublicTokenBatchError extends Error {
  constructor(code) { super(code); this.name = "PublicTokenBatchError"; this.code = code; }
}
export const failPublicTokenBatch = code => { throw new PublicTokenBatchError(code); };
const fail = failPublicTokenBatch;
const bounded = text => { try { boundedUtf8Length(text, PUBLIC_TOKEN_BATCH_FILE_LIMIT); } catch { fail("BATCH_FILE_SIZE"); } return text; };

/** Public RPC evidence has no wallet connection epoch, site permission or ownership claim. */
export function validatePublicTokenBatch(input) {
  let data, rows;
  try {
    data = captureDataRecord(input, ["schema", "chainId", "rpcUrl", "account", "blockNumber", "blockHash",
      "nativeBalanceBaseUnits", "tokens", "readOnly", "walletConnected", "canonicalBlockRechecked", "securityAudit"]);
    rows = captureDataArray(data.tokens, 3, 3);
  } catch { fail("BATCH_STRUCTURE"); }
  if (data.schema !== PUBLIC_TOKEN_BATCH_SCHEMA || ![8453, 84532].includes(data.chainId) ||
      data.rpcUrl !== PUBLIC_TOKEN_ENDPOINTS[data.chainId] || data.readOnly !== true || data.walletConnected !== false ||
      data.canonicalBlockRechecked !== true || data.securityAudit !== false) fail("BATCH_CONTEXT");
  if (typeof data.blockHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data.blockHash)) fail("BATCH_BLOCK");
  const tokens = rows.map(inputRow => {
    let row;
    try { row = captureDataRecord(inputRow, ["agent", "tokenAddress", "hasCode", "metadata", "balanceBaseUnits"]); }
    catch { fail("BATCH_TOKEN_STRUCTURE"); }
    const expected = catalogToken({ agent: row.agent, chainId: data.chainId });
    const tokenAddress = identityAddress(row.tokenAddress);
    if (tokenAddress !== expected.address || typeof row.hasCode !== "boolean") fail("BATCH_TOKEN_CONTEXT");
    let metadata = null, balanceBaseUnits = null;
    if (row.hasCode) { metadata = validateTokenMetadata(row.metadata); balanceBaseUnits = identityUnits(row.balanceBaseUnits); }
    else if (row.metadata !== null || row.balanceBaseUnits !== null) fail("BATCH_MISSING_CODE_DATA");
    return Object.freeze({ agent: row.agent, tokenAddress, hasCode: row.hasCode, metadata, balanceBaseUnits });
  });
  if (new Set(tokens.map(t => t.agent)).size !== 3) fail("BATCH_DUPLICATE_AGENT");
  return Object.freeze({ schema: PUBLIC_TOKEN_BATCH_SCHEMA, chainId: data.chainId, rpcUrl: data.rpcUrl,
    account: identityAddress(data.account), blockNumber: identityUnits(data.blockNumber), blockHash: data.blockHash.toLowerCase(),
    nativeBalanceBaseUnits: identityUnits(data.nativeBalanceBaseUnits),
    tokens: Object.freeze(AGENTS.map(agent => tokens.find(t => t.agent === agent))),
    readOnly: true, walletConnected: false, canonicalBlockRechecked: true, securityAudit: false });
}

export function publicBatchObservations(input) {
  const batch = validatePublicTokenBatch(input);
  return Object.freeze(batch.tokens.map(token => {
    const expected = catalogToken({ agent: token.agent, chainId: batch.chainId }), m = token.metadata;
    const identityMatches = token.hasCode && ["name", "symbol", "decimals"].every(key => m[key] === expected[key]) &&
      BigInt(m.totalSupply) <= BigInt(expected.initialSupply) && BigInt(token.balanceBaseUnits) <= BigInt(m.totalSupply);
    return Object.freeze({ source: "public-rpc", rpcUrl: batch.rpcUrl, walletConnected: false,
      agent: token.agent, chainId: batch.chainId, account: batch.account, blockNumber: batch.blockNumber,
      blockHash: batch.blockHash, nativeBalanceBaseUnits: batch.nativeBalanceBaseUnits,
      tokenAddress: token.tokenAddress, hasCode: token.hasCode, metadata: token.metadata, balanceBaseUnits: token.balanceBaseUnits,
      identityMatches, readOnly: true, securityAudit: false });
  }));
}
export function encodePublicTokenBatch(input) { return bounded(JSON.stringify(validatePublicTokenBatch(input), null, 2)); }
export async function preparePublicTokenBatchFile(input, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const batch = validatePublicTokenBatch(input), canonical = encodePublicTokenBatch(batch);
  const digest = await sha256Hex(new TextEncoder().encode(canonical), subtle, { signal, timeoutMs });
  const text = bounded(JSON.stringify({ schema: PUBLIC_TOKEN_BATCH_FILE_SCHEMA, algorithm: "SHA-256", digest, batch }, null, 2) + "\n");
  return Object.freeze({ text, digest, byteLength: new TextEncoder().encode(text).length,
    containsPublicAccount: true, authenticated: false, walletConnected: false,
    filename: "ThreeCore-public-batch-" + batch.blockNumber + ".json", mimeType: "application/json" });
}
export async function decodePublicTokenBatchFile(text, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  bounded(text); let data;
  try { data = captureDataRecord(parseSecurityJson(text), ["schema", "algorithm", "digest", "batch"]); }
  catch { fail("BATCH_FILE_STRUCTURE"); }
  if (data.schema !== PUBLIC_TOKEN_BATCH_FILE_SCHEMA || data.algorithm !== "SHA-256" ||
      typeof data.digest !== "string" || !/^[0-9a-f]{64}$/.test(data.digest)) fail("BATCH_FILE_SCHEMA");
  const batch = validatePublicTokenBatch(data.batch);
  const digest = await sha256Hex(new TextEncoder().encode(encodePublicTokenBatch(batch)), subtle, { signal, timeoutMs });
  if (digest !== data.digest) fail("BATCH_FILE_CHECKSUM");
  return Object.freeze({ batch, digest, checksumVerified: true, authenticated: false, walletConnected: false });
}
