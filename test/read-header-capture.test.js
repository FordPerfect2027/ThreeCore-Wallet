import test from "node:test";
import assert from "node:assert/strict";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { collectPeriod } from "../src/period-reader.js";
import { readerSession } from "./helpers/identity-fixtures.js";
import { readerFixture, REQUEST } from "./helpers/transfer-fixtures.js";
import { fakeReader, targets, S1 } from "./helpers/allowance-fixtures.js";
import { periodSession, plan, checkpoint } from "./helpers/period-fixtures.js";
const ownOnly = value => new Proxy(value, { get(target, key) {
  if (key === "then") return undefined;
  throw Error("Unexpected live header read");
} });

test("identity headers read captured number and hash fields", async () => {
  const fixture = readerSession(), original = fixture.session.getBlockSnapshot;
  fixture.session.getBlockSnapshot = async (...args) => ownOnly(await original(...args));
  assert.equal((await readTokenIdentity(fixture.session)).blockHash, fixture.row.blockHash);
});
test("transfer boundary and event headers accept own data without live reads", async () => {
  const fixture = readerFixture(), original = fixture.session.getBlockSnapshot;
  fixture.session.getBlockSnapshot = async (...args) => ownOnly(await original(...args));
  assert.equal((await readTransferSnapshot(fixture.session, REQUEST)).events.length, 1);
});
test("allowance canonical recheck reads captured header values", async () => {
  const fixture = fakeReader(), original = fixture.session.getBlockSnapshot; let calls = 0;
  fixture.session.getBlockSnapshot = async (...args) => {
    const result = await original(...args);
    return ++calls === 3 ? ownOnly(result) : result;
  };
  assert.equal((await readAllowanceSnapshot(fixture.session, targets())).rows.length, 2);
});
test("resumed period anchors read captured header fields", async () => {
  const selected = plan(), fixture = periodSession(selected), original = fixture.session.getBlockSnapshot;
  fixture.session.getBlockSnapshot = async (...args) => ownOnly(await original(...args));
  assert.deepEqual(await collectPeriod(fixture.session, selected, { draft: checkpoint(5, selected) }), checkpoint(5, selected));
});
test("a code-result accessor cannot invent a successful spender observation", async () => {
  const fixture = fakeReader(), original = fixture.session.getContractCode; let reads = 0;
  fixture.session.getContractCode = async (address, hash) => address === S1
    ? { address, get deployed() { reads++; return true; } } : original(address, hash);
  const result = await readAllowanceSnapshot(fixture.session, targets());
  assert.equal(result.rows[0].hasCode, null);
  assert.equal(result.rows[0].codeError, "INVALID_RESPONSE");
  assert.equal(reads, 0);
});
test("identity header accessors fail before native and token reads", async () => {
  const fixture = readerSession(); let reads = 0;
  fixture.session.getBlockSnapshot = async () => ({ get number() { reads++; return "0x2a"; }, hash: fixture.row.blockHash });
  await assert.rejects(readTokenIdentity(fixture.session), { code: "IDENTITY_BLOCK" });
  assert.equal(reads, 0); assert.deepEqual(fixture.calls, []);
});
test("cancelling in a resumed period header prevents the next anchor request", async () => {
  const selected = plan(), fixture = periodSession(selected), original = fixture.session.getBlockSnapshot;
  const aborter = new AbortController(); let calls = 0;
  fixture.session.getBlockSnapshot = async (...args) => {
    calls++;
    return new Proxy(await original(...args), { ownKeys(target) { aborter.abort(); return Reflect.ownKeys(target); } });
  };
  await assert.rejects(collectPeriod(fixture.session, selected, { draft: checkpoint(5, selected), signal: aborter.signal }), { code: "PERIOD_CANCELLED" });
  assert.equal(calls, 1);
});
