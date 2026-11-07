import nodeTest from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProposalAttemptJournal, proposalAttemptJournalSupport } from "../server/proposal-attempt-journal.mjs";

const support = proposalAttemptJournalSupport();
const test = (name, fn) => nodeTest(name, {
  skip: !support.supported && "Optional journal needs Node >=24.15 and verified POSIX privacy",
}, fn);
const { DatabaseSync } = support.supported ? await import("node:sqlite") : {};
const NOW = 1800000000000;

// Frozen version-one format emitted by the preceding adapter. Keep independent
// of the implementation so opening an already-created journal is a real control.
const LEGACY_CONFIGURATION = `CREATE TABLE configuration (singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  version INTEGER NOT NULL CHECK(version=1), scope TEXT NOT NULL,
  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 1000),
  last_time INTEGER NOT NULL CHECK(last_time>=0)) STRICT`;
const LEGACY_ATTEMPTS = `CREATE TABLE attempts (request_key TEXT PRIMARY KEY, agent TEXT NOT NULL CHECK(agent IN ('DAT','EMA','CAWELON')),
  fingerprint TEXT NOT NULL, reservation TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('reserved','completed','failed')),
  created_at INTEGER NOT NULL CHECK(created_at>=0), updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)) STRICT`;
const hash = value => createHash("sha256").update(value).digest("hex");
const agents = ["DAT", "EMA", "CAWELON"];
const outcomes = ["reserved", "completed", "failed"];
const fingerprint = agent => String(agents.indexOf(agent) + 1).repeat(64);
const reservation = agent => String(agents.indexOf(agent) + 4).repeat(64);
const request = agent => ({ agent, requestId: "shared-request", fingerprint: fingerprint(agent) });

function fixture(t, { configuration = LEGACY_CONFIGURATION, attempts = LEGACY_ATTEMPTS, mode = "WAL", afterSetup = "" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "threecore-journal-schema-"));
  const filename = join(directory, "attempts.sqlite");
  writeFileSync(filename, "", { mode: 0o600 });
  const database = new DatabaseSync(filename);
  try {
    database.exec(`PRAGMA journal_mode=${mode}; ${configuration}; ${attempts};`);
    database.prepare("INSERT INTO configuration(singleton,version,scope,max_attempts,last_time) VALUES(1,1,?,3,?)")
      .run("legacy-schema", NOW);
    const insert = database.prepare("INSERT INTO attempts(request_key,agent,fingerprint,reservation,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)");
    agents.forEach((agent, index) => insert.run(hash(agent + "\0shared-request"), agent, fingerprint(agent),
      reservation(agent), outcomes[index], NOW, NOW));
    if (afterSetup) database.exec(afterSetup);
  } finally { database.close(); }
  const journals = [];
  t.after(() => { for (const journal of journals) journal.close(); rmSync(directory, { recursive: true, force: true }); });
  return { filename, open() {
    const journal = openProposalAttemptJournal({ filename, scope: "legacy-schema", maxAttempts: 3, now: () => NOW });
    journals.push(journal); return journal;
  } };
}

for (const [name, change] of [
  ["lookalike non-STRICT tables without constraints", {
    configuration: "CREATE TABLE configuration(singleton INTEGER,version INTEGER,scope TEXT,max_attempts INTEGER,last_time INTEGER)",
    attempts: "CREATE TABLE attempts(request_key TEXT,agent TEXT,fingerprint TEXT,reservation TEXT,status TEXT,created_at INTEGER,updated_at INTEGER)",
  }],
  ["missing request-key uniqueness", { attempts: LEGACY_ATTEMPTS.replace("request_key TEXT PRIMARY KEY", "request_key TEXT") }],
  ["changed outcome constraint", { attempts: LEGACY_ATTEMPTS.replace("('reserved','completed','failed')", "('reserved','completed','failed','discarded')") }],
  ["extra configuration column", { configuration: LEGACY_CONFIGURATION.replace("last_time>=0)) STRICT", "last_time>=0), operator_note TEXT) STRICT") }],
  ["reordered request-key and fingerprint columns", { attempts: LEGACY_ATTEMPTS
    .replace("request_key TEXT PRIMARY KEY, agent", "fingerprint TEXT NOT NULL, agent")
    .replace("\n  fingerprint TEXT NOT NULL, reservation", "\n  request_key TEXT PRIMARY KEY, reservation") }],
  ["non-internal sqliteX trigger", {
    afterSetup: "CREATE TRIGGER sqliteXforget AFTER INSERT ON attempts BEGIN DELETE FROM attempts WHERE request_key=NEW.request_key; END;",
  }],
]) {
  test(`reopening ${name} rejects the file without changing its bytes or WAL mode`, t => {
    const f = fixture(t, change), before = readFileSync(f.filename);
    let journal, errorCode = null;
    try { journal = f.open(); } catch (error) { errorCode = error.code; } finally { journal?.close(); }
    const bytesPreserved = readFileSync(f.filename).equals(before);
    const inspection = new DatabaseSync(f.filename);
    let journalMode;
    try { journalMode = inspection.prepare("PRAGMA journal_mode").get().journal_mode; } finally { inspection.close(); }
    assert.deepEqual({ errorCode, bytesPreserved, journalMode }, {
      errorCode: "INVALID_JOURNAL_SCHEMA", bytesPreserved: true, journalMode: "wal",
    });
  });
}

test("preceding version-one journals preserve all three agents' claims and outcomes on recovery", t => {
  const f = fixture(t, { mode: "DELETE" }), before = readFileSync(f.filename), journal = f.open();
  assert.deepEqual(readFileSync(f.filename), before);
  agents.forEach((agent, index) => assert.deepEqual(journal.reserve(request(agent)), {
    status: "existing", outcome: outcomes[index], reservation: null,
  }));
  assert.deepEqual(journal.summary(), { schema: "threecore-proposal-attempt-summary-v1", scope: "legacy-schema",
    maxAttempts: 3, used: 3, remaining: 0, reserved: 1, completed: 1, failed: 1, monetaryBudget: false });
  assert.throws(() => journal.reserve({ ...request("DAT"), requestId: "new-request" }), { code: "JOURNAL_LIMIT_REACHED" });
  assert.throws(() => journal.settle({ agent: "EMA", requestId: "shared-request", reservation: reservation("DAT"), outcome: "completed" }),
    { code: "JOURNAL_RESERVATION_MISMATCH" });
  journal.close();
  const reopened = f.open();
  assert.equal(reopened.reserve(request("DAT")).outcome, "reserved");
  assert.equal(reopened.summary().used, 3);
});
