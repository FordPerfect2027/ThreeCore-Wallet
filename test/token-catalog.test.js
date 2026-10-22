import test from "node:test";
import assert from "node:assert/strict";
import { TOKEN_CATALOG, TOKEN_CATALOG_VERSION, catalogToken, lookupCatalogToken,
  reviewCatalogAddress, createCatalogSelection, tokenCatalogContext } from "../src/token-catalog.js";
import { ACCOUNT, code } from "./helpers/identity-fixtures.js";

const expectedAddresses = {
  DAT: ["0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5", "0x2474a062ec669c1912ed41bc491e8a97db4743d4"],
  EMA: ["0xbae0933d509b83b7bbab3aab9fed413504382a76", "0x20c3bb2548a1ce188229a6128df0e9612259185e"],
  CAWELON: ["0xb4654b5a4617fe2c27a0dd6eaee98f8aa941b895", "0x9c2aeb2f80e074dac065d0e5db41c2f01fed280f"],
};

test("catalog contains six immutable ERC-20 entries with no wallet addresses", () => {
  assert.equal(TOKEN_CATALOG.length, 6);
  assert.equal(new Set(TOKEN_CATALOG.map(row => row.address)).size, 6);
  assert.equal(Object.isFrozen(TOKEN_CATALOG), true);
  for (const row of TOKEN_CATALOG) {
    assert.equal(Object.isFrozen(row), true);
    assert.equal(row.catalogVersion, TOKEN_CATALOG_VERSION);
    assert.equal(row.repository.includes("FordPerfect2027"), true);
    assert.equal("account" in row, false);
    assert.equal("privateKey" in row, false);
    assert.equal(row.decimals, 18);
    assert.equal(row.explorer.includes(row.address), true);
  }
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const [index, chainId] of [8453, 84532].entries()) {
    test(`${agent} ${chainId} is bound to its exact published address`, () => {
      const row = catalogToken({ agent, chainId });
      assert.equal(row.address, expectedAddresses[agent][index]);
      assert.equal(row.testnet, chainId === 84532);
      assert.equal(row.explorer.startsWith(chainId === 8453
        ? "https://base.blockscout.com/" : "https://base-sepolia.blockscout.com/"), true);
      assert.equal(lookupCatalogToken(chainId, row.address), row);
      assert.equal(lookupCatalogToken(chainId, "0x" + row.address.slice(2).toUpperCase()), row);
    });
    test(`${agent} ${chainId} address review distinguishes own token`, () => {
      const context = { agent, chainId };
      const row = catalogToken(context);
      const result = reviewCatalogAddress(context, row.address);
      assert.equal(result.classification, "expected");
      assert.equal(result.matches, true);
      assert.equal(result.codeVerified, false);
    });
    test(`${agent} ${chainId} identifies another chain without switching it`, () => {
      const other = catalogToken({ agent, chainId: chainId === 8453 ? 84532 : 8453 });
      const result = reviewCatalogAddress({ agent, chainId }, other.address);
      assert.equal(result.classification, "other-network");
      assert.equal(result.matches, false);
      assert.equal(result.recognizedChain, other.chainId);
    });
  }
}

test("same network other token is not treated as this agent's token", () => {
  const result = reviewCatalogAddress({ agent: "DAT", chainId: 8453 }, expectedAddresses.EMA[0]);
  assert.equal(result.classification, "other-agent");
  assert.equal(result.recognizedAgent, "EMA");
  assert.equal(result.matches, false);
});

test("unrecognized complete address remains unknown", () => {
  const result = reviewCatalogAddress({ agent: "DAT", chainId: 8453 }, ACCOUNT);
  assert.equal(result.classification, "unrecognized");
  assert.equal(result.recognizedAgent, null);
  assert.equal(lookupCatalogToken(8453, ACCOUNT), null);
});

for (const context of [
  { agent: "DOT", chainId: 8453 },
  { agent: "DAT", chainId: 1 },
  { agent: "DAT", chainId: "8453" },
  { agent: "dat", chainId: 8453 },
  { agent: "DAT" },
  { agent: "DAT", chainId: 8453, approval: true },
  null,
]) {
  test("invalid catalog context rejected: " + JSON.stringify(context), () => {
    assert.throws(() => catalogToken(context));
  });
}

test("context accessor is rejected before invocation", () => {
  let touched = false;
  const input = { chainId: 8453, get agent() { touched = true; return "DAT"; } };
  assert.throws(() => tokenCatalogContext(input), code("IDENTITY_SHAPE"));
  assert.equal(touched, false);
});

test("review before application preserves the previous input", () => {
  const selector = createCatalogSelection();
  const context = { agent: "DAT", chainId: 8453 };
  const preview = selector.preview(context, ACCOUNT);
  assert.equal(preview.before, ACCOUNT);
  assert.equal(Object.isFrozen(preview), true);
  assert.equal(selector.apply(preview.id, context, ACCOUNT), expectedAddresses.DAT[0]);
  assert.throws(() => selector.apply(preview.id, context, ACCOUNT), code("IDENTITY_REVIEW_REQUIRED"));
});

test("changing the address invalidates a previous selection review", () => {
  const selector = createCatalogSelection();
  const context = { agent: "EMA", chainId: 8453 };
  const preview = selector.preview(context, "");
  assert.throws(() => selector.apply(preview.id, context, ACCOUNT), code("IDENTITY_STALE"));
});

test("changing the network invalidates a previous selection review", () => {
  const selector = createCatalogSelection();
  const preview = selector.preview({ agent: "EMA", chainId: 8453 }, "");
  assert.throws(() => selector.apply(preview.id, { agent: "EMA", chainId: 84532 }, ""), code("IDENTITY_STALE"));
});

test("changing the agent invalidates a previous selection review", () => {
  const selector = createCatalogSelection();
  const preview = selector.preview({ agent: "EMA", chainId: 8453 }, "");
  assert.throws(() => selector.apply(preview.id, { agent: "DAT", chainId: 8453 }, ""), code("IDENTITY_STALE"));
});

test("cancel and a new preview invalidate the old review token", () => {
  const selector = createCatalogSelection();
  const context = { agent: "CAWELON", chainId: 84532 };
  const first = selector.preview(context, "");
  const second = selector.preview(context, "");
  assert.notEqual(first.id, second.id);
  assert.throws(() => selector.apply(first.id, context, ""), code("IDENTITY_REVIEW_REQUIRED"));
  const third = selector.preview(context, "");
  selector.cancel();
  assert.throws(() => selector.apply(third.id, context, ""), code("IDENTITY_REVIEW_REQUIRED"));
});

test("selection refuses unbounded or coercible form input", () => {
  const selector = createCatalogSelection();
  const context = { agent: "DAT", chainId: 8453 };
  for (const value of [null, 3, "a".repeat(8193)]) {
    assert.throws(() => selector.preview(context, value), code("IDENTITY_INPUT"));
  }
});
