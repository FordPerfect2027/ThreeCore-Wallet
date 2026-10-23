import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateLibraryEntry, validatePeriodLibrary, mutatePeriodLibrary, emptyPeriodLibrary } from "../src/period-library-model.js";
import { libraryQuery, queryPeriodLibrary, periodLibraryCSV } from "../src/period-library-query.js";
import { libraryErrorText, libraryErrorCode } from "../src/period-library-view.js";
import { createPeriodController } from "../src/period-controller.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import { entry, library, id, TIME, LATER, checkpoint, context, clone, code } from "./helpers/period-library-fixtures.js";

test("array subclasses cannot run a custom map implementation during validation", () => {
  let executed = 0;
  class CustomEntries extends Array {
    map() { executed++; return []; }
  }
  const entries = new CustomEntries(entry());
  assert.throws(() => validatePeriodLibrary({ ...emptyPeriodLibrary(), entries }), code("PERIOD_LIBRARY_CAPACITY"));
  assert.equal(executed, 0);
});

test("query accessors are rejected without executing an injected getter", () => {
  let reads = 0;
  const query = { get search() { reads++; return ""; } };
  assert.throws(() => libraryQuery(query), code("PERIOD_SHAPE"));
  assert.equal(reads, 0);
});

test("inherited query properties cannot alter the selected filter", () => {
  const query = Object.create({ agent: "EMA" });
  query.search = "saved";
  assert.throws(() => libraryQuery(query), code("PERIOD_SHAPE"));
});

for (const value of [null, false, 5, "", [], new Date()]) {
  test("invalid query container fails explicitly: " + String(value), () => {
    assert.throws(() => libraryQuery(value));
  });
}

test("symbol-valued extra query keys are not silently ignored", () => {
  const query = { search: "", [Symbol("hidden")]: true };
  assert.throws(() => libraryQuery(query), code("PERIOD_SHAPE"));
});

test("error presentation rejects prototype names and always returns ordinary text", () => {
  for (const name of ["__proto__", "constructor", "toString", null, undefined, 4, "PERIOD_LIBRARY_UNKNOWN"]) {
    const text = libraryErrorText(name);
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0);
    assert.ok(!text.includes("function Object"));
  }
});

test("an exception with an unsafe code getter is reduced to a stable UI error", () => {
  const failure = { get code() { throw Error("credential-like content"); } };
  assert.equal(libraryErrorCode(failure), "PERIOD_LIBRARY_FAILED");
  assert.ok(!libraryErrorText(libraryErrorCode(failure)).includes("credential"));
});

test("only known code prefixes can pass the UI error boundary", () => {
  assert.equal(libraryErrorCode({ code: "PERIOD_LIBRARY_STALE" }), "PERIOD_LIBRARY_STALE");
  assert.equal(libraryErrorCode({ code: "CHECKPOINT_QUOTA" }), "CHECKPOINT_QUOTA");
  for (const code of ["https://example.com/private", "<script>", "PERIOD_secret", "Error: raw", null, 9]) {
    assert.equal(libraryErrorCode({ code }), "PERIOD_LIBRARY_FAILED");
  }
});

test("the saved-period bridge validates metadata without invoking its getters", () => {
  let touched = 0;
  const controller = createPeriodController({ getContext: () => context(), read: async () => checkpoint() });
  const flags = { get requiresNewPlan() { touched++; return false; } };
  assert.equal(controller.stageSaved(checkpoint(3), flags), false);
  assert.equal(touched, 0);
  assert.equal(controller.state.review, null);
  controller.dispose();
});

test("empty evidence cannot be staged with a quarantine marker", () => {
  const controller = createPeriodController({ getContext: () => context(), read: async () => checkpoint() });
  assert.equal(controller.stageSaved(checkpoint(0), { requiresNewPlan: true }), false);
  assert.equal(controller.state.error, "PERIOD_LIBRARY_ENTRY");
  assert.equal(controller.state.review, null);
  controller.dispose();
});

test("extra saved-period bridge flags cannot expand restore behavior", () => {
  const controller = createPeriodController({ getContext: () => context(), read: async () => checkpoint() });
  assert.equal(controller.stageSaved(checkpoint(3), { requiresNewPlan: false, startReading: true }), false);
  assert.equal(controller.state.draft, null);
  assert.equal(controller.state.review, null);
  controller.dispose();
});

for (const value of [
  "2026-02-30T00:00:00.000Z",
  "2026-10-24T00:00:00Z",
  "2026-10-24T00:00:00.000+09:00",
  "2026-10-24",
  "not a date",
]) {
  test("noncanonical or impossible timestamp is rejected: " + value, () => {
    assert.throws(() => entry(1, { createdAt: value }), code("PERIOD_LIBRARY_TIME"));
  });
}

test("update time cannot precede creation time in portable records", () => {
  assert.throws(() => entry(1, { createdAt: LATER, updatedAt: TIME }), code("PERIOD_LIBRARY_ENTRY"));
});

