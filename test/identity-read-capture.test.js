import test from "node:test";
import assert from "node:assert/strict";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { readerSession } from "./helpers/identity-fixtures.js";
const ownOnly = value => new Proxy(value, { get(target, key) {
  if (key === "then") return undefined;
  throw Error("Unexpected live observation read");
} });

test("identity reader keeps the metadata received before a later balance read", async () => {
  const fixture = readerSession();
  const metadata = { ...fixture.row.metadata, totalSupply: "100" };
  fixture.session.getTokenMetadata = async () => metadata;
  const balance = fixture.session.getTokenBalance;
  fixture.session.getTokenBalance = async (...args) => { metadata.totalSupply = "200"; return balance(...args); };
  assert.equal((await readTokenIdentity(fixture.session)).metadata.totalSupply, "100");
});
test("identity reader does not revise a code-absent result after its native balance read", async () => {
  const fixture = readerSession();
  const code = { address: fixture.row.tokenAddress, deployed: false };
  fixture.session.getContractCode = async () => code;
  const native = fixture.session.getNativeBalance;
  fixture.session.getNativeBalance = async (...args) => { code.deployed = true; return native(...args); };
  const result = await readTokenIdentity(fixture.session);
  assert.equal(result.hasCode, false); assert.equal(result.metadata, null); assert.equal(result.balanceBaseUnits, null);
  assert.equal(fixture.calls.some(([method]) => ["metadata", "balance"].includes(method)), false);
});
test("identity reader accepts own code fields without live getters", async () => {
  const fixture = readerSession();
  fixture.session.getContractCode = async () => ownOnly({ address: fixture.row.tokenAddress, deployed: true });
  assert.equal((await readTokenIdentity(fixture.session)).hasCode, true);
});
test("code accessors are rejected without execution or later subreads", async () => {
  const fixture = readerSession(); let reads = 0;
  fixture.session.getContractCode = async () => ({ address: fixture.row.tokenAddress, get deployed() { reads++; return true; } });
  await assert.rejects(readTokenIdentity(fixture.session), { code: "IDENTITY_CODE" });
  assert.equal(reads, 0);
  assert.equal(fixture.calls.some(([method]) => method === "native"), false);
});
test("metadata capture cancellation stops before requesting the token balance", async () => {
  const fixture = readerSession(), aborter = new AbortController();
  fixture.session.getTokenMetadata = async () => new Proxy({ ...fixture.row.metadata }, {
    ownKeys(target) { aborter.abort(); return Reflect.ownKeys(target); },
  });
  await assert.rejects(readTokenIdentity(fixture.session, { signal: aborter.signal }), { code: "IDENTITY_CANCELLED" });
  assert.equal(fixture.calls.some(([method]) => method === "balance"), false);
});
