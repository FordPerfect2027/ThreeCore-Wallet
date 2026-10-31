import { captureDataRecord, sha256Hex } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { RehearsalError, encodeRehearsal } from "./operation-rehearsal.js";
import { encodeRehearsalWorkspace } from "./operation-rehearsal-workspace.js";
import { reportRehearsalOverview, REHEARSAL_OVERVIEW_SCHEMA } from "./operation-rehearsal-overview.js";
import { compareRehearsalWorkspaces, REHEARSAL_COMPARISON_SCHEMA } from "./operation-rehearsal-comparison.js";
import { compareRehearsalScenario, REHEARSAL_SCENARIO_SCHEMA } from "./operation-rehearsal-scenario.js";
import { reportRehearsalScenarioSet, REHEARSAL_SCENARIO_SET_REPORT_SCHEMA } from "./operation-rehearsal-scenario-set.js";
import { runRehearsalCheckSuite, REHEARSAL_CHECK_REPORT_SCHEMA } from "./operation-rehearsal-check-suite.js";
import { REHEARSAL_REASON_RECORD_REPORT_SCHEMA,queryRehearsalReasonRecords,reportRehearsalReference, REHEARSAL_REFERENCE_REPORT_SCHEMA, indexRehearsalRecords, queryRehearsalRecords, validateRehearsalRecordQuery, queryRehearsalContextRecords, validateRehearsalContextRecordQuery, REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA, REHEARSAL_RECORD_REPORT_SCHEMA } from "./operation-rehearsal-records.js";

