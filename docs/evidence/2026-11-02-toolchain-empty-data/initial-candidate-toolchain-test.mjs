import assert from "node:assert/strict";
import test from "node:test";
import { bytesToHexString, hexStringToBytes } from "@nomicfoundation/hardhat-utils/hex";
import { rpcData } from "@nomicfoundation/hardhat-zod-utils/rpc";

// Pure decoding only: no Hardhat configuration, accounts, signing or RPC.
test("toolchain preserves empty RPC data separately from a zero byte", () => {
  for (const [input, expected] of [["0x", []], ["0x00", [0]], ["0x0100", [1, 0]]]) {
    const decoded = rpcData.parse(input);
    assert.deepEqual(Array.from(decoded), expected, input);
    assert.deepEqual(Array.from(hexStringToBytes(input)), expected, input);
    assert.equal(bytesToHexString(decoded), input);
  }
});

test("toolchain rejects malformed RPC data without repairing it into bytes", () => {
  for (const input of ["0x0", "0xgg", "00"]) {
    assert.equal(rpcData.safeParse(input).success, false, input);
  }
});
