import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createTokenIdentityController } from "../src/token-identity-controller.js";
import { observation, ACCOUNT, OTHER, fileFor, deferred, tick } from "./helpers/identity-fixtures.js";

function fixture(options = {}) {
  const context = { agent: "DAT", chainId: 8453, account: ACCOUNT, tokenAddress: observation().tokenAddress };
  const calls = [];
  const views = [];
  let next = observation();
  const controller = createTokenIdentityController({
    getContext: () => ({ ...context }),
    read: async input => { calls.push(input); return options.read ? options.read(input) : next; },
    onChange(state) { views.push(state); options.onChange?.(state); },
    ...(options.subtle ? { subtle: options.subtle } : {}),
  });
  return { controller, context, calls, views, setNext(row) { next = row; } };
}

test("construction is inert and performs no wallet or storage operation", () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.state().phase, "idle");
  assert.equal(f.controller.state().observation, null);
  assert.equal(f.controller.state().baseline, null);
});

test("explicit inspect captures the requested account and token", async () => {
  const f = fixture();
  assert.equal(await f.controller.inspect(), true);
  const state = f.controller.state();
  assert.equal(state.phase, "ready");
  assert.equal(state.provenance, "read");
  assert.equal(state.assessment.status, "matched");
  assert.equal(state.observation.account, ACCOUNT);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].tokenAddress, observation().tokenAddress);
  assert.equal(f.calls[0].signal instanceof AbortSignal, true);
});

test("blank token field resolves to the selected catalog entry", async () => {
  const f = fixture();
  f.context.tokenAddress = "";
  assert.equal(await f.controller.inspect(), true);
  assert.equal(f.calls[0].tokenAddress, observation().tokenAddress);
});

test("missing account gives a useful error without opening a connection", async () => {
  const f = fixture();
  f.context.account = "";
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_NOT_CONNECTED");
  assert.deepEqual(f.calls, []);
});

test("unknown token stops before invoking the read adapter", async () => {
  const f = fixture();
  f.context.tokenAddress = OTHER;
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_CONTRACT_MISMATCH");
  assert.deepEqual(f.calls, []);
});

for (const field of ["account", "chainId", "agent", "tokenAddress"]) {
  test("context change during read invalidates pending result: " + field, async () => {
    const gate = deferred();
    const f = fixture({ read: () => gate.promise });
    const pending = f.controller.inspect();
    await tick();
    f.context[field] = field === "account" || field === "tokenAddress" ? OTHER : field === "chainId" ? 84532 : "EMA";
    gate.resolve(observation());
    assert.equal(await pending, false);
    assert.equal(f.controller.state().phase, "error");
    assert.equal(f.controller.state().errorCode, "IDENTITY_STALE");
    assert.equal(f.controller.state().observation, null);
  });
}

