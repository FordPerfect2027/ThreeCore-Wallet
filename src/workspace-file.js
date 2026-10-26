import { readSecurityFileBytes } from "./security-file.js";
import { createStateNotifier } from "./state-notifier.js";
import { readOwnErrorCode } from "./provider-error.js";
import { parseSecurityJson } from "./security-json.js";
import { decodeWorkspace, encodeWorkspace, workspaceData, workspaceKeys,
  WORKSPACE_TEXT_LIMIT, workspaceFail, WorkspaceError } from "./workspace-format.js";

export const WORKSPACE_FILE_SCHEMA = "threecore-workspace-file-v1";
export const WORKSPACE_FILE_LIMIT = 8 * 1024 * 1024;
const FILE_ERRORS = new Set(["WORKSPACE_FILE_SIZE", "WORKSPACE_FILENAME", "WORKSPACE_FILE_ENCODING",
  "WORKSPACE_FILE_JSON", "WORKSPACE_FILE_SCHEMA", "WORKSPACE_FILE_READ", "WORKSPACE_CRYPTO",
  "WORKSPACE_CHECKSUM", "WORKSPACE_SIZE", "WORKSPACE_JSON", "WORKSPACE_SHAPE", "WORKSPACE_COMPLEXITY",
  "WORKSPACE_AGENT", "WORKSPACE_ADDRESS", "WORKSPACE_CHAIN", "WORKSPACE_TOKENS", "WORKSPACE_HISTORY",
  "WORKSPACE_CONFLICT", "WORKSPACE_DUPLICATE", "WORKSPACE_ENTRIES", "WORKSPACE_SCHEMA"]);

async function digestText(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.digest !== "function") workspaceFail("WORKSPACE_CRYPTO");
  const bytes = new TextEncoder().encode(text);
  let result;
  try { result = new Uint8Array(await subtle.digest("SHA-256", bytes)); }
  catch { workspaceFail("WORKSPACE_CRYPTO"); }
  if (result.length !== 32) workspaceFail("WORKSPACE_CRYPTO");
  return [...result].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** A checksum detects corruption, not ownership, authorship or authenticity. */
export async function prepareWorkspaceFile(workspace, { subtle } = {}) {
  const canonical = encodeWorkspace(workspace);
  const digest = await digestText(canonical, subtle);
  const text = JSON.stringify({ schema: WORKSPACE_FILE_SCHEMA, algorithm: "SHA-256", digest,
    workspace: JSON.parse(canonical) }, null, 2);
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > WORKSPACE_FILE_LIMIT) workspaceFail("WORKSPACE_FILE_SIZE");
  return Object.freeze({ text, byteLength, digest,
    filename: "ThreeCore-workspace-backup.json", mimeType: "application/json;charset=utf-8" });
}

export async function decodeWorkspaceFile(bytes, { subtle } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > WORKSPACE_FILE_LIMIT) {
    workspaceFail("WORKSPACE_FILE_SIZE");
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { workspaceFail("WORKSPACE_FILE_ENCODING"); }
  let parsed;
  try { parsed = workspaceData(parseSecurityJson(text)); }
  catch (error) {
    if (error instanceof WorkspaceError) throw error;
    workspaceFail("WORKSPACE_FILE_JSON");
  }
  workspaceKeys(parsed, ["schema", "algorithm", "digest", "workspace"]);
  if (parsed.schema !== WORKSPACE_FILE_SCHEMA || parsed.algorithm !== "SHA-256" ||
      typeof parsed.digest !== "string" || !/^[0-9a-f]{64}$/.test(parsed.digest)) workspaceFail("WORKSPACE_FILE_SCHEMA");
  const workspaceText = JSON.stringify(parsed.workspace);
  if (workspaceText.length > WORKSPACE_TEXT_LIMIT) workspaceFail("WORKSPACE_SIZE");
  const workspace = decodeWorkspace(workspaceText);
  const canonical = encodeWorkspace(workspace);
  const actual = await digestText(canonical, subtle);
  if (actual !== parsed.digest) workspaceFail("WORKSPACE_CHECKSUM");
  return Object.freeze({ workspace, text: canonical, digest: actual, checksumVerified: true, authenticated: false });
}

