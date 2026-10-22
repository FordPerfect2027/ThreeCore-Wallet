import { createPortfolioHistory, HISTORY_TEXT_LIMIT } from "./portfolio-history.js";
import { AGENT_IDS } from "./wallet-session.js";

export const HISTORY_FILE_LIMIT = HISTORY_TEXT_LIMIT * 4;
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
