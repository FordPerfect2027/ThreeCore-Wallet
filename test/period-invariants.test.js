import test from "node:test";
import assert from "node:assert/strict";
import { collectPeriod } from "../src/period-reader.js";
import { periodWindows } from "../src/period-plan.js";
import { emptyPeriodDraft, appendPeriodObservation, appendPeriodRecord, periodDraftProgress,
  periodDraftWorkspace, periodDraftKey, periodDraftAnchors } from "../src/period-draft.js";
import { preparePeriodFile, decodePeriodFile } from "../src/period-file.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { plan, context, periodSession, checkpoint, observation, record, event, hash, ACCOUNT, OTHER, THIRD,
  UNIT, clone, deferred, tick, code } from "./helpers/period-fixtures.js";

function random(seed) {
  let value = seed >>> 0;
  return max => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value % max;
  };
}

for (const [agent, account] of [["DAT", ACCOUNT], ["EMA", OTHER], ["CAWELON", THIRD]]) {
  test("partition-independent exact conservation through the collector: " + agent, async () => {
    const next = random(117 + agent.length);
    const partner = account === OTHER ? THIRD : OTHER;
    const rows = [];
    let expectedDelta = 0n;
    for (let i = 0; i < 40; i++) {
      const kind = next(3);
      const amount = BigInt(next(1000));
      const from = kind === 0 ? partner : account;
      const to = kind === 1 ? partner : account;
      if (to === account) expectedDelta += amount;
      if (from === account) expectedDelta -= amount;
      const block = 31 + next(30);
      rows.push(event({ blockNumber: String(block), blockHash: hash(block),
        from, to, amountBaseUnits: amount.toString() }, i + 100));
    }
    const totals = [];
    for (const windowSize of [3, 5, 15, 30]) {
      const selected = plan({ laterBlock: "60", windowSize }, context(agent, 84532, account));
      const f = periodSession(selected, { events: rows });
      const draft = await collectPeriod(f.session, selected);
      const slot = reconcileWorkspace(periodDraftWorkspace(draft)).slots.find(row => row.agent === agent);
      assert.equal(slot.status, "arithmetic-agreement");
      assert.equal(BigInt(draft.later.balanceBaseUnits) - BigInt(draft.earlier.balanceBaseUnits), expectedDelta);
      assert.equal(slot.totals.netTransferBaseUnits, expectedDelta.toString());
      assert.equal(slot.totals.eventCount, rows.length);
      totals.push(slot.totals.netTransferBaseUnits);
    }
    assert.equal(new Set(totals).size, 1);
  });
}

test("an event at the earlier block is excluded while the later block is included", async () => {
  const selected = plan({ windowSize: 12 });
  const rows = [
    event({ blockNumber: "30", blockHash: hash(30), from: OTHER, to: ACCOUNT, amountBaseUnits: "999" }, 10),
    event({ blockNumber: "42", blockHash: hash(42), from: OTHER, to: ACCOUNT, amountBaseUnits: "7" }, 11),
  ];
  const f = periodSession(selected, { events: rows });
  const result = await collectPeriod(f.session, selected);
  assert.equal(result.records[0].events.length, 1);
  assert.equal(result.records[0].events[0].blockNumber, "42");
  assert.equal(BigInt(result.later.balanceBaseUnits) - BigInt(result.earlier.balanceBaseUnits), 7n);
});

test("a self-transfer returned by both queries is counted once with zero net delta", async () => {
  const rows = [event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "7", blockNumber: "35", blockHash: hash(35) }, 50)];
  const f = periodSession(plan(), { events: rows });
  const draft = await collectPeriod(f.session, plan());
  const result = reconcileWorkspace(periodDraftWorkspace(draft)).slots[0];
  assert.equal(result.totals.eventCount, 1);
  assert.equal(result.totals.selfTransferCount, 1);
  assert.equal(result.totals.netTransferBaseUnits, "0");
  assert.equal(result.status, "arithmetic-agreement");
});

test("zero-value events remain in the captured evidence", async () => {
  const rows = [event({ from: OTHER, to: ACCOUNT, amountBaseUnits: "0", blockNumber: "35", blockHash: hash(35) }, 50)];
  const f = periodSession(plan(), { events: rows });
  const draft = await collectPeriod(f.session, plan());
  const result = reconcileWorkspace(periodDraftWorkspace(draft)).slots[0];
  assert.equal(result.totals.zeroValueCount, 1);
  assert.equal(result.totals.eventCount, 1);
  assert.equal(result.totals.netTransferBaseUnits, "0");
});

