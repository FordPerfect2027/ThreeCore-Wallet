import { sha256Hex } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { RehearsalError } from "./operation-rehearsal.js";
import { reportRehearsalOverview, REHEARSAL_OVERVIEW_SCHEMA } from "./operation-rehearsal-overview.js";
import { compareRehearsalWorkspaces, REHEARSAL_COMPARISON_SCHEMA } from "./operation-rehearsal-comparison.js";
import { compareRehearsalScenario, REHEARSAL_SCENARIO_SCHEMA } from "./operation-rehearsal-scenario.js";
import { reportRehearsalScenarioSet, REHEARSAL_SCENARIO_SET_REPORT_SCHEMA } from "./operation-rehearsal-scenario-set.js";
import { runRehearsalCheckSuite, REHEARSAL_CHECK_REPORT_SCHEMA } from "./operation-rehearsal-check-suite.js";
import { indexRehearsalRecords, queryRehearsalRecords, validateRehearsalRecordQuery, REHEARSAL_RECORD_REPORT_SCHEMA } from "./operation-rehearsal-records.js";

export const REHEARSAL_REPORT_REVIEW_SCHEMA = "threecore.operation-rehearsal-report-review.v1";
export const REHEARSAL_REPORT_REVIEW_LIMIT = 2097152;
export const REHEARSAL_REPORT_DIFFERENCE_LIMIT = 40;
const reviewSources = new WeakMap();
const fail = code => { throw new RehearsalError(code); };
const pointer = key => String(key).replace(/~/g, "~0").replace(/\//g, "~1");

function compareValues(expected, actual) {
  let count = 0; const differences = [];
  const add = (path, kind) => { count++; if (differences.length < REHEARSAL_REPORT_DIFFERENCE_LIMIT)
    differences.push(Object.freeze({ path: path || "/", kind })); };
  function visit(left, right, path) {
    if (left === right) return;
    if (left === null || right === null || typeof left !== typeof right || Array.isArray(left) !== Array.isArray(right)) {
      add(path, "type"); return;
    }
    if (typeof left !== "object") { add(path, "value"); return; }
    if (Array.isArray(left)) {
      if (left.length !== right.length) add(path, "array-length");
      for (let i = 0; i < Math.min(left.length, right.length); i++) visit(left[i], right[i], path + "/" + i);
      return;
    }
    for (const key of Object.keys(left)) {
      const next = path + "/" + pointer(key);
      if (!Object.hasOwn(right, key)) add(next, "missing"); else visit(left[key], right[key], next);
    }
    for (const key of Object.keys(right).sort()) if (!Object.hasOwn(left, key)) add(path + "/" + pointer(key), "unexpected");
  }
  visit(expected, actual, "");
  return Object.freeze({ differenceCount: count, differences: Object.freeze(differences), differencesTruncated: count > differences.length });
}

/** A checksum-only text file, bounded independently from a report. */
export function decodeRehearsalChecksumText(text){
  if(typeof text!=="string"||text.length>1024)fail("INVALID_EXPECTED_CHECKSUM");
  const value=text.trim();if(!/^[a-fA-F0-9]{64}$/.test(value))fail("INVALID_EXPECTED_CHECKSUM");
  return value.toLowerCase();
}

/** Review untrusted derived data by recomputation. Does not import its inputs into live state. */
export async function reviewRehearsalReport(text, { expectedSha256 = null, subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  let byteLength, parsed;
  try {
    byteLength = boundedUtf8Length(text, REHEARSAL_REPORT_REVIEW_LIMIT);
    parsed = parseSecurityJson(text, { bytes: REHEARSAL_REPORT_REVIEW_LIMIT, depth: 24, nodes: 100000,
      keyCharacters: 128, stringCharacters: 4096 });
  } catch { fail("INVALID_REVIEW_REPORT"); }
  if (expectedSha256 !== null && (typeof expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedSha256)))
    fail("INVALID_EXPECTED_CHECKSUM");
  let recomputed, scope, reportOutcome;
  if (parsed?.schema === REHEARSAL_OVERVIEW_SCHEMA) {
    recomputed = reportRehearsalOverview(parsed.inputs);
    scope = recomputed.rows.map(row => ({ agent: row.agent, beforeRecords: row.recordCount, afterRecords: null }));
  } else if (parsed?.schema === REHEARSAL_COMPARISON_SCHEMA) {
    recomputed = compareRehearsalWorkspaces(parsed.inputs?.before, parsed.inputs?.after);
    scope = recomputed.rows.map(row => ({ agent: row.agent, beforeRecords: row.before?.recordCount ?? null,
      afterRecords: row.after?.recordCount ?? null }));
  } else if (parsed?.schema === REHEARSAL_SCENARIO_SCHEMA) {
    recomputed = compareRehearsalScenario(parsed.inputs?.before, parsed.inputs?.after);
    scope = [{ agent: recomputed.inputs.before.agent, beforeRecords: recomputed.inputs.before.events.length,
      afterRecords: recomputed.inputs.after.events.length }];
  } else if (parsed?.schema === REHEARSAL_SCENARIO_SET_REPORT_SCHEMA) {
    recomputed = reportRehearsalScenarioSet(parsed.inputs);
    scope = recomputed.rows.map(row => ({ agent: row.agent, caseId: row.id,
      beforeRecords: row.beforeRecords, afterRecords: row.afterRecords }));
  } else if (parsed?.schema === REHEARSAL_CHECK_REPORT_SCHEMA) {
    recomputed = runRehearsalCheckSuite(parsed.inputs);
    scope = recomputed.rows.map(row => ({ agent: row.agent, caseId: row.id,
      beforeRecords: row.beforeRecords, afterRecords: row.afterRecords }));
    reportOutcome = Object.freeze({ kind: "expected-outcomes", expectationOrigin: recomputed.inputs.expectationOrigin,
      ...recomputed.summary });
  } else if (parsed?.schema === REHEARSAL_RECORD_REPORT_SCHEMA) {
    recomputed = queryRehearsalRecords(indexRehearsalRecords(parsed.inputs), validateRehearsalRecordQuery(parsed.query));
    scope = recomputed.subjects.map(row => ({ agent: row.agent, beforeRecords: row.recordCount, afterRecords: null }));
    reportOutcome = Object.freeze({ kind: "record-query", query: recomputed.query,
      totalRecords: recomputed.totalRecords, matchedRecords: recomputed.matchedRecords });
  } else fail("UNSUPPORTED_REVIEW_REPORT");
  const comparison = compareValues(recomputed, parsed);
  let sha256;
  try { sha256 = await sha256Hex(new TextEncoder().encode(text), subtle, { signal, timeoutMs }); }
  catch { fail("REVIEW_HASH_UNAVAILABLE"); }
  const expectedHash = expectedSha256?.toLowerCase() ?? null;
  const receipt = Object.freeze({ schema: REHEARSAL_REPORT_REVIEW_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, inputSchema: parsed.schema, byteLength, sha256,
    expectedSha256: expectedHash, checksumMatches: expectedHash === null ? null : expectedHash === sha256,
    matchesRecomputation: comparison.differenceCount === 0, ...comparison,
    scope: Object.freeze(scope.map(row => Object.freeze(row))), ...(reportOutcome ? { reportOutcome } : {}) });
  reviewSources.set(receipt, text);
  return receipt;
}

export function encodeRehearsalReviewReceipt(receipt) {
  // Receipts come only from reviewRehearsalReport; this is not an untrusted-receipt importer.
  return JSON.stringify(receipt, null, 2) + "\n";
}

export const REHEARSAL_REVIEW_EVIDENCE_SCHEMA = "threecore.operation-rehearsal-review-evidence.v1";
export const REHEARSAL_EVIDENCE_REVIEW_SCHEMA = "threecore.operation-rehearsal-evidence-review.v1";
export const REHEARSAL_REVIEW_EVIDENCE_LIMIT = 6 * 1024 * 1024;
const EVIDENCE_RECEIPT_LIMIT = 128 * 1024;

/** Only a receipt produced in this module can be paired with its exact source. */
export function encodeRehearsalReviewEvidence(receipt) {
  const sourceText = reviewSources.get(receipt);
  if (sourceText === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
  const text = JSON.stringify({ schema: REHEARSAL_REVIEW_EVIDENCE_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, sourceText, receipt }, null, 2) + "\n";
  try { boundedUtf8Length(text, REHEARSAL_REVIEW_EVIDENCE_LIMIT); }
  catch { fail("INVALID_REVIEW_EVIDENCE"); }
  return text;
}

/** Decode only the envelope. Neither its receipt nor its source is trusted yet. */
export function decodeRehearsalReviewEvidence(text) {
  let value;
  try {
    value = parseSecurityJson(text, { bytes: REHEARSAL_REVIEW_EVIDENCE_LIMIT, depth: 28, nodes: 100000,
      keyCharacters: 128, stringCharacters: REHEARSAL_REPORT_REVIEW_LIMIT });
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "authorizesExecution,receipt,schema,simulationOnly,sourceText,sourceVerified" ||
        value.schema !== REHEARSAL_REVIEW_EVIDENCE_SCHEMA || value.simulationOnly !== true ||
        value.sourceVerified !== false || value.authorizesExecution !== false) throw Error();
    boundedUtf8Length(value.sourceText, REHEARSAL_REPORT_REVIEW_LIMIT);
    const receipt = value.receipt;
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
        receipt.schema !== REHEARSAL_REPORT_REVIEW_SCHEMA ||
        !(receipt.expectedSha256 === null || (typeof receipt.expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(receipt.expectedSha256)))) throw Error();
    boundedUtf8Length(JSON.stringify(receipt), EVIDENCE_RECEIPT_LIMIT);
  } catch { fail("INVALID_REVIEW_EVIDENCE"); }
  return Object.freeze(value);
}

/** Recompute the report and compare every recorded receipt field. No live-state import. */
export async function reviewRehearsalEvidence(text, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const evidence = decodeRehearsalReviewEvidence(text);
  const reportReview = await reviewRehearsalReport(evidence.sourceText,
    { expectedSha256: evidence.receipt.expectedSha256, subtle, signal, timeoutMs });
  const comparison = compareValues(reportReview, evidence.receipt);
  return Object.freeze({ schema: REHEARSAL_EVIDENCE_REVIEW_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false,
    matchesReceipt: comparison.differenceCount === 0, ...comparison, reportReview });
}
