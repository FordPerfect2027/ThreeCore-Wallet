import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Algorithm evidence only: these children simulate every Windows filesystem
// and helper result. They never run PowerShell and are not native ACL evidence.
// The test-only URL override allows a preserved runtime preimage to be checked
// without modifying the production module or adding production test hooks.
const moduleUrl = process.env.THREECORE_WINDOWS_PRIVACY_TEST_MODULE ??
  new URL("../server/proposal-windows-journal-privacy.mjs", import.meta.url).href;
const MAIN = "9007199254740992", PARENT = "9007199254740994", AUX = "9007199254740996";
const frame = (changes = {}) => ({ main: MAIN, parent: PARENT, auxiliary: null, ...changes });
const present = (changes = {}) => frame({ auxiliary: AUX, ...changes });
const accepted = presentMask => ({ status: 0, stdout: JSON.stringify({ version: 1, ok: true, presentMask }), stderr: "" });
const refused = code => ({ status: 2, stdout: JSON.stringify({ version: 1, ok: false, code }), stderr: "" });

function simulate(scenario) {
  const program = `
    import fs from "node:fs";
    import cp from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    Object.defineProperty(process, "platform", { value: "win32" });
    Object.defineProperty(process, "arch", { value: "x64" });
    process.env.SystemRoot = "C:\\\\Windows";
    const api = await import(${JSON.stringify(moduleUrl)});
    const scenario = ${JSON.stringify(scenario)};
    const filename = "C:\\\\fixture\\\\attempts.sqlite", directory = "C:\\\\fixture";
    const executable = "C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe";
    let snapshots = 0, inspections = 0, current;
    const unexpected = [];
    const forbid = description => { unexpected.push(description); throw Error(description); };
    const stat = (kind, ino, options = {}) => ({
      dev: BigInt(options.dev ?? 1), ino: BigInt(ino), nlink: BigInt(options.links ?? 1), size: BigInt(options.size ?? 4096),
      isDirectory: () => kind === "directory", isFile: () => kind === "file",
      isSymbolicLink: () => Boolean(options.symlink),
    });
    fs.lstatSync = (pathname, options) => {
      if (pathname === directory) {
        if (!options?.bigint) return forbid("Expected exact directory identity");
        current = scenario.snapshots[snapshots++];
        if (!current) return forbid("Unexpected additional filesystem snapshot");
        return stat("directory", current.parent, { dev: current.dev, size: current.parentSize });
      }
      if (pathname === process.env.SystemRoot) return stat("directory", "31");
      if (pathname === executable) return stat("file", "32");
      const suffixes = ["", "-journal", "-wal", "-shm"];
      const index = suffixes.findIndex(suffix => pathname === filename + suffix);
      if (index < 0 || !current || !options?.bigint) return forbid("Unexpected file inspection");
      const ino = index === 0 ? current.main : index === 1 ? current.auxiliary : null;
      if (ino === null) { const error = Error("Simulated missing file"); error.code = "ENOENT"; throw error; }
      return stat("file", ino, { dev: current.dev, ...(index === 1
        ? { links: current.auxiliaryLinks, symlink: current.auxiliarySymlink, size: current.auxiliarySize }
        : { size: current.mainSize }) });
    };
    const nativePath = pathname => pathname;
    nativePath.native = nativePath;
    fs.realpathSync = nativePath;
    for (const name of ["openSync", "writeFileSync", "appendFileSync", "mkdirSync", "chmodSync", "unlinkSync", "renameSync", "rmSync"]) {
      fs[name] = () => forbid("Unexpected filesystem mutation: " + name);
    }
    cp.spawnSync = (pathname, args, options) => {
      inspections++;
      if (pathname !== executable || options?.input !== filename || options.shell !== false ||
          options.timeout !== 5000 || options.maxBuffer !== 4096) return forbid("Unexpected helper invocation");
      const result = scenario.helpers[inspections - 1];
      if (!result) return forbid("Unexpected additional helper inspection");
      return result;
    };
    for (const name of ["execSync", "execFileSync", "spawn", "exec", "execFile"]) {
      cp[name] = () => forbid("Unexpected subprocess: " + name);
    }
    syncBuiltinESMExports();
    let result;
    try {
      const identity = api.verifyWindowsJournalPrivacy(filename, scenario.requireFile ?? true);
      result = { ok: true, identity, frozen: Object.isFrozen(identity) };
    } catch (error) {
      result = { ok: false, code: api.windowsJournalPrivacyErrorCode(error) ?? error.code ?? "UNCLASSIFIED" };
    }
    console.log(JSON.stringify({ ...result, snapshots, inspections, unexpected }, (_, value) =>
      typeof value === "bigint" ? value.toString() : value));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", program], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(Error("Simulated reinspection timed out")); }, 10000);
    child.stdout.on("data", value => { output += value; });
    child.stderr.on("data", value => { errors += value; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, errors);
        const result = JSON.parse(output);
        assert.deepEqual(result.unexpected, [], "The simulation must not fall through to unplanned operations");
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

function assertAccepted(result, inspections, snapshots, identity = { dev: "1", ino: MAIN, directoryDev: "1", directoryIno: PARENT }) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.inspections, inspections); assert.equal(result.snapshots, snapshots);
  assert.equal(result.frozen, true);
  assert.deepEqual(result.identity, identity);
}
function assertRefused(result, code, inspections, snapshots) {
  assert.equal(result.ok, false); assert.equal(result.code, code);
  assert.equal(result.inspections, inspections); assert.equal(result.snapshots, snapshots);
}

test("SIMULATED stable journal privacy needs one helper inspection", async () => {
  assertAccepted(await simulate({ snapshots: [frame(), frame()], helpers: [accepted(1)] }), 1, 2);
});

test("SIMULATED auxiliary changes leave only positively checked survivors", async () => {
  const replacement = present({ auxiliary: "9007199254740997" });
  for (const [scenario, inspections, snapshots] of [
    [{ snapshots: [frame(), present(), present(), present()], helpers: [accepted(1), accepted(3)] }, 2, 4],
    [{ snapshots: [present(), frame()], helpers: [accepted(3)] }, 1, 2],
    [{ snapshots: [present(), replacement, replacement, replacement], helpers: [accepted(3), accepted(3)] }, 2, 4],
    [{ snapshots: [frame(), frame()], helpers: [accepted(3)] }, 1, 2],
  ]) assertAccepted(await simulate(scenario), inspections, snapshots);
});

test("SIMULATED exact NEC rollback appearance then disappearance is accepted", async () => {
  // Replay the reserve-phase ordering and stat values captured in
  // nec/native-real-call-trace-result.json for win-race-request-0: S5 absent,
  // I0 mask1, S6/S7 same rollback file, I1 mask1, S8 definite ENOENT.
  const observed = { dev: "3203948722", main: "4503599629324756", parent: "1407374885937425",
    mainSize: 20480, parentSize: 0, auxiliarySize: 21032 };
  const absent = frame(observed), rollback = present({ ...observed, auxiliary: "5066549583175952" });
  assertAccepted(await simulate({ snapshots: [absent, rollback, rollback, absent], helpers: [accepted(1), accepted(1)] }),
    2, 4, { dev: observed.dev, ino: observed.main, directoryDev: observed.dev, directoryIno: observed.parent });
});

test("SIMULATED main or parent changes are terminal on the first inspection", async () => {
  for (const changed of [frame({ main: "9007199254740993" }), frame({ parent: "9007199254740995" })]) {
    assertRefused(await simulate({ snapshots: [frame(), changed], helpers: [accepted(1)] }), "JOURNAL_FILE_CHANGED", 1, 2);
  }
  assertRefused(await simulate({ snapshots: [frame()], helpers: [accepted(0)] }), "JOURNAL_FILE_CHANGED", 1, 1);
  assertRefused(await simulate({ snapshots: [frame({ main: null })], helpers: [accepted(1)], requireFile: false }), "JOURNAL_FILE_CHANGED", 1, 1);
});

test("SIMULATED reinspection never resets the original main and parent identity", async () => {
  for (const changed of [present({ main: "9007199254740993" }), present({ parent: "9007199254740995" })]) {
    assertRefused(await simulate({ snapshots: [frame(), present(), changed], helpers: [accepted(1)] }), "JOURNAL_FILE_CHANGED", 1, 3);
    assertRefused(await simulate({ snapshots: [frame(), present(), present(), changed], helpers: [accepted(1), accepted(3)] }), "JOURNAL_FILE_CHANGED", 2, 4);
  }
  assertRefused(await simulate({ snapshots: [frame(), present(), present()], helpers: [accepted(1), accepted(2)] }), "JOURNAL_FILE_CHANGED", 2, 3);
});

test("SIMULATED repeated surviving auxiliary replacement refuses after two inspections", async () => {
  const replacement = present({ auxiliary: "9007199254740997" });
  assertRefused(await simulate({ snapshots: [frame(), present(), present(), replacement], helpers: [accepted(1), accepted(3)] }), "JOURNAL_FILE_CHANGED", 2, 4);
});

test("SIMULATED surviving auxiliary without positive helper verification is refused", async () => {
  assertRefused(await simulate({ snapshots: [present(), present(), present(), present()], helpers: [accepted(1), accepted(1)] }), "JOURNAL_FILE_CHANGED", 2, 4);
});

test("SIMULATED helper ACL and transport failures are never retried", async () => {
  const failures = [
    [refused("JOURNAL_DIRECTORY_NOT_PRIVATE"), "JOURNAL_DIRECTORY_NOT_PRIVATE"],
    [refused("INVALID_JOURNAL_FILE"), "INVALID_JOURNAL_FILE"],
    [{ status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } }, "JOURNAL_UNAVAILABLE"],
    [{ status: 0, stdout: "unexpected helper output", stderr: "" }, "JOURNAL_UNAVAILABLE"],
  ];
  for (const [failure, code] of failures) {
    assertRefused(await simulate({ snapshots: [frame()], helpers: [failure] }), code, 1, 1);
    assertRefused(await simulate({ snapshots: [frame(), present(), present()], helpers: [accepted(1), failure] }), code, 2, 3);
  }
});

test("SIMULATED later auxiliary disappearance cannot forgive an ACL failure", async () => {
  // The supplied final absence must never be read after the helper has refused.
  assertRefused(await simulate({ snapshots: [present(), frame()], helpers: [refused("INVALID_JOURNAL_FILE")] }), "INVALID_JOURNAL_FILE", 1, 1);
  assertRefused(await simulate({ snapshots: [frame(), present(), present(), frame()], helpers: [accepted(1), refused("INVALID_JOURNAL_FILE")] }), "INVALID_JOURNAL_FILE", 2, 3);
});

test("SIMULATED unsafe auxiliary files are never treated as retryable churn", async () => {
  for (const unsafe of [present({ auxiliaryLinks: 2 }), present({ auxiliarySymlink: true })]) {
    assertRefused(await simulate({ snapshots: [unsafe], helpers: [] }), "INVALID_JOURNAL_FILE", 0, 1);
    assertRefused(await simulate({ snapshots: [frame(), unsafe], helpers: [accepted(1)] }), "INVALID_JOURNAL_FILE", 1, 2);
    assertRefused(await simulate({ snapshots: [frame(), present(), unsafe], helpers: [accepted(1)] }), "INVALID_JOURNAL_FILE", 1, 3);
    assertRefused(await simulate({ snapshots: [frame(), present(), present(), unsafe], helpers: [accepted(1), accepted(3)] }), "INVALID_JOURNAL_FILE", 2, 4);
  }
});
