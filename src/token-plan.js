import { parseSecurityJson } from "./security-json.js";
import { AGENT_IDS, normalizeAddress } from "./wallet-session.js";

const SCHEMA = "threecore-token-plan-v1";
const LIMIT = 8192;
const CHAINS = Object.freeze([8453, 84532]);

export class TokenPlanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TokenPlanError";
    this.code = code;
  }
}
function fail(code, message) { throw new TokenPlanError(code, message); }

function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail("INVALID_PLAN", "Expected plain token plan data");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) {
    fail("INVALID_PLAN", "Unexpected or missing token plan fields");
  }
  for (const key of keys) {
    if (!("value" in Object.getOwnPropertyDescriptor(value, key))) {
      fail("INVALID_PLAN", "Token plan fields cannot be accessors");
    }
  }
}

function context(value) {
  fields(value, ["agent", "chainId"]);
  if (!AGENT_IDS.includes(value.agent) || !CHAINS.includes(value.chainId)) {
    fail("INVALID_CONTEXT", "Choose a ThreeCore agent and supported Base chain");
  }
  return Object.freeze({ agent: value.agent, chainId: value.chainId });
}

function contracts(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) {
    fail("INVALID_TOKENS", "Choose one to 32 distinct token contracts");
  }
  const seen = new Set();
  const tokens = [];
  for (let index = 0; index < input.length; index++) {
    const item = Object.getOwnPropertyDescriptor(input, String(index));
    if (!item || !("value" in item)) fail("INVALID_TOKENS", "Sparse or accessor token plans are forbidden");
    let address;
    try { address = normalizeAddress(item.value); }
    catch { fail("INVALID_TOKENS", "Expected complete token contract addresses"); }
    if (seen.has(address)) fail("DUPLICATE_TOKEN", "Token contracts must be unique");
    seen.add(address);
    tokens.push(address);
  }
  return Object.freeze(tokens);
}

/** Configuration only; no account, balance, authorization or provider data. */
export function validateTokenPlan(input) {
  try {
    fields(input, ["schema", "agent", "chainId", "tokens"]);
    if (input.schema !== SCHEMA) fail("INVALID_PLAN", "Unknown token plan schema");
    const identity = context({ agent: input.agent, chainId: input.chainId });
    return Object.freeze({ schema: SCHEMA, ...identity, tokens: contracts(input.tokens) });
  } catch (error) {
    if (error instanceof TokenPlanError) throw error;
    fail("INVALID_PLAN", "Malformed token plan data");
  }
}

/** Parse the same explicit line-per-contract format used by the portfolio UI. */
export function createTokenPlan(identity, lines) {
  const checked = context(identity);
  if (typeof lines !== "string" || lines.length > LIMIT) {
    fail("INVALID_TOKENS", "Expected a bounded contract list");
  }
  const tokens = lines.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return validateTokenPlan({ schema: SCHEMA, ...checked, tokens });
}

export function encodeTokenPlan(plan) {
  return JSON.stringify(validateTokenPlan(plan), null, 2);
}

export function decodeTokenPlan(text) {
  if (typeof text !== "string" || !text.length || text.length > LIMIT) {
    fail("INVALID_PLAN", "Expected a token plan JSON up to 8192 characters");
  }
  let data;
  try { data = parseSecurityJson(text); }
  catch { fail("INVALID_PLAN", "Token plan JSON cannot be parsed"); }
  return validateTokenPlan(data);
}

/** Recheck when applying, not just at preview time: chain selection may change. */
export function tokenPlanLinesForContext(input, identity) {
  const plan = validateTokenPlan(input);
  const selected = context(identity);
  if (plan.agent !== selected.agent || plan.chainId !== selected.chainId) {
    fail("PLAN_CONTEXT_MISMATCH", "Token plan belongs to a different agent or chain");
  }
  return plan.tokens.join("\n");
}
