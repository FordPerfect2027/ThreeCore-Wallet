import test from "node:test";
import assert from "node:assert/strict";
import { providerFixture, A, B, HASH, WORD } from "./helpers/security-fixtures.js";

const reads = [
  ["native balance", "eth_getBalance", wallet => wallet.getNativeBalance(HASH), "0x1"],
  ["contract code", "eth_getCode", wallet => wallet.getContractCode(B, HASH), "0x6000"],
  ["token balance", "eth_call", wallet => wallet.getTokenBalance(B, HASH), WORD],
  ["allowance", "eth_call", wallet => wallet.getTokenAllowance(B, B, HASH), WORD],
  ["block header", "eth_getBlockByNumber", wallet => wallet.getBlockSnapshot(), { number: "0x2a", hash: HASH }],
  ["transfer logs", "eth_getLogs", wallet => wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" }), []],
];

for (const [name, method, read, response] of reads) {
  test("provider can normalize a detached " + name + " request without contaminating the next read", async () => {
    const received = [], originals = [];
    const f = providerFixture(args => {
      if (args.method !== method) return;
      originals.push(JSON.parse(JSON.stringify(args)));
      received.push(args);
      assert.equal(Object.isFrozen(args), false);
      assert.equal(Object.isFrozen(args.params), false);
      args.transportMarker = "synthetic";
      if (typeof args.params[0] === "object") {
        args.params[0].from = A;
        if (args.params[0].topics) args.params[0].topics.push("provider-local-metadata");
      }
      if (typeof args.params[1] === "object") args.params[1].blockHash = "provider-local-change";
      return response;
    });
    try {
      await f.wallet.connect();
      const first = await read(f.wallet), second = await read(f.wallet);
      assert.deepEqual(second, first);
      assert.equal(received.length, 2);
      assert.notEqual(received[0], received[1]);
      assert.notEqual(received[0].params, received[1].params);
      assert.deepEqual(originals[0], originals[1]);
      assert.equal(Object.hasOwn(originals[1], "transportMarker"), false);
      if (typeof originals[1].params[0] === "object") {
        assert.equal(Object.hasOwn(originals[1].params[0], "from"), false);
        assert.notEqual(received[0].params[0], received[1].params[0]);
      }
      if (typeof originals[1].params[1] === "object") assert.equal(originals[1].params[1].blockHash, HASH);
    } finally { f.wallet.disconnect(); }
  });
}

for (const method of ["eth_chainId", "eth_accounts"]) {
  test("connection response validation uses the original " + method + " after provider argument mutation", async () => {
    const f = providerFixture(args => {
      if (args.method !== method) return;
      args.method = "eth_getBlockByNumber";
      args.params = ["latest", false];
      return method === "eth_chainId" ? "0x14a34" : [A];
    });
    try {
      await f.wallet.connect();
      assert.equal(f.wallet.state.connected, true);
      assert.equal(await f.wallet.getNativeBalance(HASH), 1n);
    } finally { f.wallet.disconnect(); }
  });
}

test("provider cannot bypass response policy by changing the transport method", async () => {
  const f = providerFixture(args => {
    if (args.method !== "eth_call") return;
    args.method = "eth_getBlockByNumber";
    return { number: "0x2a", hash: HASH };
  });
  try {
    await f.wallet.connect();
    await assert.rejects(f.wallet.getTokenBalance(B, HASH), { code: "RPC_RESULT_SHAPE" });
    assert.equal(f.wallet.state.connected, false);
  } finally { f.wallet.disconnect(); }
});
