import test from "node:test";
import assert from "node:assert/strict";
import { encodeWalletSetup } from "../src/wallet-setup.js";
import { prepareWalletSetupFile, decodeWalletSetupBytes, createWalletSetupFileReader,
  WALLET_SETUP_FILE_LIMIT } from "../src/wallet-setup-file.js";
import { A, B, C, setup, deferred, fileFor } from "./helpers/setup-fixtures.js";

const text = encodeWalletSetup(setup());
const bytes = new TextEncoder().encode(text);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("prepared file contains only validated settings and a safe filename", () => {
  const file = prepareWalletSetupFile(setup());
  assert.equal(file.filename, "ThreeCore-wallet-settings.json");
  assert.equal(file.mimeType, "application/json;charset=utf-8");
  assert.equal(file.byteLength, bytes.byteLength);
  assert.equal(file.text, text);
  assert(!file.filename.includes(A));
  assert(Object.isFrozen(file));
});

test("duplicate addresses cannot be exported through file preparation", () => {
  assert.throws(() => prepareWalletSetupFile(setup([A, A, C])), { code: "SETUP_DUPLICATE" });
});

test("UTF-8 settings file round trips without authorization data", () => {
  assert.equal(decodeWalletSetupBytes(bytes), text);
  assert.equal(decodeWalletSetupBytes(new TextEncoder().encode("\ufeff" + text)), text);
  assert(!text.includes("connected"));
  assert(!text.includes("provider"));
});

test("invalid UTF-8 is rejected rather than replaced", () => {
  assert.throws(() => decodeWalletSetupBytes(new Uint8Array([0xc3, 0x28])), { code: "SETUP_ENCODING" });
});

for (const [name, input] of [
  ["empty bytes", new Uint8Array()],
  ["too large", new Uint8Array(WALLET_SETUP_FILE_LIMIT + 1)],
  ["plain array", [123, 125]],
  ["array buffer", bytes.buffer],
  ["string", text],
]) {
  test("file decoder rejects " + name, () => {
    assert.throws(() => decodeWalletSetupBytes(input), { code: "SETUP_SIZE" });
  });
}

test("history JSON cannot be mistaken for settings", () => {
  const archive = new TextEncoder().encode(JSON.stringify({ schema: "threecore-portfolio-history-v1", reports: [] }));
  assert.throws(() => decodeWalletSetupBytes(archive));
});

test("reader emits reading then ready, with canonical detached text", async () => {
  const events = [];
  const reader = createWalletSetupFileReader({ onChange: state => events.push(state) });
  assert.equal(reader.state().phase, "idle");
  assert.equal(await reader.load(fileFor(text)), true);
  assert.deepEqual(events.map(e => e.phase), ["reading", "ready"]);
  assert.equal(reader.state().text, text);
  assert(Object.isFrozen(reader.state()));
});

test("filename is checked before file contents are read", async () => {
  let reads = 0;
  const reader = createWalletSetupFileReader({ readBytes: async () => { reads++; return bytes; } });
  assert.equal(await reader.load({ name: "settings.txt", size: bytes.length }), false);
  assert.equal(reader.state().errorCode, "SETUP_FILENAME");
  assert.equal(reads, 0);
});

for (const name of ["../wallet.json", "C:\\wallet.json", "wallet\n.json", "wallet\0.json", "x".repeat(241) + ".json"]) {
  test("rejects unsafe file name " + JSON.stringify(name.slice(0, 25)), async () => {
    const reader = createWalletSetupFileReader();
    assert.equal(await reader.load(fileFor(text, name)), false);
    assert.equal(reader.state().errorCode, "SETUP_FILENAME");
  });
}

test("uppercase JSON extension is accepted", async () => {
  const reader = createWalletSetupFileReader();
  assert.equal(await reader.load(fileFor(text, "WALLET.JSON")), true);
});

for (const size of [0, -1, 0.5, NaN, Infinity, WALLET_SETUP_FILE_LIMIT + 1, "10"]) {
  test("rejects invalid declared file size " + String(size), async () => {
    let calls = 0;
    const reader = createWalletSetupFileReader({ readBytes: async () => { calls++; return bytes; } });
    assert.equal(await reader.load({ name: "x.json", size }), false);
    assert.equal(reader.state().errorCode, "SETUP_SIZE");
    assert.equal(calls, 0);
  });
}

