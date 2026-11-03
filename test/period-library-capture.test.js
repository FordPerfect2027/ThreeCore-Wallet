import test from "node:test";
import assert from "node:assert/strict";
import { libraryArray, validateLibraryEntry, validatePeriodLibrary, emptyPeriodLibrary, mutatePeriodLibrary } from "../src/period-library-model.js";
import { libraryQuery } from "../src/period-library-query.js";
import { entry, library, saveOperation, id, LATER } from "./helpers/period-library-fixtures.js";
const ownOnly = value => new Proxy(value, { get() { throw Error("Unexpected live library read"); } });

test("period library array capture is detached and immutable", () => {
  const source = [1], result = libraryArray(source); source[0] = 2;
  assert.deepEqual(result, [1]); assert(Object.isFrozen(result));
});
test("period library entries keep captured names, flags and timestamps", () => {
  assert.deepEqual(validateLibraryEntry(ownOnly({ ...entry() })), entry());
});
test("period library captures document revision and exact bounded entries", () => {
  const input = library([entry()]);
  assert.deepEqual(validatePeriodLibrary(ownOnly({ ...input, entries: ownOnly([...input.entries]) })), input);
});
test("a changing array length cannot silently empty the period library", () => {
  const input = library([entry()]); let reads = 0;
  const entries = new Proxy([...input.entries], { get(target, key, receiver) {
    return key === "length" ? ++reads <= 2 ? 1 : 0 : Reflect.get(target, key, receiver);
  } });
  assert.equal(validatePeriodLibrary({ ...input, entries }).entries.length, 1); assert.equal(reads, 0);
});
test("period library save and rename use captured mutation operands", () => {
  const save = saveOperation();
  const result = mutatePeriodLibrary(emptyPeriodLibrary(), 0, ownOnly(save));
  assert.equal(result.entries.length, 1);
  assert.equal(mutatePeriodLibrary(result, 1, ownOnly({ kind: "rename", id: id(1), label: "Reviewed name", time: LATER })).entries[0].label, "Reviewed name");
});
test("period library mutation cannot change its discriminant during capture", () => {
  const operation = saveOperation(); let reads = 0;
  const value = new Proxy(operation, { getOwnPropertyDescriptor(target, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    return key === "kind" && ++reads > 1 ? { ...descriptor, value: "purge" } : descriptor;
  } });
  assert.throws(() => mutatePeriodLibrary(emptyPeriodLibrary(), 0, value), { code: "PERIOD_LIBRARY_OPERATION" });
});
test("revoked library mutation is rejected with a public operation error", () => {
  const { proxy, revoke } = Proxy.revocable(saveOperation(), {}); revoke();
  assert.throws(() => mutatePeriodLibrary(emptyPeriodLibrary(), 0, proxy), { code: "PERIOD_LIBRARY_OPERATION" });
});
test("library query merges defaults only with captured own input fields", () => {
  assert.deepEqual(libraryQuery(ownOnly({ search: "DAT", agent: "DAT" })), libraryQuery({ search: "DAT", agent: "DAT" }));
});
