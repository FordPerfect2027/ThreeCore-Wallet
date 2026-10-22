import { validateSiteOrigin } from "./wallet-session.js";
import { catalogToken, TOKEN_CATALOG_VERSION } from "./token-catalog.js";
import { identityAddress, identityFail, identityObject, identityUnits,
  validateTokenMetadata, formatTokenUnits } from "./token-identity-codec.js";

export const TOKEN_IDENTITY_SCHEMA = "threecore-token-observation-v1";
export const TOKEN_OBSERVATION_FIELDS = Object.freeze([
  "schema", "catalogVersion", "agent", "account", "chainId", "siteOrigin",
  "connectionEpoch", "blockNumber", "blockHash", "tokenAddress",
  "hasCode", "metadata", "balanceBaseUnits", "nativeBalanceBaseUnits",
  "readOnly", "securityAudit",
]);

/** A recorded observation is not an authenticated statement from a blockchain. */
export function validateTokenObservation(input) {
  identityObject(input, TOKEN_OBSERVATION_FIELDS);
  if (input.schema !== TOKEN_IDENTITY_SCHEMA || input.catalogVersion !== TOKEN_CATALOG_VERSION ||
      input.readOnly !== true || input.securityAudit !== false) identityFail("IDENTITY_SCHEMA");
  const expected = catalogToken({ agent: input.agent, chainId: input.chainId });
  const account = identityAddress(input.account);
  const tokenAddress = identityAddress(input.tokenAddress);
  if (tokenAddress !== expected.address) identityFail("IDENTITY_CONTRACT_MISMATCH");
  let siteOrigin;
  try { siteOrigin = validateSiteOrigin(input.siteOrigin); }
  catch { identityFail("IDENTITY_ORIGIN"); }
  if (!Number.isSafeInteger(input.connectionEpoch) || input.connectionEpoch < 0) {
    identityFail("IDENTITY_EPOCH");
  }
  const blockNumber = identityUnits(input.blockNumber);
  if (typeof input.blockHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.blockHash)) {
    identityFail("IDENTITY_BLOCK");
  }
  if (typeof input.hasCode !== "boolean") identityFail("IDENTITY_CODE");
  let metadata = null;
  let balanceBaseUnits = null;
  if (input.hasCode) {
    metadata = validateTokenMetadata(input.metadata);
    balanceBaseUnits = identityUnits(input.balanceBaseUnits);
  } else if (input.metadata !== null || input.balanceBaseUnits !== null) {
    identityFail("IDENTITY_MISSING_CODE_DATA");
  }
  return Object.freeze({
    schema: TOKEN_IDENTITY_SCHEMA,
    catalogVersion: TOKEN_CATALOG_VERSION,
    agent: expected.agent,
    account,
    chainId: expected.chainId,
    siteOrigin,
    connectionEpoch: input.connectionEpoch,
    blockNumber,
    blockHash: input.blockHash.toLowerCase(),
    tokenAddress,
    hasCode: input.hasCode,
    metadata,
    balanceBaseUnits,
    nativeBalanceBaseUnits: identityUnits(input.nativeBalanceBaseUnits),
    readOnly: true,
    securityAudit: false,
  });
}

