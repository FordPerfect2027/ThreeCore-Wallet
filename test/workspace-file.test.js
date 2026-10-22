import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { prepareWorkspaceFile, decodeWorkspaceFile, createWorkspaceFileReader,
  createWorkspaceBackupTracker, WORKSPACE_FILE_LIMIT } from "../src/workspace-file.js";
import { encodeWorkspace } from "../src/workspace-format.js";
import { bundle, fileObject, clone, gate, tick, CONTRACTS } from "./helpers/workspace-fixtures.js";

const bytes = text => new TextEncoder().encode(text);
const prepared = await prepareWorkspaceFile(bundle());

test("workspace backup file contains a SHA-256 of canonical data", async () => {
  const file = JSON.parse(prepared.text);
  const expected = createHash("sha256").update(encodeWorkspace(bundle())).digest("hex");
  assert.equal(file.digest, expected);
  assert.equal(file.algorithm, "SHA-256");
  assert.equal(prepared.byteLength, bytes(prepared.text).length);
  assert.equal(prepared.filename, "ThreeCore-workspace-backup.json");
  assert.match(prepared.mimeType, /^application\/json/);
});

test("workspace file round trip restores data without claiming authenticity", async () => {
  const result = await decodeWorkspaceFile(bytes(prepared.text));
  assert.equal(result.text, encodeWorkspace(bundle()));
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
  assert.ok(Object.isFrozen(result.workspace.entries));
});

test("workspace file checksum is independent of JSON whitespace and key order", async () => {
  const file = JSON.parse(prepared.text);
  const reordered = { workspace: file.workspace, digest: file.digest, algorithm: file.algorithm, schema: file.schema };
  const result = await decodeWorkspaceFile(bytes(JSON.stringify(reordered)));
  assert.equal(result.digest, prepared.digest);
});

test("workspace file accepts UTF-8 BOM while retaining canonical digest", async () => {
  const result = await decodeWorkspaceFile(bytes("\ufeff" + prepared.text));
  assert.equal(result.digest, prepared.digest);
});

test("workspace file rejects a modified balance even when structure is valid", async () => {
  const file = JSON.parse(prepared.text);
  file.workspace.entries[0].history.reports[0].snapshot.nativeBalanceBaseUnits = "999";
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_CHECKSUM" });
});

test("workspace file rejects reassigned account under the old checksum", async () => {
  const file = JSON.parse(prepared.text);
  file.workspace.entries[0].account = "0x" + "99".repeat(20);
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_CHECKSUM" });
});

test("workspace file rejects removed observations under the old checksum", async () => {
  const file = JSON.parse(prepared.text);
  file.workspace.entries[2].history.reports = [];
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_CHECKSUM" });
});

for (const changes of [
  { schema: "workspace-v2" },
  { algorithm: "MD5" },
  { algorithm: "sha-256" },
  { digest: "0".repeat(63) },
  { digest: "G".repeat(64) },
  { digest: 123 },
]) {
  test("workspace file rejects invalid envelope " + JSON.stringify(changes), async () => {
    const file = { ...JSON.parse(prepared.text), ...changes };
    await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_FILE_SCHEMA" });
  });
}

test("workspace file will not accept extra fields or signing instructions", async () => {
  const file = JSON.parse(prepared.text);
  file.instructions = "connect and sign";
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_SHAPE" });
});

test("workspace file refuses a raw settings file instead of silently misreading it", async () => {
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(bundle()))), { code: "WORKSPACE_SHAPE" });
});

test("workspace file validates observations before checking integrity", async () => {
  const file = JSON.parse(prepared.text);
  file.workspace.entries[0].history.reports[0].snapshot.readOnly = false;
  await assert.rejects(decodeWorkspaceFile(bytes(JSON.stringify(file))), { code: "WORKSPACE_HISTORY" });
});

