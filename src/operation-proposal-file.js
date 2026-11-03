import { captureDataRecord, captureDataArray, captureOptionalDataFields } from "./security-data.js";
import { boundedUtf8Length, parseSecurityJson } from "./security-json.js";
import { BUDGET_EVIDENCE_LIMIT } from "./operation-budget-evidence.js";
import { PROPOSAL_FILE_LIMIT, OperationProposalError, decodeOperationProposal, decodeProposalReviewPolicy, inspectOperationProposal } from "./operation-proposal.js";

export const PROPOSAL_REVIEW_FILE_SCHEMA = "threecore.operation-proposal-review-file.v1";
export const PROPOSAL_REVIEW_FILE_LIMIT = 2097152;
const fail = code => { throw new OperationProposalError(code); };
function bound(value, limit) { try { boundedUtf8Length(value, limit); } catch { fail("FILE_TOO_LARGE"); } return value; }
function record(value, keys) { try { return captureDataRecord(value, keys); } catch { fail("INVALID_REVIEW_FILE"); } }
function sources(input) {
  const data = record(input, ["proposalFile", "policyFile", "budgetEvidenceFile"]);
  return Object.freeze({ proposalFile: bound(data.proposalFile, PROPOSAL_FILE_LIMIT), policyFile: bound(data.policyFile, PROPOSAL_FILE_LIMIT),
    budgetEvidenceFile: bound(data.budgetEvidenceFile, BUDGET_EVIDENCE_LIMIT) });
}
function summary(result) { return { checksSatisfied: result.checksSatisfied, reasons: result.reasons, authorizesExecution: false }; }

/** Preserve exact input text and an explicitly historical result, never an execution permission. */
export async function prepareOperationProposalReview(input, options = {}) {
  const files = sources(input);
  const result = await inspectOperationProposal(decodeOperationProposal(files.proposalFile), decodeProposalReviewPolicy(files.policyFile), files.budgetEvidenceFile, options);
  const data = { schema: PROPOSAL_REVIEW_FILE_SCHEMA, reviewOnly: true, ...files, evaluatedAtSeconds: result.evaluatedAtSeconds, result: summary(result) };
  const text = bound(JSON.stringify(data, null, 2) + "\n", PROPOSAL_REVIEW_FILE_LIMIT);
  return Object.freeze({ text, result, files });
}

/** Validate a saved result by recomputation at its recorded time. The timestamp and author are not authenticated. */
export async function inspectOperationProposalReviewFile(text, options = {}) {
  bound(text, PROPOSAL_REVIEW_FILE_LIMIT);
  let raw; try { raw = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  const data = record(raw, ["schema", "reviewOnly", "proposalFile", "policyFile", "budgetEvidenceFile", "evaluatedAtSeconds", "result"]);
  if (data.schema !== PROPOSAL_REVIEW_FILE_SCHEMA || data.reviewOnly !== true) fail("INVALID_REVIEW_FILE");
  if (!Number.isSafeInteger(data.evaluatedAtSeconds) || data.evaluatedAtSeconds < 0 || data.evaluatedAtSeconds > 253402300799) fail("INVALID_TIME");
  const files = sources({ proposalFile: data.proposalFile, policyFile: data.policyFile, budgetEvidenceFile: data.budgetEvidenceFile });
  const recorded = record(data.result, ["checksSatisfied", "reasons", "authorizesExecution"]);
  if (typeof recorded.checksSatisfied !== "boolean" || recorded.authorizesExecution !== false) fail("INVALID_REVIEW_FILE");
  let reasons; try { reasons = captureDataArray(recorded.reasons, 32); } catch { fail("INVALID_REVIEW_FILE"); }
  if (reasons.some(code => typeof code !== "string" || !/^[A-Z_]{1,64}$/.test(code))) fail("INVALID_REVIEW_FILE");
  let settings; try { settings = captureOptionalDataFields(options, ["subtle", "signal", "timeoutMs"]); } catch { fail("INVALID_OPTIONS"); }
  const prepared = await prepareOperationProposalReview(files, { ...settings, nowSeconds: data.evaluatedAtSeconds });
  if (recorded.checksSatisfied !== prepared.result.checksSatisfied || JSON.stringify(reasons) !== JSON.stringify(prepared.result.reasons)) fail("RECORDED_REVIEW_MISMATCH");
  return Object.freeze({ files, recordedResult: prepared.result, historicalOnly: true, timestampAuthenticated: false, authorizesExecution: false });
}
