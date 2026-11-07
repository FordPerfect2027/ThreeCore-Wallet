import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { openProposalAttemptJournal, proposalAttemptJournalSupport } from "../server/proposal-attempt-journal.mjs";

const support = proposalAttemptJournalSupport(), NOW = 1800000000000;
const moduleUrl = new URL("../server/proposal-attempt-journal.mjs", import.meta.url).href;
const request = (agent = "DAT", requestId = "request-1") => ({ agent, requestId, fingerprint: "a".repeat(64) });

// Only API metadata and refusal are simulated here. These children cannot
// inspect or create a Windows journal and are not Windows ACL evidence.
function simulatedWindows(operation, version) {
  const program = `
    import fs from "node:fs";
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    Object.defineProperty(process, "getuid", { value: undefined });
    ${version ? `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });` : ""}
    const api = await import(${JSON.stringify(moduleUrl)});
    let filesystemCalls = 0, subprocessCalls = 0;
    for (const name of ["accessSync", "existsSync", "openSync", "lstatSync", "statSync", "realpathSync", "readFileSync", "writeFileSync", "mkdirSync", "chmodSync"]) {
      fs[name] = () => { filesystemCalls++; throw Error("Unexpected fixture filesystem call"); };
    }
    for (const name of ["spawnSync", "execSync", "execFileSync", "spawn", "exec", "execFile"]) {
      cp[name] = () => { subprocessCalls++; throw Error("Unexpected fixture subprocess call"); };
    }
    syncBuiltinESMExports();
    const errorCode = fn => { try { fn(); return null; } catch (error) { return error.code ?? "UNCLASSIFIED"; } };
    const result = (() => { ${operation} })();
    console.log(JSON.stringify({ result, filesystemCalls, subprocessCalls }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(Error("Simulated platform guard timed out")); }, 10000);
    child.stdout.on("data", value => { output += value; });
    child.stderr.on("data", value => { errors += value; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      try { assert.equal(code, 0, errors); resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
}

test("simulated Windows support is explicit, metadata-only and leaves default refusal intact", async () => {
  const result = await simulatedWindows(`
    const baseline = api.proposalAttemptJournalSupport();
    const disabled = api.proposalAttemptJournalSupport({ windowsAcl: false });
    const enabled = api.proposalAttemptJournalSupport({ windowsAcl: true });
    return { baseline, disabled, enabled,
      frozen: [baseline, disabled, enabled].every(Object.isFrozen),
      refused: errorCode(() => api.openProposalAttemptJournal()) };
  `);
  assert.equal(result.filesystemCalls, 0); assert.equal(result.subprocessCalls, 0);
  const { baseline, disabled, enabled, frozen, refused } = result.result;
  assert.equal(baseline.platformVerified, false); assert.equal(baseline.supported, false);
  assert.deepEqual(disabled, baseline);
  assert.equal(enabled.platformVerified, true);
  assert.equal(enabled.runtimeAvailable, baseline.runtimeAvailable);
  assert.equal(enabled.supported, baseline.runtimeAvailable);
  assert.equal(frozen, true);
  assert.equal(refused, baseline.runtimeAvailable ? "JOURNAL_PLATFORM_UNVERIFIED" : "JOURNAL_RUNTIME_UNAVAILABLE");
});

test("non-boolean Windows opt-ins are refused before filesystem or subprocess access", async () => {
  const result = await simulatedWindows(`
    const runtimeAvailable = api.proposalAttemptJournalSupport().runtimeAvailable;
    return { runtimeAvailable, errors: ["true", 1, {}, null].map(windowsAcl => ({
      support: errorCode(() => api.proposalAttemptJournalSupport({ windowsAcl })),
      open: errorCode(() => api.openProposalAttemptJournal({ windowsAcl,
        filename: "C:/synthetic-policy-only/attempts.sqlite", scope: "synthetic-policy", create: true }))
    })) };
  `);
  assert.equal(result.filesystemCalls, 0); assert.equal(result.subprocessCalls, 0);
  for (const entry of result.result.errors) {
    assert.equal(entry.support, "INVALID_JOURNAL_CONFIG");
    assert.equal(entry.open, result.result.runtimeAvailable ? "INVALID_JOURNAL_CONFIG" : "JOURNAL_RUNTIME_UNAVAILABLE");
  }
});

test("simulated older runtimes reject before Windows opt-in validation or path access", async () => {
  for (const version of ["22.0.0", "24.14.0"]) {
    const result = await simulatedWindows(`
      return { enabled: api.proposalAttemptJournalSupport({ windowsAcl: true }),
        refused: [true, "true"].map(windowsAcl => errorCode(() =>
          api.openProposalAttemptJournal({ windowsAcl, create: true }))) };
    `, version);
    assert.equal(result.filesystemCalls, 0); assert.equal(result.subprocessCalls, 0);
    assert.equal(result.result.enabled.runtimeAvailable, false);
    assert.equal(result.result.enabled.supported, false);
    assert.deepEqual(result.result.refused, ["JOURNAL_RUNTIME_UNAVAILABLE", "JOURNAL_RUNTIME_UNAVAILABLE"]);
  }
});

test("POSIX directory privacy loss poisons every transaction entrypoint even after restoration", {
  skip: !support.supported || typeof process.getuid !== "function" ? "Requires the default verified POSIX journal" : false,
}, t => {
  for (const windowsAcl of [false, true]) for (const operation of ["reserve", "settle", "summary"]) {
    const directory = mkdtempSync(join(tmpdir(), "threecore-policy-lifetime-"));
    const filename = join(directory, "attempts.sqlite"), journals = [];
    t.after(() => { chmodSync(directory, 0o700); for (const journal of journals) journal.close(); rmSync(directory, { recursive: true, force: true }); });
    const config = { filename, scope: "synthetic-policy", maxAttempts: 3, windowsAcl, now: () => NOW };
    const journal = openProposalAttemptJournal({ ...config, create: true }); journals.push(journal);
    const claim = journal.reserve(request()), before = readFileSync(filename);
    const next = () => operation === "reserve" ? journal.reserve(request("EMA")) : operation === "settle"
      ? journal.settle({ agent: "DAT", requestId: "request-1", reservation: claim.reservation, outcome: "completed" })
      : journal.summary();
    chmodSync(directory, 0o755);
    assert.throws(next, { code: "JOURNAL_DIRECTORY_NOT_PRIVATE" }, operation);
    assert.deepEqual(readFileSync(filename), before, "privacy failure must precede the transaction");
    chmodSync(directory, 0o700);
    assert.throws(() => journal.summary(), { code: "JOURNAL_UNAVAILABLE" }, operation);
    assert.throws(() => journal.reserve(request("EMA")), { code: "JOURNAL_UNAVAILABLE" }, operation);
    assert.deepEqual(readFileSync(filename), before, "restoring permissions cannot revive the handle");
    journal.close();
    const reopened = openProposalAttemptJournal(config); journals.push(reopened);
    assert.equal(reopened.summary().used, 1);
    assert.equal(reopened.summary().reserved, 1);
    assert.deepEqual(reopened.reserve(request()), { status: "existing", outcome: "reserved", reservation: null });
  }
});
