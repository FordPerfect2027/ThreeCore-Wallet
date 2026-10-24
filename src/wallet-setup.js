import { parseSecurityJson } from "./security-json.js";
import { AGENT_IDS, normalizeAddress } from "./wallet-session.js";

export const WALLET_SETUP_SCHEMA = "threecore-wallet-setup-v1";
export const WALLET_SETUP_LIMIT = 16384;
const CHAINS = Object.freeze([84532, 8453]);

export class WalletSetupError extends Error {
  constructor(code) {
    super(code);
    this.name = "WalletSetupError";
    this.code = code;
  }
}
const fail = code => { throw new WalletSetupError(code); };

function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("SETUP_SHAPE");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) fail("SETUP_SHAPE");
  for (const key of keys) {
    if (!("value" in Object.getOwnPropertyDescriptor(value, key))) fail("SETUP_SHAPE");
  }
}

function rows(value) {
  if (!Array.isArray(value) || value.length !== AGENT_IDS.length ||
      Reflect.ownKeys(value).some(key => !["0", "1", "2", "length"].includes(key))) fail("SETUP_ROWS");
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) fail("SETUP_ROWS");
    const row = descriptor.value;
    fields(row, ["agent", "account", "chainId"]);
    if (!AGENT_IDS.includes(row.agent) || result.some(item => item.agent === row.agent)) fail("SETUP_AGENT");
    if (!CHAINS.includes(row.chainId)) fail("SETUP_CHAIN");
    result.push(row);
  }
  return AGENT_IDS.map(agent => result.find(row => row.agent === agent));
}

function address(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length !== 42) fail("SETUP_ADDRESS");
  if (/^0x0{40}$/.test(value)) fail("SETUP_ADDRESS");
  try { return normalizeAddress(value); }
  catch { fail("SETUP_ADDRESS"); }
}

/** Configuration data only. A saved address never proves wallet ownership. */
export function validateWalletSetup(value) {
  try {
    fields(value, ["schema", "entries"]);
    if (value.schema !== WALLET_SETUP_SCHEMA) fail("SETUP_SCHEMA");
    const seen = new Set();
    const entries = rows(value.entries).map(row => {
      const account = address(row.account);
      if (account && seen.has(account)) fail("SETUP_DUPLICATE");
      if (account) seen.add(account);
      return Object.freeze({ agent: row.agent, account, chainId: row.chainId });
    });
    return Object.freeze({ schema: WALLET_SETUP_SCHEMA, entries: Object.freeze(entries) });
  } catch (error) {
    if (error instanceof WalletSetupError) throw error;
    fail("SETUP_SHAPE");
  }
}

export function encodeWalletSetup(value) {
  return JSON.stringify(validateWalletSetup(value), null, 2);
}

export function decodeWalletSetup(text) {
  if (typeof text !== "string" || !text.length || text.length > WALLET_SETUP_LIMIT) fail("SETUP_SIZE");
  let value;
  try { value = parseSecurityJson(text.startsWith("\ufeff") ? text.slice(1) : text); }
  catch { fail("SETUP_JSON"); }
  return validateWalletSetup(value);
}

/** Capture raw form values, including incomplete addresses, for stale checks. */
export function captureWalletFields(value) {
  try {
    return Object.freeze(rows(value).map(row => {
      if (typeof row.account !== "string" || row.account.length > 256) fail("SETUP_ADDRESS");
      return Object.freeze({ agent: row.agent, account: row.account, chainId: row.chainId });
    }));
  } catch (error) {
    if (error instanceof WalletSetupError) throw error;
    fail("SETUP_SHAPE");
  }
}

export function setupFromFields(value) {
  const entries = captureWalletFields(value).map(row => ({
    ...row, account: row.account.trim() || null,
  }));
  return validateWalletSetup({ schema: WALLET_SETUP_SCHEMA, entries });
}

/** Reports configuration readiness, deliberately never 'connected' or 'owned'. */
export function inspectWalletFields(value) {
  const captured = captureWalletFields(value);
  const normalized = captured.map(row => {
    const input = row.account.trim();
    if (!input) return { ...row, account: null, status: "missing" };
    try { return { ...row, account: address(input), status: "configured" }; }
    catch { return { ...row, account: null, status: "invalid" }; }
  });
  const entries = normalized.map(row => Object.freeze({ ...row,
    status: row.account && normalized.filter(other => other.account === row.account).length > 1
      ? "duplicate" : row.status,
  }));
  const configured = entries.filter(row => row.status === "configured").length;
  return Object.freeze({ entries: Object.freeze(entries), configured,
    readyForManualConnection: configured === 3, ownershipVerified: false });
}

