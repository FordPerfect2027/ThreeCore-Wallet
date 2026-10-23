import { identityObject, identityUnits } from "./token-identity-codec.js";
import { validateTransferContext, transferContextKey } from "./transfer-codec.js";

export const PERIOD_PLAN_SCHEMA = "threecore.period-plan.v1";
export const PERIOD_MAX_WINDOWS = 12;
export const PERIOD_MAX_WINDOW_BLOCKS = 2000;

export class PeriodError extends Error {
  constructor(code) {
    super(code);
    this.name = "PeriodError";
    this.code = code;
  }
}

export function periodFail(code) { throw new PeriodError(code); }

export function periodShape(value, fields) {
  try { identityObject(value, fields); }
  catch { periodFail("PERIOD_SHAPE"); }
}

export function periodBlock(value) {
  try { return identityUnits(value); }
  catch { periodFail("PERIOD_BLOCK"); }
}

export function periodContext(value) {
  try { return validateTransferContext(value); }
  catch { periodFail("PERIOD_CONTEXT"); }
}

export function periodContextKey(value) {
  return transferContextKey(periodContext(value));
}

/** No provider access: pin explicit decimal endpoints before the first request. */
export function createPeriodPlan(input) {
  periodShape(input, ["context", "earlierBlock", "laterBlock", "windowSize"]);
  const context = periodContext(input.context);
  const earlierBlock = periodBlock(input.earlierBlock);
  const laterBlock = periodBlock(input.laterBlock);
  const windowSize = input.windowSize;
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > PERIOD_MAX_WINDOW_BLOCKS) {
    periodFail("PERIOD_WINDOW_SIZE");
  }
  const count = BigInt(laterBlock) - BigInt(earlierBlock);
  if (count < 1n) periodFail("PERIOD_ORDER");
  const windows = (count + BigInt(windowSize) - 1n) / BigInt(windowSize);
  if (windows > BigInt(PERIOD_MAX_WINDOWS)) periodFail("PERIOD_WINDOW_LIMIT");
  return Object.freeze({ schema: PERIOD_PLAN_SCHEMA, context, earlierBlock, laterBlock, windowSize });
}

export function validatePeriodPlan(input) {
  periodShape(input, ["schema", "context", "earlierBlock", "laterBlock", "windowSize"]);
  if (input.schema !== PERIOD_PLAN_SCHEMA) periodFail("PERIOD_PLAN_SCHEMA");
  return createPeriodPlan({ context: input.context, earlierBlock: input.earlierBlock,
    laterBlock: input.laterBlock, windowSize: input.windowSize });
}

export function periodPlanKey(input) { return JSON.stringify(validatePeriodPlan(input)); }

/** The balance at A already includes events in A; history is exactly (A, B]. */
export function periodWindows(input) {
  const plan = validatePeriodPlan(input);
  const rows = [];
  const end = BigInt(plan.laterBlock);
  for (let start = BigInt(plan.earlierBlock) + 1n; start <= end; start += BigInt(plan.windowSize)) {
    const upper = start + BigInt(plan.windowSize) - 1n;
    const to = upper < end ? upper : end;
    rows.push(Object.freeze({ index: rows.length, fromBlock: start.toString(),
      toBlock: to.toString(), blocks: (to - start + 1n).toString() }));
  }
  return Object.freeze(rows);
}

export function describePeriodPlan(input) {
  const plan = validatePeriodPlan(input);
  const windows = periodWindows(plan);
  return Object.freeze({ ...plan, windows,
    blocks: (BigInt(plan.laterBlock) - BigInt(plan.earlierBlock)).toString(),
    steps: windows.length + 2,
    automaticRetry: false, readOnly: true,
  });
}
