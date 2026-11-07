/** Durable at-most-once attempt claims. No model, wallet or network access. */
import { openSync, closeSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { AGENT_IDS } from "../src/wallet-session.js";
import { captureDataRecord } from "../src/security-data.js";
import { readSynchronousClock } from "../src/security-callback.js";
import { verifyWindowsJournalPrivacy, windowsJournalPrivacyErrorCode,
  windowsJournalPrivacySupported } from "./proposal-windows-journal-privacy.mjs";

// Optional backend: importing it must not break the older Node versions used
// by the read-only demo. Unsupported runtimes cannot create/open a journal.
let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}
export function proposalAttemptJournalSupport({ windowsAcl = false } = {}) {
  if (typeof windowsAcl !== "boolean") fail("INVALID_JOURNAL_CONFIG");
  const [major, minor] = process.versions.node.split(".").map(Number);
  const runtimeAvailable = typeof DatabaseSync === "function" && (major > 24 || major === 24 && minor >= 15);
  // This reports backend capability, without touching a path or starting a
  // process. Windows remains unsupported unless its ACL backend is opted in.
  const platformVerified = process.platform === "win32" ? windowsAcl && windowsJournalPrivacySupported()
    : typeof process.getuid === "function";
  return Object.freeze({ supported: runtimeAvailable && platformVerified, runtimeAvailable, platformVerified });
}

const hash = value => createHash("sha256").update(value).digest("hex");
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value);
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
class JournalError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new JournalError(code); };
const safeError = error => error instanceof JournalError ? error : new JournalError("JOURNAL_UNAVAILABLE");

// The version-one file format is owned by this adapter. Matching table names
// and valid current rows do not prove that its constraints still exist.
const CONFIGURATION_SCHEMA = `CREATE TABLE configuration (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  version INTEGER NOT NULL CHECK(version=1), scope TEXT NOT NULL,
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 1000),
  last_time INTEGER NOT NULL CHECK(last_time>=0)) STRICT`;
const ATTEMPTS_SCHEMA = `CREATE TABLE attempts (request_key TEXT PRIMARY KEY, agent TEXT NOT NULL CHECK(agent IN ('DAT','EMA','CAWELON')),
  fingerprint TEXT NOT NULL, reservation TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('reserved','completed','failed')),
  created_at INTEGER NOT NULL CHECK(created_at>=0), updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)) STRICT`;
const schemaText = sql => typeof sql === "string" ? sql.replace(/\s+/g, " ").trim() : null;
const EXPECTED_TABLES = [
  { type: "table", name: "attempts", sql: schemaText(ATTEMPTS_SCHEMA) },
  { type: "table", name: "configuration", sql: schemaText(CONFIGURATION_SCHEMA) },
];

// POSIX uses owner/mode checks. The explicit Windows backend independently
// validates a protected parent DACL and all present SQLite file DACLs.
function privatePath(filename, exists, windowsAcl) {
  if (process.platform === "win32" && windowsAcl) {
    try { return verifyWindowsJournalPrivacy(filename, exists); }
    catch (error) { fail(windowsJournalPrivacyErrorCode(error) ?? "JOURNAL_UNAVAILABLE"); }
  }
  if (typeof process.getuid !== "function") fail("JOURNAL_PLATFORM_UNVERIFIED");
  if (typeof filename !== "string" || !isAbsolute(filename) || resolve(filename) !== filename ||
      !filename.endsWith(".sqlite")) fail("INVALID_JOURNAL_PATH");
  const directory = dirname(filename), owner = process.getuid();
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || realpathSync(directory) !== directory || parent.uid !== owner ||
      (parent.mode & 0o077) !== 0) fail("JOURNAL_DIRECTORY_NOT_PRIVATE");
  if (exists) {
    const file = lstatSync(filename);
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== owner ||
        (file.mode & 0o077) !== 0 || file.size > 4 * 1024 * 1024) fail("INVALID_JOURNAL_FILE");
    return { dev: file.dev, ino: file.ino };
  }
}
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino &&
  left.directoryDev === right.directoryDev && left.directoryIno === right.directoryIno;

