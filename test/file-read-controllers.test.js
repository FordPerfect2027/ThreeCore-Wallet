import test from "node:test";
import assert from "node:assert/strict";
import { createWalletSetupFileReader, prepareWalletSetupFile, WALLET_SETUP_FILE_LIMIT } from "../src/wallet-setup-file.js";
import { createWorkspaceFileReader, prepareWorkspaceFile, WORKSPACE_FILE_LIMIT } from "../src/workspace-file.js";
import { createCheckpointCollectionReader, CHECKPOINT_TRANSFER_LIMIT } from "../src/checkpoint-transfer.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { readSecurityFileBytes } from "../src/security-file.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { HISTORY_FILE_LIMIT } from "../src/history-file.js";
import { setup } from "./helpers/setup-fixtures.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";
import { bytes, deferred, tick, stalledFile } from "./helpers/file-boundary-fixtures.js";

const setups = [
  { name: "settings", create: options => createWalletSetupFileReader(options), limit: WALLET_SETUP_FILE_LIMIT,
    prepare: async () => prepareWalletSetupFile(setup()).text },
  { name: "workspace", create: options => createWorkspaceFileReader(options), limit: WORKSPACE_FILE_LIMIT,
    prepare: async () => (await prepareWorkspaceFile(bundle())).text },
  { name: "history", create: options => createHistoryFileReader({ agent: "DAT", readBytes: readSecurityFileBytes, ...options }),
    limit: HISTORY_FILE_LIMIT, prepare: async () => archive() },
];

for (const item of setups) {
  test("file controller: native File round trip through guarded default " + item.name, async () => {
    const states = [];
    const reader = item.create({ onChange: state => states.push(state.phase) });
    const text = await item.prepare();
    await reader.load(new File([text], "synthetic.json"));
    assert.equal(reader.state().phase, "ready");
    assert.deepEqual(states, ["reading", "ready"]);
    assert.equal(walletFileReadService.state().active, 0);
    reader.dispose();
  });

  for (const action of ["cancel", "dispose"]) {
    test(`file controller: ${action} aborts shared reader ${item.name}`, async () => {
      const states = [];
      const reader = item.create({ onChange: state => states.push(state.phase) });
      const input = stalledFile();
      const pending = reader.load(input.file);
      await tick(); reader[action]();
      await pending;
      assert(!states.includes("ready"));
      assert(!states.includes("error"));
      assert.equal(input.calls.cancel, 1);
      assert.equal(walletFileReadService.state().retained, 1);
      input.settle(); await tick();
      assert.equal(walletFileReadService.state().active, 0);
      reader.dispose();
    });
  }

  test("file controller: injected reader receives size limit and signal " + item.name, async () => {
    const text = await item.prepare();
    let options;
    const reader = item.create({ readBytes: async (file, readOptions) => {
      options = readOptions;
      return bytes(text);
    } });
    await reader.load({ name: "synthetic.json", size: bytes(text).length });
    assert.equal(options.maxBytes, item.limit);
    assert(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    reader.dispose();
    assert.equal(options.signal.aborted, true);
  });

  test("file controller: superseding input aborts old operation " + item.name, async () => {
    const text = await item.prepare();
    const gates = [deferred(), deferred()];
    const signals = [];
    const reader = item.create({ readBytes(file, options) {
      signals.push(options.signal);
      return gates[signals.length - 1].promise;
    } });
    const file = { name: "synthetic.json", size: bytes(text).length };
    const first = reader.load(file);
    const second = reader.load(file);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);
    gates[1].resolve(bytes(text)); await second;
    const current = reader.state();
    gates[0].resolve(bytes(text)); await first;
    assert.equal(reader.state(), current);
    assert.equal(current.phase, "ready");
    reader.dispose();
  });

  test("file controller: cancellation from reading observer prevents IO " + item.name, async () => {
    let reader, calls = 0;
    reader = item.create({ readBytes: async () => { calls++; return bytes("{}"); },
      onChange(state) { if (state.phase === "reading") reader.cancel(); } });
    await reader.load({ name: "synthetic.json", size: 2 });
    assert.equal(calls, 0);
    assert.notEqual(reader.state().phase, "ready");
    reader.dispose();
  });

  test("file controller: existing candidate remains detached from input file " + item.name, async () => {
    const text = await item.prepare();
    const data = bytes(text);
    const reader = item.create({ readBytes: async () => data });
    await reader.load({ name: "synthetic.json", size: data.length });
    const before = JSON.stringify(reader.state());
    data.fill(0);
    assert.equal(JSON.stringify(reader.state()), before);
    reader.dispose();
  });
}

test("file controller: checkpoint reader captures size before asynchronous input", async () => {
  const gate = deferred();
  let size = 2;
  const reader = createCheckpointCollectionReader({ readBytes: () => gate.promise });
  const file = { name: "synthetic.json", get size() { return size; } };
  const pending = reader.read(file);
  size = 999;
  gate.resolve(bytes("{}"));
  assert.equal(await pending, "{}");
  reader.dispose();
});

test("file controller: checkpoint reader cancellation rejects with established code", async () => {
  const reader = createCheckpointCollectionReader();
  const input = stalledFile();
  const pending = reader.read(input.file);
  await tick(); reader.cancel();
  await assert.rejects(pending, { code: "CHECKPOINT_CANCELLED" });
  assert.equal(input.calls.cancel, 1);
  input.settle(); await tick(); reader.dispose();
});

test("file controller: checkpoint reader forwards its smaller cap", async () => {
  let options;
  const reader = createCheckpointCollectionReader({ readBytes: async (file, value) => {
    options = value;
    return bytes("{}");
  } });
  assert.equal(await reader.read({ name: "synthetic.json", size: 2 }), "{}");
  assert.equal(options.maxBytes, CHECKPOINT_TRANSFER_LIMIT);
  assert.equal(options.signal.aborted, false);
  reader.dispose();
  assert.equal(options.signal.aborted, true);
});

test("file controller: checkpoint native byte mode keeps encoding checks", async () => {
  const reader = createCheckpointCollectionReader();
  await assert.rejects(reader.read(new File([Uint8Array.of(0xff)], "synthetic.json")), { code: "CHECKPOINT_TRANSFER_ENCODING" });
  assert.equal(await reader.read(new File(["{}"], "synthetic.json")), "{}");
  reader.dispose();
});

test("file controller: history reset aborts current work without ready publication", async () => {
  const input = stalledFile();
  const reader = createHistoryFileReader({ agent: "DAT", readBytes: readSecurityFileBytes });
  const pending = reader.load(input.file);
  await tick(); reader.reset(); await pending;
  assert.equal(reader.state().phase, "idle");
  assert.equal(input.calls.cancel, 1);
  input.settle(); await tick(); reader.dispose();
});