export const REHEARSAL_REPORT_REVIEW_SCHEMA = "threecore.operation-rehearsal-report-review.v1";
export const REHEARSAL_REPORT_REVIEW_LIMIT = 2097152;
export const REHEARSAL_REPORT_DIFFERENCE_LIMIT = 40;
const reviewSources = new WeakMap();
const evidenceReceipts = new WeakMap();
const fail = code => { throw new RehearsalError(code); };
const pointer = key => String(key).replace(/~/g, "~0").replace(/\//g, "~1");

function compareValues(expected, actual, offset = 0, onDifference = null) {
  let count = 0; const differences = [];
  const add = (path, kind, left, right, expectedPresent = true, actualPresent = true) => {
    count++;
    const difference = Object.freeze({ path: path || "/", kind });
    if (count > offset && differences.length < REHEARSAL_REPORT_DIFFERENCE_LIMIT) differences.push(difference);
    onDifference?.(count - 1, difference, left, right, expectedPresent, actualPresent);
  };
  function visit(left, right, path) {
    if (left === right) return;
    if (left === null || right === null || typeof left !== typeof right || Array.isArray(left) !== Array.isArray(right)) {
      add(path, "type", left, right); return;
    }
    if (typeof left !== "object") { add(path, "value", left, right); return; }
    if (Array.isArray(left)) {
      if (left.length !== right.length) add(path, "array-length", left, right);
      for (let i = 0; i < Math.min(left.length, right.length); i++) visit(left[i], right[i], path + "/" + i);
      return;
    }
    for (const key of Object.keys(left)) {
      const next = path + "/" + pointer(key);
      if (!Object.hasOwn(right, key)) add(next, "missing", left[key], undefined, true, false); else visit(left[key], right[key], next);
    }
    for (const key of Object.keys(right).sort()) if (!Object.hasOwn(left, key)) add(path + "/" + pointer(key), "unexpected", undefined, right[key], false, true);
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
function prepareRehearsalReview(text, expectedSha256) {
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
  } else if(parsed?.schema===REHEARSAL_REFERENCE_REPORT_SCHEMA) {
    recomputed=reportRehearsalReference(indexRehearsalRecords(parsed.inputs),parsed.selectedKey);
    scope=recomputed.subjects.map(row=>({agent:row.agent,beforeRecords:row.recordCount,afterRecords:null}));
    reportOutcome=Object.freeze({kind:"record-reference",agent:recomputed.agent,reference:recomputed.reference,recordCount:recomputed.recordCount,summary:recomputed.summary});
  } else if ([REHEARSAL_RECORD_REPORT_SCHEMA,REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA,REHEARSAL_REASON_RECORD_REPORT_SCHEMA].includes(parsed?.schema)) {
    recomputed = parsed.schema===REHEARSAL_REASON_RECORD_REPORT_SCHEMA?queryRehearsalReasonRecords(indexRehearsalRecords(parsed.inputs),parsed.query):parsed.schema===REHEARSAL_RECORD_REPORT_SCHEMA?queryRehearsalRecords(indexRehearsalRecords(parsed.inputs), validateRehearsalRecordQuery(parsed.query)):queryRehearsalContextRecords(indexRehearsalRecords(parsed.inputs), validateRehearsalContextRecordQuery(parsed.query));
    scope = recomputed.subjects.map(row => ({ agent: row.agent, beforeRecords: row.recordCount, afterRecords: null }));
    reportOutcome = Object.freeze({ kind: "record-query", query: recomputed.query,
      totalRecords: recomputed.totalRecords, matchedRecords: recomputed.matchedRecords });
  } else fail("UNSUPPORTED_REVIEW_REPORT");
  return { byteLength, parsed, recomputed, scope, reportOutcome };
}

export async function reviewRehearsalReport(text, { expectedSha256 = null, subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const { byteLength, parsed, recomputed, scope, reportOutcome } = prepareRehearsalReview(text, expectedSha256);
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

const workspaceSourceSchemas = new Set([REHEARSAL_OVERVIEW_SCHEMA,REHEARSAL_RECORD_REPORT_SCHEMA,
  REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA,REHEARSAL_REASON_RECORD_REPORT_SCHEMA,REHEARSAL_REFERENCE_REPORT_SCHEMA]);

/** Only a fresh successful review with one unambiguous workspace can export inputs. */
export function canExportReviewedRehearsalWorkspace(receipt) {
  return reviewSources.has(receipt)&&receipt.matchesRecomputation===true&&receipt.checksumMatches!==false&&workspaceSourceSchemas.has(receipt.inputSchema);
}

/** Reconstruct canonical workspace JSON; do not claim original file-byte recovery. */
export function exportReviewedRehearsalWorkspace(receipt) {
  return encodeRehearsalWorkspace(reviewedWorkspaceInputs(receipt));
}

function reviewedWorkspaceInputs(receipt) {
  if(!canExportReviewedRehearsalWorkspace(receipt))fail("REVIEW_WORKSPACE_UNAVAILABLE");
  const {recomputed}=prepareRehearsalReview(reviewSources.get(receipt),receipt.expectedSha256);
  return recomputed.inputs;
}

/** Extract only a present agent; an absent agent must never become a zero ledger. */
export function exportReviewedRehearsalAgent(receipt,agent) {
  if(typeof agent!=="string"||!["DAT","EMA","CAWELON"].includes(agent))fail("INVALID_REVIEW_AGENT");
  const ledger=reviewedWorkspaceInputs(receipt).ledgers.find(row=>row.agent===agent);
  if(!ledger)fail("REVIEW_AGENT_MISSING");
  return encodeRehearsal(ledger);
}

/** The direction is current workspace -> report inputs; this never applies either side. */
export function compareReviewedRehearsalWorkspace(receipt,currentInputs) {
  return compareRehearsalWorkspaces(currentInputs,reviewedWorkspaceInputs(receipt));
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
  const review = Object.freeze({ schema: REHEARSAL_EVIDENCE_REVIEW_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false,
    matchesReceipt: comparison.differenceCount === 0, ...comparison, reportReview });
  evidenceReceipts.set(review, evidence.receipt);
  return review;
}

function reviewDifferencePage(expected, actual, requestedOffset) {
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) fail("INVALID_REVIEW_DIFFERENCE_OFFSET");
  const size = REHEARSAL_REPORT_DIFFERENCE_LIMIT, requested = Math.floor(requestedOffset / size) * size;
  let comparison = compareValues(expected, actual, requested);
  const totalPages = Math.max(1, Math.ceil(comparison.differenceCount / size));
  const offset = Math.min(requested, (totalPages - 1) * size);
  if (offset !== requested) comparison = compareValues(expected, actual, offset);
  return Object.freeze({ offset, limit: size, page: offset / size + 1, totalPages,
    totalDifferences: comparison.differenceCount, differences: comparison.differences,
    hasPrevious: offset > 0, hasNext: offset + size < comparison.differenceCount });
}

/** Page only the exact source of a completed review; no new hash or wallet request. */
export function pageReviewedRehearsalDifferences(receipt, offset = 0) {
  const text = reviewSources.get(receipt);
  if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
  const { parsed, recomputed } = prepareRehearsalReview(text, receipt.expectedSha256);
  return reviewDifferencePage(recomputed, parsed, offset);
}

/** The recorded receipt is retained privately alongside its completed verification. */
export function pageRehearsalEvidenceReceiptDifferences(review, offset = 0) {
  const receipt = evidenceReceipts.get(review);
  if (receipt === undefined) fail("UNRECOGNIZED_EVIDENCE_REVIEW");
  return reviewDifferencePage(review.reportReview, receipt, offset);
}

export const REHEARSAL_DIFFERENCE_VALUE_PREVIEW_LIMIT = 2048;
function differenceValue(value, present) {
  if (!present) return Object.freeze({ present: false, type: "absent", json: null, characters: 0, truncated: false, arrayLength: null });
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const json = JSON.stringify(value).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  const limit = REHEARSAL_DIFFERENCE_VALUE_PREVIEW_LIMIT;
  let end = Math.min(json.length, limit);
  // Keep the preview boundary outside a UTF-16 surrogate pair.
  if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1]) && /[\uDC00-\uDFFF]/.test(json[end])) end--;
  return Object.freeze({ present: true, type, json: json.slice(0, end), characters: json.length,
    truncated: end < json.length, arrayLength: Array.isArray(value) ? value.length : null });
}
function inspectDifference(expected, actual, index) {
  if (!Number.isSafeInteger(index) || index < 0) fail("INVALID_REVIEW_DIFFERENCE_INDEX");
  let selected = null;
  const comparison = compareValues(expected, actual, 0, (number, difference, left, right, leftPresent, rightPresent) => {
    if (number === index) selected = Object.freeze({ ...difference, expected: differenceValue(left, leftPresent), actual: differenceValue(right, rightPresent) });
  });
  if (!selected) fail("REVIEW_DIFFERENCE_NOT_FOUND");
  return Object.freeze({ index, number: index + 1, totalDifferences: comparison.differenceCount,
    previewLimit: REHEARSAL_DIFFERENCE_VALUE_PREVIEW_LIMIT, ...selected });
}