for (const value of [null, "data", [], new Uint8Array(), new Uint8Array(WORKSPACE_FILE_LIMIT + 1)]) {
  test("workspace file rejects empty invalid or oversized byte buffers " + typeof value + "/" + (value?.length ?? 0), async () => {
    await assert.rejects(decodeWorkspaceFile(value), { code: "WORKSPACE_FILE_SIZE" });
  });
}

test("workspace file refuses malformed UTF-8 without replacement characters", async () => {
  await assert.rejects(decodeWorkspaceFile(new Uint8Array([0xc3, 0x28])), { code: "WORKSPACE_FILE_ENCODING" });
});

test("workspace file refuses incomplete JSON", async () => {
  await assert.rejects(decodeWorkspaceFile(bytes('{"schema":')), { code: "WORKSPACE_FILE_JSON" });
});

test("workspace file refuses a checksum service that fails or returns wrong width", async () => {
  await assert.rejects(prepareWorkspaceFile(bundle(), { subtle: null }), { code: "WORKSPACE_CRYPTO" });
  await assert.rejects(prepareWorkspaceFile(bundle(), { subtle: { digest: async () => { throw Error("disabled"); } } }),
    { code: "WORKSPACE_CRYPTO" });
  await assert.rejects(prepareWorkspaceFile(bundle(), { subtle: { digest: async () => new ArrayBuffer(31) } }),
    { code: "WORKSPACE_CRYPTO" });
});

test("workspace reader publishes reading then ready without applying state", async () => {
  const states = [];
  const reader = createWorkspaceFileReader({ onChange: state => states.push(state) });
  assert.equal(await reader.load(fileObject(prepared.text)), true);
  assert.deepEqual(states.map(state => state.phase), ["reading", "ready"]);
  assert.equal(reader.state().result.digest, prepared.digest);
});

for (const name of ["backup.txt", "../backup.json", "C:\\backup.json", "a/b.json", "backup\u0000.json", "a".repeat(241) + ".json"]) {
  test("workspace reader rejects unsafe filename " + JSON.stringify(name), async () => {
    let reads = 0;
    const reader = createWorkspaceFileReader({ readBytes: async () => { reads++; return bytes(prepared.text); } });
    assert.equal(await reader.load(fileObject(prepared.text, { name })), false);
    assert.equal(reader.state().errorCode, "WORKSPACE_FILENAME");
    assert.equal(reads, 0);
  });
}

test("workspace reader accepts uppercase JSON extension and Unicode names", async () => {
  const reader = createWorkspaceFileReader();
  assert.equal(await reader.load(fileObject(prepared.text, { name: "保存した３ウォレット.JSON" })), true);
});

for (const size of [0, -1, 1.5, "100", Infinity, WORKSPACE_FILE_LIMIT + 1]) {
  test("workspace reader rejects invalid declared size " + size, async () => {
    let reads = 0;
    const reader = createWorkspaceFileReader({ readBytes: async () => { reads++; } });
    assert.equal(await reader.load(fileObject(prepared.text, { size })), false);
    assert.equal(reader.state().errorCode, "WORKSPACE_FILE_SIZE");
    assert.equal(reads, 0);
  });
}

test("workspace reader rejects actual bytes inconsistent with declared size", async () => {
  const reader = createWorkspaceFileReader({ readBytes: async () => bytes(prepared.text + " ") });
  assert.equal(await reader.load(fileObject(prepared.text)), false);
  assert.equal(reader.state().errorCode, "WORKSPACE_FILE_SIZE");
});

test("workspace reader reports IO failures without exposing their raw message", async () => {
  const reader = createWorkspaceFileReader({ readBytes: async () => { throw Error("C:/secret/private path"); } });
  assert.equal(await reader.load(fileObject(prepared.text)), false);
  assert.equal(reader.state().errorCode, "WORKSPACE_FILE_READ");
  assert.equal(JSON.stringify(reader.state()).includes("secret"), false);
});

