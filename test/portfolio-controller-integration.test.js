import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioController } from "../src/portfolio-controller.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "22".repeat(20);
const BLOCK = {number: "0x2a", hash: "0x" + "ab".repeat(32)};

function adapter(nativeRead = async () => 0n) {
  return {
    state: {
      agent: "DAT", account: ACCOUNT, chainId: 8453,
      connectionEpoch: 1, connected: true, siteOrigin: "https://example.test",
      canSign: false, canSendTransactions: false, canBridge: false,
    },
    async getBlockSnapshot() { return {...BLOCK}; },
    getNativeBalance: nativeRead,
    async getContractCode(address) { return {address, deployed: true}; },
    async getTokenBalance() { return 0n; },
  };
}

test("default controller and snapshot reader preserve verified zero balances", async () => {
  const controller = createPortfolioController();
  const outcome = await controller.refresh(adapter(), {tokens: [TOKEN]});
  assert.equal(outcome.accepted, true);
  assert.equal(controller.state.status, "ready");
  assert.equal(controller.state.result.nativeBalanceBaseUnits, "0");
  assert.equal(controller.state.result.holdings[0].balanceBaseUnits, "0");
  assert.equal(controller.state.result.holdings[0].hasCode, true);
  controller.dispose();
});

test("default reader cancellation resolves the controller without later rendering", async () => {
  let started;
  let release;
  const ready = new Promise(resolve => { started = resolve; });
  const session = adapter(() => {
    started();
    return new Promise(resolve => { release = resolve; });
  });
  const controller = createPortfolioController();
  const pending = controller.refresh(session, {tokens: [TOKEN]});
  await ready;
  controller.cancel();
  assert.equal((await pending).accepted, false);
  assert.equal(controller.state.status, "cancelled");
  release(99n);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.state.result, null);
  assert.equal(controller.state.status, "cancelled");
  controller.dispose();
});
