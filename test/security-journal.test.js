import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityJournal, validateSecurityJournal, exportSecurityJournal,
  securityJournalRows, SECURITY_JOURNAL_EVENTS, SECURITY_JOURNAL_LIMIT } from "../src/security-journal.js";

const clone = value => JSON.parse(JSON.stringify(value));
function sample(capacity = 64) {
  const journal = createSecurityJournal({ capacity });
  journal.record("ready");
  journal.record("manual");
  journal.record("resumed");
  journal.record("idle-policy", { idleMs: 60_000 });
  journal.record("hidden-policy", { enabled: true });
  return journal;
}

test("journal starts empty and contains no wall clock, account or provider fields", () => {
  const journal = createSecurityJournal();
  const state = journal.state();
  assert.equal(state.capacity, SECURITY_JOURNAL_LIMIT);
  assert.equal(state.total, 0);
  assert.equal(state.dropped, 0);
  assert.deepEqual(state.events, []);
  assert.ok(Object.values(state.counts).every(count => count === 0));
  assert.deepEqual(Object.keys(state).sort(), ["capacity", "counts", "disposed", "dropped", "events", "total"]);
  assert.deepEqual(validateSecurityJournal(state), state);
});

for (const capacity of [1, 2, 8, 64]) {
  test("old details are evicted while aggregate counts remain accurate: capacity " + capacity, () => {
    const journal = createSecurityJournal({ capacity });
    for (let i = 0; i < 1000; i++) journal.record(i % 2 ? "resumed" : "manual");
    const snapshot = validateSecurityJournal(journal.state());
    assert.equal(snapshot.events.length, capacity);
    assert.equal(snapshot.total, 1000);
    assert.equal(snapshot.dropped, 1000 - capacity);
    assert.equal(snapshot.events[0].sequence, 1001 - capacity);
    assert.equal(snapshot.events.at(-1).sequence, 1000);
    assert.equal(snapshot.counts.manual, 500);
    assert.equal(snapshot.counts.resumed, 500);
  });
}

for (const capacity of [0, -1, 65, NaN, Infinity, 1.5, "8", null]) {
  test("invalid journal capacity is refused: " + String(capacity), () => {
    assert.throws(() => createSecurityJournal({ capacity }), /Invalid protection/);
  });
}

for (const kind of SECURITY_JOURNAL_EVENTS) {
  test("known event has an immutable typed representation: " + kind, () => {
    const journal = createSecurityJournal();
    const detail = kind === "idle-policy" ? { idleMs: 60_000 } : kind === "hidden-policy" ? { enabled: false } : {};
    journal.record(kind, detail);
    const snapshot = journal.state();
    assert.equal(snapshot.counts[kind], 1);
    assert.equal(snapshot.events[0].kind, kind);
    assert.equal(Object.isFrozen(snapshot.events[0]), true);
    assert.equal(Object.isFrozen(snapshot.events[0].detail), true);
    assert.equal(Object.isFrozen(snapshot.counts), true);
    assert.equal(Object.isFrozen(snapshot.events), true);
    assert.deepEqual(validateSecurityJournal(snapshot), snapshot);
    assert.ok(securityJournalRows(snapshot)[0].text.length > 0);
  });
}

test("details are copied, not retained by reference", () => {
  const journal = createSecurityJournal(), detail = { idleMs: 60_000 };
  journal.record("idle-policy", detail);
  detail.idleMs = 900_000;
  assert.equal(journal.state().events[0].detail.idleMs, 60_000);
});

test("an earlier snapshot is stable after later events and disposal", () => {
  const journal = sample(), previous = journal.state();
  journal.record("idle");
  journal.dispose();
  assert.equal(previous.total, 5);
  assert.equal(previous.counts.idle, 0);
  assert.equal(previous.events.length, 5);
  assert.equal(journal.state().events.length, 0);
});

test("discarding the panel drops retained details and counts without external writes", () => {
  const journal = sample();
  journal.dispose(); journal.dispose();
  assert.equal(journal.record("manual"), false);
  const state = journal.state();
  assert.equal(state.disposed, true);
  assert.equal(state.total, 0);
  assert.deepEqual(state.events, []);
  assert.ok(Object.values(state.counts).every(count => count === 0));
  assert.deepEqual(validateSecurityJournal(state), state);
});

for (const kind of ["0x1234", "provider-error", "constructor", "__proto__", "<script>", null, {}, 4001]) {
  test("unrecognized free-form event cannot enter the record", () => {
    const journal = sample(), before = journal.state();
    assert.throws(() => journal.record(kind));
    assert.deepEqual(journal.state(), before);
  });
}

for (const key of ["account", "address", "balance", "message", "error", "request", "seed", "privateKey", "toJSON"]) {
  test("private or free-form field is rejected before any partial record: " + key, () => {
    const journal = sample(), before = journal.state();
    assert.throws(() => journal.record("manual", { [key]: "DO-NOT-RECORD" }));
    assert.deepEqual(journal.state(), before);
    assert.ok(!exportSecurityJournal(journal.state()).includes("DO-NOT-RECORD"));
  });
}

