import test from "node:test";
import assert from "node:assert/strict";
import { createWalletSetupFileReader, prepareWalletSetupFile } from "../src/wallet-setup-file.js";
import { createWorkspaceFileReader, prepareWorkspaceFile } from "../src/workspace-file.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { createCheckpointCollectionReader } from "../src/checkpoint-transfer.js";
import { setup } from "./helpers/setup-fixtures.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

const bytes = text => new TextEncoder().encode(text);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settled = promise => promise.then(value => ({ value }), error => ({ code: error.code }));
const formats = [
  { name: "settings", create: createWalletSetupFileReader, method: "load", cancelled: "idle",
    text: prepareWalletSetupFile(setup()).text },
  { name: "workspace", create: createWorkspaceFileReader, method: "load", cancelled: "cancelled",
    text: (await prepareWorkspaceFile(bundle())).text },
  { name: "history", create: options => createHistoryFileReader({ agent: "DAT", ...options }),
    method: "load", cancelled: "cancelled", text: archive() },
  // This adapter only reads UTF-8; the collection decoder is a later stage.
  { name: "checkpoints", create: createCheckpointCollectionReader, method: "read", text: "{}" },
];

for (const format of formats) {
  const data = bytes(format.text);
  const file = () => ({ name: "synthetic.json", size: data.length });
  const start = (reader, input = file()) => settled(reader[format.method](input));

  for (const stop of ["cancel", "dispose"]) {
    test(`file import lifecycle: ${format.name} ${stop} cannot open another file from abort callback`, async () => {
      const gate = deferred();
      let calls = 0, nested;
      const reader = format.create({ readBytes(input, { signal }) {
        calls++;
        signal.addEventListener("abort", () => { if (!nested) nested = start(reader); }, { once: true });
        return gate.promise;
      } });
      const first = start(reader);
      reader[stop]();
      gate.resolve(data);
      await Promise.all([first, nested]);
      assert.equal(calls, 1, "cleanup must not start a replacement IO");
      if (reader.state) {
        assert.equal(reader.state().phase, stop === "dispose" ? "disposed" : format.cancelled);
        assert.equal(reader.state().text ?? reader.state().result ?? null, null);
      }
      reader.dispose();
    });

    test(`file import lifecycle: ${format.name} ${stop} inside superseded read cleanup prevents next IO`, async () => {
      const gate = deferred();
      let calls = 0;
      const reader = format.create({ readBytes(input, { signal }) {
        calls++;
        signal.addEventListener("abort", () => reader[stop](), { once: true });
        return gate.promise;
      } });
      const first = start(reader);
      const next = start(reader);
      gate.resolve(data);
      await Promise.all([first, next]);
      assert.equal(calls, 1);
      if (reader.state) assert.equal(reader.state().phase, stop === "dispose" ? "disposed" : format.cancelled);
      reader.dispose();
    });
  }

  for (const property of ["name", "size"]) {
    test(`file import lifecycle: ${format.name} cancellation while reading ${property} prevents IO`, async () => {
      let calls = 0, getterCalls = 0;
      const reader = format.create({ readBytes: () => { calls++; return data; } });
      const input = file();
      Object.defineProperty(input, property, { get() {
        getterCalls++; reader.cancel();
        return property === "name" ? "synthetic.json" : data.length;
      } });
      await start(reader, input);
      assert.equal(calls, 0);
      assert.equal(getterCalls, 1, "metadata must be captured once");
      if (reader.state) assert.equal(reader.state().phase, format.cancelled);
      reader.dispose();
    });
  }

  test(`file import lifecycle: ${format.name} replacement remains abortable after nested start is refused`, async () => {
    const gate = deferred();
    const signals = [];
    let nested, firstAbort = true;
    const reader = format.create({ readBytes(input, { signal }) {
      signals.push(signal);
      signal.addEventListener("abort", () => {
        if (firstAbort) { firstAbort = false; nested = start(reader); }
      }, { once: true });
      return gate.promise;
    } });
    const first = start(reader);
    const next = start(reader);
    reader.cancel();
    gate.resolve(data);
    await Promise.all([first, next, nested]);
    assert.equal(signals.length, 2, "only explicit first and replacement reads");
    assert(signals.every(signal => signal.aborted), "no detached active read");
    reader.dispose();
  });

  if (format.name === "checkpoints") continue;

  test(`file import lifecycle: ${format.name} cancellation from ready observer is not success`, async () => {
    const reader = format.create({ readBytes: () => data, onChange(state) {
      if (state.phase === "ready") reader.cancel();
    } });
    const result = await start(reader);
    assert.equal(reader.state().phase, format.cancelled);
    if (format.name !== "history") assert.equal(result.value, false);
    else assert.equal(result.value.phase, format.cancelled);
    reader.dispose();
  });

  test(`file import lifecycle: ${format.name} disposal clears accepted import data`, async () => {
    const reader = format.create({ readBytes: () => data });
    await start(reader);
    assert.equal(reader.state().phase, "ready");
    reader.dispose();
    assert.equal(reader.state().phase, "disposed");
    assert.equal(reader.state().text ?? reader.state().result ?? null, null);
  });

  test(`file import lifecycle: ${format.name} observer exceptions cannot reject load`, async () => {
    const reader = format.create({ readBytes: () => data, onChange() { throw Error("synthetic observer"); } });
    const result = await start(reader);
    assert.equal(result.code, undefined);
    assert.equal(reader.state().phase, "ready");
    reader.dispose();
  });
}

test("file import lifecycle: history reset cannot revive a disposed reader during cleanup", async () => {
  const gate = deferred();
  const reader = createHistoryFileReader({ agent: "DAT", readBytes(file, { signal }) {
    signal.addEventListener("abort", () => reader.dispose(), { once: true });
    return gate.promise;
  } });
  const pending = reader.load({ name: "history.json", size: 2 });
  const state = reader.reset();
  gate.resolve(bytes("{}"));
  await pending;
  assert.equal(state.phase, "disposed");
  assert.equal(reader.state().phase, "disposed");
});

test("file import lifecycle: history reset rejects a cleanup-triggered read and permits later selection", async () => {
  const data = bytes(archive());
  const input = { name: "history.json", size: data.length };
  const gate = deferred();
  let calls = 0, nested;
  const reader = createHistoryFileReader({ agent: "DAT", readBytes(file, { signal }) {
    if (++calls === 1) signal.addEventListener("abort", () => { nested = reader.load(input); }, { once: true });
    return gate.promise;
  } });
  const pending = reader.load(input);
  reader.reset();
  gate.resolve(data);
  await Promise.all([pending, nested]);
  assert.equal(calls, 1);
  assert.equal(reader.state().phase, "idle");
  await reader.load(input);
  assert.equal(calls, 2);
  assert.equal(reader.state().phase, "ready");
  reader.dispose();
});
