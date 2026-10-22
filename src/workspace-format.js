import { AGENT_IDS, normalizeAddress } from "./wallet-session.js";
import { validateWalletSetup, WALLET_SETUP_SCHEMA } from "./wallet-setup.js";
import { createPortfolioHistory, HISTORY_TEXT_LIMIT } from "./portfolio-history.js";

export const WORKSPACE_SCHEMA = "threecore-wallet-workspace-v1";
export const WORKSPACE_TEXT_LIMIT = 4 * 1024 * 1024;
export const WORKSPACE_TOKEN_LIMIT = 32;
const CHAINS = [8453, 84532];
const ENTRY_KEYS = ["agent", "account", "chainId", "tokenAddress", "tokens", "history"];

export class WorkspaceError extends Error {
  constructor(code, detail = "") {
    super(detail || code);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
export const workspaceFail = (code, detail) => { throw new WorkspaceError(code, detail); };

/** Copy bounded JSON data without invoking toJSON, accessors or coercion. */
export function workspaceData(input) {
  const ancestors = new Set();
  let visited = 0;
  let characters = 0;
  function copy(value, depth) {
    if (++visited > 100000 || depth > 16) workspaceFail("WORKSPACE_COMPLEXITY");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      characters += value.length;
      if (characters > WORKSPACE_TEXT_LIMIT) workspaceFail("WORKSPACE_SIZE");
      return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (!value || typeof value !== "object") workspaceFail("WORKSPACE_SHAPE");
    if (ancestors.has(value)) workspaceFail("WORKSPACE_SHAPE");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 256 || Reflect.ownKeys(value).length !== value.length + 1) {
          workspaceFail("WORKSPACE_SHAPE");
        }
        const result = [];
        for (let index = 0; index < value.length; index++) {
          const item = Object.getOwnPropertyDescriptor(value, String(index));
          if (!item || !("value" in item)) workspaceFail("WORKSPACE_SHAPE");
          result.push(copy(item.value, depth + 1));
        }
        return result;
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) workspaceFail("WORKSPACE_SHAPE");
      const result = Object.create(null);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) {
          workspaceFail("WORKSPACE_SHAPE");
        }
        characters += key.length;
        const item = Object.getOwnPropertyDescriptor(value, key);
        if (!item || !("value" in item)) workspaceFail("WORKSPACE_SHAPE");
        result[key] = copy(item.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  try { return copy(input, 0); }
  catch (error) {
    if (error instanceof WorkspaceError) throw error;
    workspaceFail("WORKSPACE_SHAPE");
  }
}

export function workspaceKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) workspaceFail("WORKSPACE_SHAPE");
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) workspaceFail("WORKSPACE_SHAPE");
}

export function freezeWorkspace(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeWorkspace(child);
    Object.freeze(value);
  }
  return value;
}

function address(value, optional = false) {
  if (optional && value === null) return null;
  if (typeof value !== "string" || /^0x0{40}$/i.test(value)) workspaceFail("WORKSPACE_ADDRESS");
  try { return normalizeAddress(value); }
  catch { workspaceFail("WORKSPACE_ADDRESS"); }
}

export function workspaceHistory(agent, text) {
  if (!AGENT_IDS.includes(agent)) workspaceFail("WORKSPACE_AGENT");
  if (typeof text !== "string" || !text.length || text.length > HISTORY_TEXT_LIMIT) workspaceFail("WORKSPACE_HISTORY");
  const history = createPortfolioHistory();
  try {
    history.importText(text);
    if (history.state().snapshots.some(row => row.agent !== agent)) workspaceFail("WORKSPACE_AGENT");
    return history;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    workspaceFail(error?.code === "OBSERVATION_CONFLICT" ? "WORKSPACE_CONFLICT" : "WORKSPACE_HISTORY");
  }
}

