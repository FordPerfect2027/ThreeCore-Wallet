/** Bounded, page-local protection history. Never stores wallet or RPC payloads. */
export const SECURITY_JOURNAL_LIMIT = 64;
export const SECURITY_JOURNAL_EVENTS = Object.freeze([
  "ready", "manual", "idle", "hidden", "page-exit", "clock", "disposed",
  "resumed", "idle-policy", "hidden-policy", "broadcast-stop", "peer-stop",
  "channel-error", "page-freeze", "page-restored",
]);
export const SECURITY_JOURNAL_TEXT = Object.freeze({
  ready: "保護機能を開始しました",
  manual: "停止ボタンで接続を停止しました",
  idle: "無操作のため接続を停止しました",
  hidden: "画面を離れたため接続を停止しました",
  "page-exit": "ページを離れたため接続を停止しました",
  clock: "待機時間を確認できず接続を停止しました",
  disposed: "画面終了により接続を停止しました",
  resumed: "接続操作を再開しました。自動接続は行いません",
  "idle-policy": "無操作時の停止時間を変更しました",
  "hidden-policy": "画面移動時の停止設定を変更しました",
  "broadcast-stop": "同じアドレスの画面へ通知するため、この画面を停止しました",
  "peer-stop": "他の画面からの停止通知で保護停止しました",
  "channel-error": "停止通知の通信を確認できず保護停止しました",
  "page-freeze": "ページの一時停止により保護停止しました",
  "page-restored": "保存されたページの再表示により保護停止しました",
});
const intervals = [60_000, 300_000, 900_000];
const fail = () => { throw new TypeError("Invalid protection journal data"); };

function ownRecord(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => ![...required, ...optional].includes(key))) fail();
  const result = {};
  for (const key of [...required, ...optional]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      if (required.includes(key)) fail();
      continue;
    }
    if (!("value" in descriptor)) fail();
    result[key] = descriptor.value;
  }
  return result;
}

function eventDetails(kind, value) {
  const fields = kind === "idle-policy" ? ["idleMs"] : kind === "hidden-policy" ? ["enabled"] : [];
  const result = ownRecord(value, fields);
  if (kind === "idle-policy" && !intervals.includes(result.idleMs)) fail();
  if (kind === "hidden-policy" && typeof result.enabled !== "boolean") fail();
  return Object.freeze(result);
}

/** Only known event names and typed policy settings cross the journal boundary. */
export function createSecurityJournal({ capacity = SECURITY_JOURNAL_LIMIT } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > SECURITY_JOURNAL_LIMIT) fail();
  let total = 0, dropped = 0, disposed = false;
  let events = [];
  const counts = Object.fromEntries(SECURITY_JOURNAL_EVENTS.map(kind => [kind, 0]));

  function state() {
    return Object.freeze({ capacity, total, dropped, disposed,
      events: Object.freeze([...events]), counts: Object.freeze({ ...counts }) });
  }
  function record(kind, detail = {}) {
    if (disposed) return false;
    if (!SECURITY_JOURNAL_EVENTS.includes(kind)) fail();
    const safeDetail = eventDetails(kind, detail);
    // A hostile accessor/proxy may reenter through reflection during validation.
    if (disposed) return false;
    if (total >= Number.MAX_SAFE_INTEGER) return false;
    const entry = Object.freeze({ sequence: ++total, kind, detail: safeDetail });
    counts[kind]++;
    events.push(entry);
    if (events.length > capacity) { events.shift(); dropped++; }
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    events = [];
    total = dropped = 0;
    for (const key of SECURITY_JOURNAL_EVENTS) counts[key] = 0;
  }
  return Object.freeze({ state, record, dispose });
}

/** Validate a snapshot before presenting or exporting it. No free-form fields. */
export function validateSecurityJournal(value) {
  const input = ownRecord(value, ["capacity", "total", "dropped", "disposed", "events", "counts"]);
  if (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > SECURITY_JOURNAL_LIMIT ||
      !Number.isSafeInteger(input.total) || input.total < 0 ||
      !Number.isSafeInteger(input.dropped) || input.dropped < 0 ||
      typeof input.disposed !== "boolean") fail();
  const counts = ownRecord(input.counts, SECURITY_JOURNAL_EVENTS);
  let sum = 0;
  for (const value of Object.values(counts)) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) fail();
    sum += value;
  }
  if (sum !== input.total || !Array.isArray(input.events) || input.events.length > input.capacity ||
      Reflect.ownKeys(input.events).length !== input.events.length + 1 ||
      input.events.length !== Math.min(input.capacity, input.total) ||
      input.dropped !== input.total - input.events.length) fail();
  const events = [];
  const retainedCounts = Object.fromEntries(SECURITY_JOURNAL_EVENTS.map(kind => [kind, 0]));
  for (let index = 0; index < input.events.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input.events, String(index));
    if (!descriptor || !("value" in descriptor)) fail();
    const event = ownRecord(descriptor.value, ["sequence", "kind", "detail"]);
    if (event.sequence !== input.dropped + index + 1 || !SECURITY_JOURNAL_EVENTS.includes(event.kind)) fail();
    const detail = eventDetails(event.kind, event.detail);
    retainedCounts[event.kind]++;
    if (retainedCounts[event.kind] > counts[event.kind]) fail();
    events.push(Object.freeze({ sequence: event.sequence, kind: event.kind, detail }));
  }
  if (input.disposed && input.total !== 0) fail();
  return Object.freeze({ ...input, counts: Object.freeze(counts), events: Object.freeze(events) });
}

export function securityJournalRows(value, limit = 8) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SECURITY_JOURNAL_LIMIT) fail();
  const snapshot = validateSecurityJournal(value);
  return Object.freeze(snapshot.events.slice(-limit).reverse().map(entry => {
    let text = SECURITY_JOURNAL_TEXT[entry.kind];
    if (entry.kind === "idle-policy") text += "（" + entry.detail.idleMs / 60_000 + "分）";
    if (entry.kind === "hidden-policy") text += entry.detail.enabled ? "（有効）" : "（無効）";
    return Object.freeze({ sequence: entry.sequence, text });
  }));
}

export function exportSecurityJournal(value) {
  const snapshot = validateSecurityJournal(value);
  return JSON.stringify({
    schema: "threecore.local-protection-journal",
    version: 1,
    scope: "This page session only. Not a security audit or wallet permission revocation record.",
    containsWalletAddresses: false,
    containsBalances: false,
    containsPrivateKeys: false,
    ...snapshot,
  }, null, 2);
}