test("context becoming malformed during read also clears result", async () => {
  const gate = deferred();
  const f = fixture({ read: () => gate.promise });
  const pending = f.controller.inspect();
  f.context.account = "invalid";
  gate.resolve(observation());
  assert.equal(await pending, false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_STALE");
});

test("read adapter cannot substitute another wallet", async () => {
  const f = fixture({ read: () => observation({ account: OTHER }) });
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_SESSION_CHANGED");
  assert.equal(f.controller.state().observation, null);
});

test("read adapter cannot substitute another agent", async () => {
  const f = fixture({ read: () => observation({}, "EMA") });
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_SESSION_CHANGED");
});

for (const action of ["cancel", "invalidate", "dispose"]) {
  test(action + " ends a read and ignores a delayed successful callback", async () => {
    const gate = deferred();
    const f = fixture({ read: () => gate.promise });
    const pending = f.controller.inspect();
    await tick();
    f.controller[action]();
    const state = f.controller.state();
    assert.equal(f.calls[0].signal.aborted, true);
    gate.resolve(observation());
    assert.equal(await pending, false);
    assert.equal(f.controller.state(), state);
    assert.equal(state.observation, null);
  });
  test(action + " suppresses a delayed rejected callback", async () => {
    const gate = deferred();
    const f = fixture({ read: () => gate.promise });
    const pending = f.controller.inspect();
    f.controller[action]();
    const state = f.controller.state();
    gate.reject(Error("Old result"));
    assert.equal(await pending, false);
    assert.equal(f.controller.state(), state);
  });
}

test("new read supersedes an older result even if the old read wins later", async () => {
  const gate = deferred();
  let count = 0;
  const f = fixture({ read: () => ++count === 1 ? gate.promise : observation({ blockNumber: "43" }) });
  const old = f.controller.inspect();
  assert.equal(await f.controller.inspect(), true);
  assert.equal(f.calls[0].signal.aborted, true);
  gate.resolve(observation());
  assert.equal(await old, false);
  assert.equal(f.controller.state().observation.blockNumber, "43");
});

test("starting a new read removes obsolete displayed data immediately", async () => {
  const gate = deferred();
  let count = 0;
  const f = fixture({ read: () => ++count === 1 ? observation() : gate.promise });
  await f.controller.inspect();
  const pending = f.controller.inspect();
  assert.equal(f.controller.state().observation, null);
  assert.equal(f.controller.state().phase, "reading");
  gate.resolve(observation({ blockNumber: "43" }));
  await pending;
});

test("failure code is preserved but not arbitrary provider text", async () => {
  const f = fixture({ read: () => { throw Object.assign(Error("<img src=x>"), { code: "IDENTITY_TIMEOUT" }); } });
  assert.equal(await f.controller.inspect(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_TIMEOUT");
  assert.equal(JSON.stringify(f.controller.state()).includes("<img"), false);
});

test("file import is local and explicitly marked imported", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await fileFor()), true);
  assert.equal(f.controller.state().provenance, "imported");
  assert.equal(f.controller.state().phase, "ready");
  assert.deepEqual(f.calls, []);
});

test("file import accepts a historical account without asserting it is connected", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await fileFor(observation({ account: OTHER }))), true);
  assert.equal(f.controller.state().observation.account, OTHER);
  assert.equal(f.context.account, ACCOUNT);
  assert.equal(f.controller.state().provenance, "imported");
});

test("file for another agent is rejected without changing form values", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(await fileFor(observation({}, "EMA"))), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_IMPORT_AGENT");
  assert.equal(f.context.agent, "DAT");
  assert.deepEqual(f.calls, []);
});

test("cancelling an asynchronous file read suppresses its result", async () => {
  const original = await fileFor();
  const gate = deferred();
  const f = fixture();
  const pending = f.controller.load({ ...original, arrayBuffer: () => gate.promise });
  f.controller.cancel();
  gate.resolve(await original.arrayBuffer());
  assert.equal(await pending, false);
  assert.equal(f.controller.state().phase, "cancelled");
});

test("slow import cannot overwrite a newer live read", async () => {
  const original = await fileFor(observation({ blockNumber: "41" }));
  const gate = deferred();
  const f = fixture();
  const pending = f.controller.load({ ...original, arrayBuffer: () => gate.promise });
  await f.controller.inspect();
  gate.resolve(await original.arrayBuffer());
  assert.equal(await pending, false);
  assert.equal(f.controller.state().observation.blockNumber, "42");
  assert.equal(f.controller.state().provenance, "read");
});

test("exported file represents the displayed record exactly", async () => {
  const f = fixture();
  await f.controller.inspect();
  assert.equal(await f.controller.prepareFile(), true);
  const file = f.controller.state().file;
  assert.equal(JSON.parse(file.text).observation.balanceBaseUnits, observation().balanceBaseUnits);
  assert.equal(f.calls.length, 1);
});

