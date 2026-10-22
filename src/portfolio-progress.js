import { normalizeAddress } from "./wallet-session.js";
import { readErrorCode } from "./provider-error.js";

const FAILURES = Object.freeze({
  INVALID_ADDRESS: "契約アドレスを0xで始まる42文字で入力してください。",
  INVALID_TOKENS: "契約アドレスを1行に1つ、1〜32件入力してください。",
  DUPLICATE_TOKEN: "同じ契約アドレスが重複しています。入力リストを確認してください。",
  INVALID_TIMEOUT: "読み取りの待機時間の設定を確認してください。",
  INVALID_SIGNAL: "操作状態をリセットし、必要な場合は手動で再確認してください。",
  INVALID_PROGRESS_OBSERVER: "進捗表示の設定を確認してください。",
  SNAPSHOT_TIMEOUT: "全体の待機時間を超えました。必要な場合は手動で再確認してください。",
  READ_TIMEOUT: "Walletから応答がありません。接続状態を確認してください。",
  BLOCK_CHANGED: "参照ブロックが変わりました。必要な場合は手動で再確認してください。",
  SESSION_CHANGED: "アカウントまたはチェーンが変わりました。接続設定を確認してください。",
  DISCONNECTED: "先にWalletを明示的に接続してください。",
  ABORTED: "操作はキャンセルされています。必要な場合は手動で再確認してください。",
  "4100": "Walletの接続許可を確認し、必要な場合は手動で再接続してください。",
  "4900": "Walletが切断されています。必要な場合は手動で再接続してください。",
  "4901": "選択したチェーンへの接続を確認してください。",
});

/** Finite labels only: never display arbitrary provider messages or payloads. */
export function portfolioFailureStatus(error) {
  const value = readErrorCode(error);
  const key = value === undefined ? "" : String(value);
  const known = Object.hasOwn(FAILURES, key);
  return Object.freeze({
    code: known ? key : "PORTFOLIO_UNAVAILABLE",
    message: "確認できませんでした。" + (known ? FAILURES[key] : "接続と入力を確認してください。"),
  });
}

export class PortfolioProgressError extends Error {
  constructor() {
    super("Unexpected portfolio progress event");
    this.name = "PortfolioProgressError";
    this.code = "INVALID_PORTFOLIO_PROGRESS";
  }
}
const fail = () => { throw new PortfolioProgressError(); };
const KEYS = ["stage", "completedTokens", "totalTokens", "tokenIndex", "tokenAddress"];
const STAGES = ["block", "native", "token-code", "token-balance", "canonical", "complete"];

function data(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail();
  const names = Reflect.ownKeys(input);
  if (names.length !== KEYS.length || names.some(name => !KEYS.includes(name))) fail();
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(input, name);
    if (!descriptor || !("value" in descriptor)) fail();
  }
  if (!STAGES.includes(input.stage) || !Number.isInteger(input.totalTokens) ||
      input.totalTokens < 1 || input.totalTokens > 32 ||
      !Number.isInteger(input.completedTokens) || input.completedTokens < 0 ||
      input.completedTokens > input.totalTokens) fail();
  const token = input.stage === "token-code" || input.stage === "token-balance";
  if (token) {
    if (!Number.isInteger(input.tokenIndex) || input.tokenIndex !== input.completedTokens ||
        input.tokenIndex >= input.totalTokens) fail();
    normalizeAddress(input.tokenAddress);
  } else {
    if (input.tokenIndex !== null || input.tokenAddress !== null) fail();
    const expected = ["canonical", "complete"].includes(input.stage) ? input.totalTokens : 0;
    if (input.completedTokens !== expected) fail();
  }
  return Object.freeze({ ...input, tokenAddress: token ? normalizeAddress(input.tokenAddress) : null });
}

function label(event) {
  const count = event.completedTokens + "/" + event.totalTokens + "件確認済み。";
  switch (event.stage) {
    case "block": return count + "参照ブロックを取得しています。";
    case "native": return count + "ETH残高を確認しています。";
    case "token-code": return count + (event.tokenIndex + 1) + "件目の契約コードを確認しています。";
    case "token-balance": return count + (event.tokenIndex + 1) + "件目のトークン残高を確認しています。";
    case "canonical": return count + "ブロックが変わっていないか再確認しています。";
    case "complete": return count + "読み取り結果を確認しています。";
  }
}

/** Progress is display-only; it cannot produce a portfolio or authorize an action. */
export function createPortfolioProgressTracker(inputTokens) {
  if (!Array.isArray(inputTokens) || inputTokens.length < 1 || inputTokens.length > 32) fail();
  const tokens = [];
  try {
    for (let index = 0; index < inputTokens.length; index++) {
      const item = Object.getOwnPropertyDescriptor(inputTokens, String(index));
      if (!item || !("value" in item)) fail();
      tokens.push(normalizeAddress(item.value));
    }
    if (new Set(tokens).size !== tokens.length) fail();
  } catch { fail(); }
  let previous = null;
  return Object.freeze({
    accept(input) {
      let event;
      try { event = data(input); } catch { fail(); }
      if (event.totalTokens !== tokens.length ||
          (event.tokenIndex !== null && event.tokenAddress !== tokens[event.tokenIndex])) fail();
      let allowed = false;
      if (!previous) allowed = event.stage === "block";
      else if (previous.stage === "block") allowed = event.stage === "native";
      else if (previous.stage === "native") allowed = event.stage === "token-code" && event.tokenIndex === 0;
      else if (["token-code", "token-balance"].includes(previous.stage)) {
        allowed = (previous.stage === "token-code" && event.stage === "token-balance" && event.tokenIndex === previous.tokenIndex) ||
          (event.stage === "token-code" && event.tokenIndex === previous.tokenIndex + 1) ||
          (event.stage === "canonical" && previous.tokenIndex === tokens.length - 1);
      } else if (previous.stage === "canonical") allowed = event.stage === "complete";
      if (!allowed) fail();
      previous = event;
      return Object.freeze({ ...event, label: label(event) });
    },
  });
}