test("JSON save and resume after each successful checkpoint equals an uninterrupted result", async () => {
  const reference = await collectPeriod(periodSession().session, plan());
  for (let completed = 1; completed < 5; completed++) {
    let partial;
    const aborter = new AbortController();
    await assert.rejects(collectPeriod(periodSession().session, plan(), {
      signal: aborter.signal,
      onCheckpoint(value) {
        partial = value;
        if (periodDraftProgress(value).completed === completed) aborter.abort();
      },
    }), code("PERIOD_CANCELLED"));
    const disk = await preparePeriodFile(partial);
    const restored = (await decodePeriodFile(disk.text)).draft;
    const resumed = await collectPeriod(periodSession().session, plan(), { draft: restored });
    assert.equal(periodDraftKey(resumed), periodDraftKey(reference));
  }
});

test("maximum 12 windows and 6,000 events survive canonical save and reconciliation", async () => {
  const selected = plan({ earlierBlock: "0", laterBlock: "12", windowSize: 1 });
  let draft = emptyPeriodDraft(selected);
  draft = appendPeriodObservation(draft, "earlier", observation({ blockNumber: "0", blockHash: hash(0) }));
  draft = appendPeriodObservation(draft, "later", observation({ blockNumber: "12", blockHash: hash(12),
    balanceBaseUnits: (100n * UNIT + 6000n).toString() }));
  for (const window of periodWindows(selected)) {
    const rows = Array.from({ length: 500 }, (_, index) => event({
      blockNumber: window.fromBlock, blockHash: hash(window.fromBlock), from: OTHER, to: ACCOUNT,
      amountBaseUnits: "1",
    }, window.index * 500 + index));
    draft = appendPeriodRecord(draft, record(window.fromBlock, window.toBlock, rows));
  }
  assert.equal(periodDraftProgress(draft).events, 6000);
  assert.equal(periodDraftAnchors(draft).length, 13);
  const prepared = await preparePeriodFile(draft);
  const decoded = await decodePeriodFile(prepared.text);
  assert.equal(periodDraftKey(decoded.draft), periodDraftKey(draft));
  const result = reconcileWorkspace(periodDraftWorkspace(decoded.draft)).slots[0];
  assert.equal(result.status, "arithmetic-agreement");
  assert.equal(result.totals.netTransferBaseUnits, "6000");
});

test("repeated pause at the same prefix is idempotent, with no duplicate records", async () => {
  let draft = checkpoint(3);
  const before = periodDraftKey(draft);
  for (let attempt = 0; attempt < 3; attempt++) {
    const aborter = new AbortController();
    await assert.rejects(collectPeriod(periodSession().session, plan(), { draft, signal: aborter.signal,
      onProgress(value) { if (value.stage === "history") aborter.abort(); },
      onCheckpoint(value) { draft = value; },
    }), code("PERIOD_CANCELLED"));
    assert.equal(periodDraftKey(draft), before);
  }
  const complete = await collectPeriod(periodSession().session, plan(), { draft });
  assert.equal(complete.records.length, 3);
  assert.equal(new Set(complete.records.map(row => row.range.fromBlock)).size, 3);
});

test("unknown lower-level provider exceptions do not leak messages into public progress", async () => {
  const emitted = [];
  const f = periodSession(plan(), { before(method) {
    if (method === "native") throw Error("SECRET_TEST_PATH / account-details");
  } });
  let captured;
  try { await collectPeriod(f.session, plan(), { onProgress: value => emitted.push(value) }); }
  catch (error) { captured = error; }
  assert.equal(captured.code, "PERIOD_READ_FAILED");
  assert.equal(captured.message.includes("SECRET_TEST_PATH"), false);
  assert.equal(JSON.stringify(emitted).includes("SECRET_TEST_PATH"), false);
});

test("late timeout completion cannot emit further progress or checkpoint data", async () => {
  const gate = deferred();
  const f = periodSession(plan(), { before(method) { if (method === "native") return gate.promise; } });
  const emitted = [];
  const saved = [];
  await assert.rejects(collectPeriod(f.session, plan(), { timeoutMs: 10,
    onProgress: value => emitted.push(value), onCheckpoint: value => saved.push(value),
  }), code("PERIOD_TIMEOUT"));
  const count = emitted.length;
  gate.resolve();
  await tick();
  assert.equal(emitted.length, count);
  assert.equal(saved.length, 0);
});