test("workspace reader cancellation prevents a late read from filling the import field", async () => {
  const pending = gate();
  const reader = createWorkspaceFileReader({ readBytes: () => pending.promise });
  const result = reader.load(fileObject(prepared.text));
  reader.cancel();
  pending.resolve(bytes(prepared.text));
  assert.equal(await result, false);
  assert.equal(reader.state().phase, "cancelled");
  assert.equal(reader.state().result, null);
});

test("workspace reader cancellation also covers the checksum computation", async () => {
  const pending = gate();
  let hashing = false;
  const reader = createWorkspaceFileReader({ subtle: { digest(...args) {
    hashing = true;
    return pending.promise.then(() => webcrypto.subtle.digest(...args));
  } } });
  const result = reader.load(fileObject(prepared.text));
  await tick();
  assert.equal(hashing, true);
  reader.cancel();
  pending.resolve();
  assert.equal(await result, false);
  assert.equal(reader.state().phase, "cancelled");
});

test("workspace reader newer selection wins even if the older one completes last", async () => {
  const old = gate();
  const newer = await prepareWorkspaceFile(bundle({ block: "99" }));
  let reads = 0;
  const reader = createWorkspaceFileReader({ readBytes: () => ++reads === 1 ? old.promise : bytes(newer.text) });
  const first = reader.load(fileObject(prepared.text));
  assert.equal(await reader.load(fileObject(newer.text)), true);
  old.resolve(bytes(prepared.text));
  assert.equal(await first, false);
  assert.equal(reader.state().result.workspace.entries[0].history.reports[0].snapshot.blockNumber, "99");
});

test("workspace reader stale errors cannot overwrite a successful new selection", async () => {
  const old = gate();
  let reads = 0;
  const reader = createWorkspaceFileReader({ readBytes: () => ++reads === 1 ? old.promise : bytes(prepared.text) });
  const first = reader.load(fileObject(prepared.text));
  await reader.load(fileObject(prepared.text));
  old.reject(Error("old failure"));
  assert.equal(await first, false);
  assert.equal(reader.state().phase, "ready");
});

test("workspace reader disposal prevents notifications and new reads", async () => {
  const old = gate();
  const states = [];
  const reader = createWorkspaceFileReader({ readBytes: () => old.promise, onChange: state => states.push(state.phase) });
  const first = reader.load(fileObject(prepared.text));
  reader.dispose();
  old.resolve(bytes(prepared.text));
  assert.equal(await first, false);
  assert.equal(await reader.load(fileObject(prepared.text)), false);
  assert.deepEqual(states, ["reading"]);
  assert.equal(reader.state().phase, "disposed");
});

test("workspace reader cancellation from a reading callback avoids opening the file", async () => {
  let reads = 0;
  const reader = createWorkspaceFileReader({
    readBytes: () => { reads++; },
    onChange: state => { if (state.phase === "reading") reader.cancel(); },
  });
  assert.equal(await reader.load(fileObject(prepared.text)), false);
  assert.equal(reads, 0);
});

test("workspace backup tracker never claims browser initiation proves disk persistence", () => {
  const tracker = createWorkspaceBackupTracker();
  assert.equal(tracker.status(bundle()).phase, "not-offered");
  tracker.offered(bundle());
  assert.deepEqual(tracker.status(bundle()), { phase: "current-offered", diskSaved: false });
});

test("workspace backup tracker marks settings and history edits as needing a new save", () => {
  const tracker = createWorkspaceBackupTracker();
  tracker.offered(bundle());
  const changed = bundle();
  changed.entries[0].tokens = CONTRACTS;
  assert.equal(tracker.status(changed).phase, "changed");
  assert.equal(tracker.status(bundle({ block: "99" })).phase, "changed");
  assert.equal(tracker.status({ bad: true }).phase, "changed");
});

test("workspace backup tracker uses detached data and can be cleared", () => {
  const tracker = createWorkspaceBackupTracker();
  const original = bundle();
  tracker.offered(original);
  original.entries[0].tokens = [];
  assert.equal(tracker.status(bundle()).phase, "current-offered");
  tracker.clear();
  assert.equal(tracker.status(bundle()).phase, "not-offered");
});
