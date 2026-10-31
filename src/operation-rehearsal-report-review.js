import { captureDataRecord, captureDataArray, captureOptionalDataFields, sha256Hex } from "./security-data.js";
import { consumeCallback, observeCallbackResult } from "./security-callback.js";
import { subscribeReadAbort, readAbortState } from "./security-abort.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { RehearsalError, encodeRehearsal } from "./operation-rehearsal.js";
import { encodeRehearsalWorkspace } from "./operation-rehearsal-workspace.js";
import { reportRehearsalOverview, REHEARSAL_OVERVIEW_SCHEMA } from "./operation-rehearsal-overview.js";
import { compareRehearsalWorkspaces, REHEARSAL_COMPARISON_SCHEMA } from "./operation-rehearsal-comparison.js";
import { compareRehearsalScenario, REHEARSAL_SCENARIO_SCHEMA } from "./operation-rehearsal-scenario.js";
import { encodeRehearsalScenarioSet, reportRehearsalScenarioSet, REHEARSAL_SCENARIO_SET_REPORT_SCHEMA } from "./operation-rehearsal-scenario-set.js";
import { encodeRehearsalCheckSuite, runRehearsalCheckSuite, REHEARSAL_CHECK_REPORT_SCHEMA } from "./operation-rehearsal-check-suite.js";
import { validateRehearsalReasonRecordQuery, summarizeRehearsalRecords, reportRehearsalRecordPrefix, REHEARSAL_RECORD_SUMMARY_SCHEMA, REHEARSAL_PREFIX_REPORT_SCHEMA } from "./operation-rehearsal-records.js";
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

/** Field locations only; bounded text input cannot expose object getters or values. */
export function compareBoundedSavedJSONTexts(beforeText, afterText) {
  const limits = { bytes: 2097152, depth: 32, nodes: 100000, keyCharacters: 256, stringCharacters: 1048576 };
  return compareValues(parseSecurityJson(beforeText, limits), parseSecurityJson(afterText, limits));
}

