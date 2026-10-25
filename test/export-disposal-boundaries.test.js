import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { exportReceiptFixture } from "./helpers/export-receipt-fixtures.js";
import { microtasks } from "./helpers/secure-lifecycle-time.js";

for (const name of ["period-library", "period-report", "report-history", "report-set"]) {
  test("export disposal: " + name + " is already closed when abort listeners execute", async t => {
    const f = await exportReceiptFixture(name); t.after(f.dispose);
    const original = f.store.storage.read;
    let release, observed, reentered, reads = 0;
    const gate = new Promise(resolve => { release = resolve; });
    f.store.storage.read = options => {
      reads++;
      options.signal.addEventListener("abort", () => {
        observed = f.state();
        f.cancel(); // A stale owner cannot reopen admission during disposal.
        reentered = f.controller.refresh();
      }, { once: true });
      return gate.then(() => original(options));
    };
    const pending = f.controller.refresh();
    f.dispose();
    release();
    await microtasks();
    assert.equal(await pending, false);
    assert.equal(await reentered, false);
    assert.equal(observed.disposed, true);
    assert.equal(observed.busy, false);
    assert.equal(reads, 1, "abort callback must not dispatch a second storage read");
    assert.equal(f.state().busy, false);
    assert.equal(await f.controller.refresh(), false);
  });

  test("export disposal: " + name + " contains synchronous close failure and stays closed", async t => {
    const f = await exportReceiptFixture(name); t.after(f.dispose);
    let closes = 0;
    f.store.storage.close = () => { closes++; throw Error("private close failure"); };
    assert.doesNotThrow(f.dispose);
    f.dispose();
    assert.equal(closes, 1);
    assert.equal(f.state().disposed, true);
    assert.equal(f.state().busy, false);
    assert.equal(await f.controller.refresh(), false);
  });

  for (const kind of ["promise", "async-then"]) {
    test("export disposal: " + name + " observes " + kind + " close failure", () => {
      const helper = new URL("./helpers/export-receipt-fixtures.js", import.meta.url).href;
      const script = [
        "import {exportReceiptFixture} from " + JSON.stringify(helper) + ";",
        "const f=await exportReceiptFixture(" + JSON.stringify(name) + ");",
        "f.store.storage.close=()=>" + (kind === "promise" ?
          "Promise.reject(Error('private close detail'));" : "({async then(){throw Error('private close detail')}});"),
        "f.dispose();f.dispose();",
        "if(!f.state().disposed||f.state().busy)throw Error('not disposed');",
        "setTimeout(()=>console.log('contained'),15);",
      ].join("\n");
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { timeout: 10000, encoding: "utf8", windowsHide: true });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.equal(child.stdout.trim(), "contained");
    });
  }
}
