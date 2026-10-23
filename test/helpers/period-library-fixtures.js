import { emptyPeriodLibrary, validatePeriodLibrary, validateLibraryEntry, mutatePeriodLibrary } from "../../src/period-library-model.js";
import { periodFail } from "../../src/period-plan.js";
import { checkpoint, plan, context, clone, deferred, tick, fileFrom, code, ACCOUNT, OTHER, THIRD } from "./period-fixtures.js";

export { checkpoint, plan, context, clone, deferred, tick, fileFrom, code, ACCOUNT, OTHER, THIRD };
export const TIME = "2026-10-24T01:00:00.000Z";
export const LATER = "2026-10-24T02:00:00.000Z";
export const id = number => "12345678-1234-4234-8234-" + String(number).padStart(12, "0");

export function entry(number = 1, changes = {}) {
  return validateLibraryEntry({
    id: id(number),
    label: "控え " + number,
    createdAt: TIME,
    updatedAt: TIME,
    archived: false,
    requiresNewPlan: false,
    draft: checkpoint(3),
    ...changes,
  });
}

export function library(entries = [], revision = 0) {
  return validatePeriodLibrary({ ...emptyPeriodLibrary(), revision, entries });
}

export function saveOperation(number = 1, draft = checkpoint(3), changes = {}) {
  return { kind: "save", id: id(number), label: "控え " + number, time: TIME,
    draft, requiresNewPlan: false, ...changes };
}

export function sampleLibrary() {
  return library([
    entry(1, { label: "DAT 途中", draft: checkpoint(3) }),
    entry(2, { label: "EMA 取得済み", draft: checkpoint(5, plan({}, context("EMA", 84532, OTHER))) }),
    entry(3, { label: "CAWELON 要再取得", requiresNewPlan: true,
      draft: checkpoint(2, plan({}, context("CAWELON", 84532, THIRD))) }),
    entry(4, { label: "DAT 古い保管", archived: true, draft: checkpoint(1) }),
  ], 4);
}

/** Browser and unit fixtures share the production schema but have isolated storage. */
export function memoryStorage(initial = emptyPeriodLibrary(), hooks = {}) {
  let document = validatePeriodLibrary(initial);
  let closed = false;
  const calls = [];
  const storage = {
    async read() {
      calls.push(["read"]);
      await hooks.beforeRead?.();
      if (closed) periodFail("CHECKPOINT_CLOSED");
      return clone(document);
    },
    async change(revision, operation, config = {}) {
      calls.push(["change", revision, clone(operation)]);
      await hooks.beforeChange?.();
      if (closed || config.signal?.aborted || config.canCommit?.() === false) periodFail("CHECKPOINT_CANCELLED");
      document = mutatePeriodLibrary(document, revision, operation);
      await hooks.afterChange?.();
      return clone(document);
    },
    close() { closed = true; calls.push(["close"]); },
  };
  return {
    storage, calls,
    get document() { return document; },
    get closed() { return closed; },
    replace(value) { document = validatePeriodLibrary(value); },
    external(operation) { document = mutatePeriodLibrary(document, document.revision, operation); },
  };
}

export function walk(node) {
  return [node, ...Array.from(node.children ?? []).flatMap(walk)];
}

export function randomLibraryName(prefix = "unit") {
  return "threecore-test-period-library-" + prefix + "-" + crypto.randomUUID();
}
