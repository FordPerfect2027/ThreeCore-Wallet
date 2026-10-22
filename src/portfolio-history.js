import { validatePortfolioSnapshot, encodePortfolioReport, decodePortfolioReport } from "./portfolio-report.js";
import { comparePortfolioSnapshots } from "./portfolio-comparison.js";

export const HISTORY_SCHEMA = "threecore-portfolio-history-v1";
export const HISTORY_LIMIT = 64;
export const HISTORY_TEXT_LIMIT = 1048576;

export class PortfolioHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortfolioHistoryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PortfolioHistoryError(code, message);
}

function exactObject(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_HISTORY", "Expected a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_HISTORY", "Unexpected object prototype");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) {
    fail("INVALID_HISTORY", "Unknown or missing history fields");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      fail("INVALID_HISTORY", "Accessors are not history data");
    }
  }
}

function boundedArray(value, limit) {
  if (!Array.isArray(value) || value.length > limit) {
    fail("HISTORY_CAPACITY", "History exceeds its explicit capacity");
  }
  // Index descriptors avoid invoking getters in caller supplied arrays.
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) {
      fail("INVALID_HISTORY", "Sparse or accessor arrays are forbidden");
    }
    result.push(descriptor.value);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    fail("INVALID_HISTORY", "Extra array properties are forbidden");
  }
  return result;
}

function identity(snapshot) {
  return JSON.stringify([
    snapshot.agent,
    snapshot.account,
    snapshot.chainId,
    snapshot.siteOrigin,
  ]);
}

function slot(snapshot) {
  return JSON.stringify([identity(snapshot), snapshot.blockNumber]);
}

function fingerprint(snapshot) {
  // Connection epochs are session-local, not part of an onchain observation.
  // Holdings order is presentation-only; normalize it before deduplication.
  return JSON.stringify({
    blockHash: snapshot.blockHash,
    nativeBalanceBaseUnits: snapshot.nativeBalanceBaseUnits,
    holdings: [...snapshot.holdings]
      .sort((a, b) => a.address.localeCompare(b.address))
      .map(row => [row.address, row.hasCode, row.balanceBaseUnits, row.notice]),
  });
}

function limitValue(value) {
  if (!Number.isInteger(value) || value < 1 || value > HISTORY_LIMIT) {
    fail("INVALID_CAPACITY", "Capacity must be an integer from one to 64");
  }
  return value;
}

/**
 * A bounded, in-memory collection of historical observations.
 * No persistence, RPC requests, wallet connection or signing happens here.
 * Capacity errors never silently evict records; callers choose removals.
 * All batch imports are transactional: validate everything before commit.
 */
