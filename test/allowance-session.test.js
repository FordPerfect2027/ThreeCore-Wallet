import test from "node:test";
import assert from "node:assert/strict";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { realSession, targets, S1, S2, HASH, ACCOUNT, OTHER, ORIGIN, deferred, tick, word } from "./helpers/allowance-fixtures.js";

const allowedMethods = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId",
  "eth_getBlockByNumber", "eth_getCode", "eth_getBalance", "eth_call"]);
function assertReadOnly(calls, plan) {
  assert(calls.every(call => allowedMethods.has(call.method)));
  for (const call of calls.filter(call => call.method === "eth_call")) {
    const { to, data } = call.params[0];
    assert.equal(to, plan.tokenAddress);
    assert.deepEqual(call.params[1], { blockHash: HASH, requireCanonical: true });
    assert(["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd", "0x70a08231", "0xdd62ed3e"]
      .some(selector => data.startsWith(selector)));
  }
}
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chain of [8453, 84532]) {
    test("allowance real session: ABI owner/spender encoding and fixed block " + agent + "/" + chain, async () => {
      const f = realSession({ agent, chainId: chain });
      await f.session.connect();
      const plan = targets(agent, chain);
      const result = await readAllowanceSnapshot(f.session, plan);
      assert.equal(result.rows.length, 2);
      const calls = f.calls.filter(c => c.method === "eth_call" && c.params[0].data.startsWith("0xdd62ed3e"));
      assert.equal(calls.length, 2);
      assert.equal(calls[0].params[0].data, "0xdd62ed3e" + ACCOUNT.slice(2).padStart(64, "0") + S1.slice(2).padStart(64, "0"));
      assert.equal(calls[1].params[0].data, "0xdd62ed3e" + ACCOUNT.slice(2).padStart(64, "0") + S2.slice(2).padStart(64, "0"));
      assertReadOnly(f.calls, plan);
      f.session.disconnect();
    });
  }
}
test("allowance real session: malformed allowance ABI is partial unknown", async () => {
  const f = realSession({ override: args => {
    if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) return "0x1";
  } });
  await f.session.connect();
  const result = await readAllowanceSnapshot(f.session, targets());
  assert(result.rows.every(row => row.allowanceBaseUnits === null && row.allowanceError === "READ_FAILED"));
  assertReadOnly(f.calls, targets());
  f.session.disconnect();
});
test("allowance real session: owner account change aborts entire observation", async () => {
  const f = realSession({ override: (args, provider) => {
    if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
      provider.account = OTHER;
      return word(0);
    }
  } });
  await f.session.connect();
  await assert.rejects(readAllowanceSnapshot(f.session, targets()));
  assert.equal(f.session.state.connected, false);
});
test("allowance card: result handled by the card read lifecycle", async () => {
  const f = realSession();
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN });
  assert.equal(await controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 }), true);
  const result = await controller.readAllowances(targets());
  assert.equal(result.identity.agent, "DAT");
  assert.equal(controller.state.phase, "connected");
  assert.equal(controller.state.result.kind, "allowances");
  assertReadOnly(f.calls, targets());
  controller.dispose();
});
test("allowance card: disconnected request cannot invoke provider", async () => {
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN });
  await assert.rejects(controller.readAllowances(targets()), e => e.code === "ALLOWANCE_NOT_CONNECTED");
  assert.equal(controller.state.phase, "disconnected");
  controller.dispose();
});
test("allowance card: disconnect during request prevents late publication", async () => {
  const pending = deferred();
  let entered = false;
  const f = realSession({ override: args => {
    if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
      entered = true;
      return pending.promise;
    }
  } });
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN });
  await controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 });
  const operation = controller.readAllowances(targets());
  const failure = assert.rejects(operation);
  for (let i = 0; i < 100 && !entered; i++) await tick();
  assert(entered);
  controller.disconnect();
  pending.resolve(word(0));
  await failure;
  assert.equal(controller.state.phase, "disconnected");
  assert.equal(controller.state.result, null);
  controller.dispose();
});
test("allowance card: provider event clears connection and obsolete result", async () => {
  const f = realSession();
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN });
  await controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 });
  await controller.readAllowances(targets());
  f.provider.emit("chainChanged", "0x14a34");
  assert.equal(controller.state.phase, "disconnected");
  assert.equal(controller.state.result, null);
  controller.dispose();
});
test("allowance card: clearResult supersedes in-flight result", async () => {
  const pending = deferred();
  let entered = false;
  const f = realSession({ override: args => {
    if (args.method === "eth_call" && args.params[0].data.startsWith("0xdd62ed3e")) {
      entered = true;
      return pending.promise;
    }
  } });
  const controller = createWalletCardController({ agent: "DAT", siteOrigin: ORIGIN });
  await controller.connect({ provider: f.provider, account: ACCOUNT, chainId: 8453 });
  const failed = assert.rejects(controller.readAllowances(targets()));
  for (let i = 0; i < 100 && !entered; i++) await tick();
  assert(entered);
  controller.clearResult();
  pending.resolve(word(0));
  await failed;
  assert.equal(controller.state.result, null);
  controller.dispose();
});