function orderedEntries(value) {
  if (!Array.isArray(value) || value.length !== 3) workspaceFail("WORKSPACE_ENTRIES");
  const agents = value.map(row => row?.agent);
  if (new Set(agents).size !== 3 || agents.some(agent => !AGENT_IDS.includes(agent))) workspaceFail("WORKSPACE_AGENT");
  return AGENT_IDS.map(agent => value.find(row => row.agent === agent));
}

/** The file contains observations, never connection permission or key material. */
export function validateWorkspace(input) {
  const value = workspaceData(input);
  workspaceKeys(value, ["schema", "historicalObservation", "entries"]);
  if (value.schema !== WORKSPACE_SCHEMA || value.historicalObservation !== true) workspaceFail("WORKSPACE_SCHEMA");
  const entries = orderedEntries(value.entries).map(row => {
    workspaceKeys(row, ENTRY_KEYS);
    if (!CHAINS.includes(row.chainId)) workspaceFail("WORKSPACE_CHAIN");
    if (!Array.isArray(row.tokens) || row.tokens.length > WORKSPACE_TOKEN_LIMIT) workspaceFail("WORKSPACE_TOKENS");
    const tokens = row.tokens.map(token => address(token));
    if (new Set(tokens).size !== tokens.length) workspaceFail("WORKSPACE_TOKENS");
    const history = workspaceHistory(row.agent, JSON.stringify(row.history));
    return {
      agent: row.agent,
      account: address(row.account, true),
      chainId: row.chainId,
      tokenAddress: address(row.tokenAddress, true),
      tokens,
      history: JSON.parse(history.exportText()),
    };
  });
  try {
    validateWalletSetup({ schema: WALLET_SETUP_SCHEMA,
      entries: entries.map(({ agent, account, chainId }) => ({ agent, account, chainId })) });
  } catch (error) {
    workspaceFail(error?.code === "SETUP_DUPLICATE" ? "WORKSPACE_DUPLICATE" : "WORKSPACE_ADDRESS");
  }
  const result = { schema: WORKSPACE_SCHEMA, historicalObservation: true, entries };
  if (JSON.stringify(result).length > WORKSPACE_TEXT_LIMIT) workspaceFail("WORKSPACE_SIZE");
  return freezeWorkspace(result);
}

export function encodeWorkspace(value) {
  const text = JSON.stringify(validateWorkspace(value), null, 2);
  if (text.length > WORKSPACE_TEXT_LIMIT) workspaceFail("WORKSPACE_SIZE");
  return text;
}

export function decodeWorkspace(text) {
  if (typeof text !== "string" || !text.length || text.length > WORKSPACE_TEXT_LIMIT) workspaceFail("WORKSPACE_SIZE");
  let parsed;
  try { parsed = JSON.parse(text.startsWith("\ufeff") ? text.slice(1) : text); }
  catch { workspaceFail("WORKSPACE_JSON"); }
  return validateWorkspace(parsed);
}

/** Raw form values are captured so a valid restore can repair unfinished input. */
export function captureWorkspaceDraft(input) {
  const value = workspaceData(input);
  const entries = orderedEntries(value).map(row => {
    workspaceKeys(row, ENTRY_KEYS);
    if (!CHAINS.includes(row.chainId)) workspaceFail("WORKSPACE_CHAIN");
    for (const key of ["account", "tokenAddress", "tokens", "history"]) {
      if (typeof row[key] !== "string") workspaceFail("WORKSPACE_DRAFT");
    }
    if (row.account.length > 256 || row.tokenAddress.length > 256 || row.tokens.length > 8192) workspaceFail("WORKSPACE_DRAFT");
    const history = workspaceHistory(row.agent, row.history);
    return { agent: row.agent, account: row.account, chainId: row.chainId,
      tokenAddress: row.tokenAddress, tokens: row.tokens, history: history.exportText() };
  });
  return freezeWorkspace(entries);
}

