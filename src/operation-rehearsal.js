import { captureDataRecord, captureDataArray } from "./security-data.js";
import { parseSecurityJson } from "./security-json.js";

export const REHEARSAL_SCHEMA = "threecore.operation-rehearsal.v1";
export const REHEARSAL_SCHEMA_V2 = "threecore.operation-rehearsal.v2";
export const REHEARSAL_LIMIT = 131072;
export const REHEARSAL_RECORD_LIMIT = 200;
const MAX = (1n << 256n) - 1n;
const AGENTS = ["DAT", "EMA", "CAWELON"];
const ROOT = ["schema", "simulationOnly", "agent", "chainId", "account", "asset",
  "openingBalance", "policy", "events"];
const POLICY = ["origin", "spender", "maxPerOperation", "maxOutstanding", "reserveFloor",
  "lossLimit", "buybackBps", "paused"];
const CONTEXT = ["agent", "chainId", "account"];
const COMMON = ["id", "kind", ...CONTEXT];
const FIELDS = {
  open: [...COMMON, "operationId", "origin", "spender", "principal", "fee"],
  settle: [...COMMON, "operationId", "grossReturn", "fee"],
  deposit: [...COMMON, "amount"],
  withdraw: [...COMMON, "amount"],
  reserve: [...COMMON, "reservationId", "amount"],
  release: [...COMMON, "reservationId"],
};

export class RehearsalError extends Error {
  constructor(code) { super(code); this.name = "RehearsalError"; this.code = code; }
}
const fail = code => { throw new RehearsalError(code); };
function amount(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX)
    fail("INVALID_AMOUNT");
  return value;
}
function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value))
    fail("INVALID_ADDRESS");
  return value.toLowerCase();
}
function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
    fail("INVALID_ID");
  return value;
}
function origin(value) {
  if (typeof value !== "string" || value.length > 256) fail("INVALID_ORIGIN");
  let url;
  try { url = new URL(value); } catch { fail("INVALID_ORIGIN"); }
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password)
    fail("INVALID_ORIGIN");
  return value;
}
function context(data) {
  if (!AGENTS.includes(data.agent) || ![8453, 84532].includes(data.chainId)) fail("INVALID_CONTEXT");
  return { agent: data.agent, chainId: data.chainId, account: address(data.account) };
}
function record(input, fields) {
  try { return captureDataRecord(input, fields); } catch { fail("INVALID_STRUCTURE"); }
}
function array(input) {
  try { return captureDataArray(input, REHEARSAL_RECORD_LIMIT); } catch { fail("INVALID_STRUCTURE"); }
}
function kindOf(input) {
  // Inspect one own data descriptor; never invoke an input getter.
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" ||
        !Object.hasOwn(FIELDS, descriptor.value)) fail("INVALID_KIND");
    return descriptor.value;
  } catch { fail("INVALID_KIND"); }
}
export function validateRehearsal(input) {
  const data = record(input, ROOT);
  if (![REHEARSAL_SCHEMA, REHEARSAL_SCHEMA_V2].includes(data.schema) || data.simulationOnly !== true)
    fail("SIMULATION_REQUIRED");
  const extended = data.schema === REHEARSAL_SCHEMA_V2;
  const identity = context(data);
  const asset = record(data.asset, ["address", "symbol", "decimals"]);
  if (typeof asset.symbol !== "string" || !/^[A-Z][A-Z0-9]{0,11}$/.test(asset.symbol) ||
      !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18)
    fail("INVALID_ASSET");
  const inputPolicy = record(data.policy, extended ? [...POLICY, "maxEntryFee", "maxExitFee"] : POLICY);
  if (!Number.isInteger(inputPolicy.buybackBps) || inputPolicy.buybackBps < 0 ||
      inputPolicy.buybackBps > 10000 || typeof inputPolicy.paused !== "boolean")
    fail("INVALID_POLICY");
  const policy = Object.freeze({ origin: origin(inputPolicy.origin), spender: address(inputPolicy.spender),
    ...Object.fromEntries(["maxPerOperation", "maxOutstanding", "reserveFloor", "lossLimit"]
      .map(key => [key, amount(inputPolicy[key])])),
    buybackBps: inputPolicy.buybackBps, paused: inputPolicy.paused,
    ...(extended ? { maxEntryFee: amount(inputPolicy.maxEntryFee), maxExitFee: amount(inputPolicy.maxExitFee) } : {}) });
  const ids = new Set();
  const events = array(data.events).map(inputEvent => {
    const kind = kindOf(inputEvent);
    if (!extended && ["reserve", "release"].includes(kind)) fail("INVALID_KIND");
    const event = record(inputEvent, extended && kind === "open" ? [...FIELDS.open, "exitFeeReserve"] : FIELDS[kind]);
    const eventId = id(event.id);
    if (ids.has(eventId)) fail("DUPLICATE_EVENT");
    ids.add(eventId);
    const result = { id: eventId, kind, ...context(event) };
    if (kind === "open") Object.assign(result, {
      operationId: id(event.operationId), origin: origin(event.origin), spender: address(event.spender),
      principal: amount(event.principal), fee: amount(event.fee),
      ...(extended ? { exitFeeReserve: amount(event.exitFeeReserve) } : {}),
    });
    if (kind === "settle") Object.assign(result, {
      operationId: id(event.operationId), grossReturn: amount(event.grossReturn), fee: amount(event.fee),
    });
    if (kind === "deposit" || kind === "withdraw") result.amount = amount(event.amount);
    if (kind === "reserve" || kind === "release") result.reservationId = id(event.reservationId);
    if (kind === "reserve") result.amount = amount(event.amount);
    return Object.freeze(result);
  });
  return Object.freeze({ schema: data.schema, simulationOnly: true, ...identity,
    asset: Object.freeze({ address: address(asset.address), symbol: asset.symbol, decimals: asset.decimals }),
    openingBalance: amount(data.openingBalance), policy, events: Object.freeze(events) });
}

