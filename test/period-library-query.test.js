import test from "node:test";
import assert from "node:assert/strict";
import { libraryQuery, queryPeriodLibrary, summarizePeriodLibrary, periodLibraryCSV } from "../src/period-library-query.js";
import { sampleLibrary, library, entry, checkpoint, context, plan, TIME, LATER, id, code, ACCOUNT, OTHER } from "./helpers/period-library-fixtures.js";

test("default query hides archived records while retaining total capacity", () => {
  const value = queryPeriodLibrary(sampleLibrary());
  assert.equal(value.total, 4);
  assert.equal(value.matched, 3);
  assert.ok(value.rows.every(row => !row.archived));
  assert.equal(value.query.order, "newest");
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const archive of ["active", "archived", "all"]) {
    for (const status of ["all", "partial", "complete", "blocked"]) {
      test("combined query keeps all constraints: " + [agent, archive, status].join("/"), () => {
        const source = sampleLibrary();
        const result = queryPeriodLibrary(source, { agent, archive, status });
        for (const row of result.rows) {
          assert.equal(row.context.agent, agent);
          if (archive !== "all") assert.equal(row.archived, archive === "archived");
          if (status !== "all") assert.equal(row.status, status);
        }
        const expected = source.entries.filter(row => {
          const rowStatus = row.requiresNewPlan ? "blocked" : row.draft.records.length === 3 ? "complete" : "partial";
          return row.draft.plan.context.agent === agent &&
            (archive === "all" || row.archived === (archive === "archived")) &&
            (status === "all" || rowStatus === status);
        });
        assert.deepEqual(result.rows.map(row => row.id).sort(), expected.map(row => row.id).sort());
      });
    }
  }
}

test("search finds names case-insensitively and trims input", () => {
  assert.deepEqual(queryPeriodLibrary(sampleLibrary(), { search: "  ema  " }).rows.map(row => row.id), [id(2)]);
  assert.deepEqual(queryPeriodLibrary(sampleLibrary(), { search: "再取得" }).rows.map(row => row.id), [id(3)]);
});

test("search can identify exact public account, record ID, chain and period", () => {
  for (const search of [OTHER, id(2)]) {
    assert.deepEqual(queryPeriodLibrary(sampleLibrary(), { search }).rows.map(row => row.id), [id(2)]);
  }
  assert.equal(queryPeriodLibrary(sampleLibrary(), { search: "84532" }).matched, 2);
  assert.equal(queryPeriodLibrary(sampleLibrary(), { search: "42" }).matched, 3);
});

test("no-match search produces an empty result without discarding the saved document", () => {
  const source = sampleLibrary();
  assert.equal(queryPeriodLibrary(source, { search: "no such name" }).matched, 0);
  assert.equal(source.entries.length, 4);
});

test("sort order is deterministic with stable ID tie breaks", () => {
  const source = library([
    entry(3, { label: "B", updatedAt: LATER }),
    entry(2, { label: "A", updatedAt: TIME }),
    entry(1, { label: "A", updatedAt: TIME }),
  ]);
  assert.deepEqual(queryPeriodLibrary(source, { order: "newest" }).rows.map(row => row.id), [id(3), id(1), id(2)]);
  assert.deepEqual(queryPeriodLibrary(source, { order: "oldest" }).rows.map(row => row.id), [id(1), id(2), id(3)]);
  assert.deepEqual(queryPeriodLibrary(source, { order: "name" }).rows.map(row => row.id), [id(1), id(2), id(3)]);
  assert.deepEqual(source.entries.map(row => row.id), [id(3), id(2), id(1)]);
});

test("progress sort is a completion ratio, never a token balance ranking", () => {
  const source = library([
    entry(1, { draft: checkpoint(0) }),
    entry(2, { draft: checkpoint(5) }),
    entry(3, { draft: checkpoint(3) }),
  ]);
  const result = queryPeriodLibrary(source, { order: "progress" });
  assert.deepEqual(result.rows.map(row => row.id), [id(2), id(3), id(1)]);
});

for (const query of [
  { agent: "BTC" }, { archive: "deleted" }, { status: "trusted" }, { order: "balance" },
  { search: "\u202e" }, { search: "x".repeat(101) }, { search: 3 }, { extra: true },
]) {
  test("invalid filter is surfaced instead of weakening the search: " + JSON.stringify(query), () => {
    assert.throws(() => libraryQuery(query));
  });
}

test("query results are immutable views with no write-back path", () => {
  const result = queryPeriodLibrary(sampleLibrary());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
  assert.ok(Object.isFrozen(result.rows[0]));
  assert.throws(() => { result.rows[0].label = "Changed"; }, TypeError);
});

test("token summary counts acquisition states separately from archive states", () => {
  const result = summarizePeriodLibrary(sampleLibrary());
  assert.deepEqual(result.agents[0], { agent: "DAT", count: 2, active: 1, archived: 1,
    partial: 2, complete: 0, blocked: 0, contexts: 1 });
  assert.equal(result.agents[1].complete, 1);
  assert.equal(result.agents[2].blocked, 1);
  assert.equal(result.eventCountsAreUnique, false);
  assert.equal(result.automaticallyMerged, false);
});

test("same token on another account or chain has a distinct connection context", () => {
  const source = library([
    entry(1, { draft: checkpoint(1, plan({}, context("DAT", 8453, ACCOUNT))) }),
    entry(2, { draft: checkpoint(1, plan({}, context("DAT", 8453, OTHER))) }),
    entry(3, { draft: checkpoint(1, plan({}, context("DAT", 84532, ACCOUNT))) }),
  ]);
  const summary = summarizePeriodLibrary(source);
  assert.equal(summary.agents[0].contexts, 3);
  assert.ok(!JSON.stringify(summary).includes("balance"));
  assert.equal(summary.agents[1].count, 0);
});

test("CSV uses the selected filters and discloses included public accounts", () => {
  const csv = periodLibraryCSV(sampleLibrary(), { agent: "EMA" });
  assert.equal(csv.rows, 1);
  assert.equal(csv.includesPublicAccounts, true);
  assert.equal(csv.containsBalances, false);
  assert.ok(csv.text.includes(OTHER));
  assert.ok(!csv.text.includes("DAT 途中"));
  assert.ok(csv.text.includes('"events_in_record"'));
  assert.ok(!csv.text.includes("balanceBaseUnits"));
  assert.ok(csv.text.endsWith("\r\n"));
});

for (const prefix of ["=", "+", "-", "@"]) {
  test("CSV escapes spreadsheet formula prefix " + prefix, () => {
    const csv = periodLibraryCSV(library([entry(1, { label: prefix + "command(1)" })]));
    assert.ok(csv.text.includes(String.fromCharCode(34, 39) + prefix + "command(1)"));
  });
}

test("CSV doubles quotes and quotes fields containing commas", () => {
  const csv = periodLibraryCSV(library([entry(1, { label: 'DAT, "October"' })]));
  assert.ok(csv.text.includes('"DAT, ""October"""'));
});

test("empty search result CSV contains only a header, never hidden rows", () => {
  const csv = periodLibraryCSV(sampleLibrary(), { search: "no match" });
  assert.equal(csv.rows, 0);
  assert.equal(csv.text.trim().split("\r\n").length, 1);
});

test("archive-inclusive CSV is an explicit choice", () => {
  assert.equal(periodLibraryCSV(sampleLibrary()).rows, 3);
  assert.equal(periodLibraryCSV(sampleLibrary(), { archive: "all" }).rows, 4);
  assert.equal(periodLibraryCSV(sampleLibrary(), { archive: "archived" }).rows, 1);
});