export function workspaceFromDraft(input) {
  const entries = captureWorkspaceDraft(input).map(row => ({
    agent: row.agent,
    account: row.account.trim() || null,
    chainId: row.chainId,
    tokenAddress: row.tokenAddress.trim() || null,
    tokens: row.tokens.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    history: JSON.parse(row.history),
  }));
  return validateWorkspace({ schema: WORKSPACE_SCHEMA, historicalObservation: true, entries });
}

export function workspaceToDraft(input) {
  return freezeWorkspace(validateWorkspace(input).entries.map(row => ({
    agent: row.agent,
    account: row.account ?? "",
    chainId: row.chainId,
    tokenAddress: row.tokenAddress ?? "",
    tokens: row.tokens.join("\n"),
    history: JSON.stringify(row.history, null, 2),
  })));
}

export function workspaceDraftKey(input) {
  return JSON.stringify(captureWorkspaceDraft(input));
}

export function workspaceOptions(input) {
  const options = workspaceData(input);
  workspaceKeys(options, ["settings", "histories", "mode"]);
  if (typeof options.settings !== "boolean" || typeof options.histories !== "boolean" ||
      !(options.settings || options.histories) || !["merge", "replace"].includes(options.mode)) {
    workspaceFail("WORKSPACE_OPTIONS");
  }
  return Object.freeze({ settings: options.settings, histories: options.histories, mode: options.mode });
}

function normalizedConfiguration(row) {
  const clean = value => value.trim().toLowerCase();
  return JSON.stringify([clean(row.account), row.chainId, clean(row.tokenAddress),
    row.tokens.split(/\r?\n/).map(clean).filter(Boolean)]);
}

/** Compute the whole result in isolated stores before altering any card. */
export function previewWorkspace(text, current, selected) {
  const incoming = decodeWorkspace(text);
  const before = captureWorkspaceDraft(current);
  const options = workspaceOptions(selected);
  const proposed = workspaceToDraft(incoming);
  const changes = [];
  const after = before.map((old, index) => {
    const next = proposed[index];
    const result = { ...(options.settings ? next : old) };
    const previousHistory = workspaceHistory(old.agent, old.history);
    const merged = workspaceHistory(old.agent, old.history);
    let duplicates = 0;
    let added = 0;
    if (options.histories) {
      try {
        const update = merged.importText(next.history, { replace: options.mode === "replace" });
        duplicates = update.duplicates;
        added = update.added;
      } catch (error) {
        workspaceFail(error?.code === "OBSERVATION_CONFLICT" ? "WORKSPACE_CONFLICT" : "WORKSPACE_CAPACITY");
      }
    }
    result.history = merged.exportText();
    const oldSnapshots = previousHistory.state().snapshots;
    const resultSnapshots = merged.state().snapshots;
    const retained = new Set(resultSnapshots.map(row => JSON.stringify(row)));
    const removed = oldSnapshots.filter(row => !retained.has(JSON.stringify(row))).length;
    const configurationChanged = normalizedConfiguration(old) !== normalizedConfiguration(result);
    // Preserve the exact form spelling if the effective configuration is unchanged.
    if (!configurationChanged) {
      result.account = old.account;
      result.tokenAddress = old.tokenAddress;
      result.tokens = old.tokens;
    }
    changes.push({ agent: old.agent, configurationChanged,
      historyChanged: old.history !== result.history,
      beforeCount: oldSnapshots.length,
      incomingCount: incoming.entries[index].history.reports.length,
      afterCount: resultSnapshots.length,
      added, duplicates, removed,
      beforeAccount: old.account,
      afterAccount: result.account,
      beforeChain: old.chainId,
      afterChain: result.chainId,
      tokenCount: result.tokens.split(/\r?\n/).filter(line => line.trim()).length,
    });
    return result;
  });
  return freezeWorkspace({ before, after, options, changes,
    changed: changes.some(row => row.configurationChanged || row.historyChanged),
    removed: changes.reduce((sum, row) => sum + row.removed, 0),
    authorizesConnection: false, authorizesTransaction: false });
}
