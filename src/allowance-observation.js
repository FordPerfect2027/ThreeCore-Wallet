import { UINT256_MAX, identityUnits, formatTokenUnits } from "./token-identity-codec.js";
import { validateTokenObservation, assessTokenObservation, observationContextKey } from "./token-identity-model.js";
import { allowanceObject, allowanceFail, allowanceAddress, allowanceLabel,
  allowanceArray, validateAllowanceTargets } from "./allowance-targets.js";

export const ALLOWANCE_OBSERVATION_SCHEMA = "threecore-allowance-observation-v1";
const ERRORS = [null, "READ_FAILED", "INVALID_RESPONSE", "TOKEN_UNAVAILABLE"];

function units(value) {
  try { return identityUnits(value); }
  catch { allowanceFail("ALLOWANCE_AMOUNT"); }
}
export function validateAllowanceRow(input, tokenHasCode) {
  allowanceObject(input, ["spenderAddress", "label", "hasCode", "codeError", "allowanceBaseUnits", "allowanceError"]);
  const spenderAddress = allowanceAddress(input.spenderAddress);
  const label = allowanceLabel(input.label);
  if (!ERRORS.includes(input.codeError) || !ERRORS.includes(input.allowanceError)) allowanceFail("ALLOWANCE_ROW");
  if (input.hasCode !== null && typeof input.hasCode !== "boolean") allowanceFail("ALLOWANCE_ROW");
  if ((input.hasCode === null) !== (input.codeError !== null)) allowanceFail("ALLOWANCE_ROW");
  if ((input.allowanceBaseUnits === null) !== (input.allowanceError !== null)) allowanceFail("ALLOWANCE_ROW");
  if (input.codeError === "TOKEN_UNAVAILABLE") allowanceFail("ALLOWANCE_ROW");
  if (tokenHasCode && input.allowanceError === "TOKEN_UNAVAILABLE") allowanceFail("ALLOWANCE_ROW");
  if (!tokenHasCode && input.allowanceError !== "TOKEN_UNAVAILABLE") allowanceFail("ALLOWANCE_ROW");
  return Object.freeze({
    spenderAddress, label, hasCode: input.hasCode, codeError: input.codeError,
    allowanceBaseUnits: input.allowanceBaseUnits === null ? null : units(input.allowanceBaseUnits),
    allowanceError: input.allowanceError,
  });
}
export function validateAllowanceObservation(input) {
  allowanceObject(input, ["schema", "identity", "targets", "rows", "readOnly", "completeDiscovery", "securityAudit"]);
  if (input.schema !== ALLOWANCE_OBSERVATION_SCHEMA || input.readOnly !== true ||
      input.completeDiscovery !== false || input.securityAudit !== false) allowanceFail("ALLOWANCE_SCHEMA");
  const identity = validateTokenObservation(input.identity);
  const targets = validateAllowanceTargets(input.targets);
  if (["agent", "chainId", "tokenAddress"].some(key => targets[key] !== identity[key])) allowanceFail("ALLOWANCE_CONTEXT");
  const rows = allowanceArray(input.rows).map(row => validateAllowanceRow(row, identity.hasCode));
  if (rows.length !== targets.targets.length || rows.some((row, index) =>
    row.spenderAddress !== targets.targets[index].address || row.label !== targets.targets[index].label)) {
    allowanceFail("ALLOWANCE_ROWS");
  }
  return Object.freeze({
    schema: ALLOWANCE_OBSERVATION_SCHEMA, identity, targets, rows: Object.freeze(rows),
    readOnly: true, completeDiscovery: false, securityAudit: false,
  });
}

export function summarizeAllowances(input) {
  const record = validateAllowanceObservation(input);
  const token = assessTokenObservation(record.identity);
  const rows = record.rows.map(row => {
    const raw = row.allowanceBaseUnits;
    const known = raw !== null;
    const amount = known ? BigInt(raw) : null;
    const balance = record.identity.balanceBaseUnits === null ? null : BigInt(record.identity.balanceBaseUnits);
    const smaller = amount !== null && balance !== null ? (amount < balance ? amount : balance).toString() : null;
    return Object.freeze({
      ...row,
      status: !known ? "unknown" : amount === 0n ? "zero" : amount === UINT256_MAX ? "maximum" : "nonzero",
      amount: known && token.status === "matched" ? formatTokenUnits(raw, token.expected.decimals) : null,
      smallerOfBalanceAndAllowance: smaller,
      smallerAmount: smaller !== null && token.status === "matched"
        ? formatTokenUnits(smaller, token.expected.decimals) : null,
      exceedsObservedBalance: known && balance !== null ? amount > balance : null,
      completeRow: row.codeError === null && row.allowanceError === null,
      selfSpender: row.spenderAddress === record.identity.account,
      tokenIsSpender: row.spenderAddress === record.identity.tokenAddress,
      contractSafetyVerified: false,
    });
  });
  return Object.freeze({
    agent: record.identity.agent,
    chainId: record.identity.chainId,
    account: record.identity.account,
    tokenStatus: token.status,
    requested: rows.length,
    completeRows: rows.filter(row => row.completeRow).length,
    knownAmounts: rows.filter(row => row.status !== "unknown").length,
    positiveAmounts: rows.filter(row => ["maximum", "nonzero"].includes(row.status)).length,
    maximumAmounts: rows.filter(row => row.status === "maximum").length,
    zeroAmounts: rows.filter(row => row.status === "zero").length,
    unknownAmounts: rows.filter(row => row.status === "unknown").length,
    codeUnavailable: rows.filter(row => row.hasCode === null).length,
    codeAbsent: rows.filter(row => row.hasCode === false).length,
    rows: Object.freeze(rows),
    completeDiscovery: false,
    totalExposure: null,
    provesCurrentPermission: false,
    securityAudit: false,
  });
}

