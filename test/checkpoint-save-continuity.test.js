import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { draft, CONTRACTS, gate, until } from "./helpers/workspace-fixtures.js";
import { memoryStorage, id, TIME } from "./helpers/checkpoint-fixtures.js";

function fixture(readDraft) {
  const storage = memoryStorage();
  let controller, reads = 0, nextId = 0;
  controller = createCheckpointController({ storage,
    readDraft: () => readDraft(++reads, controller),
    now: () => TIME, createId: () => id(++nextId),
    onStage: () => {}, download: () => {},
  });
  return { storage, controller };
}

for (const failure of ["throw", "malformed"]) {
  test(`saved checkpoint remains successful when post-commit draft read is ${failure}`, async t => {
    const f = fixture(count => {
      if (count === 4) {
        if (failure === "throw") throw Error("Draft no longer available");
        return [];
      }
      return draft();
    });
    t.after(() => f.controller.dispose());
    await f.controller.refresh();
    assert.equal(await f.controller.save("confirmed write"), true);
    assert.equal(f.storage.current().entries.length, 1);
    assert.equal(f.controller.state().lastAction, "save");
    assert.equal(f.controller.state().errorCode, null);
    assert.equal(f.controller.state().currentDraftChanged, true);
  });
}

test("disposal inside commit-time draft read cannot authorize a checkpoint write", async () => {
  const f = fixture((count, controller) => {
    if (count === 3) controller.dispose();
    return draft();
  });
  await f.controller.refresh();
  const before = f.storage.current();
  assert.equal(await f.controller.save("stopped"), false);
  assert.deepEqual(f.storage.current(), before);
  assert.equal(f.controller.state().disposed, true);
  assert.equal(f.controller.state().lastAction, null);
});

for (const readNumber of [1, 2, 3, 4]) {
  for (const failure of ["promise", "async-then"]) {
    test(`draft callback ${readNumber} contains ${failure} rejection without false save status`, () => {
      const controllerUrl = new URL("../src/checkpoint-controller.js", import.meta.url).href;
      const fixturesUrl = new URL("./helpers/checkpoint-fixtures.js", import.meta.url).href;
      const draftsUrl = new URL("./helpers/workspace-fixtures.js", import.meta.url).href;
      const rejected = failure === "promise" ? "Promise.reject(Error('private detail'))" :
        "({ async then() { throw Error('private detail'); } })";
      const script = `import assert from 'node:assert/strict';
        import {createCheckpointController} from ${JSON.stringify(controllerUrl)};
        import {memoryStorage,id,TIME} from ${JSON.stringify(fixturesUrl)};
        import {draft} from ${JSON.stringify(draftsUrl)};
        const storage=memoryStorage(); let reads=0;
        const c=createCheckpointController({storage,
          readDraft:()=>++reads===${readNumber}?${rejected}:draft(),
          now:()=>TIME,createId:()=>id(1),onStage:()=>{},download:()=>{}});
        await c.refresh(); const result=await c.save('snapshot');
        assert.equal(result,${readNumber === 4});
        assert.equal(storage.current().entries.length,${readNumber === 4 ? 1 : 0});
        assert(!JSON.stringify(c.state()).includes('private detail'));
        if(result) { assert.equal(c.state().lastAction,'save'); assert(c.state().currentDraftChanged); }
        c.dispose(); setTimeout(()=>console.log('contained'),10);`;
      const child = spawnSync(process.execPath,
        ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { timeout: 10000, encoding: "utf8" });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.equal(child.stdout.trim(), "contained");
    });
  }
}

for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  test(`${agent} account change while saving preserves the prior checkpoint and allows a fresh explicit save`, async t => {
    const current = draft();
    const f = fixture(() => current); t.after(() => f.controller.dispose());
    await f.controller.refresh();
    assert.equal(await f.controller.save("original"), true);
    const before = f.storage.current();
    const pending = gate(); let entered = false;
    f.storage.onChange(() => { entered = true; return pending.promise; });
    const saving = f.controller.save("stale account");
    await until(() => entered);
    current[index].account = CONTRACTS[index];
    f.controller.invalidateDraft();
    pending.resolve();
    assert.equal(await saving, false);
    assert.equal(f.controller.state().errorCode, "CHECKPOINT_DRAFT_CHANGED");
    assert.deepEqual(f.storage.current(), before);
    f.storage.onChange(async () => {});
    assert.equal(await f.controller.save("new account"), true);
    const saved = f.storage.current();
    assert.equal(saved.entries.length, 2);
    assert.deepEqual(saved.entries[0], before.entries[0]);
    const file = await decodeWorkspaceFile(new TextEncoder().encode(saved.entries[1].fileText));
    const restored = file.workspace.entries[index];
    assert.equal(restored.account, CONTRACTS[index]);
    assert.equal(restored.history.reports.length, 1);
    assert.notEqual(restored.history.reports[0].snapshot.account, restored.account);
  });
}
