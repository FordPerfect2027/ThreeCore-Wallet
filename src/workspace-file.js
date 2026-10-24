import { parseSecurityJson } from "./security-json.js";
import { decodeWorkspace, encodeWorkspace, workspaceData, workspaceKeys,
  WORKSPACE_TEXT_LIMIT, workspaceFail, WorkspaceError } from "./workspace-format.js";

export const WORKSPACE_FILE_SCHEMA = "threecore-workspace-file-v1";
export const WORKSPACE_FILE_LIMIT = 8 * 1024 * 1024;

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

function validFile(file) {
  if (!file || typeof file.name !== "string" || file.name.length > 240 ||
      !/\.json$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) workspaceFail("WORKSPACE_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > WORKSPACE_FILE_LIMIT) workspaceFail("WORKSPACE_FILE_SIZE");
  return file.size;
}

/** Generation checks cover both file reading and checksum computation. */
export function createWorkspaceFileReader({
  readBytes = async file => new Uint8Array(await file.arrayBuffer()),
  subtle,
  onChange = () => {},
} = {}) {
  let generation = 0;
  let disposed = false;
  let state = Object.freeze({ phase: "idle", result: null, errorCode: null });
  function publish(phase, result = null, errorCode = null) {
    state = Object.freeze({ phase, result, errorCode });
    onChange(state);
  }
  return Object.freeze({
    state: () => state,
    async load(file) {
      if (disposed) return false;
      const id = ++generation;
      publish("reading");
      try {
        if (disposed || id !== generation) return false;
        const size = validFile(file);
        const bytes = await readBytes(file);
        if (disposed || id !== generation) return false;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) workspaceFail("WORKSPACE_FILE_SIZE");
        const result = await decodeWorkspaceFile(bytes, { subtle });
        if (disposed || id !== generation) return false;
        publish("ready", result);
        return true;
      } catch (error) {
        if (disposed || id !== generation) return false;
        publish("error", null, error instanceof WorkspaceError ? error.code : "WORKSPACE_FILE_READ");
        return false;
      }
    },
    cancel() {
      if (disposed) return;
      generation++;
      publish("cancelled");
    },
    dispose() {
      generation++;
      disposed = true;
      state = Object.freeze({ phase: "disposed", result: null, errorCode: null });
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
