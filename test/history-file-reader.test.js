import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { HISTORY_FILE_LIMIT } from "../src/history-file.js";
import { archive, observation, file, bytes, deferred } from "./helpers/history-fixtures.js";

function fixture(readBytes = async () => bytes()) {
  const events = [];
  const reader = createHistoryFileReader({ agent: "DAT", readBytes, onChange: event => events.push(event) });
  return { reader, events };
}

test("initial file reader does not run injected IO", () => {
  let calls = 0;
  const { reader } = fixture(() => { calls++; });
  assert.equal(reader.state().phase, "idle");
  assert.equal(calls, 0);
});

test("valid file becomes a historical candidate without applying it", async () => {
  const { reader, events } = fixture();
  const result = await reader.load(file());
  assert.equal(result.phase, "ready");
  assert.equal(result.result.observationCount, 1);
  assert.equal(result.result.canAuthorizeConnection, false);
  assert.equal(result.result.canAuthorizeTransaction, false);
  assert.deepEqual(events.map(event => event.phase), ["reading", "ready"]);
  assert.ok(Object.isFrozen(result));
});

for (const changes of [
  { name: "history.txt" },
  { name: "history.json.exe" },
  { name: "" },
  { name: "history\n.json" },
  { name: "x".repeat(256) + ".json" },
  { name: null },
]) {
  test("file metadata name rejected before read " + JSON.stringify(changes), async () => {
    let calls = 0;
    const { reader } = fixture(async () => { calls++; return bytes(); });
    const result = await reader.load(file(archive(), changes));
    assert.equal(result.phase, "error");
    assert.equal(result.errorCode, "FILE_NAME");
    assert.equal(calls, 0);
  });
}

for (const name of ["history.JSON", "ThreeCore-DAT.json", "履歴.json", "backup.v2.json"]) {
  test("valid JSON filename " + name, async () => {
    const { reader } = fixture();
    assert.equal((await reader.load(file(archive(), { name }))).phase, "ready");
  });
}

for (const size of [0, -1, 1.5, NaN, Infinity, "100", null, HISTORY_FILE_LIMIT + 1]) {
  test("invalid file size rejected before read " + String(size), async () => {
    let calls = 0;
    const { reader } = fixture(() => { calls++; });
    const result = await reader.load(file(archive(), { size }));
    assert.equal(result.errorCode, "FILE_SIZE");
    assert.equal(calls, 0);
  });
}

test("byte count must equal the selected file's declared size", async () => {
  const { reader } = fixture();
  const result = await reader.load(file(archive(), { size: 1 }));
  assert.equal(result.errorCode, "FILE_SIZE");
  assert.equal(result.result, null);
});

for (const result of [null, [], "text", new ArrayBuffer(4)]) {
  test("reader result must be bytes " + Object.prototype.toString.call(result), async () => {
    const { reader } = fixture(async () => result);
    assert.equal((await reader.load(file())).errorCode, "FILE_SIZE");
  });
}

test("malformed UTF-8 produces a specific encoding error", async () => {
  const { reader } = fixture(async () => new Uint8Array([0xff]));
  const result = await reader.load(file(archive(), { size: 1 }));
  assert.equal(result.errorCode, "FILE_ENCODING");
});

test("different agent produces a specific mismatch without returning content", async () => {
  const text = archive([observation("42", { agent: "EMA" })]);
  const { reader } = fixture(async () => bytes(text));
  const result = await reader.load(file(text));
  assert.equal(result.errorCode, "AGENT_MISMATCH");
  assert.equal(result.result, null);
});

test("malformed JSON produces finite safe error code", async () => {
  const { reader } = fixture(async () => bytes("<img>"));
  const result = await reader.load(file("<img>"));
  assert.equal(result.errorCode, "INVALID_FILE");
  assert.equal(result.result, null);
});

test("reader IO rejection does not expose arbitrary error messages", async () => {
  const { reader } = fixture(async () => { throw Error("PRIVATE_PATH_AND_TOKEN"); });
  const result = await reader.load(file());
  assert.equal(result.errorCode, "INVALID_FILE");
  assert.equal(JSON.stringify(result).includes("PRIVATE_PATH"), false);
});

test("new selection wins when older file finishes late", async () => {
  const first = deferred();
  const secondText = archive([observation("99")]);
  const { reader } = fixture(selected => selected.name === "first.json" ? first.promise : Promise.resolve(bytes(secondText)));
  const old = reader.load(file(archive(), { name: "first.json" }));
  await reader.load(file(secondText, { name: "second.json" }));
  first.resolve(bytes());
  await old;
  assert.equal(JSON.parse(reader.state().result.text).reports[0].snapshot.blockNumber, "99");
});

test("older rejection cannot overwrite the newer ready file", async () => {
  const first = deferred();
  const { reader } = fixture(selected => selected.name === "first.json" ? first.promise : Promise.resolve(bytes()));
  const old = reader.load(file(archive(), { name: "first.json" }));
  await reader.load(file());
  first.reject(Error("late rejection"));
  await old;
  assert.equal(reader.state().phase, "ready");
});

test("a failed new selection still invalidates a preceding read", async () => {
  const first = deferred();
  const { reader } = fixture(() => first.promise);
  const old = reader.load(file());
  await reader.load(file(archive(), { name: "wrong.exe" }));
  first.resolve(bytes());
  await old;
  assert.equal(reader.state().errorCode, "FILE_NAME");
});

test("cancel prevents a slow file from reaching the JSON input", async () => {
  const pending = deferred();
  const { reader, events } = fixture(() => pending.promise);
  const task = reader.load(file());
  reader.cancel();
  pending.resolve(bytes());
  await task;
  assert.equal(reader.state().phase, "cancelled");
  assert.equal(events.filter(event => event.phase === "ready").length, 0);
});

test("reset prevents a slow file from replacing manually edited text", async () => {
  const pending = deferred();
  const { reader } = fixture(() => pending.promise);
  const task = reader.load(file());
  reader.reset();
  pending.resolve(bytes());
  await task;
  assert.equal(reader.state().phase, "idle");
});

test("dispose prevents subsequent reads and late notifications", async () => {
  const pending = deferred();
  let calls = 0;
  const { reader, events } = fixture(() => { calls++; return pending.promise; });
  const task = reader.load(file());
  reader.dispose();
  pending.resolve(bytes());
  await task;
  await reader.load(file());
  reader.cancel();
  reader.reset();
  reader.dispose();
  assert.equal(calls, 1);
  assert.equal(reader.state().phase, "disposed");
  assert.deepEqual(events.map(event => event.phase), ["reading"]);
});

test("recovery after cancelling requires a new explicit load", async () => {
  const { reader } = fixture();
  reader.cancel();
  const result = await reader.load(file());
  assert.equal(result.phase, "ready");
});

test("observer exception cannot turn valid file into a failure", async () => {
  const reader = createHistoryFileReader({ agent: "DAT", readBytes: async () => bytes(),
    onChange() { throw Error("observer"); } });
  assert.equal((await reader.load(file())).phase, "ready");
});

for (const options of [{}, { readBytes: 1 }, { readBytes() {}, onChange: null }]) {
  test("file reader requires explicit function dependencies " + JSON.stringify(options), () => {
    assert.throws(() => createHistoryFileReader({ agent: "DAT", ...options }), TypeError);
  });
}