/**
 * An explicit create is required once; opening never recreates a missing file.
 * Use one stable file/scope across restarts and capability renewals. The fixed
 * attempt limit is NOT a money budget. No resetting, refunding or recovery retry.
 */
export function openProposalAttemptJournal({ filename, scope, maxAttempts = 1,
  create = false, now = Date.now, windowsAcl = false } = {}) {
  if (!proposalAttemptJournalSupport().runtimeAvailable) fail("JOURNAL_RUNTIME_UNAVAILABLE");
  if (!proposalAttemptJournalSupport({ windowsAcl }).platformVerified) fail("JOURNAL_PLATFORM_UNVERIFIED");
  if (!id(scope) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000 ||
      typeof create !== "boolean" || typeof now !== "function") fail("INVALID_JOURNAL_CONFIG");
  let db, closed = false, poisoned = false, identity;
  const windows = process.platform === "win32";
  try {
    if (create || !windows) privatePath(filename, false, windowsAcl);
    if (create) {
      // Never replace an existing journal (including a symlink or failed setup).
      const fd = openSync(filename, "wx", 0o600); closeSync(fd);
    }
    identity = privatePath(filename, true, windowsAcl);
    db = new DatabaseSync(filename, { timeout: 250, allowExtension: false,
      enableDoubleQuotedStringLiterals: false, defensive: true });
    // Recheck the Windows pathname after SQLite opens or recovers and before
    // schema creation/settings. SQLite and the inspector do not share a handle.
    if (windows && !sameIdentity(identity, privatePath(filename, true, windowsAcl))) fail("JOURNAL_FILE_CHANGED");
    db.exec("PRAGMA trusted_schema=OFF;");
    const durability = "PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; PRAGMA foreign_keys=ON;";
    if (create) {
      db.exec(durability);
      db.exec(`BEGIN IMMEDIATE; ${CONFIGURATION_SCHEMA}; ${ATTEMPTS_SCHEMA};`);
      db.prepare("INSERT INTO configuration VALUES(1,1,?,?,0)").run(scope, maxAttempts);
      db.exec("COMMIT");
    }
    // Inspect a consistent snapshot before changing persistent settings on an
    // existing file. A wrong file/configuration is not a migration request.
    db.exec("BEGIN");
    // GLOB treats '_' literally; LIKE would also hide non-internal sqliteX...
    // objects, including triggers that can remove committed attempt rows.
    const tables = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all()
      .map(({ type, name, sql }) => ({ type, name, sql: schemaText(sql) }));
    if (JSON.stringify(tables) !== JSON.stringify(EXPECTED_TABLES)) fail("INVALID_JOURNAL_SCHEMA");
    const meta = db.prepare("SELECT * FROM configuration").all();
    if (meta.length !== 1 || meta[0].singleton !== 1 || meta[0].version !== 1 || meta[0].scope !== scope ||
        meta[0].max_attempts !== maxAttempts || !uint(meta[0].last_time)) fail("JOURNAL_CONFIG_MISMATCH");
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") fail("JOURNAL_CORRUPT");
    const rows = db.prepare("SELECT * FROM attempts LIMIT 1001").all();
    if (rows.length > maxAttempts || rows.some(row => !hex(row.request_key) || !hex(row.fingerprint) ||
        !hex(row.reservation) || !AGENT_IDS.includes(row.agent) || !["reserved","completed","failed"].includes(row.status) ||
        !uint(row.created_at) || !uint(row.updated_at) || row.created_at > row.updated_at || row.updated_at > meta[0].last_time)) fail("JOURNAL_CORRUPT");
    db.exec("COMMIT");
    db.exec(durability);
  } catch (error) {
    try { db?.close(); } catch {}
    throw safeError(error);
  }
  const transaction = work => {
    if (closed) fail("JOURNAL_CLOSED");
    if (poisoned) fail("JOURNAL_UNAVAILABLE");
    try {
      const current = privatePath(filename, true, windowsAcl);
      if (!sameIdentity(current, identity)) fail("JOURNAL_FILE_CHANGED");
    } catch (error) {
      // A lost privacy/identity boundary cannot be restored on this handle by
      // changing the path back. The operator must explicitly close and reopen.
      poisoned = true;
      throw safeError(error);
    }
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = work(); db.exec("COMMIT"); return result;
    } catch (error) {
      try { if (db.isTransaction) db.exec("ROLLBACK"); } catch { poisoned = true; }
      // Unknown storage outcomes are never repaired/reset automatically.
      if (!(error instanceof JournalError) || ["JOURNAL_FILE_CHANGED", "INVALID_JOURNAL_FILE"].includes(error.code)) poisoned = true;
      throw safeError(error);
    }
  };
  const clock = () => {
    let time;
    try { time = readSynchronousClock(now); } catch { fail("JOURNAL_CLOCK_INVALID"); }
    const previous = db.prepare("SELECT last_time FROM configuration WHERE singleton=1").get().last_time;
    if (!uint(time) || time < previous) fail("JOURNAL_CLOCK_INVALID");
    db.prepare("UPDATE configuration SET last_time=? WHERE singleton=1").run(time);
    return time;
  };
  const keyOf = (agent, requestId) => {
    if (!AGENT_IDS.includes(agent) || !id(requestId)) fail("INVALID_JOURNAL_REQUEST");
    return hash(agent + "\0" + requestId);
  };
  return Object.freeze({
    reserve(input) {
      let data;
      try { data = captureDataRecord(input, ["agent", "requestId", "fingerprint"]); }
      catch { fail("INVALID_JOURNAL_REQUEST"); }
      const key = keyOf(data.agent, data.requestId);
      if (!hex(data.fingerprint)) fail("INVALID_JOURNAL_REQUEST");
      return transaction(() => {
        const time = clock();
        const prior = db.prepare("SELECT fingerprint, status FROM attempts WHERE request_key=?").get(key);
        if (prior) {
          if (prior.fingerprint !== data.fingerprint) fail("JOURNAL_REQUEST_CONFLICT");
          // Never return the original reservation credential to another caller.
          return Object.freeze({ status: "existing", outcome: prior.status, reservation: null });
        }
        const count = db.prepare("SELECT COUNT(*) AS count FROM attempts").get().count;
        if (count >= maxAttempts) fail("JOURNAL_LIMIT_REACHED");
        const reservation = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO attempts VALUES(?,?,?,?,?,?,?)").run(key, data.agent, data.fingerprint, reservation, "reserved", time, time);
        return Object.freeze({ status: "reserved", outcome: "reserved", reservation });
      });
    },
    settle(input) {
      let data;
      try { data = captureDataRecord(input, ["agent", "requestId", "reservation", "outcome"]); }
      catch { fail("INVALID_JOURNAL_REQUEST"); }
      const key = keyOf(data.agent, data.requestId);
      if (!hex(data.reservation) || !["completed", "failed"].includes(data.outcome)) fail("INVALID_JOURNAL_REQUEST");
      return transaction(() => {
        const time = clock();
        const prior = db.prepare("SELECT reservation, status FROM attempts WHERE request_key=?").get(key);
        if (!prior || prior.reservation !== data.reservation) fail("JOURNAL_RESERVATION_MISMATCH");
        if (prior.status !== "reserved" && prior.status !== data.outcome) fail("JOURNAL_OUTCOME_CONFLICT");
        if (prior.status === "reserved") db.prepare("UPDATE attempts SET status=?,updated_at=? WHERE request_key=?").run(data.outcome, time, key);
        return Object.freeze({ status: data.outcome });
      });
    },
    summary() {
      return transaction(() => {
        const counts = { reserved: 0, completed: 0, failed: 0 };
        for (const row of db.prepare("SELECT status, COUNT(*) AS count FROM attempts GROUP BY status").all()) counts[row.status] = row.count;
        const used = counts.reserved + counts.completed + counts.failed;
        return Object.freeze({ schema: "threecore-proposal-attempt-summary-v1", scope, maxAttempts,
          used, remaining: maxAttempts - used, ...counts, monetaryBudget: false });
      });
    },
    close() { if (!closed) { closed = true; db.close(); } },
  });
}