function validFile(file, valid) {
  const name = file?.name;
  if (!valid()) return null;
  if (typeof name !== "string" || name.length > 240 ||
      !/\.json$/i.test(name) || /[\\/\u0000-\u001f\u007f]/.test(name)) workspaceFail("WORKSPACE_FILENAME");
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > WORKSPACE_FILE_LIMIT) workspaceFail("WORKSPACE_FILE_SIZE");
  return size;
}

/** Generation checks cover both file reading and checksum computation. */
export function createWorkspaceFileReader({
  readBytes = readSecurityFileBytes,
  subtle,
  onChange = () => {},
} = {}) {
  let generation = 0;
  let readAbort = null;
  let aborting = false;
  let stopping = false;
  function abortRead() {
    const previous = readAbort;
    readAbort = null;
    if (!previous) return;
    aborting = true;
    try { previous.abort(); } finally { aborting = false; }
  }
  let disposed = false;
  const current = id => !disposed && id === generation;
  let state = Object.freeze({ phase: "idle", result: null, errorCode: null });
  // Keep the bounded notification key separate from plaintext workspace data.
  const notifications = createStateNotifier({
    observers: new Set([() => {
      if (disposed) return;
      const previous = stopping;
      stopping ||= state.phase === "cancelled";
      try { return onChange(state); } finally { stopping = previous; }
    }]),
    read: () => ({ generation, phase: state.phase }),
  });
  function publish(phase, result = null, errorCode = null) {
    state = Object.freeze({ phase, result, errorCode });
    notifications.notify();
  }
  return Object.freeze({
    state: () => state,
    async load(file) {
      if (disposed || aborting || stopping) return false;
      const id = ++generation;
      state = Object.freeze({ phase: "reading", result: null, errorCode: null });
      abortRead();
      if (!current(id)) return false;
      const activeRead = new AbortController();
      readAbort = activeRead;
      publish("reading");
      try {
        if (disposed || id !== generation) return false;
        const size = validFile(file, () => current(id));
        if (!current(id)) return false;
        const bytes = await readBytes(file, { maxBytes: WORKSPACE_FILE_LIMIT, signal: activeRead.signal });
        if (disposed || id !== generation) return false;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) workspaceFail("WORKSPACE_FILE_SIZE");
        const result = await decodeWorkspaceFile(bytes, { subtle });
        if (disposed || id !== generation) return false;
        publish("ready", result);
        return current(id);
      } catch (error) {
        if (disposed || id !== generation) return false;
        const code = readOwnErrorCode(error);
        if (!current(id)) return false;
        publish("error", null, FILE_ERRORS.has(code) ? code : "WORKSPACE_FILE_READ");
        return false;
      }
    },
    cancel() {
      if (disposed || stopping) return;
      stopping = true;
      const id = ++generation;
      state = Object.freeze({ phase: "cancelled", result: null, errorCode: null });
      try {
        abortRead();
        if (current(id)) notifications.notify();
      } finally { stopping = false; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      state = Object.freeze({ phase: "disposed", result: null, errorCode: null });
      abortRead();
    },
  });
}

/** Tracks the exact data offered for download; never claims disk persistence. */
export function createWorkspaceBackupTracker() {
  let captured = null;
  let offered = false;
  return Object.freeze({
    offered(workspace) {
      captured = encodeWorkspace(workspace);
      offered = true;
    },
    status(workspace) {
      if (!offered) return Object.freeze({ phase: "not-offered", diskSaved: false });
      let same = false;
      try { same = encodeWorkspace(workspace) === captured; } catch { /* Invalid input is changed. */ }
      return Object.freeze({ phase: same ? "current-offered" : "changed", diskSaved: false });
    },
    clear() { captured = null; offered = false; },
  });
}
