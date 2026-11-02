import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve from Hardhat itself: an unrelated root-level copy must not hide an
// older nested decoder retained by the dependency lock.
const requireHardhat = createRequire(createRequire(import.meta.url).resolve("hardhat"));
const { bytesToHexString, hexStringToBytes } = await import(
  pathToFileURL(requireHardhat.resolve("@nomicfoundation/hardhat-utils/hex")).href
);
const { rpcData } = await import(
  pathToFileURL(requireHardhat.resolve("@nomicfoundation/hardhat-zod-utils/rpc")).href
);
const configHelperPath = requireHardhat.resolve("@nomicfoundation/hardhat-zod-utils");
const { validateUserConfigZodType } = await import(pathToFileURL(configHelperPath).href);
// Resolve Zod from the helper, not a possibly unrelated root installation.
const { z } = await import(pathToFileURL(createRequire(configHelperPath).resolve("zod")).href);

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

test("toolchain accepts a valid fictional configuration without loading Hardhat settings", () => {
  const schema = z.object({ networks: z.object({ development: z.object({ url: z.string() }) }) });
  assert.deepEqual(validateUserConfigZodType({ networks: { development: { url: "https://example.invalid" } } }, schema), []);
});

test("toolchain reports a nested invalid field as a structured error rather than throwing", () => {
  const schema = z.object({ networks: z.object({ development: z.object({ url: z.string() }) }) });
  const errors = validateUserConfigZodType({ networks: { development: { url: 42 } } }, schema);
  assert.equal(errors.length, 1);
  assert.deepEqual(errors[0].path, ["networks", "development", "url"]);
  assert.equal(typeof errors[0].message, "string");
  assert.ok(errors[0].message.length > 0);
});