/** Read-only value previews bound to the exact source of a completed review. */
export function inspectReviewedRehearsalDifference(receipt, index) {
  const text = reviewSources.get(receipt);
  if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
  const { parsed, recomputed } = prepareRehearsalReview(text, receipt.expectedSha256);
  return inspectDifference(recomputed, parsed, index);
}

/** Receipt values and source values have separate verification identities. */
export function inspectRehearsalEvidenceReceiptDifference(review, index) {
  const recorded = evidenceReceipts.get(review);
  if (recorded === undefined) fail("UNRECOGNIZED_EVIDENCE_REVIEW");
  return inspectDifference(review.reportReview, recorded, index);
}

export const REHEARSAL_DIFFERENCE_VALUES_SCHEMA = "threecore.operation-rehearsal-difference-values.v1";
/** Complete selected values, for inspection only. Never exposes private source references. */
export function encodeRehearsalDifferenceValues(review, index, target = "report") {
  if (!["report", "evidence-source", "evidence-receipt"].includes(target)) fail("INVALID_REVIEW_DIFFERENCE_TARGET");
  let expected, actual, report, matchesReceipt = null;
  if (target === "report") {
    const text = reviewSources.get(review);
    if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
    report = review;
    ({ recomputed: expected, parsed: actual } = prepareRehearsalReview(text, report.expectedSha256));
  } else {
    const recorded = evidenceReceipts.get(review);
    if (recorded === undefined) fail("UNRECOGNIZED_EVIDENCE_REVIEW");
    report = review.reportReview;
    matchesReceipt = review.matchesReceipt;
    if (target === "evidence-receipt") { expected = report; actual = recorded; }
    else {
      const text = reviewSources.get(report);
      if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
      ({ recomputed: expected, parsed: actual } = prepareRehearsalReview(text, report.expectedSha256));
    }
  }
  if (!Number.isSafeInteger(index) || index < 0) fail("INVALID_REVIEW_DIFFERENCE_INDEX");
  const value = (item, present) => present
    ? { present: true, type: item === null ? "null" : Array.isArray(item) ? "array" : typeof item, value: item }
    : { present: false, type: "absent" };
  let selected = null;
  const comparison = compareValues(expected, actual, 0, (number, difference, left, right, leftPresent, rightPresent) => {
    if (number === index) selected = { ...difference, expected: value(left, leftPresent), actual: value(right, rightPresent) };
  });
  if (!selected) fail("REVIEW_DIFFERENCE_NOT_FOUND");
  const text = JSON.stringify({ schema: REHEARSAL_DIFFERENCE_VALUES_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, target, sourceSha256: report.sha256,
    summary: { matchesReceipt, matchesRecomputation: report.matchesRecomputation, checksumMatches: report.checksumMatches,
      reportOutcome: report.reportOutcome ?? null },
    index, number: index + 1, totalDifferences: comparison.differenceCount, valuesComplete: true, ...selected }, null, 2)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")) + "\n";
  try { boundedUtf8Length(text, REHEARSAL_REVIEW_EVIDENCE_LIMIT); }
  catch { fail("DIFFERENCE_VALUES_TOO_LARGE"); }
  return text;
}