export function compareAllowances(beforeInput, afterInput) {
  const before = validateAllowanceObservation(beforeInput);
  const after = validateAllowanceObservation(afterInput);
  if (observationContextKey(before.identity) !== observationContextKey(after.identity)) allowanceFail("ALLOWANCE_COMPARE_CONTEXT");
  const earlier = BigInt(before.identity.blockNumber);
  const later = BigInt(after.identity.blockNumber);
  if (earlier > later) allowanceFail("ALLOWANCE_COMPARE_ORDER");
  if (earlier === later && before.identity.blockHash !== after.identity.blockHash) allowanceFail("ALLOWANCE_BLOCK_CONFLICT");
  if (earlier === later && ["hasCode", "metadata", "balanceBaseUnits", "nativeBalanceBaseUnits"].some(key =>
    JSON.stringify(before.identity[key]) !== JSON.stringify(after.identity[key]))) {
    allowanceFail("ALLOWANCE_SAME_BLOCK_CONFLICT");
  }
  const old = new Map(before.rows.map(row => [row.spenderAddress, row]));
  const current = new Map(after.rows.map(row => [row.spenderAddress, row]));
  const addresses = [...new Set([...old.keys(), ...current.keys()])];
  const verified = assessTokenObservation(before.identity).status === "matched" &&
    assessTokenObservation(after.identity).status === "matched";
  const rows = addresses.map(address => {
    const a = old.get(address), b = current.get(address);
    if (!a || !b) {
      return Object.freeze({ spenderAddress: address, label: (b ?? a).label,
        status: !a ? "new-target" : "omitted-target", before: a?.allowanceBaseUnits ?? null,
        after: b?.allowanceBaseUnits ?? null, deltaBaseUnits: null, deltaAmount: null,
        codeChanged: null, labelChanged: false });
    }
    const comparable = a.allowanceBaseUnits !== null && b.allowanceBaseUnits !== null;
    const delta = comparable ? BigInt(b.allowanceBaseUnits) - BigInt(a.allowanceBaseUnits) : null;
    if (earlier === later && ((delta !== null && delta !== 0n) ||
        (a.hasCode !== null && b.hasCode !== null && a.hasCode !== b.hasCode))) {
      allowanceFail("ALLOWANCE_SAME_BLOCK_CONFLICT");
    }
    const decimal = delta !== null && verified
      ? formatTokenUnits((delta < 0n ? -delta : delta).toString(), before.identity.metadata.decimals) : null;
    return Object.freeze({
      spenderAddress: address, label: b.label,
      status: delta === null ? "unknown" : delta > 0n ? "increased" : delta < 0n ? "decreased" : "unchanged",
      before: a.allowanceBaseUnits, after: b.allowanceBaseUnits,
      deltaBaseUnits: delta?.toString() ?? null,
      deltaAmount: decimal === null ? null : (delta > 0n ? "+" : delta < 0n ? "-" : "") + decimal,
      codeChanged: a.hasCode !== null && b.hasCode !== null ? a.hasCode !== b.hasCode : null,
      labelChanged: a.label !== b.label,
    });
  });
  return Object.freeze({
    earlierBlock: before.identity.blockNumber, laterBlock: after.identity.blockNumber,
    rows: Object.freeze(rows), provesApprovalTransactions: false, provesRevocation: false,
    completeDiscovery: false,
  });
}

/** Filtering preserves observed rows; it never changes the underlying record. */
export function filterAllowances(input, { status = "all", search = "" } = {}) {
  if (!["all", "nonzero", "maximum", "zero", "unknown", "code-absent"].includes(status) ||
      typeof search !== "string" || search.length > 128) allowanceFail("ALLOWANCE_FILTER");
  const text = search.trim().toLowerCase();
  return Object.freeze(summarizeAllowances(input).rows.filter(row =>
    (!text || row.label.toLowerCase().includes(text) || row.spenderAddress.includes(text)) &&
    (status === "all" || (status === "nonzero" ? ["maximum", "nonzero"].includes(row.status) :
      status === "code-absent" ? row.hasCode === false : row.status === status))));
}
