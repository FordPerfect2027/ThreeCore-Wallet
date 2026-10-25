import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { CHECKPOINT_HANDOFFS, checkpointReceiptFixture } from "./helpers/checkpoint-receipt-fixtures.js";
import { microtasks } from "./helpers/secure-lifecycle-time.js";

for (const action of CHECKPOINT_HANDOFFS) {
  for (const kind of ["false", "promise", "thenable", "changing-getter", "throwing-getter", "throw"]) {
    test(`checkpoint receipt: ${action} rejects ${kind} without changing stored data`, async t => {
      let reads = 0, deliveries = 0, settled = 0;
      const f = await checkpointReceiptFixture(() => {
        deliveries++;
        if (kind === "false") return false;
        if (kind === "promise") return Promise.resolve(true);
        if (kind === "throw") throw Error("private callback detail");
        return { get then() {
          reads++;
          if (kind === "throwing-getter") throw Error("private getter detail");
          if (kind === "changing-getter" && reads > 1) return undefined;
          return resolve => { settled++; resolve(true); };
        } };
      });
      t.after(f.dispose);
      const before = f.storage.current();
      assert.equal(await f.send(action), false);
      await microtasks();
      const state = f.controller.state();
      assert.equal(deliveries, 1);
      assert.equal(state.phase, "error");
      assert.equal(state.lastAction, null);
      assert.equal(state.busy, false);
      assert(state.errorCode);
      assert(!JSON.stringify(state).includes("private"));
      assert.deepEqual(f.storage.current(), before);
      if (kind.includes("getter") || kind === "thenable") assert.equal(reads, 1);
      if (kind === "thenable" || kind === "changing-getter") assert.equal(settled, 1);
      // A fresh explicit attempt may succeed; it never overwrites the backup.
      f.setCallback(() => true);
      assert.equal(await f.send(action), true);
      assert.deepEqual(f.storage.current(), before);
    });
  }

  for (const receipt of [undefined, true]) {
    test(`checkpoint receipt: ${action} preserves ${String(receipt)} callback compatibility`, async t => {
      const f = await checkpointReceiptFixture(() => receipt); t.after(f.dispose);
      assert.equal(await f.send(action), true);
      assert.equal(f.controller.state().lastAction, action === "exportFile" ? "export" : action);
    });
  }

  test(`checkpoint receipt: ${action} disposal during delivery cannot announce success`, async t => {
    const f = await checkpointReceiptFixture(); t.after(f.dispose);
    const before = f.storage.current();
    f.setCallback(() => { f.dispose(); return true; });
    assert.equal(await f.send(action), false);
    assert.equal(f.controller.state().lastAction, null);
    assert.equal(f.controller.state().disposed, true);
    assert.equal(f.controller.state().busy, false);
    assert.deepEqual(f.storage.current(), before);
  });

  for (const kind of ["promise", "async-then"]) {
    test(`checkpoint receipt: ${action} contains ${kind} rejection`, () => {
      const helper = new URL("./helpers/checkpoint-receipt-fixtures.js", import.meta.url).href;
      const callback = kind === "promise" ? "Promise.reject(Error('private detail'))" :
        "({async then(){throw Error('private detail')}})";
      const script = `import {checkpointReceiptFixture} from ${JSON.stringify(helper)};
        const f=await checkpointReceiptFixture(()=>${callback});
        try{if(await f.send(${JSON.stringify(action)})!==false)throw Error('false success')}
        finally{f.dispose()}
        setTimeout(()=>console.log('contained'),15);`;
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { timeout: 10000, encoding: "utf8", windowsHide: true });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.equal(child.stdout.trim(), "contained");
    });
  }
}

test("checkpoint disposal: read abort listeners observe a terminal non-busy controller", async t => {
  const f = await checkpointReceiptFixture(); t.after(f.dispose);
  let release, during, reentered, reads = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const before = f.storage.current();
  f.storage.read = options => {
    reads++;
    options.signal.addEventListener("abort", () => {
      during = f.controller.state();
      reentered = f.controller.refresh();
    });
    return gate.then(() => before);
  };
  const pending = f.controller.refresh();
  f.dispose(); release();
  assert.equal(await pending, false);
  assert.equal(await reentered, false);
  assert.equal(during.disposed, true);
  assert.equal(during.busy, false);
  assert.equal(reads, 1);
});

test("checkpoint disposal: close exception is contained and disposal remains idempotent", async () => {
  const f = await checkpointReceiptFixture();
  let closes = 0;
  f.storage.close = () => { closes++; throw Error("private close detail"); };
  assert.doesNotThrow(f.dispose);
  f.dispose();
  assert.equal(closes, 1);
  assert.equal(await f.controller.refresh(), false);
});