export const REHEARSAL_DIFFERENCE_QUERY = Object.freeze({ path: "", kind: "all" });
export function validateRehearsalDifferenceQuery(input) {
  let value;
  try { value = captureDataRecord(input, ["path", "kind"]); }
  catch { fail("INVALID_REVIEW_DIFFERENCE_QUERY"); }
  if (typeof value.path !== "string" || value.path.length > 128 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.path) ||
      !["all", "missing", "unexpected", "type", "value", "array-length"].includes(value.kind))
    fail("INVALID_REVIEW_DIFFERENCE_QUERY");
  return Object.freeze({ path: value.path.trim(), kind: value.kind });
}
function queryDifferencePage(expected, actual, input, requestedOffset) {
  const query = validateRehearsalDifferenceQuery(input);
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0) fail("INVALID_REVIEW_DIFFERENCE_OFFSET");
  const limit = REHEARSAL_REPORT_DIFFERENCE_LIMIT, requested = Math.floor(requestedOffset / limit) * limit;
  function collect(offset) {
    const differences = []; let matched = 0;
    const compared = compareValues(expected, actual, 0, (index, difference) => {
      if ((query.kind !== "all" && difference.kind !== query.kind) || !difference.path.includes(query.path)) return;
      if (matched >= offset && differences.length < limit) differences.push(Object.freeze({ index, ...difference }));
      matched++;
    });
    return { differences: Object.freeze(differences), matched, total: compared.differenceCount };
  }
  let result = collect(requested);
  const totalPages = Math.max(1, Math.ceil(result.matched / limit)), offset = Math.min(requested, (totalPages - 1) * limit);
  if (offset !== requested) result = collect(offset);
  return Object.freeze({ query, offset, limit, page: offset / limit + 1, totalPages,
    totalDifferences: result.total, matchedDifferences: result.matched, differences: result.differences,
    hasPrevious: offset > 0, hasNext: offset + limit < result.matched });
}
/** Filter inspection paths only; global mismatch status and original indices stay intact. */
export function queryReviewedRehearsalDifferences(receipt, query = REHEARSAL_DIFFERENCE_QUERY, offset = 0) {
  const text = reviewSources.get(receipt);
  if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
  const { parsed, recomputed } = prepareRehearsalReview(text, receipt.expectedSha256);
  return queryDifferencePage(recomputed, parsed, query, offset);
}
export function queryRehearsalEvidenceReceiptDifferences(review, query = REHEARSAL_DIFFERENCE_QUERY, offset = 0) {
  const recorded = evidenceReceipts.get(review);
  if (recorded === undefined) fail("UNRECOGNIZED_EVIDENCE_REVIEW");
  return queryDifferencePage(review.reportReview, recorded, query, offset);
}
export const REHEARSAL_DIFFERENCE_QUERY_ALL_SCHEMA = "threecore.operation-rehearsal-difference-query-all.v1";
/** Collect every matching path in a bounded artifact, independently of screen paging. */
export function encodeRehearsalDifferenceQuery(review, input = REHEARSAL_DIFFERENCE_QUERY, target = "report") {
  if (!["report", "evidence-source", "evidence-receipt"].includes(target)) fail("INVALID_REVIEW_DIFFERENCE_TARGET");
  let expected, actual, report, matchesReceipt = null;
  if (target === "report") {
    const text = reviewSources.get(review);
    if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
    report = review;
    ({ recomputed: expected, parsed: actual } = prepareRehearsalReview(text, report.expectedSha256));
  } else {
    const recorded = evidenceReceipts.get(review);
    if (recorded === undefined) fail("UNRECOGNIZED_EVIDENCE_REVIEW");
    report = review.reportReview; matchesReceipt = review.matchesReceipt;
    if (target === "evidence-receipt") { expected = report; actual = recorded; }
    else {
      const text = reviewSources.get(report);
      if (text === undefined) fail("UNRECOGNIZED_REVIEW_RECEIPT");
      ({ recomputed: expected, parsed: actual } = prepareRehearsalReview(text, report.expectedSha256));
    }
  }
  const query = validateRehearsalDifferenceQuery(input), rows = [];
  const visible = text => text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  let bytes = 0;
  const result = compareValues(expected, actual, 0, (index, difference) => {
    if ((query.kind !== "all" && query.kind !== difference.kind) || !difference.path.includes(query.path)) return;
    const row = "    " + visible(JSON.stringify({ index, ...difference }));
    try { bytes += boundedUtf8Length(row, REHEARSAL_REVIEW_EVIDENCE_LIMIT - bytes) + (rows.length ? 2 : 0); }
    catch { fail("DIFFERENCE_QUERY_TOO_LARGE"); }
    if (bytes > REHEARSAL_REVIEW_EVIDENCE_LIMIT) fail("DIFFERENCE_QUERY_TOO_LARGE");
    rows.push(row);
  });
  const metadata = { schema: REHEARSAL_DIFFERENCE_QUERY_ALL_SCHEMA, simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, target, sourceSha256: report.sha256,
    summary: { matchesReceipt, matchesRecomputation: report.matchesRecomputation, checksumMatches: report.checksumMatches,
      reportOutcome: report.reportOutcome ?? null }, query, totalDifferences: result.differenceCount,
    matchedDifferences: rows.length, allMatchingDifferencesIncluded: true };
  const text = visible(JSON.stringify(metadata, null, 2)).slice(0, -2) + ',\n  "differences": [\n' + rows.join(",\n") + '\n  ]\n}\n';
  try { boundedUtf8Length(text, REHEARSAL_REVIEW_EVIDENCE_LIMIT); }
  catch { fail("DIFFERENCE_QUERY_TOO_LARGE"); }
  return text;
}