for (const value of [undefined, null, "60000", 0, -1, 61_000, NaN, Infinity]) {
  test("idle policy accepts only the three UI intervals", () => {
    const journal = createSecurityJournal();
    assert.throws(() => journal.record("idle-policy", { idleMs: value }));
    assert.equal(journal.state().total, 0);
  });
}
for (const idleMs of [60_000, 300_000, 900_000]) {
  test("idle policy display reflects the selected duration " + idleMs, () => {
    const journal = createSecurityJournal();
    journal.record("idle-policy", { idleMs });
    assert.ok(securityJournalRows(journal.state())[0].text.includes(String(idleMs / 60_000) + "分"));
  });
}
for (const enabled of ["true", "false", 0, 1, {}, null]) {
  test("hide policy cannot smuggle arbitrary values", () => {
    const journal = createSecurityJournal();
    assert.throws(() => journal.record("hidden-policy", { enabled }));
    assert.equal(journal.state().total, 0);
  });
}

test("detail accessors are refused without invoking them", () => {
  let read = 0;
  const detail = { get idleMs() { read++; return 60_000; } };
  const journal = createSecurityJournal();
  assert.throws(() => journal.record("idle-policy", detail));
  assert.equal(read, 0);
  assert.equal(journal.state().total, 0);
});

test("reflection reentry that disposes the journal cannot append afterward", () => {
  const journal = sample();
  const detail = new Proxy({}, { ownKeys() { journal.dispose(); return []; } });
  assert.equal(journal.record("manual", detail), false);
  assert.equal(journal.state().total, 0);
  assert.equal(journal.state().disposed, true);
});

test("display is latest first without changing the original event order", () => {
  const journal = sample();
  const rows = securityJournalRows(journal.state(), 2);
  assert.deepEqual(rows.map(row => row.sequence), [5, 4]);
  assert.deepEqual(journal.state().events.map(row => row.sequence), [1, 2, 3, 4, 5]);
  assert.ok(Object.isFrozen(rows) && Object.isFrozen(rows[0]));
});

for (const limit of [0, 65, 1.5, "8", NaN]) {
  test("invalid presentation limit cannot bypass the record bound", () => {
    assert.throws(() => securityJournalRows(sample().state(), limit));
  });
}

test("export includes explicit scope and no external identity", () => {
  const result = JSON.parse(exportSecurityJournal(sample().state()));
  assert.equal(result.schema, "threecore.local-protection-journal");
  assert.equal(result.version, 1);
  assert.equal(result.containsPrivateKeys, false);
  assert.equal(result.containsWalletAddresses, false);
  assert.equal(result.containsBalances, false);
  assert.match(result.scope, /Not a security audit/);
  assert.equal(result.events.length, 5);
  assert.ok(!JSON.stringify(result).includes("0x"));
});

const mutations = [
  ["oversized capacity", value => { value.capacity = 65; }],
  ["wrong count", value => { value.total++; }],
  ["wrong dropped count", value => { value.dropped++; }],
  ["negative count", value => { value.counts.ready = -1; }],
  ["fractional count", value => { value.counts.ready = .5; }],
  ["huge count", value => { value.counts.ready = Number.MAX_SAFE_INTEGER + 1; }],
  ["unknown count", value => { value.counts.secret = 0; }],
  ["missing count", value => { delete value.counts.ready; }],
  ["unknown envelope field", value => { value.account = "secret"; }],
  ["string total", value => { value.total = String(value.total); }],
  ["duplicate sequence", value => { value.events[1].sequence = 1; }],
  ["reordered events", value => { value.events.reverse(); }],
  ["missing event", value => { value.events.pop(); }],
  ["extra event field", value => { value.events[0].message = "secret"; }],
  ["unknown event", value => { value.events[0].kind = "attack"; }],
  ["extra detail", value => { value.events[0].detail.seed = "secret"; }],
  ["count redistribution", value => { value.counts.manual = 0; value.counts.resumed++; }],
  ["disposed but retained", value => { value.disposed = true; }],
  ["sparse events", value => { delete value.events[0]; }],
];
for (const [name, mutate] of mutations) {
  test("invalid snapshot never becomes an exported security claim: " + name, () => {
    const value = clone(sample().state()); mutate(value);
    assert.throws(() => validateSecurityJournal(value));
    assert.throws(() => exportSecurityJournal(value));
    assert.throws(() => securityJournalRows(value));
  });
}

test("event accessors are not invoked by a report renderer", () => {
  let read = 0;
  const value = clone(sample().state());
  Object.defineProperty(value.events, "0", { get() { read++; return {}; } });
  assert.throws(() => exportSecurityJournal(value));
  assert.equal(read, 0);
});

test("validated records share no mutable object with the source snapshot", () => {
  const input = clone(sample().state()), validated = validateSecurityJournal(input);
  input.events[3].detail.idleMs = 900_000;
  input.events[0].kind = "idle";
  input.counts.ready = 0;
  assert.equal(validated.events[3].detail.idleMs, 60_000);
  assert.equal(validated.events[0].kind, "ready");
  assert.equal(validated.counts.ready, 1);
});
