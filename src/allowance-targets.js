import { catalogToken } from "./token-catalog.js";
import { identityObject, identityAddress, metadataText } from "./token-identity-codec.js";

export const ALLOWANCE_TARGET_LIMIT = 20;
export const ALLOWANCE_DRAFT_LIMIT = 8192;
export const ALLOWANCE_TARGET_SCHEMA = "threecore-allowance-targets-v1";

export class AllowanceError extends Error {
  constructor(code) {
    super(code);
    this.name = "AllowanceError";
    this.code = code;
  }
}
export function allowanceFail(code) { throw new AllowanceError(code); }

export function allowanceObject(value, fields) {
  try { return identityObject(value, fields); }
  catch { allowanceFail("ALLOWANCE_SHAPE"); }
}
export function allowanceAddress(value) {
  try { return identityAddress(value); }
  catch { allowanceFail("ALLOWANCE_ADDRESS"); }
}
export function allowanceLabel(value) {
  if (value === "") return "";
  try {
    if (typeof value !== "string" || value.length > 64 || value.includes("|")) allowanceFail("ALLOWANCE_LABEL");
    metadataText(value);
  } catch { allowanceFail("ALLOWANCE_LABEL"); }
  return value;
}
export function allowanceContext(input) {
  let token;
  try { token = catalogToken({ agent: input?.agent, chainId: input?.chainId }); }
  catch { allowanceFail("ALLOWANCE_CONTEXT"); }
  const address = input.tokenAddress ? allowanceAddress(input.tokenAddress) : token.address;
  if (address !== token.address) allowanceFail("ALLOWANCE_TOKEN");
  return Object.freeze({ agent: token.agent, chainId: token.chainId, tokenAddress: token.address });
}
export function allowanceArray(input, { allowEmpty = false } = {}) {
  if (!Array.isArray(input) || input.length > ALLOWANCE_TARGET_LIMIT ||
      (!allowEmpty && input.length === 0) || Reflect.ownKeys(input).length !== input.length + 1) {
    allowanceFail("ALLOWANCE_TARGETS");
  }
  for (let i = 0; i < input.length; i++) {
    const property = Object.getOwnPropertyDescriptor(input, String(i));
    if (!property || !("value" in property)) allowanceFail("ALLOWANCE_TARGETS");
  }
  return input;
}

export function validateAllowanceTargets(input) {
  allowanceObject(input, ["schema", "agent", "chainId", "tokenAddress", "targets"]);
  if (input.schema !== ALLOWANCE_TARGET_SCHEMA) allowanceFail("ALLOWANCE_SCHEMA");
  const context = allowanceContext(input);
  const seen = new Set();
  const targets = allowanceArray(input.targets).map(value => {
    allowanceObject(value, ["address", "label"]);
    const address = allowanceAddress(value.address);
    if (seen.has(address)) allowanceFail("ALLOWANCE_DUPLICATE");
    seen.add(address);
    return Object.freeze({ address, label: allowanceLabel(value.label) });
  });
  return Object.freeze({ schema: ALLOWANCE_TARGET_SCHEMA, ...context, targets: Object.freeze(targets) });
}

/** One address per line, optionally followed by a pipe and a local label. */
export function parseAllowanceTargets(text, input) {
  const context = allowanceContext(input);
  if (typeof text !== "string" || !text.trim() ||
      new TextEncoder().encode(text).length > ALLOWANCE_DRAFT_LIMIT) allowanceFail("ALLOWANCE_DRAFT");
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > ALLOWANCE_TARGET_LIMIT) allowanceFail("ALLOWANCE_TARGETS");
  const targets = lines.map(line => {
    const parts = line.split("|");
    if (parts.length > 2) allowanceFail("ALLOWANCE_DRAFT");
    return { address: parts[0].trim(), label: parts.length === 2 ? parts[1].trim() : "" };
  });
  return validateAllowanceTargets({ schema: ALLOWANCE_TARGET_SCHEMA, ...context, targets });
}

export function formatAllowanceTargets(input) {
  return validateAllowanceTargets(input).targets.map(target =>
    target.address + (target.label ? " | " + target.label : "")).join("\n");
}

export function allowanceTargetsKey(input) {
  return JSON.stringify(validateAllowanceTargets(input));
}

export function assertAllowanceContext(plan, current) {
  const expected = allowanceContext(current);
  const valid = validateAllowanceTargets(plan);
  if (["agent", "chainId", "tokenAddress"].some(key => valid[key] !== expected[key])) {
    allowanceFail("ALLOWANCE_CONTEXT_CHANGED");
  }
  return valid;
}