export function createPortfolioHistory({ capacity = HISTORY_LIMIT } = {}) {
  limitValue(capacity);
  let records = [];
  let revision = 0;

  function state() {
    return Object.freeze({
      schema: HISTORY_SCHEMA,
      capacity,
      revision,
      size: records.length,
      snapshots: Object.freeze([...records]),
      historicalObservation: true,
      canAuthorizeConnection: false,
      canAuthorizeTransaction: false,
      securityAudit: false,
    });
  }

  function merge(inputs, replace = false) {
    if (typeof replace !== "boolean") fail("INVALID_HISTORY", "Replace must be explicit boolean");
    const incoming = boundedArray(inputs, HISTORY_LIMIT);
    const candidate = replace ? [] : [...records];
    const slots = new Map(candidate.map(row => [slot(row), fingerprint(row)]));
    let added = 0;
    let duplicates = 0;
    for (const input of incoming) {
      const snapshot = validatePortfolioSnapshot(input);
      const key = slot(snapshot);
      const data = fingerprint(snapshot);
      if (slots.has(key)) {
        if (slots.get(key) !== data) {
          fail("OBSERVATION_CONFLICT", "Conflicting observations for the same identity and height");
        }
        duplicates++;
        continue;
      }
      if (candidate.length >= capacity) {
        fail("HISTORY_CAPACITY", "Remove a record explicitly before adding more");
      }
      candidate.push(snapshot);
      slots.set(key, data);
      added++;
    }
    const changed = JSON.stringify(candidate) !== JSON.stringify(records);
    if (changed) {
      records = candidate;
      revision++;
    }
    return Object.freeze({ added, duplicates, changed, state: state() });
  }

  function add(snapshot) {
    return merge([snapshot]);
  }

  function addReport(text) {
    return add(decodePortfolioReport(text).snapshot);
  }

  function remove(index, expectedRevision) {
    if (expectedRevision !== revision) {
      fail("STALE_HISTORY", "The collection changed; review the current records");
    }
    if (!Number.isInteger(index) || index < 0 || index >= records.length) {
      fail("INVALID_SELECTION", "Select an existing record");
    }
    records = records.filter((_, position) => position !== index);
    revision++;
    return state();
  }

  function clear(expectedRevision) {
    if (expectedRevision !== revision) {
      fail("STALE_HISTORY", "The collection changed; review before clearing");
    }
    if (records.length) {
      records = [];
      revision++;
    }
    return state();
  }

  function exportText() {
    const text = JSON.stringify({
      schema: HISTORY_SCHEMA,
      historicalObservation: true,
      reports: records.map(row => JSON.parse(encodePortfolioReport(row))),
    }, null, 2);
    if (text.length > HISTORY_TEXT_LIMIT) {
      fail("HISTORY_SIZE", "Export exceeds the bounded text limit");
    }
    return text;
  }

  function importText(text, { replace = false } = {}) {
    if (typeof replace !== "boolean") fail("INVALID_HISTORY", "Replace must be explicit boolean");
    if (typeof text !== "string" || !text.length || text.length > HISTORY_TEXT_LIMIT) {
      fail("HISTORY_SIZE", "Expected a bounded history JSON document");
    }
    let document;
    try { document = JSON.parse(text); }
    catch { fail("INVALID_HISTORY", "Invalid history JSON"); }
    exactObject(document, ["schema", "historicalObservation", "reports"]);
    if (document.schema !== HISTORY_SCHEMA || document.historicalObservation !== true) {
      fail("INVALID_HISTORY", "Unknown history schema or observation status");
    }
    const reports = boundedArray(document.reports, HISTORY_LIMIT);
    // Decode all reports before allowing merge to touch collection state.
    const snapshots = reports.map(report => decodePortfolioReport(JSON.stringify(report)).snapshot);
    return merge(snapshots, replace);
  }

  function compare(firstIndex, lastIndex, expectedRevision) {
    if (expectedRevision !== revision) fail("STALE_HISTORY", "Review current records before comparing");
    for (const index of [firstIndex, lastIndex]) {
      if (!Number.isInteger(index) || index < 0 || index >= records.length) {
        fail("INVALID_SELECTION", "Select existing history records");
      }
    }
    return comparePortfolioSnapshots(records[firstIndex], records[lastIndex]);
  }

  function groups() {
    const map = new Map();
    records.forEach((snapshot, index) => {
      const key = identity(snapshot);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ index, snapshot });
    });
    return Object.freeze([...map.values()].map(rows => {
      rows.sort((a, b) => {
        const first = BigInt(a.snapshot.blockNumber);
        const second = BigInt(b.snapshot.blockNumber);
        return first < second ? -1 : first > second ? 1 : 0;
      });
      const sample = rows[0].snapshot;
      return Object.freeze({
        agent: sample.agent,
        account: sample.account,
        chainId: sample.chainId,
        siteOrigin: sample.siteOrigin,
        indices: Object.freeze(rows.map(row => row.index)),
        earliestBlockNumber: rows[0].snapshot.blockNumber,
        latestBlockNumber: rows.at(-1).snapshot.blockNumber,
      });
    }));
  }

  return Object.freeze({ state, add, addReport, merge, remove, clear, exportText, importText, compare, groups });
}

