import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { memoryStorage, id, TIME } from "./helpers/checkpoint-fixtures.js";
import { draft } from "./helpers/workspace-fixtures.js";

for (const shape of ["accessor", "prototype-trap", "descriptor-trap", "revoked-proxy"]) {
  test(`checkpoint contains ${shape} errors and permits explicit recovery`, async () => {
    let accesses = 0, broken = false, nextId = 0;
    let problem;
    if (shape === "accessor") problem = { get code() { accesses++; throw Error("private detail"); } };
    if (shape === "prototype-trap") problem = new Proxy({}, { getPrototypeOf() { accesses++; throw Error("private detail"); } });
    if (shape === "descriptor-trap") problem = new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private detail"); } });
    if (shape === "revoked-proxy") { const pair = Proxy.revocable({}, {}); pair.revoke(); problem = pair.proxy; }
    const storage = memoryStorage();
    const c = createCheckpointController({ storage: {
      read: (...args) => { if (broken) throw problem; return storage.read(...args); },
      change: (...args) => storage.change(...args), close: () => storage.close(),
    }, readDraft: draft, now: () => TIME, createId: () => id(++nextId), onStage: () => {}, download: () => {} });
    try {
      await c.refresh(); assert.equal(await c.save("original"), true);
      const before = storage.current(); broken = true;
      assert.equal(await c.refresh(), false);
      assert.equal(c.state().errorCode, "CHECKPOINT_ACTION");
      assert.equal(c.state().busy, false);
      assert.equal(accesses, 0, "Error handling must not invoke code getters or prototype traps");
      assert.deepEqual(storage.current(), before);
      broken = false;
      assert.equal(await c.refresh(), true);
      assert.equal(await c.save("recovered"), true);
      assert.equal(storage.current().entries.length, 2);
    } finally { c.dispose(); }
  });
}
