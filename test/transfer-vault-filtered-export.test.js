import test from "node:test";
import assert from "node:assert/strict";
import { vaultFilteredActivityCsv, queryVaultActivity } from "../src/transfer-vault-analytics.js";
import { vaultKey, vaultBundle } from "../src/transfer-vault-model.js";
import { bundleFor, controllerFixture } from "./helpers/vault-fixtures.js";
import { clone, code, hash } from "./helpers/transfer-fixtures.js";

const query = overrides => ({ agent: "all", direction: "all", search: "", order: "newest", page: 0, pageSize: 20, ...overrides });
const csvRows = text => text.slice(1).trimEnd().split("\r\n").slice(1);

test("filtered CSV includes all matching rows across pages, with exact base units", () => {
  const bundle = bundleFor(undefined, { count: 23, amount: "99999999999999999999999999999" });
  const filter = query({ agent: "EMA", page: 1 });
  assert.equal(queryVaultActivity(bundle, filter).rows.length, 3);
  const exported = vaultFilteredActivityCsv(bundle, filter);
  assert.equal(exported.scope, "all-matches");
  assert.equal(exported.matched, 23);
  assert.equal(exported.total, 69);
  assert.equal(exported.completeHistory, false);
  assert.equal(csvRows(exported.text).length, 23);
  assert.ok(csvRows(exported.text).every(row => row.startsWith('"EMA",')));
  assert.ok(csvRows(exported.text).every(row => row.includes('"99999999999999999999999999999"')));
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
});

test("filtered CSV empty result contains a header and does not invent a zero event", () => {
  const exported = vaultFilteredActivityCsv(bundleFor(), query({ search: "does-not-exist" }));
  assert.equal(exported.matched, 0);
  assert.equal(exported.total, 3);
  assert.equal(csvRows(exported.text).length, 0);
  assert.match(exported.text, /amountBaseUnits/);
});

test("filtered CSV can report an entirely empty working copy without assuming zero balance", () => {
  const exported = vaultFilteredActivityCsv(vaultBundle(), query());
  assert.equal(exported.total, 0);
  assert.equal(exported.matched, 0);
  assert.equal(exported.completeHistory, false);
  assert.equal(csvRows(exported.text).length, 0);
});

for (const field of ["account", "from", "to", "transactionHash", "blockNumber", "tokenAddress"]) {
  test("filtered CSV uses the same public " + field + " search as the activity screen", () => {
    const bundle = bundleFor(undefined, { count: 4 });
    const row = queryVaultActivity(bundle).rows[0];
    const filter = query({ search: row[field].toUpperCase(), order: "oldest" });
    const expected = queryVaultActivity(bundle, { ...filter, pageSize: 100 });
    const exported = vaultFilteredActivityCsv(bundle, filter);
    assert.equal(exported.matched, expected.matched);
    assert.equal(csvRows(exported.text).length, expected.matched);
    for (const match of expected.rows) {
      assert.ok(exported.text.includes(match.transactionHash));
      assert.ok(exported.text.includes('"' + match.agent + '"'));
    }
  });
}

test("filtered CSV direction includes only the chosen kind and respects visible block ordering", () => {
  const bundle = clone(bundleFor(["DAT"], { count: 3 }));
  const events = bundle.slots[0].archive.records[0].events;
  [events[1].from, events[1].to] = [events[1].to, events[1].from];
  const outgoing = vaultFilteredActivityCsv(bundle, query({ direction: "outgoing" }));
  assert.equal(outgoing.matched, 1);
  assert.ok(outgoing.text.includes(events[1].transactionHash));
  assert.ok(!outgoing.text.includes(events[0].transactionHash));
  assert.ok(!outgoing.text.includes(events[2].transactionHash));
  const oldest = vaultFilteredActivityCsv(bundle, query({ order: "oldest" }));
  const newest = vaultFilteredActivityCsv(bundle, query({ order: "newest" }));
  assert.deepEqual(csvRows(oldest.text), csvRows(newest.text).reverse());
});

test("filtered CSV uses a normalized isolated query and cannot mutate original history", () => {
  const bundle = bundleFor();
  const before = vaultKey(bundle);
  const filter = query({ search: "  42  " });
  const exported = vaultFilteredActivityCsv(bundle, filter);
  filter.agent = "EMA";
  filter.search = "999";
  assert.equal(exported.query.agent, "all");
  assert.equal(exported.query.search, "42");
  assert.equal(exported.matched, 3);
  assert.equal(Object.isFrozen(exported.query), true);
  assert.equal(vaultKey(bundle), before);
});

for (const invalid of [query({ agent: "OTHER" }), query({ direction: "approval" }), query({ search: "x".repeat(101) }),
  query({ search: "\n" }), query({ page: -1 }), query({ order: "random" })]) {
  test("filtered CSV rejects invalid criteria " + JSON.stringify(invalid), () => {
    assert.throws(() => vaultFilteredActivityCsv(bundleFor(), invalid), code("TRANSFER_VAULT_QUERY"));
  });
}

test("controller creates a filtered download without changing working data, saved entries or undo", async () => {
  const f = controllerFixture();
  await f.capture(); await f.save();
  const working = vaultKey(f.controller.state.working);
  const stored = JSON.stringify(f.storage.value);
  const timeline = f.controller.state.timeline;
  const beforeCalls = f.storage.calls.length;
  const file = await f.controller.prepare("filtered-csv", false, query({ agent: "CAWELON" }));
  assert.equal(file.filename, "ThreeCore-filtered-transfer-activity.csv");
  assert.equal(file.matched, 1);
  assert.equal(file.total, 3);
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
  assert.equal(csvRows(file.text).length, 1);
  assert.equal(vaultKey(f.controller.state.working), working);
  assert.equal(JSON.stringify(f.storage.value), stored);
  assert.deepEqual(f.controller.state.timeline, timeline);
  assert.equal(f.storage.calls.length, beforeCalls);
  f.controller.dispose();
});

test("controller reports no matches instead of initiating a misleading empty download", async () => {
  const f = controllerFixture();
  await f.capture();
  assert.equal(await f.controller.prepare("filtered-csv", false, query({ search: hash(999) })), null);
  assert.equal(f.controller.state.error, "TRANSFER_VAULT_NO_MATCHES");
  assert.equal(f.controller.state.hasRecords, true);
  assert.equal(f.storage.calls.length, 0);
  f.controller.dispose();
});

test("filtered export remains unavailable after disposal", async () => {
  const f = controllerFixture();
  await f.capture();
  f.controller.dispose();
  assert.equal(await f.controller.prepare("filtered-csv", false, query()), null);
});