export function previewWalletSetup(text, current) {
  const plan = decodeWalletSetup(text);
  const before = captureWalletFields(current);
  const changes = plan.entries.map((next, index) => {
    const previous = before[index];
    let account = previous.account.trim();
    try { account = address(account) ?? ""; } catch { /* Show invalid input as replaced. */ }
    return Object.freeze({ agent: next.agent, before: previous, after: next,
      accountChanged: account !== (next.account ?? ""),
      chainChanged: previous.chainId !== next.chainId,
    });
  });
  return Object.freeze({ plan, before, changes: Object.freeze(changes),
    changedAgents: Object.freeze(changes.filter(row => row.accountChanged || row.chainChanged).map(row => row.agent)),
    configured: plan.entries.filter(row => row.account !== null).length,
    authorizesConnection: false, authorizesTransaction: false,
  });
}

/** Preview is single use and tied to both the JSON and all current form values. */
// Provider cleanup belongs in prepareApply, before the final destination check.
// applyPlan must synchronously update local fields, without calling providers.
export function createWalletSetupReview({ readFields, applyPlan, prepareApply = () => {} }) {
  if (![readFields, applyPlan, prepareApply].every(value => typeof value === "function")) fail("SETUP_ADAPTER");
  let pending = null;
  let revision = 0;
  let disposed = false;
  let active = false;
  function cancel() { pending = null; revision++; }
  function available() {
    if (disposed) fail("SETUP_DISPOSED");
    if (active) fail("SETUP_REVIEW_REQUIRED");
  }
  function checkCurrent(id) {
    if (!active || disposed || revision !== id) fail("SETUP_REVIEW_REQUIRED");
  }
  function syncResult(value) {
    if (value && typeof value.then === "function") {
      Promise.resolve(value).catch(() => {});
      fail("SETUP_ADAPTER");
    }
    return value;
  }
  function capture(id) {
    const result = captureWalletFields(syncResult(readFields()));
    checkCurrent(id);
    return result;
  }
  return Object.freeze({
    preview(text) {
      available();
      cancel();
      const id = revision;
      active = true;
      try {
        const result = previewWalletSetup(text, capture(id));
        checkCurrent(id);
        pending = { id, text, key: JSON.stringify(result.before), result };
        return Object.freeze({ id, ...result });
      } finally { active = false; }
    },
    apply(id, text) {
      available();
      const candidate = pending;
      cancel(); // Failures and reentrant callbacks cannot reuse the preview.
      const operation = revision;
      if (!candidate || id !== candidate.id || text !== candidate.text) fail("SETUP_REVIEW_REQUIRED");
      active = true;
      try {
        const current = capture(operation);
        if (JSON.stringify(current) !== candidate.key) fail("SETUP_STALE");
        const checked = previewWalletSetup(text, current);
        checkCurrent(operation);
        syncResult(prepareApply(checked.plan, checked.changes, () => checkCurrent(operation)));
        checkCurrent(operation);
        // Cleanup can synchronously call application code. Neither cancellation
        // nor an edit made there may be overwritten by the reviewed old plan.
        if (JSON.stringify(capture(operation)) !== candidate.key) fail("SETUP_STALE");
        syncResult(applyPlan(checked.plan, checked.changes));
        checkCurrent(operation);
        return checked;
      } finally { active = false; }
    },
    cancel,
    dispose() { disposed = true; cancel(); },
  });
}

export function describeWalletSetupReview(review) {
  const show = row => (row.account || "未設定") + " / " +
    (row.chainId === 84532 ? "Base Sepolia（テスト用）" : "Base Mainnet（本番・読み取り専用）");
  const lines = ["設定済みアドレス: " + review.configured + " / 3", "変更対象: " +
    (review.changedAgents.join("・") || "なし"), ""];
  for (const row of review.changes) {
    lines.push(row.agent, "変更前: " + show(row.before), "変更後: " + show(row.after));
    if (row.chainChanged) lines.push("ネットワーク変更に伴い、このカードのトークン入力を消去します。");
  }
  lines.push("", "変更するカードは切断し、残高表示を消去します。保存履歴は保持します。",
    "Walletの種類や接続許可はファイルに保存しません。実際の所有・接続・残高は別途確認してください。");
  return lines.join("\n");
}