/** Page field locations without retaining all matches or returning values. */
export function queryBoundedSavedJSONDifferences(beforeText, afterText, input = {}) {
  let options; try { options = captureOptionalDataFields(input, ["offset", "pathIncludes"]); } catch { fail("INVALID_SAVED_DIFFERENCE_QUERY"); }
  const { offset = 0, pathIncludes = "" } = options;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 200000 || offset % REHEARSAL_REPORT_DIFFERENCE_LIMIT !== 0 ||
      typeof pathIncludes !== "string" || pathIncludes.length > 128 || /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(pathIncludes)) fail("INVALID_SAVED_DIFFERENCE_QUERY");
  const limits = { bytes: 2097152, depth: 32, nodes: 100000, keyCharacters: 256, stringCharacters: 1048576 }, differences = [];
  let matched = 0;
  const full = compareValues(parseSecurityJson(beforeText, limits), parseSecurityJson(afterText, limits), 0, (index, location) => {
    if (!location.path.includes(pathIncludes)) return;
    if (matched >= offset && differences.length < REHEARSAL_REPORT_DIFFERENCE_LIMIT) differences.push(Object.freeze({ ordinal: index + 1, ...location }));
    matched++;
  });
  if (offset > 0 && offset >= matched) fail("INVALID_SAVED_DIFFERENCE_QUERY");
  return Object.freeze({ query: Object.freeze({ pathIncludes }), offset, limit: REHEARSAL_REPORT_DIFFERENCE_LIMIT,
    totalDifferences: full.differenceCount, matchedDifferences: matched, shownDifferences: differences.length,
    differences: Object.freeze(differences), hasPrevious: offset > 0, hasNext: offset + differences.length < matched });
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
  } else if(parsed?.schema===REHEARSAL_RECORD_SUMMARY_SCHEMA){
    recomputed=summarizeRehearsalRecords(indexRehearsalRecords(parsed.inputs),parsed.query);
    scope=recomputed.subjects.map(row=>({agent:row.agent,beforeRecords:row.recordCount,afterRecords:null}));
    reportOutcome=Object.freeze({kind:"record-summary",matchedRecords:recomputed.matchedRecords,totalRecords:recomputed.totalRecords});
  } else if(parsed?.schema===REHEARSAL_PREFIX_REPORT_SCHEMA){
    recomputed=reportRehearsalRecordPrefix(indexRehearsalRecords(parsed.inputs),parsed.selectedKey);
    scope=recomputed.subjects.map(row=>({agent:row.agent,beforeRecords:row.recordCount,afterRecords:null}));
    reportOutcome=Object.freeze({kind:"record-prefix",agent:recomputed.agent,includedRecords:recomputed.includedRecords,omittedLaterRecords:recomputed.omittedLaterRecords});
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

export const REHEARSAL_BATCH_REVIEW_SCHEMA = "threecore.operation-rehearsal-batch-review.v1";
export const REHEARSAL_BATCH_REVIEW_FILES = 20;
export const REHEARSAL_BATCH_REVIEW_BYTES = 8 * 1024 * 1024;
export const REHEARSAL_BATCH_MANIFEST_LIMIT = 16384;
export const REHEARSAL_BATCH_REFERENCE_REVIEW_SCHEMA = "threecore.operation-rehearsal-batch-review.v2";
const batchReceipts = new WeakSet();
const fileBatchSelections = new WeakMap();
const batchSources = new WeakMap(), batchEvidenceReviews = new WeakMap();
export const REHEARSAL_BATCH_EVIDENCE_SCHEMA = "threecore.operation-rehearsal-batch-evidence.v1";
export const REHEARSAL_BATCH_EVIDENCE_LIMIT = 16 * 1024 * 1024;

/** Portable unique basenames keep the exported manifest unambiguous. */
export function validateRehearsalReportBatchSelection(input) {
  try {
    const names = new Set(); let totalBytes = 0;
    const files = captureDataArray(input, REHEARSAL_BATCH_REVIEW_FILES, 1).map(value => {
      const row = captureDataRecord(value, ["name", "byteLength"]);
      if (typeof row.name !== "string" || row.name.length > 180 || row.name !== row.name.trim() ||
          !/\.json$/i.test(row.name) || /^[.]/.test(row.name) ||
          /[/\\:*?"<>|\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(row.name) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(row.name) ||
          !Number.isSafeInteger(row.byteLength) || row.byteLength < 1 || row.byteLength > REHEARSAL_REPORT_REVIEW_LIMIT) throw Error();
      const key = row.name.normalize("NFC").toLowerCase();
      if (names.has(key)) throw Error();
      names.add(key); totalBytes += row.byteLength;
      return Object.freeze({ name: row.name, byteLength: row.byteLength });
    });
    if (totalBytes > REHEARSAL_BATCH_REVIEW_BYTES) throw Error();
    return Object.freeze({ files: Object.freeze(files), totalBytes });
  } catch { fail("INVALID_REVIEW_BATCH_SELECTION"); }
}

/** This browser workflow binds basenames only, never paths or directory walks. */
export function decodeRehearsalBatchManifest(text) {
  try {
    boundedUtf8Length(text, REHEARSAL_BATCH_MANIFEST_LIMIT);
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    if (!lines.length || lines.length > REHEARSAL_BATCH_REVIEW_FILES) throw Error();
    const entries = lines.map(line => {
      const matched = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line);
      if (!matched) throw Error();
      return Object.freeze({ name: matched[2], expectedSha256: matched[1].toLowerCase() });
    });
    validateRehearsalReportBatchSelection(entries.map(row => ({ name: row.name, byteLength: 1 })));
    return Object.freeze(entries);
  } catch { fail("INVALID_REVIEW_BATCH_MANIFEST"); }
}

/** Require the exact same file names, not a silent subset of a saved reference. */
export function matchRehearsalBatchManifest(selectionInput, text) {
  const selection = validateRehearsalReportBatchSelection(selectionInput);
  const entries = decodeRehearsalBatchManifest(text), byName = new Map(entries.map(row => [row.name, row]));
  if (selection.files.length !== entries.length || selection.files.some(row => !byName.has(row.name)))
    fail("REVIEW_BATCH_REFERENCE_SELECTION");
  return Object.freeze(selection.files.map(row => byName.get(row.name)));
}

function captureRehearsalBatchOptions(options) {
  try { options = captureOptionalDataFields(options, ["subtle", "signal", "onProgress", "timeoutMs", "manifestText"]); }
  catch { fail("INVALID_REVIEW_BATCH_OPTIONS"); }
  const { onProgress, timeoutMs = 120000 } = options;
  if ((onProgress !== undefined && typeof onProgress !== "function") ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) fail("INVALID_REVIEW_BATCH_OPTIONS");
  return options;
}

/** Sequential recomputation of explicit text inputs. No restoration or I/O. */
export async function reviewRehearsalReportBatch(input, options = {}) {
  options = captureRehearsalBatchOptions(options);
  let rows;
  try {
    rows = captureDataArray(input, REHEARSAL_BATCH_REVIEW_FILES, 1).map(row => {
      const value = captureDataRecord(row, ["name", "text"]);
      return Object.freeze({ name: value.name, text: value.text,
        byteLength: boundedUtf8Length(value.text, REHEARSAL_REPORT_REVIEW_LIMIT) });
    });
  } catch { fail("INVALID_REVIEW_BATCH_INPUT"); }
  const selection = validateRehearsalReportBatchSelection(rows.map(({ name, byteLength }) => ({ name, byteLength })));
  return reviewRehearsalBatchCaptured(rows, selection, options);
}

/** Read and finish each explicitly selected source before starting the next. */
export async function reviewRehearsalReportFileBatch(input, readSource, options = {}) {
  const selection = validateRehearsalReportBatchSelection(input);
  if (typeof readSource !== "function") fail("INVALID_REVIEW_BATCH_READER");
  return reviewRehearsalBatchCaptured(selection.files, selection, captureRehearsalBatchOptions(options), readSource);
}

export function canResumeRehearsalReportFileBatch(previous) {
  return fileBatchSelections.has(previous) && ["cancelled", "timed-out"].includes(previous.phase) && previous.summary.pending > 0;
}
/** Keep the original selection/reference and completed prefix; re-read pending files only. */
export async function resumeRehearsalReportFileBatch(previous, readSource, options = {}) {
  if (!canResumeRehearsalReportFileBatch(previous)) fail("INVALID_REVIEW_BATCH_RESUME");
  if (typeof readSource !== "function") fail("INVALID_REVIEW_BATCH_READER");
  options = captureRehearsalBatchOptions(options);
  if (Object.hasOwn(options, "manifestText")) fail("INVALID_REVIEW_BATCH_OPTIONS");
  const selection = fileBatchSelections.get(previous);
  return reviewRehearsalBatchCaptured(selection.files, selection,
    { ...options, ...(previous.referenceProvided ? { manifestText: previous.reference.text } : {}) }, readSource, previous);
}

export function canRetryRehearsalReportFileBatch(previous) {
  return fileBatchSelections.has(previous) && previous.summary.pending === 0 && previous.files.some(row => ["source-unavailable", "hash-unavailable"].includes(row.status));
}
/** A retry retains all other reviewed rows and the original reference selection. */
export async function retryRehearsalReportFileBatch(previous, readSource, options = {}) {
  if (!canRetryRehearsalReportFileBatch(previous)) fail("INVALID_REVIEW_BATCH_RETRY");
  if (typeof readSource !== "function") fail("INVALID_REVIEW_BATCH_READER");
  options = captureRehearsalBatchOptions(options);
  if (Object.hasOwn(options, "manifestText")) fail("INVALID_REVIEW_BATCH_OPTIONS");
  const selection = fileBatchSelections.get(previous);
  return reviewRehearsalBatchCaptured(selection.files, selection,
    { ...options, ...(previous.referenceProvided ? { manifestText: previous.reference.text } : {}) }, readSource, previous, true);
}

function waitRehearsalBatchSource(read, signal) {
  return new Promise((resolve, reject) => {
    let settled = false, subscription;
    const finish = (callback, value) => { if (callback === reject) observeCallbackResult(value); if (settled) return; settled = true; subscription?.dispose(); callback(value); };
    subscription = subscribeReadAbort(signal, () => { const error = new Error("FILE_CANCELLED"); error.code = "FILE_CANCELLED"; finish(reject, error); });
    if (settled) return;
    try { const value = read(); if (typeof value === "string") finish(resolve, value);
      else try { Reflect.apply(Promise.prototype.then, value, [value => finish(resolve, value), error => finish(reject, error)]); }
      catch { observeCallbackResult(value); const error = new Error("FILE_READ"); error.code = "FILE_READ"; finish(reject, error); }
    } catch (error) { finish(reject, error); }
  });
}

async function reviewRehearsalBatchCaptured(rows, selection, options, readSource = null, previous = null, retryFailed = false) {
  const { subtle = globalThis.crypto?.subtle, signal, onProgress, timeoutMs = 120000 } = options;
  const hasReference = options.manifestText !== undefined;
  const reference = hasReference ? matchRehearsalBatchManifest(selection.files, options.manifestText) : null;
  let referenceSha256 = null;
  const retained = previous?.summary.reviewed ?? 0, completed = previous ? previous.files.slice(0, retained) : [], aborter = new AbortController();
  const capturedSources = previous ? (batchSources.get(previous) ?? []).slice() : [];
  const targets = rows.map((_, index) => index).filter(index => retryFailed ? ["source-unavailable", "hash-unavailable"].includes(previous.files[index].status) : index >= retained), retried = [];
  let previousBatchSha256 = null;
  let cancellation, timer, phase = "complete";
  const stopped = () => readAbortState(aborter.signal);
  const stop = reason => { if (!stopped()) { phase = reason; aborter.abort(); } };
  const notify = () => consumeCallback(() => onProgress?.(Object.freeze({
    selected: rows.length, reviewed: completed.length, phase: stopped() ? phase : "reviewing",
    ...(retryFailed ? { retrySelected: targets.length, retryReviewed: retried.length } : {}),
  })));
  const accept = (index, row) => { completed[index] = row; if (retryFailed) retried.push(index); notify(); };
  function finish() {
    const files = rows.map((row, index) => completed[index] ?? Object.freeze({
      name: row.name, byteLength: readSource ? null : row.byteLength, ...(readSource ? { reportedByteLength: row.byteLength } : {}), status: "pending", sha256: null,
      inputSchema: null, differenceCount: null, expectedOutcomes: null,
      ...(hasReference ? { expectedSha256: reference[index].expectedSha256, checksumMatches: null } : {}),
    }));
    const counts = status => files.filter(row => row.status === status).length;
    const unknownBytes = files.some(row => row.byteLength === null);
    const summary = Object.freeze({ selected: rows.length, reviewed: completed.length,
      pending: counts("pending"), matching: counts("matched"), differing: counts("different"),
      unsupported: counts("unsupported"), invalid: counts("invalid"), hashUnavailable: counts("hash-unavailable"),
      reportsWithFailedExpectations: files.filter(row => row.expectedOutcomes?.differing > 0).length,
      totalBytes: unknownBytes ? files.reduce((total, row) => total + (row.byteLength ?? 0), 0) : selection.totalBytes,
      ...(unknownBytes ? { sourceUnavailable: counts("source-unavailable"), selectedReportedBytes: selection.totalBytes,
        unreadSourceReportedBytes: files.reduce((total, row) => total + (row.reportedByteLength ?? 0), 0) } : {}) });
    const referenceSummary = hasReference ? {
      ...summary, checksumsCompared: files.filter(row => row.checksumMatches !== null).length,
      checksumsMatching: files.filter(row => row.checksumMatches === true).length,
      checksumMismatches: files.filter(row => row.checksumMatches === false).length,
    } : summary;
    const result = Object.freeze({ schema: retryFailed ? "threecore.operation-rehearsal-batch-review.v5" : previous ? "threecore.operation-rehearsal-batch-review.v4" : unknownBytes ? "threecore.operation-rehearsal-batch-review.v3" : hasReference ? REHEARSAL_BATCH_REFERENCE_REVIEW_SCHEMA : REHEARSAL_BATCH_REVIEW_SCHEMA, simulationOnly: true,
      sourceVerified: false, authorizesExecution: false,
      externalChecksumsCompared: hasReference && referenceSummary.checksumsCompared > 0,
      phase, complete: phase === "complete" && completed.length === rows.length,
      allRecomputationsMatch: phase === "complete" && summary.matching === rows.length,
      summary: Object.freeze(referenceSummary), files: Object.freeze(files),
      ...(unknownBytes && !hasReference ? { referenceProvided: false } : {}),
      ...(previous && !retryFailed ? { continuation: Object.freeze({ sequence: (previous.continuation?.sequence ?? 0) + 1,
        retainedReviews: retained, previousPhase: previous.phase, previousBatchSha256 }) } : {}),
      ...(retryFailed ? { retry: Object.freeze({ sequence: (previous.retry?.sequence ?? 0) + 1, previousPhase: previous.phase, previousBatchSha256,
        targetIndexes: Object.freeze(targets), completedIndexes: Object.freeze(retried), remainingIndexes: Object.freeze(targets.filter(index => !retried.includes(index))), retainedReviews: rows.length - retried.length }) } : {}),
      ...(hasReference ? { referenceProvided: true,
        reference: Object.freeze({ text: options.manifestText, sha256: referenceSha256, entries: reference }),
        allExternalChecksumsMatch: phase === "complete" && referenceSummary.checksumsMatching === rows.length } : {}),
    });
    batchReceipts.add(result); batchSources.set(result, Object.freeze(capturedSources.slice()));
    if (readSource) fileBatchSelections.set(result, selection); return result;
  }
  try {
    try { cancellation = subscribeReadAbort(signal, () => stop("cancelled")); }
    catch { fail("INVALID_REVIEW_BATCH_SIGNAL"); }
    timer = setTimeout(() => stop("timed-out"), timeoutMs);
    notify();
    if (previous && !stopped()) {
      try { previousBatchSha256 = await sha256Hex(new TextEncoder().encode(encodeRehearsalBatchReview(previous)), subtle,
        { signal: aborter.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { if (!stopped()) fail(retryFailed ? "REVIEW_BATCH_RETRY_HASH_UNAVAILABLE" : "REVIEW_BATCH_RESUME_HASH_UNAVAILABLE"); }
    }
    if (hasReference && !stopped()) {
      try { referenceSha256 = await sha256Hex(new TextEncoder().encode(options.manifestText), subtle,
        { signal: aborter.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { if (!stopped()) fail("REVIEW_BATCH_REFERENCE_HASH_UNAVAILABLE"); }
    }
    for (const index of targets) {
      const selected = rows[index];
      if (stopped()) break;
      let row = selected;
      if (readSource) {
        try {
          const text = await waitRehearsalBatchSource(() => readSource(index, Object.freeze({ signal: aborter.signal, maxBytes: selected.byteLength })), aborter.signal);
          if (stopped()) break;
          const byteLength = boundedUtf8Length(text, selected.byteLength);
          if (byteLength !== selected.byteLength) { const error = new Error("FILE_SIZE"); error.code = "FILE_SIZE"; throw error; }
          row = Object.freeze({ ...selected, text, byteLength });
        } catch (error) {
          if (stopped()) break;
          let code; try { code = Object.getOwnPropertyDescriptor(error, "code")?.value; } catch {}
          code = code === "JSON_SIZE" ? "FILE_SIZE" : ["FILE_ENCODING", "FILE_SIZE", "FILE_READ", "FILE_TIMEOUT", "FILE_CHANGED"].includes(code) ? code : "FILE_READ";
          accept(index, Object.freeze({ name: selected.name, byteLength: null, reportedByteLength: selected.byteLength,
            status: "source-unavailable", code, sha256: null, inputSchema: null, differenceCount: null, expectedOutcomes: null,
            ...(hasReference ? { expectedSha256: reference[index].expectedSha256, checksumMatches: null } : {}) }));
          continue;
        }
      }
      let sha256 = null, status = "hash-unavailable", inputSchema = null, differenceCount = null, expectedOutcomes = null;
      const expectedSha256 = hasReference ? reference[index].expectedSha256 : null;
      let checksumMatches = null;
      try { sha256 = await sha256Hex(new TextEncoder().encode(row.text), subtle,
        { signal: aborter.signal, timeoutMs: Math.min(timeoutMs, 30000) }); }
      catch { /* Hash failures remain per-file failures, never matching reports. */ }
      if (stopped()) break;
      if (sha256 !== null) capturedSources[index] = Object.freeze({ name: row.name, text: row.text });
      if (hasReference && sha256 !== null) checksumMatches = expectedSha256 === sha256;
      if (checksumMatches === false) status = "checksum-mismatch";
      if (sha256 !== null && checksumMatches !== false) {
        try {
          const prepared = prepareRehearsalReview(row.text, null);
          const comparison = compareValues(prepared.recomputed, prepared.parsed);
          inputSchema = prepared.parsed.schema; differenceCount = comparison.differenceCount;
          status = differenceCount === 0 ? "matched" : "different";
          if (prepared.reportOutcome?.kind === "expected-outcomes") {
            const { cases, matched, differing } = prepared.reportOutcome;
            expectedOutcomes = Object.freeze({ cases, matched, differing });
          }
        } catch (error) { status = error?.code === "UNSUPPORTED_REVIEW_REPORT" ? "unsupported" : "invalid"; }
      }
      accept(index, Object.freeze({ name: row.name, byteLength: row.byteLength, status, sha256,
        inputSchema, differenceCount, expectedOutcomes,
        ...(hasReference ? { expectedSha256, checksumMatches } : {}) }));
    }
    return finish();
  } finally { clearTimeout(timer); cancellation?.dispose(); aborter.abort(); }
}

export function encodeRehearsalBatchReview(result) {
  if (!batchReceipts.has(result)) fail("UNRECOGNIZED_REVIEW_BATCH");
  return JSON.stringify(result, null, 2) + "\n";
}
const rehearsalBatchComparisons = new WeakSet();
/** Compare owned observations of selected files; selection differences are not filesystem deletions. */
export function compareRehearsalBatches(before, after) {
  if (!batchReceipts.has(before) || !batchReceipts.has(after)) fail("INVALID_REVIEW_BATCH_COMPARISON");
  const leftByName = new Map(before.files.map(row => [row.name, row])), rightByName = new Map(after.files.map(row => [row.name, row]));
  const names = [...new Set([...leftByName.keys(), ...rightByName.keys()])];
  const files = Object.freeze(names.map(name => {
    const left = leftByName.get(name) ?? null, right = rightByName.get(name) ?? null;
    const sameBytes = left?.sha256 && right?.sha256 ? left.sha256 === right.sha256 : null;
    const sameRecordedResult = left && right ? compareValues(left, right).differenceCount === 0 : null;
    const kind = !left ? "only-after" : !right ? "only-before" : sameBytes === null ? "uncompared" : !sameBytes ? "bytes-changed" : sameRecordedResult ? "unchanged" : "result-changed";
    return Object.freeze({ name, kind, sameBytes, sameRecordedResult, before: left, after: right });
  }));
  const count = kind => files.filter(row => row.kind === kind).length;
  const summary = Object.freeze({ files: files.length, bothSelected: files.filter(row => row.before && row.after).length,
    onlyBefore: count("only-before"), onlyAfter: count("only-after"), unchanged: count("unchanged"),
    bytesChanged: count("bytes-changed"), resultChanged: count("result-changed"), uncompared: count("uncompared") });
  const result = Object.freeze({ schema: "threecore.operation-rehearsal-batch-comparison.v1", before, after, files, summary,
    sameSelection: summary.onlyBefore === 0 && summary.onlyAfter === 0,
    allSelectedBytesMatch: before.complete && after.complete && files.every(row => row.sameBytes === true),
    simulationOnly: true, sourceVerified: false, authorizesExecution: false, containsOriginalEvidence: false,
    automaticallyImported: false, restorable: false, reportsFilesystemDeletions: false, recordedProcessVerified: false });
  rehearsalBatchComparisons.add(result); return result;
}
export function encodeRehearsalBatchComparison(result, format = "json") {
  if (!rehearsalBatchComparisons.has(result) || !["json", "csv"].includes(format)) fail("INVALID_REVIEW_BATCH_COMPARISON");
  if (format === "json") return JSON.stringify(result, null, 2) + "\n";
  const rows = [["simulationOnly", "sourceVerified", "authorizesExecution", "reportsFilesystemDeletions", "beforePhase", "beforeComplete", "afterPhase", "afterComplete", "allSelectedBytesMatch", "name", "kind", "sameBytes", "sameRecordedResult", "beforeStatus", "afterStatus", "beforeSha256", "afterSha256", "beforeFailedExpectations", "afterFailedExpectations"]];
  for (const row of result.files) rows.push([true, false, false, false, result.before.phase, result.before.complete, result.after.phase, result.after.complete, result.allSelectedBytesMatch,
    row.name, row.kind, row.sameBytes ?? "", row.sameRecordedResult ?? "", row.before?.status ?? "", row.after?.status ?? "", row.before?.sha256 ?? "", row.after?.sha256 ?? "", row.before?.expectedOutcomes?.differing ?? "", row.after?.expectedOutcomes?.differing ?? ""]);
  const cell = value => { let text = String(value); if (/^\s*[=+@-]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export const REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT = 32 * 1024 * 1024;
const rehearsalBatchComparisonEvidenceReviews = new WeakSet();
function batchComparisonEvidenceDocument(before, after) {
  return { schema: "threecore.operation-rehearsal-batch-comparison-evidence.v1", simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, recordedProcessVerified: false,
    before: batchEvidenceDocument(before, batchSources.get(before)), after: batchEvidenceDocument(after, batchSources.get(after)),
    comparison: compareRehearsalBatches(before, after) };
}
function batchEvidenceBudget(input) {
  const options = batchEvidenceOptions(input), started = Date.now(), limit = options.timeoutMs ?? 120000;
  return () => { const remaining = limit - (Date.now() - started); if (remaining < 1 || readAbortState(options.signal)) fail("REVIEW_BATCH_COMPARISON_INCOMPLETE"); return { ...options, timeoutMs: remaining }; };
}
export async function prepareRehearsalBatchComparisonEvidence(before, after, input = {}) {
  if (!canPrepareRehearsalBatchEvidence(before) || !canPrepareRehearsalBatchEvidence(after)) fail("REVIEW_BATCH_COMPARISON_UNAVAILABLE");
  const budget = batchEvidenceBudget(input);
  const recompute = source => reviewRehearsalReportBatch(batchSources.get(source), { ...budget(), ...(source.referenceProvided ? { manifestText: source.reference.text } : {}) });
  const left = await recompute(before), right = await recompute(after); budget();
  if (!canPrepareRehearsalBatchEvidence(left) || !canPrepareRehearsalBatchEvidence(right)) fail("REVIEW_BATCH_COMPARISON_INCOMPLETE");
  const text = JSON.stringify(batchComparisonEvidenceDocument(left, right), null, 2) + "\n";
  try { boundedUtf8Length(text, REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT); } catch { fail("REVIEW_BATCH_COMPARISON_SIZE"); } budget();
  return Object.freeze({ text, filename: "ThreeCore-rehearsal-batch-comparison-evidence.json", mimeType: "application/json", containsOriginalEvidence: true,
    simulationOnly: true, sourceVerified: false, authorizesExecution: false, recordedProcessVerified: false });
}
export async function reviewRehearsalBatchComparisonEvidence(text, input = {}) {
  const budget = batchEvidenceBudget(input); let parsed;
  try { parsed = parseSecurityJson(text, { bytes: REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT, depth: 24, nodes: 50000, keyCharacters: 256, stringCharacters: REHEARSAL_REPORT_REVIEW_LIMIT }); } catch { fail("REVIEW_BATCH_COMPARISON_JSON"); }
  if (parsed?.schema !== "threecore.operation-rehearsal-batch-comparison-evidence.v1") fail("REVIEW_BATCH_COMPARISON_SCHEMA");
  const beforeReview = await reviewRehearsalBatchEvidence(JSON.stringify(parsed.before), budget()), afterReview = await reviewRehearsalBatchEvidence(JSON.stringify(parsed.after), budget());
  const before = batchEvidenceReviews.get(beforeReview).result, after = batchEvidenceReviews.get(afterReview).result, expected = batchComparisonEvidenceDocument(before, after);
  const differences = Object.keys(expected).filter(key => !Object.hasOwn(parsed, key) || compareValues(expected[key], parsed[key]).differenceCount !== 0), unexpectedFields = Object.keys(parsed).filter(key => !Object.hasOwn(expected, key)).length;
  const options = budget(), sha256 = await sha256Hex(new TextEncoder().encode(text), options.subtle, { signal: options.signal, timeoutMs: Math.min(options.timeoutMs, 30000) }); budget();
  const result = Object.freeze({ schema: "threecore.operation-rehearsal-batch-comparison-evidence-review.v1", sha256,
    matchesRecomputation: differences.length === 0 && unexpectedFields === 0 && beforeReview.matchesRecomputation && afterReview.matchesRecomputation,
    differences: Object.freeze(differences), unexpectedFields, beforeEvidenceMatches: beforeReview.matchesRecomputation, afterEvidenceMatches: afterReview.matchesRecomputation,
    comparisonMatches: compareValues(expected.comparison, parsed.comparison).differenceCount === 0,
    beforeSummary: before.summary, afterSummary: after.summary, comparisonSummary: expected.comparison.summary,
    allSourceReportsMatch: before.allRecomputationsMatch && after.allRecomputationsMatch,
    simulationOnly: true, sourceVerified: false, authorizesExecution: false, automaticallyImported: false,
    recordedProcessVerified: false, containsOriginalEvidence: false, restorable: false });
  rehearsalBatchComparisonEvidenceReviews.add(result); return result;
}
export function encodeRehearsalBatchComparisonEvidenceReview(result) {
  if (!rehearsalBatchComparisonEvidenceReviews.has(result)) fail("REVIEW_BATCH_COMPARISON_RESULT");
  return JSON.stringify(result, null, 2) + "\n";
}

export function canPrepareRehearsalBatchEvidence(result) {
  const sources = batchSources.get(result);
  return Boolean(batchReceipts.has(result) && result.complete && sources?.length === result.files.length &&
    result.files.every((row, index) => row.sha256 !== null && sources[index]?.name === row.name));
}
function batchEvidenceOptions(input) {
  const options = captureRehearsalBatchOptions(input);
  if (Object.hasOwn(options, "manifestText")) fail("INVALID_REVIEW_BATCH_OPTIONS");
  return options;
}
function batchEvidenceDocument(result, sources) {
  return { schema: REHEARSAL_BATCH_EVIDENCE_SCHEMA, simulationOnly: true, sourceVerified: false,
    authorizesExecution: false, referenceText: result.referenceProvided ? result.reference.text : null,
    files: sources, receipt: result };
}
/** Recompute a fresh complete snapshot; continuation/retry chronology is deliberately not asserted. */
export async function prepareRehearsalBatchEvidence(previous, input = {}) {
  if (!canPrepareRehearsalBatchEvidence(previous)) fail("REVIEW_BATCH_EVIDENCE_UNAVAILABLE");
  const options = batchEvidenceOptions(input), sources = batchSources.get(previous);
  const result = await reviewRehearsalReportBatch(sources, { ...options,
    ...(previous.referenceProvided ? { manifestText: previous.reference.text } : {}) });
  if (!canPrepareRehearsalBatchEvidence(result)) fail("REVIEW_BATCH_EVIDENCE_INCOMPLETE");
  const text = JSON.stringify(batchEvidenceDocument(result, sources), null, 2) + "\n";
  try { boundedUtf8Length(text, REHEARSAL_BATCH_EVIDENCE_LIMIT); } catch { fail("REVIEW_BATCH_EVIDENCE_SIZE"); }
  if (readAbortState(options.signal)) fail("REVIEW_BATCH_EVIDENCE_INCOMPLETE");
  return Object.freeze({ text, filename: "ThreeCore-report-batch-evidence.json", mimeType: "application/json",
    containsOriginalEvidence: true, simulationOnly: true, authorizesExecution: false });
}
/** Verify the bundle's current claims from its exact embedded texts, never from a claimed pass. */
export async function reviewRehearsalBatchEvidence(text, input = {}) {
  const options = batchEvidenceOptions(input), started = Date.now();
  let parsed;
  try { parsed = parseSecurityJson(text, { bytes: REHEARSAL_BATCH_EVIDENCE_LIMIT, depth: 16, nodes: 10000,
    keyCharacters: 256, stringCharacters: REHEARSAL_REPORT_REVIEW_LIMIT }); } catch { fail("INVALID_REVIEW_BATCH_EVIDENCE"); }
  if (parsed?.schema !== REHEARSAL_BATCH_EVIDENCE_SCHEMA || !(parsed.referenceText === null || typeof parsed.referenceText === "string")) fail("INVALID_REVIEW_BATCH_EVIDENCE");
  const result = await reviewRehearsalReportBatch(parsed.files, { ...options,
    ...(parsed.referenceText !== null ? { manifestText: parsed.referenceText } : {}) });
  if (!canPrepareRehearsalBatchEvidence(result)) fail("REVIEW_BATCH_EVIDENCE_INCOMPLETE");
  const remaining = (options.timeoutMs ?? 120000) - (Date.now() - started);
  if (remaining <= 0 || readAbortState(options.signal)) fail("REVIEW_BATCH_EVIDENCE_INCOMPLETE");
  let sha256;
  try { sha256 = await sha256Hex(new TextEncoder().encode(text), options.subtle ?? globalThis.crypto?.subtle,
    { signal: options.signal, timeoutMs: Math.min(remaining, 30000) }); } catch { fail("REVIEW_BATCH_EVIDENCE_HASH_UNAVAILABLE"); }
  const sources = batchSources.get(result), comparison = compareValues(batchEvidenceDocument(result, sources), parsed);
  const review = Object.freeze({ schema: "threecore.operation-rehearsal-batch-evidence-review.v1", simulationOnly: true,
    sourceVerified: false, authorizesExecution: false, automaticallyImported: false, recordedProcessVerified: false,
    sha256, byteLength: boundedUtf8Length(text, REHEARSAL_BATCH_EVIDENCE_LIMIT),
    matchesRecomputation: comparison.differenceCount === 0, ...comparison,
    allSourceReportsMatch: result.allRecomputationsMatch, expectedSummary: result.summary,
    externalChecksumsCompared: result.externalChecksumsCompared,
    allExternalChecksumsMatch: result.allExternalChecksumsMatch ?? null });
  batchEvidenceReviews.set(review, Object.freeze({ result, files: sources })); return review;
}
export function encodeRehearsalBatchEvidenceReview(review) {
  if (!batchEvidenceReviews.has(review)) fail("UNRECOGNIZED_BATCH_EVIDENCE_REVIEW");
  return JSON.stringify(review, null, 2) + "\n";
}
export function queryRehearsalBatchFiles(result, input = {}) {
  if (!batchReceipts.has(result)) fail("UNRECOGNIZED_BATCH_REVIEW");
  let query; try { query = captureOptionalDataFields(input, ["name", "status"]); } catch { fail("INVALID_REVIEW_BATCH_FILTER"); }
  const name = query.name === undefined ? "" : query.name, status = query.status === undefined ? "all" : query.status;
  if (typeof name !== "string" || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name) ||
      !["all", "matched", "different", "invalid", "unsupported", "hash-unavailable", "source-unavailable", "checksum-mismatch", "pending", "expected-differences"].includes(status)) fail("INVALID_REVIEW_BATCH_FILTER");
  const files = Object.freeze(result.files.filter(row => row.name.toLowerCase().includes(name.toLowerCase()) &&
    (status === "all" || (status === "expected-differences" ? row.expectedOutcomes?.differing > 0 : row.status === status))));
  return Object.freeze({ schema: "threecore.operation-rehearsal-batch-selection.v1", query: Object.freeze({ name, status }),
    selectedBatchFiles: result.files.length, matchedFiles: files.length, fullBatchSummary: result.summary,
    sourcePhase: result.phase, sourceComplete: result.complete, files, sourceReceiptRequiredForRecheck: true,
    fullBatchResultIncluded: false, containsOriginalEvidence: false, readOnly: true, simulationOnly: true, sourceVerified: false,
    restorable: false, automaticallyImported: false, authorizesExecution: false });
}
const rehearsalBatchSelectionChecks = new WeakMap();
export async function reviewRehearsalBatchSelection(source, text, input = {}) {
  if (!batchReceipts.has(source)) fail("REVIEW_BATCH_SELECTION_SOURCE");
  let supplied, options;
  try { options = captureOptionalDataFields(input, ["subtle", "signal", "timeoutMs"]); } catch { fail("REVIEW_BATCH_SELECTION_OPTIONS"); }
  const timeoutMs = options.timeoutMs ?? 30000, started = Date.now();
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || readAbortState(options.signal)) fail("REVIEW_BATCH_SELECTION_OPTIONS");
  try { supplied = parseSecurityJson(text, { bytes: 256 * 1024, depth: 32, nodes: 10000 }); } catch { fail("REVIEW_BATCH_SELECTION_JSON"); }
  if (!supplied || Array.isArray(supplied)) fail("REVIEW_BATCH_SELECTION_JSON");
  const expected = queryRehearsalBatchFiles(source, supplied.query);
  if (supplied.schema !== expected.schema) fail("REVIEW_BATCH_SELECTION_SCHEMA");
  const differences = Object.keys(expected).filter(key => !Object.hasOwn(supplied, key) || !(compareValues(expected[key], supplied[key]).differenceCount === 0));
  const unexpectedFields = Object.keys(supplied).filter(key => !Object.hasOwn(expected, key)).length;
  const digest = async value => {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining < 1 || readAbortState(options.signal)) fail("REVIEW_BATCH_SELECTION_CANCELLED");
    return sha256Hex(new TextEncoder().encode(value), options.subtle, { signal: options.signal, timeoutMs: remaining });
  };
  const selectionTextDigest = await digest(text), sourceBatchTextDigest = await digest(encodeRehearsalBatchReview(source));
  if (readAbortState(options.signal)) fail("REVIEW_BATCH_SELECTION_CANCELLED");
  const result = Object.freeze({ schema: "threecore.operation-rehearsal-batch-selection-review.v1", matchesRecomputation: differences.length === 0 && unexpectedFields === 0,
    selectionTextDigest, sourceBatchTextDigest, query: expected.query, selectedBatchFiles: expected.selectedBatchFiles, matchedFiles: expected.matchedFiles,
    differences: Object.freeze(differences), unexpectedFields, sourceComplete: source.complete, sourcePhase: source.phase,
    unselectedSourceContentsCompared: false, recordedProcessVerified: false, readOnly: true, authorizesExecution: false,
    automaticallyImported: false, containsOriginalEvidence: false, restorable: false });
  rehearsalBatchSelectionChecks.set(result, source); return result;
}
export function encodeRehearsalBatchSelectionReview(result) {
  if (!rehearsalBatchSelectionChecks.has(result)) fail("REVIEW_BATCH_SELECTION_RESULT");
  return JSON.stringify(result, null, 2) + "\n";
}
export function extractRehearsalBatchSelectionQuery(result) {
  if (!rehearsalBatchSelectionChecks.has(result) || !result.matchesRecomputation) fail("REVIEW_BATCH_SELECTION_UNVERIFIED");
  return result.query;
}
export function encodeRehearsalBatchSelection(result, query = {}) {
  return JSON.stringify(queryRehearsalBatchFiles(result, query), null, 2) + "\n";
}
const batchEvidenceReceiptChecks = new WeakSet();
export async function reviewRehearsalBatchEvidenceReceipt(expected, text, input = {}) {
  if (!batchEvidenceReviews.has(expected)) fail("REVIEW_BATCH_RECEIPT_SOURCE");
  let options, supplied;
  try { options = captureOptionalDataFields(input, ["subtle", "signal", "timeoutMs"]); } catch { fail("REVIEW_BATCH_RECEIPT_OPTIONS"); }
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000)) fail("REVIEW_BATCH_RECEIPT_OPTIONS");
  if (readAbortState(options.signal)) fail("REVIEW_CANCELLED");
  try { supplied = parseSecurityJson(text, { bytes: 256 * 1024, depth: 32, nodes: 10000 }); } catch { fail("REVIEW_BATCH_RECEIPT_JSON"); }
  if (!supplied || Array.isArray(supplied) || supplied.schema !== expected.schema) fail("REVIEW_BATCH_RECEIPT_SCHEMA");
  const differences = Object.keys(expected).filter(key => !Object.hasOwn(supplied, key) || compareValues(expected[key], supplied[key]).differenceCount !== 0);
  const unexpectedFields = Object.keys(supplied).filter(key => !Object.hasOwn(expected, key)).length;
  const receiptTextDigest = await sha256Hex(new TextEncoder().encode(text), options.subtle, options);
  if (readAbortState(options.signal)) fail("REVIEW_CANCELLED");
  const result = Object.freeze({ schema: "threecore.operation-rehearsal-batch-evidence-receipt-check.v1", matchesRecomputation: differences.length === 0 && unexpectedFields === 0,
    bundleTextDigest: expected.sha256, bundleTextBindingMatches: supplied.sha256 === expected.sha256, receiptTextDigest,
    expectedEvidenceMatches: expected.matchesRecomputation, expectedSummary: expected.expectedSummary,
    differences: Object.freeze(differences), unexpectedFields, readOnly: true, simulationOnly: true, sourceVerified: false,
    authorizesExecution: false, automaticallyImported: false, containsOriginalEvidence: false, restorable: false });
  batchEvidenceReceiptChecks.add(result); return result;
}
export function encodeRehearsalBatchEvidenceReceiptCheck(result) {
  if (!batchEvidenceReceiptChecks.has(result)) fail("REVIEW_BATCH_RECEIPT_RESULT");
  return JSON.stringify(result, null, 2) + "\n";
}
/** Only a fully matching owned verification can expose the captured sources to a review panel. */
export function openReviewedRehearsalBatchEvidence(review) {
  if (!batchEvidenceReviews.has(review) || !review.matchesRecomputation) fail("UNVERIFIED_BATCH_EVIDENCE");
  return batchEvidenceReviews.get(review);
}
/** Extract exact original text, including faithful negative evidence, without restoring its inputs. */
export function extractRehearsalBatchEvidenceSource(review, name) {
  const { result, files } = openReviewedRehearsalBatchEvidence(review);
  if (typeof name !== "string") fail("REVIEW_BATCH_EVIDENCE_SOURCE_NAME");
  const index = files.findIndex(row => row.name === name);
  if (index < 0) fail("REVIEW_BATCH_EVIDENCE_SOURCE_NAME");
  return Object.freeze({ filename: files[index].name, text: files[index].text, mimeType: "application/json;charset=utf-8",
    sourceTextDigest: result.files[index].sha256, sourceStatus: result.files[index].status,
    containsOriginalEvidence: true, simulationOnly: true, sourceVerified: false, authorizesExecution: false, automaticallyImported: false });
}

/** Hashes identify selected bytes, including differing/unsupported reports. */
export function encodeRehearsalBatchManifest(result) {
  if (!batchReceipts.has(result)) fail("UNRECOGNIZED_REVIEW_BATCH");
  if (!result.complete || result.files.some(row => row.sha256 === null)) fail("REVIEW_BATCH_HASHES_INCOMPLETE");
  return result.files.map(row => row.sha256 + "  " + row.name).join("\n") + "\n";
}

/** Viewing summary only. Retain partial scope on every row and never infer a pass. */
export function encodeRehearsalBatchCsv(result) {
  if (!batchReceipts.has(result)) fail("UNRECOGNIZED_REVIEW_BATCH");
  const rows = [["receiptSchema","simulationOnly","sourceVerified","authorizesExecution","phase","complete",
    "selected","reviewed","pending","totalBytes","allRecomputationsMatch","referenceProvided","referenceSha256",
    "externalChecksumsCompared","allExternalChecksumsMatch","name","status","byteLength","sha256",
    "expectedSha256","checksumMatches","inputSchema","differenceCount","expectedCases","expectationsMatched","expectationsDiffering"]];
  const unknownBytes = Object.hasOwn(result.summary, "sourceUnavailable");
  if (unknownBytes) rows[0].push("reportedByteLength", "readError", "sourceUnavailable", "selectedReportedBytes", "unreadSourceReportedBytes");
  if (result.continuation) rows[0].push("continuationSequence", "retainedReviews", "previousPhase", "previousBatchSha256");
  if (result.retry) rows[0].push("retrySequence", "retryPreviousPhase", "retryPreviousBatchSha256", "retryTargetIndexes", "retryCompletedIndexes", "retryRemainingIndexes", "retryRetainedReviews");
  for (const row of result.files) rows.push([result.schema,true,false,false,result.phase,result.complete,
    result.summary.selected,result.summary.reviewed,result.summary.pending,result.summary.totalBytes,
    result.allRecomputationsMatch,result.referenceProvided ?? false,result.reference?.sha256 ?? "",
    result.externalChecksumsCompared,result.allExternalChecksumsMatch ?? "",row.name,row.status,row.byteLength ?? "",
    row.sha256 ?? "",row.expectedSha256 ?? "",row.checksumMatches ?? "",row.inputSchema ?? "",row.differenceCount ?? "",
    row.expectedOutcomes?.cases ?? "",row.expectedOutcomes?.matched ?? "",row.expectedOutcomes?.differing ?? "",
    ...(unknownBytes ? [row.reportedByteLength ?? "", row.code ?? "", result.summary.sourceUnavailable, result.summary.selectedReportedBytes, result.summary.unreadSourceReportedBytes] : []),
    ...(result.continuation ? [result.continuation.sequence, result.continuation.retainedReviews, result.continuation.previousPhase, result.continuation.previousBatchSha256 ?? ""] : []),
    ...(result.retry ? [result.retry.sequence, result.retry.previousPhase, result.retry.previousBatchSha256 ?? "", result.retry.targetIndexes.join(" | "), result.retry.completedIndexes.join(" | "), result.retry.remainingIndexes.join(" | "), result.retry.retainedReviews] : [])]);
  const cell = value => { let text = String(value); if (/^\s*[=+@-]/u.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

const workspaceSourceSchemas = new Set([REHEARSAL_OVERVIEW_SCHEMA,REHEARSAL_RECORD_REPORT_SCHEMA,
  REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA,REHEARSAL_REASON_RECORD_REPORT_SCHEMA,REHEARSAL_REFERENCE_REPORT_SCHEMA,REHEARSAL_RECORD_SUMMARY_SCHEMA]);

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

const querySourceSchemas=new Set([REHEARSAL_RECORD_REPORT_SCHEMA,REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA,REHEARSAL_REASON_RECORD_REPORT_SCHEMA,REHEARSAL_RECORD_SUMMARY_SCHEMA]);
export function canReuseReviewedRehearsalQuery(receipt){
  return reviewSources.has(receipt)&&receipt.matchesRecomputation===true&&receipt.checksumMatches!==false&&querySourceSchemas.has(receipt.inputSchema);
}
/** Reuse only search criteria. The original report's history is never returned here. */
export function extractReviewedRehearsalQuery(receipt){
  if(!canReuseReviewedRehearsalQuery(receipt))fail("REVIEW_QUERY_UNAVAILABLE");
  const {recomputed}=prepareRehearsalReview(reviewSources.get(receipt),receipt.expectedSha256),query=recomputed.query;
  return validateRehearsalReasonRecordQuery({...query,searchScope:query.searchScope??"stored",reason:query.reason??"all"});
}

const reviewedParts = Object.freeze([
  {part:"record-prefix",label:"選んだ記録までの単体入力",schema:REHEARSAL_PREFIX_REPORT_SCHEMA,destination:"記録を保存・再確認",note:"選んだ記録より後の記録と、他のトークンは含みません。元の全履歴ではありません。"},
  {part:"workspace-before",label:"比較前の3トークン入力",schema:REHEARSAL_COMPARISON_SCHEMA,destination:"3トークンの履歴の復旧欄",note:"比較後の入力は含みません。"},
  {part:"workspace-after",label:"比較後の3トークン入力",schema:REHEARSAL_COMPARISON_SCHEMA,destination:"3トークンの履歴の復旧欄",note:"比較前の入力は含みません。"},
  {part:"scenario-before",label:"条件変更前の単体入力",schema:REHEARSAL_SCENARIO_SCHEMA,destination:"記録を保存・再確認",note:"仮の条件比較の、変更前の入力です。"},
  {part:"scenario-after",label:"条件変更後の単体入力",schema:REHEARSAL_SCENARIO_SCHEMA,destination:"記録を保存・再確認",note:"仮の条件比較の、変更後の入力です。実際に実行した履歴ではありません。"},
  {part:"scenario-set",label:"名前付きの比較ケース集",schema:REHEARSAL_SCENARIO_SET_REPORT_SCHEMA,destination:"比較ケースを名前付きで残す",note:"ケースの名前・順序・比較前後の入力を含みます。"},
  {part:"check-suite",label:"元の期待結果と比較ケース",schema:REHEARSAL_CHECK_REPORT_SCHEMA,destination:"保存した期待結果との比較",note:"期待値を変更せず取り出します。期待結果との差がある場合も、そのまま含みます。"}
].map(Object.freeze));

/** Choices require a receipt owned by this module; a comparison has no implicit side. */
export function reviewedRehearsalInputChoices(receipt) {
  if(!reviewSources.has(receipt)||!receipt.matchesRecomputation||receipt.checksumMatches===false)return Object.freeze([]);
  return Object.freeze(reviewedParts.filter(item=>item.schema===receipt.inputSchema));
}

/** Recover canonical source values; neither import nor recapture expected results. */
export function exportReviewedRehearsalPart(receipt,part) {
  if(typeof part!=="string"||!reviewedParts.some(item=>item.part===part))fail("INVALID_REVIEW_PART");
  const choice=reviewedRehearsalInputChoices(receipt).find(item=>item.part===part);
  if(!choice)fail("REVIEW_PART_UNAVAILABLE");
  const {recomputed}=prepareRehearsalReview(reviewSources.get(receipt),receipt.expectedSha256),input=recomputed.inputs;
  let text;
  if(part==="record-prefix")text=encodeRehearsal(recomputed.prefix);
  else if(part==="workspace-before"||part==="workspace-after")text=encodeRehearsalWorkspace(input[part.slice(10)]);
  else if(part==="scenario-before"||part==="scenario-after")text=encodeRehearsal(input[part.slice(9)]);
  else if(part==="scenario-set")text=encodeRehearsalScenarioSet(input);
  else text=encodeRehearsalCheckSuite(input);
  return Object.freeze({part,label:choice.label,destination:choice.destination,note:choice.note,
    filename:"ThreeCore-recovered-"+part+".json",mimeType:"application/json",text});
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
