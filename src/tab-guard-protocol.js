/** An ephemeral stop-only protocol. No account, balance, password or unlock message. */
export const TAB_GUARD_SCHEMA = "threecore-tab-stop-v1";
export const TAB_GUARD_CHANNEL = "threecore-wallet-stop-v1";
export const TAB_GUARD_TTL = 10000;
export const TAB_GUARD_FUTURE = 1000;
export const TAB_GUARD_REPLAYS = 128;
export const TAB_GUARD_RECEIPTS = 32;
export const TAB_GUARD_BUDGET = 256;
export const TAB_GUARD_CODES = Object.freeze([
  "TAB_FORMAT", "TAB_CLOCK", "TAB_ENTROPY", "TAB_UNAVAILABLE", "TAB_TRANSPORT",
  "TAB_FLOOD", "TAB_CLEANUP", "TAB_CONFIG", "TAB_CLOSED",
]);

export class TabGuardError extends Error {
  constructor(code) {
    const safe = TAB_GUARD_CODES.includes(code) ? code : "TAB_CONFIG";
    super(safe);
    this.name = "TabGuardError";
    this.code = safe;
  }
}
export function tabGuardFail(code) { throw new TabGuardError(code); }
export function tabGuardCode(error, fallback = "TAB_TRANSPORT") {
  return error instanceof TabGuardError && TAB_GUARD_CODES.includes(error.code) ? error.code : fallback;
}
export function tabGuardTime(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 8640000000000000) tabGuardFail("TAB_CLOCK");
  return value;
}
export function tabGuardId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/.test(value) || /^0+$/.test(value)) {
    tabGuardFail("TAB_FORMAT");
  }
  return value;
}
function fields(input, names) {
  if (!input || typeof input !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).length !== names.length) tabGuardFail("TAB_FORMAT");
  const copy = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !("value" in descriptor)) tabGuardFail("TAB_FORMAT");
    copy[name] = descriptor.value;
  }
  return copy;
}
export function validateTabSignal(input) {
  let kind;
  try { kind = Object.getOwnPropertyDescriptor(input, "kind")?.value; }
  catch { tabGuardFail("TAB_FORMAT"); }
  const names = ["schema", "kind", "source", "id", "issuedAt"];
  if (kind === "receipt") names.push("target");
  const value = fields(input, names);
  if (value.schema !== TAB_GUARD_SCHEMA || !["stop", "receipt"].includes(value.kind)) tabGuardFail("TAB_FORMAT");
  tabGuardId(value.source);
  tabGuardId(value.id);
  tabGuardTime(value.issuedAt);
  if (kind === "receipt") {
    tabGuardId(value.target);
    if (value.target === value.source) tabGuardFail("TAB_FORMAT");
  }
  return Object.freeze(value);
}
export function createStopSignal(source, id, issuedAt) {
  return validateTabSignal({ schema: TAB_GUARD_SCHEMA, kind: "stop", source, id, issuedAt });
}
export function createStopReceipt(signal, source) {
  const safe = validateTabSignal(signal);
  if (safe.kind !== "stop") tabGuardFail("TAB_FORMAT");
  return validateTabSignal({ schema: TAB_GUARD_SCHEMA, kind: "receipt", source,
    id: safe.id, issuedAt: safe.issuedAt, target: safe.source });
}
export function tabSignalFresh(signal, now) {
  const safe = validateTabSignal(signal);
  tabGuardTime(now);
  return safe.issuedAt <= now + TAB_GUARD_FUTURE && now - safe.issuedAt < TAB_GUARD_TTL;
}
export function randomTabId(crypto = globalThis.crypto) {
  const bytes = new Uint8Array(16);
  try {
    if (typeof crypto?.getRandomValues !== "function") tabGuardFail("TAB_ENTROPY");
    crypto.getRandomValues(bytes);
    return tabGuardId([...bytes].map(value => value.toString(16).padStart(2, "0")).join(""));
  } catch { tabGuardFail("TAB_ENTROPY"); }
  finally { bytes.fill(0); }
}

/** Bounded replay retention; capacity overflow is an explicit stop condition. */
export function createTabReplayWindow() {
  const seen = new Map();
  let lastTime = 0;
  function clear() { seen.clear(); lastTime = 0; }
  function accept(signal, now) {
    const safe = validateTabSignal(signal);
    tabGuardTime(now);
    if (now < lastTime) tabGuardFail("TAB_CLOCK");
    lastTime = now;
    for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
    if (!tabSignalFresh(safe, now)) return false;
    const key = safe.source + ":" + safe.id;
    if (seen.has(key)) return false;
    if (seen.size >= TAB_GUARD_REPLAYS) tabGuardFail("TAB_FLOOD");
    // Retain future-tolerated messages until their own expiry, not arrival+TTL.
    seen.set(key, safe.issuedAt + TAB_GUARD_TTL);
    return true;
  }
  return Object.freeze({ accept, clear, size: () => seen.size });
}