/** Exact single-asset what-if accounting; no wallet, network, authority, or transaction object. */
export function evaluateRehearsal(input) {
  const document = validateRehearsal(input);
  const { policy } = document;
  const extended = document.schema === REHEARSAL_SCHEMA_V2;
  let cash = BigInt(document.openingBalance), outstanding = 0n, pnl = 0n;
  let deposits = 0n, withdrawals = 0n, fees = 0n;
  const positions = new Map(), usedOperations = new Set(), rows = [];
  const reservations = new Map(), usedReservations = new Set();
  let reservedExitFees = 0n, reservedAllocations = 0n;
  const profitQuota = () => pnl > 0n ? pnl * BigInt(policy.buybackBps) / 10000n : 0n;
  const freeCash = () => cash - reservedExitFees - reservedAllocations;
  const availableBudget = () => {
    const unreservedQuota = profitQuota() > reservedAllocations ? profitQuota() - reservedAllocations : 0n;
    const spare = freeCash() > BigInt(policy.reserveFloor) ? freeCash() - BigInt(policy.reserveFloor) : 0n;
    return unreservedQuota < spare ? unreservedQuota : spare;
  };
  for (const event of document.events) {
    const reasons = [];
    for (const key of CONTEXT) if (event[key] !== document[key]) reasons.push("WRONG_" + key.toUpperCase());
    let delta = 0n;
    if (!reasons.length && event.kind === "open") {
      const principal = BigInt(event.principal), fee = BigInt(event.fee);
      const exitReserve = extended ? BigInt(event.exitFeeReserve) : 0n;
      if (extended && fee > BigInt(policy.maxEntryFee)) reasons.push("ENTRY_FEE_LIMIT");
      if (extended && exitReserve > BigInt(policy.maxExitFee)) reasons.push("EXIT_FEE_LIMIT");
      if (policy.paused) reasons.push("PAUSED");
      if (usedOperations.has(event.operationId)) reasons.push("REUSED_OPERATION");
      if (event.origin !== policy.origin) reasons.push("UNLISTED_ORIGIN");
      if (event.spender !== policy.spender) reasons.push("UNLISTED_SPENDER");
      if (principal === 0n) reasons.push("ZERO_PRINCIPAL");
      if (principal > BigInt(policy.maxPerOperation)) reasons.push("PER_OPERATION_LIMIT");
      if (outstanding + principal > BigInt(policy.maxOutstanding)) reasons.push("OUTSTANDING_LIMIT");
      if (cash < principal + fee) reasons.push("INSUFFICIENT_BALANCE");
      else if (freeCash() - principal - fee - exitReserve < BigInt(policy.reserveFloor)) reasons.push("RESERVE_FLOOR");
      if (pnl - fee - outstanding - principal - reservedExitFees - exitReserve < -BigInt(policy.lossLimit)) reasons.push("LOSS_LIMIT");
      if (!reasons.length) {
        cash -= principal + fee; outstanding += principal; pnl -= fee; fees += fee; delta = -fee;
        reservedExitFees += exitReserve;
        positions.set(event.operationId, { principal, fee, exitReserve });
        usedOperations.add(event.operationId);
      }
    } else if (!reasons.length && event.kind === "settle") {
      const position = positions.get(event.operationId);
      const returned = BigInt(event.grossReturn), fee = BigInt(event.fee);
      if (!position) reasons.push("NO_OPEN_POSITION");
      if (extended && fee > BigInt(policy.maxExitFee)) reasons.push("EXIT_FEE_LIMIT");
      if (extended && position && fee > position.exitReserve) reasons.push("EXIT_FEE_RESERVE_EXCEEDED");
      if (cash + returned < fee) reasons.push("INSUFFICIENT_FEE_BALANCE");
      if (cash + returned - fee > MAX) reasons.push("BALANCE_OVERFLOW");
      if (!reasons.length) {
        cash += returned - fee; outstanding -= position.principal;
        delta = returned - position.principal - fee; pnl += delta; fees += fee;
        reservedExitFees -= position.exitReserve;
        positions.delete(event.operationId);
      }
    } else if (!reasons.length && event.kind === "deposit") {
      const value = BigInt(event.amount);
      if (cash + value > MAX) reasons.push("BALANCE_OVERFLOW");
      if (!reasons.length) { cash += value; deposits += value; }
    } else if (!reasons.length && event.kind === "withdraw") {
      const value = BigInt(event.amount);
      if (cash < value) reasons.push("INSUFFICIENT_BALANCE");
      else if (freeCash() - value < BigInt(policy.reserveFloor)) reasons.push("RESERVE_FLOOR");
      if (!reasons.length) { cash -= value; withdrawals += value; }
    } else if (!reasons.length && event.kind === "reserve") {
      const value = BigInt(event.amount);
      if (policy.paused) reasons.push("PAUSED");
      if (usedReservations.has(event.reservationId)) reasons.push("REUSED_RESERVATION");
      if (value === 0n) reasons.push("ZERO_RESERVATION");
      if (positions.size) reasons.push("UNSETTLED_POSITIONS");
      if (rows.some(row => !row.withinEnteredLimits)) reasons.push("REJECTED_RECORDS");
      if (value > availableBudget()) reasons.push("ALLOCATION_LIMIT");
      if (!reasons.length) {
        reservations.set(event.reservationId, value); usedReservations.add(event.reservationId);
        reservedAllocations += value;
      }
    } else if (!reasons.length && event.kind === "release") {
      const value = reservations.get(event.reservationId);
      if (value === undefined) reasons.push("NO_RESERVATION");
      else { reservedAllocations -= value; reservations.delete(event.reservationId); }
    }
    // Capital additions/withdrawals never become profit. Open principal is not an expense.
    if (cash + outstanding !== BigInt(document.openingBalance) + deposits - withdrawals + pnl)
      fail("ACCOUNTING_INVARIANT");
    rows.push(Object.freeze({ id: event.id, kind: event.kind, withinEnteredLimits: reasons.length === 0,
      reasons: Object.freeze(reasons), cash: cash.toString(), outstanding: outstanding.toString(),
      realizedPnl: pnl.toString(), pnlChange: delta.toString(),
      reservedExitFees: reservedExitFees.toString(), reservedAllocations: reservedAllocations.toString(),
      availableCash: freeCash().toString() }));
  }
  const blockers = [];
  if (rows.some(row => !row.withinEnteredLimits)) blockers.push("REJECTED_RECORDS");
  if (positions.size) blockers.push("UNSETTLED_POSITIONS");
  if (pnl <= 0n) blockers.push("NO_NET_PROFIT");
  if (policy.paused) blockers.push("PAUSED");
  const available = freeCash() > BigInt(policy.reserveFloor) ? freeCash() - BigInt(policy.reserveFloor) : 0n;
  if (available === 0n) blockers.push("NO_AVAILABLE_CASH");
  const shortfall = reservedAllocations > profitQuota() ? reservedAllocations - profitQuota() : 0n;
  if (shortfall) blockers.push("ALLOCATION_OVERCOMMITTED");
  const budget = blockers.length ? 0n : availableBudget();
  return Object.freeze({ schema: extended ? "threecore.operation-rehearsal-report.v2" : "threecore.operation-rehearsal-report.v1",
    simulationOnly: true, sourceVerified: false, authorizesExecution: false,
    agent: document.agent, asset: document.asset, rows: Object.freeze(rows),
    cash: cash.toString(), outstanding: outstanding.toString(), realizedPnl: pnl.toString(),
    deposits: deposits.toString(), withdrawals: withdrawals.toString(), fees: fees.toString(),
    openPositions: positions.size, proposedOwnTokenBuybackBudget: budget.toString(),
    reservedExitFees: reservedExitFees.toString(), reservedAllocations: reservedAllocations.toString(),
    availableCash: freeCash().toString(), allocationShortfall: shortfall.toString(),
    positions: Object.freeze([...positions].map(([operationId, position]) => Object.freeze({
      operationId, principal: position.principal.toString(), exitFeeReserve: position.exitReserve.toString() }))),
    reservations: Object.freeze([...reservations].map(([reservationId, value]) => Object.freeze({ reservationId, amount: value.toString() }))),
    allocationBlockers: Object.freeze(blockers), accountingInvariant: true });
}

export function decodeRehearsal(text) {
  if (typeof text !== "string" || text.length > REHEARSAL_LIMIT ||
      new TextEncoder().encode(text).length > REHEARSAL_LIMIT)
    fail("FILE_TOO_LARGE");
  let input;
  try { input = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  return validateRehearsal(input);
}
export function encodeRehearsal(input) {
  const text = JSON.stringify(validateRehearsal(input), null, 2) + "\n";
  if (new TextEncoder().encode(text).length > REHEARSAL_LIMIT) fail("FILE_TOO_LARGE");
  return text;
}
export function parseRehearsalUnits(text, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 ||
      typeof text !== "string" || text.length > 100 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text))
    fail("INVALID_DECIMAL");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) fail("EXCESS_PRECISION");
  return amount((BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")).toString());
}
export function formatRehearsalUnits(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) fail("INVALID_DECIMAL");
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]{0,80})$/.test(value)) fail("INVALID_AMOUNT");
  const n = BigInt(value), absolute = n < 0n ? -n : n, scale = 10n ** BigInt(decimals);
  const tail = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return (n < 0n ? "-" : "") + (absolute / scale).toString() + (tail ? "." + tail : "");
}