test("entry shape rejects inherited, missing and non-enumerable hidden payloads", () => {
  const missing = { ...entry() };
  delete missing.requiresNewPlan;
  const decorated = { ...entry() };
  Object.defineProperty(decorated, "hidden", { value: "data" });
  const inherited = Object.assign(Object.create({ source: "other" }), entry());
  for (const value of [missing, decorated, inherited]) assert.throws(() => validateLibraryEntry(value), code("PERIOD_SHAPE"));
});

test("all supported operation mutations detach results from the caller's source objects", () => {
  const input = clone(entry());
  const initial = library([input]);
  input.label = "Changed outside";
  input.draft.earlier.balanceBaseUnits = "1";
  assert.equal(initial.entries[0].label, "控え 1");
  assert.notEqual(initial.entries[0].draft.earlier.balanceBaseUnits, "1");
  const imported = mutatePeriodLibrary(emptyPeriodLibrary(), 0, { kind: "import", entries: initial.entries });
  assert.ok(Object.isFrozen(imported.entries[0]));
  assert.ok(Object.isFrozen(imported.entries[0].draft.plan.context));
});

test("unknown document schema is not silently downgraded during portable decoding", async () => {
  const prepared = await preparePeriodLibraryFile(library([entry()]));
  const envelope = JSON.parse(prepared.text);
  envelope.document.schema = "threecore.period-library.v2";
  await assert.rejects(decodePeriodLibraryFile(JSON.stringify(envelope)), code("PERIOD_LIBRARY_SCHEMA"));
});

test("sequential metadata edits preserve evidence through repeated serialization", async () => {
  let document = library([
    entry(1, { draft: checkpoint(1) }),
    entry(2, { draft: checkpoint(2) }),
    entry(3, { draft: checkpoint(5), requiresNewPlan: true }),
  ]);
  const immutableEvidence = new Map(document.entries.map(row => [row.id, JSON.stringify(row.draft)]));
  const expected = new Map(document.entries.map(row => [row.id, { label: row.label, archived: false }]));
  let random = 0x12345678;
  for (let step = 0; step < 32; step++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const key = id(random % 3 + 1);
    const row = expected.get(key);
    if (step % 2 === 0) {
      row.label = "Review " + step;
      document = mutatePeriodLibrary(document, document.revision, { kind: "rename", id: key, label: row.label, time: LATER });
    } else {
      row.archived = !row.archived;
      document = mutatePeriodLibrary(document, document.revision, { kind: "archive", id: key, archived: row.archived, time: LATER });
    }
    if (step % 8 === 7) document = (await decodePeriodLibraryFile((await preparePeriodLibraryFile(document)).text)).document;
    for (const saved of document.entries) {
      assert.equal(saved.label, expected.get(saved.id).label);
      assert.equal(saved.archived, expected.get(saved.id).archived);
      assert.equal(JSON.stringify(saved.draft), immutableEvidence.get(saved.id));
    }
    const active = queryPeriodLibrary(document);
    assert.equal(active.matched, [...expected.values()].filter(row => !row.archived).length);
    assert.equal(periodLibraryCSV(document, { archive: "all" }).rows, 3);
  }
  assert.equal(document.entries[2].requiresNewPlan, true);
});

test("a collection imported from another source cannot expand per-draft schema capabilities", async () => {
  const envelope = JSON.parse((await preparePeriodLibraryFile(library([entry()]))).text);
  envelope.document.entries[0].draft.readOnly = false;
  await assert.rejects(decodePeriodLibraryFile(JSON.stringify(envelope)), code("PERIOD_DRAFT_SCHEMA"));
});

test("cross-context endpoint injection is rejected before any storage mutation", () => {
  const original = library([entry()]);
  const candidate = clone(entry(2));
  candidate.draft.earlier.account = "0x2222222222222222222222222222222222222222";
  assert.throws(() => mutatePeriodLibrary(original, 0, { kind: "import", entries: [candidate] }),
    code("PERIOD_CONTEXT_MISMATCH"));
  assert.equal(original.entries.length, 1);
});

test("library modules do not contain network, signing or account-request entry points", async () => {
  const paths = ["model", "storage", "file", "query", "view", "controller"].map(name =>
    new URL("../src/period-library-" + name + ".js", import.meta.url));
  paths.push(new URL("../examples/period-library-panel.js", import.meta.url));
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|eth_requestAccounts|eth_sendTransaction|personal_sign|eth_signTypedData/);
  }
});

test("model storage does not use floating-point conversion for historical amounts", async () => {
  for (const name of ["model", "file", "query"]) {
    const source = await readFile(new URL("../src/period-library-" + name + ".js", import.meta.url), "utf8");
    assert.doesNotMatch(source, /parseFloat|Number\([^)]*balance|Number\([^)]*amount/);
  }
});

test("new UI routes and scripts do not execute shell or provider calls", async () => {
  const source = await readFile(new URL("../scripts/check-period-library.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(|fetch\(|writeFile|appendFile/);
  assert.match(source, /readBoundedVaultPath/);
});
