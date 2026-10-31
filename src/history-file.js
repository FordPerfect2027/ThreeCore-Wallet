import { createPortfolioHistory, HISTORY_TEXT_LIMIT } from "./portfolio-history.js";
import { AGENT_IDS } from "./wallet-session.js";
import { decodePortfolioReport } from "./portfolio-report.js";
import { captureDataArray } from "./security-data.js";

export const HISTORY_FILE_LIMIT = HISTORY_TEXT_LIMIT * 4;
export const HISTORY_REPORT_FILE_LIMIT = 65536;
export const HISTORY_REPORT_BATCH_LIMIT = 1048576;
export const HISTORY_ARCHIVE_FILE_LIMIT = 1048576;
export const HISTORY_ARCHIVE_BATCH_LIMIT = 4194304;
export class HistoryFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HistoryFileError";
    this.code = code;
  }
}
function fail(code, message) {
  throw new HistoryFileError(code, message);
}
function agentName(agent) {
  if (!AGENT_IDS.includes(agent)) fail("INVALID_AGENT", "Select a ThreeCore agent");
  return agent;
}

/** Build a separate candidate; one invalid/conflicting report rejects the whole batch. */
export function preparePortfolioReportsHistory(inputs, agent) {
  agentName(agent);
  let sources; try { sources = captureDataArray(inputs, 64, 1); } catch { fail("INVALID_FILE", "Choose one to 64 portfolio reports"); }
  let total = 0;
  const snapshots = sources.map(text => {
    if (typeof text !== "string" || !text.length || text.length > HISTORY_REPORT_FILE_LIMIT) fail("FILE_SIZE", "Report too large");
    const size = new TextEncoder().encode(text).byteLength; total += size;
    if (size > HISTORY_REPORT_FILE_LIMIT || total > HISTORY_REPORT_BATCH_LIMIT) fail("FILE_SIZE", "Report batch too large");
    const snapshot = decodePortfolioReport(text).snapshot;
    if (snapshot.agent !== agent) fail("AGENT_MISMATCH", "This report belongs to another card");
    return snapshot;
  });
  const history = createPortfolioHistory(), merged = history.merge(snapshots);
  return Object.freeze({ ...validateHistoryFileText(history.exportText(), agent), sourceCount: sources.length, duplicateCount: merged.duplicates });
}

/** Consolidate separate archive files into one candidate; never touch the live collection. */
export function prepareHistoryArchives(inputs, agent) {
  agentName(agent);
  let sources; try { sources = captureDataArray(inputs, 16, 1); } catch { fail("INVALID_FILE", "Choose one to 16 history archives"); }
  let total = 0, sourceObservationCount = 0, duplicateCount = 0;
  const history = createPortfolioHistory();
  for (const text of sources) {
    if (typeof text !== "string" || !text.length || text.length > HISTORY_ARCHIVE_FILE_LIMIT) fail("FILE_SIZE", "Archive too large");
    const size = new TextEncoder().encode(text).byteLength; total += size;
    if (size > HISTORY_ARCHIVE_FILE_LIMIT || total > HISTORY_ARCHIVE_BATCH_LIMIT) fail("FILE_SIZE", "Archive batch too large");
    const checked = validateHistoryFileText(text, agent), source = createPortfolioHistory(); source.importText(checked.text);
    const snapshots = source.state().snapshots; sourceObservationCount += snapshots.length;
    duplicateCount += history.merge(snapshots).duplicates;
  }
  if (!sourceObservationCount) fail("INVALID_FILE", "No observations in selected archives");
  return Object.freeze({ ...validateHistoryFileText(history.exportText(), agent), sourceCount: sources.length, sourceObservationCount, duplicateCount });
}

/** Validate a history archive and return a canonical, bounded copy. */
export function validateHistoryFileText(text, agent) {
  agentName(agent);
  if (typeof text !== "string") fail("INVALID_FILE", "Expected UTF-8 JSON text");
  // A UTF-8 BOM is allowed at the beginning only, as produced by some editors.
  const normalized = text.startsWith("\ufeff") ? text.slice(1) : text;
  const history = createPortfolioHistory();
  history.importText(normalized);
  const state = history.state();
  if (state.snapshots.some(snapshot => snapshot.agent !== agent)) {
    fail("AGENT_MISMATCH", "This file contains a different agent");
  }
  const canonicalText = history.exportText();
  const groups = history.groups();
  return Object.freeze({
    text: canonicalText,
    agent,
    observationCount: state.size,
    identityCount: groups.length,
    groups,
    historicalObservation: true,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
  });
}

/** Decode bytes with fatal UTF-8 validation rather than replacement characters. */
export function decodeHistoryFileBytes(bytes, agent) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > HISTORY_FILE_LIMIT) {
    fail("FILE_SIZE", "Expected a nonempty bounded UTF-8 file");
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("FILE_ENCODING", "The file must contain valid UTF-8"); }
  return validateHistoryFileText(text, agent);
}

/**
 * A safe suggested filename, never a filesystem path. No addresses are placed
 * in the name; the archive itself contains public addresses and balances.
 */
export function historyFileName(agent, revision) {
  agentName(agent);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    fail("INVALID_REVISION", "Expected a nonnegative revision");
  }
  return "ThreeCore-" + agent + "-history-r" + revision + ".json";
}

export function prepareHistoryDownload(text, agent, revision) {
  const checked = validateHistoryFileText(text, agent);
  const bytes = new TextEncoder().encode(checked.text);
  if (bytes.byteLength > HISTORY_FILE_LIMIT) fail("FILE_SIZE", "Archive too large");
  return Object.freeze({
    filename: historyFileName(agent, revision),
    mimeType: "application/json;charset=utf-8",
    text: checked.text,
    byteLength: bytes.byteLength,
    observationCount: checked.observationCount,
    revision,
  });
}

/**
 * Track preparation separately from durable saving. Starting a browser download
 * cannot establish that the user kept a file, so no 'saved to disk' claim exists.
 */
export function createHistoryBackupTracker() {
  let offeredRevision = null;
  function offered(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      fail("INVALID_REVISION", "Invalid backup revision");
    }
    offeredRevision = revision;
    return state(revision);
  }
  function state(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      fail("INVALID_REVISION", "Invalid current revision");
    }
    return Object.freeze({
      offeredRevision,
      currentRevision: revision,
      currentDownloadOffered: offeredRevision === revision,
      needsNewDownload: offeredRevision !== revision,
      diskSaveVerified: false,
    });
  }
  return Object.freeze({ offered, state });
}
