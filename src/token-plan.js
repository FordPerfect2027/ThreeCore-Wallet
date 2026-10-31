import { parseSecurityJson } from "./security-json.js";
import { captureDataRecord, captureDataArray } from "./security-data.js";
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
  try { return captureDataRecord(value, names); }
  catch { fail("INVALID_PLAN", "Expected explicit token plan data fields"); }
}

function context(value) {
  value = fields(value, ["agent", "chainId"]);
  if (!AGENT_IDS.includes(value.agent) || !CHAINS.includes(value.chainId)) {
    fail("INVALID_CONTEXT", "Choose a ThreeCore agent and supported Base chain");
  }
  return Object.freeze({ agent: value.agent, chainId: value.chainId });
}

function contracts(input) {
  let entries;
  try { entries = captureDataArray(input, 32, 1); }
  catch { fail("INVALID_TOKENS", "Choose one to 32 explicit token contracts"); }
  const seen = new Set();
  const tokens = [];
  for (const entry of entries) {
    let address;
    try { address = normalizeAddress(entry); }
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
    input = fields(input, ["schema", "agent", "chainId", "tokens"]);
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

/** Describe replacement of configuration only. Invalid old input is unknown, never an empty list. */
export function previewTokenPlanReplacement(input, identity, currentLines) {
  const plan = validateTokenPlan(input); tokenPlanLinesForContext(plan, identity);
  if (typeof currentLines !== "string") fail("INVALID_TOKENS", "Expected local input text");
  let previous = null;
  if (currentLines.length <= LIMIT) {
    if (!currentLines.trim()) previous = [];
    else { try { previous = createTokenPlan(identity, currentLines).tokens; } catch { /* Invalid current text cannot support a change count. */ } }
  }
  const before = previous && new Set(previous), after = new Set(plan.tokens);
  return Object.freeze({ agent: plan.agent, chainId: plan.chainId, currentInputValid: previous !== null,
    currentCount: previous?.length ?? null, targetCount: plan.tokens.length,
    added: previous ? Object.freeze(plan.tokens.filter(address => !before.has(address))) : null,
    removed: previous ? Object.freeze(previous.filter(address => !after.has(address))) : null,
    retainedCount: previous ? previous.filter(address => after.has(address)).length : null,
    sameOrder: previous ? previous.join("\n") === plan.tokens.join("\n") : null,
    configurationOnly: true, canAuthorizeConnection: false, canAuthorizeTransaction: false });
}