test("declared byte length must match the actual read", async () => {
  const reader = createWalletSetupFileReader({ readBytes: async () => bytes });
  assert.equal(await reader.load({ name: "x.json", size: bytes.length - 1 }), false);
  assert.equal(reader.state().errorCode, "SETUP_SIZE");
});

test("read errors do not leak filesystem or provider diagnostic text", async () => {
  const reader = createWalletSetupFileReader({ readBytes: async () => { throw Error("secret local path"); } });
  assert.equal(await reader.load(fileFor(text)), false);
  assert.deepEqual(reader.state(), { phase: "error", text: null, errorCode: "SETUP_FILE" });
  assert(!JSON.stringify(reader.state()).includes("secret"));
});

test("cancelling a delayed read ignores its successful result", async () => {
  const gate = deferred();
  const reader = createWalletSetupFileReader({ readBytes: () => gate.promise });
  const pending = reader.load(fileFor(text));
  assert.equal(reader.state().phase, "reading");
  reader.cancel();
  gate.resolve(bytes);
  assert.equal(await pending, false);
  assert.deepEqual(reader.state(), { phase: "idle", text: null, errorCode: null });
});

test("cancelling a delayed error leaves the idle state intact", async () => {
  const gate = deferred();
  const reader = createWalletSetupFileReader({ readBytes: () => gate.promise });
  const pending = reader.load(fileFor(text));
  reader.cancel();
  gate.reject(Error("late"));
  assert.equal(await pending, false);
  assert.equal(reader.state().phase, "idle");
});

test("second file wins even when the first finishes later", async () => {
  const first = deferred();
  const laterText = encodeWalletSetup(setup([null, B, C]));
  const laterBytes = new TextEncoder().encode(laterText);
  let calls = 0;
  const reader = createWalletSetupFileReader({ readBytes: () => ++calls === 1 ? first.promise : Promise.resolve(laterBytes) });
  const pending = reader.load(fileFor(text));
  assert.equal(await reader.load(fileFor(laterText)), true);
  first.resolve(bytes);
  assert.equal(await pending, false);
  assert.equal(reader.state().text, laterText);
});

test("late rejection cannot overwrite the second successful file", async () => {
  const first = deferred();
  let calls = 0;
  const reader = createWalletSetupFileReader({ readBytes: () => ++calls === 1 ? first.promise : Promise.resolve(bytes) });
  const pending = reader.load(fileFor(text));
  await reader.load(fileFor(text));
  first.reject(Error("late rejection"));
  assert.equal(await pending, false);
  assert.equal(reader.state().phase, "ready");
});

test("disposal suppresses later changes and later file reads", async () => {
  const gate = deferred();
  const states = [];
  const reader = createWalletSetupFileReader({ readBytes: () => gate.promise, onChange: state => states.push(state.phase) });
  const pending = reader.load(fileFor(text));
  reader.dispose();
  gate.resolve(bytes);
  assert.equal(await pending, false);
  assert.equal(await reader.load(fileFor(text)), false);
  reader.cancel();
  await tick();
  assert.deepEqual(states, ["reading"]);
});

test("observer cancellation before read prevents byte access", async () => {
  let calls = 0;
  let reader;
  reader = createWalletSetupFileReader({ readBytes: async () => { calls++; return bytes; },
    onChange(state) { if (state.phase === "reading") reader.cancel(); } });
  assert.equal(await reader.load(fileFor(text)), false);
  assert.equal(calls, 0);
});

test("unrecognized security-sensitive fields in a file are rejected", async () => {
  const value = setup();
  value.permissions = ["eth_sendTransaction"];
  const reader = createWalletSetupFileReader();
  assert.equal(await reader.load(fileFor(JSON.stringify(value))), false);
  assert.equal(reader.state().text, null);
  assert.equal(reader.state().errorCode, "SETUP_SHAPE");
});