/** Identity and arithmetic consistency checks, not investment/security ratings. */
export function assessTokenObservation(input) {
  const observation = validateTokenObservation(input);
  const expected = catalogToken({ agent: observation.agent, chainId: observation.chainId });
  const metadata = observation.metadata;
  const checks = [
    { field: "code", expected: true, observed: observation.hasCode,
      status: observation.hasCode ? "match" : "missing" },
    ...["name", "symbol", "decimals"].map(field => ({
      field,
      expected: expected[field],
      observed: metadata?.[field] ?? null,
      status: !metadata ? "unknown" : metadata[field] === expected[field] ? "match" : "mismatch",
    })),
    {
      field: "supply",
      expected: expected.initialSupply,
      observed: metadata?.totalSupply ?? null,
      status: !metadata ? "unknown" : BigInt(metadata.totalSupply) <= BigInt(expected.initialSupply)
        ? "within-issuance" : "exceeds-issuance",
    },
    {
      field: "balance",
      expected: metadata?.totalSupply ?? null,
      observed: observation.balanceBaseUnits,
      status: !metadata ? "unknown" : BigInt(observation.balanceBaseUnits) <= BigInt(metadata.totalSupply)
        ? "within-supply" : "exceeds-supply",
    },
  ];
  const mismatches = checks.filter(check => ["mismatch", "exceeds-issuance", "exceeds-supply"].includes(check.status));
  const status = !observation.hasCode ? "missing-code" : mismatches.length ? "mismatch" : "matched";
  const decimalsMatch = metadata?.decimals === expected.decimals;
  return Object.freeze({
    status,
    checks: Object.freeze(checks.map(Object.freeze)),
    mismatchFields: Object.freeze(mismatches.map(check => check.field)),
    expected,
    // Never put a misleading known symbol beside an unverified decimal value.
    tokenAmount: status === "matched" ? formatTokenUnits(observation.balanceBaseUnits, expected.decimals) : null,
    nativeAmount: formatTokenUnits(observation.nativeBalanceBaseUnits, 18),
    supplyAmount: decimalsMatch ? formatTokenUnits(metadata.totalSupply, expected.decimals) : null,
    belowInitialSupply: metadata ? BigInt(metadata.totalSupply) < BigInt(expected.initialSupply) : null,
    ownershipVerified: false,
    securityAudit: false,
    authorizesTransaction: false,
    provesCurrentBalance: false,
  });
}

export function observationContextKey(input) {
  const row = validateTokenObservation(input);
  return JSON.stringify([row.agent, row.account, row.chainId, row.siteOrigin, row.tokenAddress]);
}

/** Compare two validated observations only within one account/network/origin. */
export function compareTokenObservations(earlierInput, laterInput) {
  const earlier = validateTokenObservation(earlierInput);
  const later = validateTokenObservation(laterInput);
  if (observationContextKey(earlier) !== observationContextKey(later)) identityFail("IDENTITY_COMPARISON_CONTEXT");
  if (BigInt(earlier.blockNumber) > BigInt(later.blockNumber)) identityFail("IDENTITY_COMPARISON_ORDER");
  const sameBlock = earlier.blockNumber === later.blockNumber;
  if (sameBlock && earlier.blockHash !== later.blockHash) identityFail("IDENTITY_BLOCK_CONFLICT");
  if (sameBlock && ["hasCode", "metadata", "balanceBaseUnits", "nativeBalanceBaseUnits"].some(field =>
    JSON.stringify(earlier[field]) !== JSON.stringify(later[field]))) identityFail("IDENTITY_OBSERVATION_CONFLICT");
  const before = assessTokenObservation(earlier);
  const after = assessTokenObservation(later);
  const comparable = before.status === "matched" && after.status === "matched";
  const delta = comparable ? (BigInt(later.balanceBaseUnits) - BigInt(earlier.balanceBaseUnits)) : null;
  const absolute = delta === null ? null : formatTokenUnits((delta < 0n ? -delta : delta).toString(), before.expected.decimals);
  return Object.freeze({
    earlierBlock: earlier.blockNumber,
    laterBlock: later.blockNumber,
    sameBlock,
    comparable,
    deltaBaseUnits: delta?.toString() ?? null,
    deltaAmount: delta === null ? null : (delta < 0n ? "-" : delta > 0n ? "+" : "") + absolute,
    direction: delta === null ? "unknown" : delta > 0n ? "increased" : delta < 0n ? "decreased" : "unchanged",
    beforeStatus: before.status,
    afterStatus: after.status,
    historicalObservation: true,
    provesTransfers: false,
    provesProfit: false,
  });
}