test("export without a record does not produce an empty or fabricated file", async () => {
  const f = fixture();
  assert.equal(await f.controller.prepareFile(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_NO_RESULT");
  assert.equal(f.controller.state().file, null);
});

test("context change during checksum prevents the prepared file from appearing", async () => {
  const gate = deferred();
  const f = fixture({ subtle: { async digest(...args) { await gate.promise; return webcrypto.subtle.digest(...args); } } });
  await f.controller.inspect();
  const pending = f.controller.prepareFile();
  f.context.account = OTHER;
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.state().file, null);
  assert.equal(f.controller.state().errorCode, "IDENTITY_STALE");
});

test("baseline survives a new observation and comparison uses exact amounts", async () => {
  const f = fixture();
  await f.controller.inspect();
  assert.equal(f.controller.useAsBaseline(), true);
  f.setNext(observation({ blockNumber: "43", balanceBaseUnits: "1234567890123456790" }));
  await f.controller.inspect();
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state().comparison.deltaBaseUnits, "1");
  assert.equal(f.controller.state().baseline.blockNumber, "42");
});

test("an imported baseline is usable but stays historical", async () => {
  const f = fixture();
  await f.controller.load(await fileFor(observation({ blockNumber: "41", balanceBaseUnits: "1" })));
  f.controller.useAsBaseline();
  await f.controller.inspect();
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state().comparison.historicalObservation, true);
  assert.equal(f.controller.state().comparison.provesTransfers, false);
});

test("comparison context failure retains both records for inspection", async () => {
  const f = fixture();
  await f.controller.load(await fileFor(observation({ account: OTHER, blockNumber: "41" })));
  f.controller.useAsBaseline();
  await f.controller.inspect();
  assert.equal(f.controller.compare(), false);
  assert.equal(f.controller.state().errorCode, "IDENTITY_COMPARISON_CONTEXT");
  assert.equal(f.controller.state().baseline.account, OTHER);
  assert.equal(f.controller.state().observation.account, ACCOUNT);
});

test("invalidate clears comparison, export, baseline and result together", async () => {
  const f = fixture();
  await f.controller.inspect();
  f.controller.useAsBaseline();
  f.controller.compare();
  await f.controller.prepareFile();
  f.controller.invalidate();
  const state = f.controller.state();
  for (const field of ["observation", "assessment", "baseline", "comparison", "file", "errorCode"]) {
    assert.equal(state[field], null);
  }
});

test("all methods stay inert after disposal", async () => {
  const f = fixture();
  f.controller.dispose();
  const state = f.controller.state();
  assert.equal(await f.controller.inspect(), false);
  assert.equal(await f.controller.load(await fileFor()), false);
  assert.equal(await f.controller.prepareFile(), false);
  assert.equal(f.controller.useAsBaseline(), false);
  assert.equal(f.controller.compare(), false);
  f.controller.cancel();
  f.controller.invalidate();
  assert.equal(f.controller.state(), state);
  assert.deepEqual(f.calls, []);
});

test("throwing display callback cannot make a successful read fail", async () => {
  const f = fixture({ onChange() { throw Error("View unavailable"); } });
  assert.equal(await f.controller.inspect(), true);
  assert.equal(f.controller.state().phase, "ready");
});

test("reentrant display cancellation occurs before the read adapter starts", async () => {
  let f;
  f = fixture({ onChange(state) { if (state.phase === "reading") f.controller.cancel(); } });
  assert.equal(await f.controller.inspect(), false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.state().phase, "cancelled");
});

test("reentrant disposal during file preparation does not publish a download", async () => {
  let f;
  f = fixture({ onChange(state) { if (state.phase === "preparing") f.controller.dispose(); } });
  await f.controller.inspect();
  assert.equal(await f.controller.prepareFile(), false);
  assert.equal(f.controller.state().file, null);
});

test("invalid adapter configuration is rejected synchronously", () => {
  assert.throws(() => createTokenIdentityController());
  assert.throws(() => createTokenIdentityController({ getContext: () => ({}), read: true }));
});
