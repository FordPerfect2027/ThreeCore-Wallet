import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fixture, outcome, saveOperation, microtasks, document } from "./helpers/storage-guard-fixtures.js";
import { synchronousStorageValue, observeStorageCleanup } from "../src/storage-guard-policy.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const mode of ["read", "write"]) {
  for (const kind of ["promise", "thenable", "false", "getter", "changing-getter"]) {
    test("storage callback: " + mode + " refuses " + kind + " signal registration before opening", async t => {
      const f = fixture(t), aborter = new AbortController();
      let removals = 0, reads = 0;
      aborter.signal.removeEventListener = () => { removals++; };
      aborter.signal.addEventListener = () => {
        if (kind === "promise") return Promise.resolve();
        if (kind === "thenable") return { then(resolve) { resolve(); } };
        if (kind === "false") return false;
        if (kind === "getter") return { get then() { throw Error("private registration detail"); } };
        return { get then() { reads++; return reads === 1 ? resolve => resolve() : undefined; } };
      };
      const pending = outcome(mode === "read" ? f.storage.read({ signal: aborter.signal }) :
        f.storage.change(0, saveOperation(), { signal: aborter.signal }));
      // Settle the old implementation as well, so a regression fails rather than hangs.
      if (f.requests.length) { const tx = await f.open(); tx.read(); tx.complete(); }
      const result = await pending;
      await microtasks();
      assert.equal(result.code, "CHECKPOINT_ADAPTER");
      assert.equal(f.requests.length, 0);
      assert.equal(f.effects.puts, 0);
      assert.equal(f.guard.state().active, 0);
      assert.equal(f.time.pending, 0);
      assert(removals >= 1);
      if (kind === "changing-getter") assert.equal(reads, 1);
    });
  }

  test("storage callback: " + mode + " removes a listener attached after close", async t => {
    const f = fixture(t), aborter = new AbortController(), gate = deferred(), listeners = new Set();
    aborter.signal.addEventListener = (_type, listener) => gate.promise.then(() => listeners.add(listener));
    aborter.signal.removeEventListener = (_type, listener) => listeners.delete(listener);
    const pending = outcome(mode === "read" ? f.storage.read({ signal: aborter.signal }) :
      f.storage.change(0, saveOperation(), { signal: aborter.signal }));
    await microtasks();
    f.storage.close();
    gate.resolve();
    const result = await pending;
    await microtasks();
    assert.equal(result.code, "CHECKPOINT_ADAPTER");
    assert.equal(listeners.size, 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.guard.state().completed, 0);
  });

  test("storage callback: " + mode + " allows a synchronous native registration", async t => {
    const f = fixture(t), aborter = new AbortController();
    const pending = outcome(mode === "read" ? f.storage.read({ signal: aborter.signal }) :
      f.storage.change(0, saveOperation(), { signal: aborter.signal }));
    const tx = await f.open(); tx.read(); tx.complete();
    assert.equal((await pending).ok, true);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.time.pending, 0);
  });
}

for (const step of ["open", "transaction", "objectStore", "get", "put"]) {
  for (const kind of ["promise", "thenable", "getter"]) {
    test("storage callback: " + step + " refuses an asynchronous " + kind + " result", async t => {
      const f = fixture(t, { initial: document(0) });
      let reads = 0, settles = 0;
      const bad = () => kind === "promise" ? Promise.resolve({}) : {
        get then() {
          reads++;
          if (kind === "getter") throw Error("private callback detail");
          return resolve => { settles++; resolve({}); };
        },
      };
      if (step === "open") f.factory.open = bad;
      else if (step === "transaction") f.db.transaction = bad;
      else f.hooks.onTransaction = tx => { (step === "objectStore" ? tx : tx.store)[step] = bad; };
      const pending = outcome(f.storage.change(0, saveOperation()));
      if (step !== "open") {
        f.succeed(); await microtasks();
        const tx = f.transactions[0];
        if (step === "put") tx.read();
        // Before the fix, a put returning a Promise was reported as successful.
        if (step !== "transaction") tx.complete();
      }
      await microtasks();
      f.time.advance(101); f.time.flush();
      const result = await pending;
      assert.equal(result.code, "CHECKPOINT_ADAPTER");
      assert.equal(f.effects.commits, 0);
      assert.equal(f.guard.state().completed, 0);
      assert.equal(f.current().revision, 0);
      if (kind !== "promise") assert.equal(reads, 1);
      if (kind === "thenable") assert.equal(settles, 1);
    });
  }
}

test("storage callback: the synchronous-value contract reads a then getter only once", async () => {
  let reads = 0, calls = 0;
  const value = { get then() {
    reads++;
    if (reads !== 1) throw Error("private second getter");
    return (_resolve, reject) => { calls++; reject(Error("synthetic failure")); };
  } };
  assert.throws(() => synchronousStorageValue(value), error => error.code === "CHECKPOINT_ADAPTER");
  await microtasks();
  assert.equal(reads, 1);
  assert.equal(calls, 1);
});

test("storage callback: cleanup captures a then getter once", async () => {
  let reads = 0, calls = 0;
  observeStorageCleanup(() => ({ get then() {
    reads++;
    return resolve => { calls++; resolve(); };
  } }));
  await microtasks();
  assert.equal(reads, 1);
  assert.equal(calls, 1);
});

for (const kind of ["clock", "registration", "policy-async-then", "cleanup-async-then",
  "open", "transaction", "objectStore", "get", "put"]) {
  test("storage callback: rejected " + kind + " result does not leak an unhandled rejection", () => {
    const fixtureUrl = new URL("./helpers/storage-guard-fixtures.js", import.meta.url).href;
    const policyUrl = new URL("../src/storage-guard-policy.js", import.meta.url).href;
    const storageUrl = new URL("../src/checkpoint-storage.js", import.meta.url).href;
    const script = [
      "import { fixture, outcome, saveOperation, microtasks } from " + JSON.stringify(fixtureUrl) + ";",
      "import { synchronousStorageValue, observeStorageCleanup } from " + JSON.stringify(policyUrl) + ";",
      "import { createCheckpointStorage } from " + JSON.stringify(storageUrl) + ";",
      "const kind=" + JSON.stringify(kind) + ", cleanups=[];",
      "const f=fixture({after:work=>cleanups.push(work)});",
      "const bad=()=>Promise.reject(Error('synthetic private adapter detail'));",
      "const aborter=new AbortController();",
      "if(kind==='policy-async-then'||kind==='cleanup-async-then'){",
      "  const value={async then(){throw Error('synthetic async then detail')}};",
      "  try{if(kind==='policy-async-then')synchronousStorageValue(value);else observeStorageCleanup(()=>value)}catch{}",
      "}else{",
      "  let target=f.storage;",
      "  if(kind==='clock'){",
      "    target=createCheckpointStorage({indexedDB:f.factory,guard:f.guard,deadlineOptions:{...f.time.options,now:bad}});",
      "    cleanups.push(target.close);",
      "  }",
      "  if(kind==='registration')aborter.signal.addEventListener=bad;",
      "  if(kind==='open')f.factory.open=bad;",
      "  if(kind==='transaction')f.db.transaction=bad;",
      "  if(['objectStore','get','put'].includes(kind))f.hooks.onTransaction=tx=>{(kind==='objectStore'?tx:tx.store)[kind]=bad};",
      "  const pending=outcome(target.change(0,saveOperation(),{signal:aborter.signal}));",
      "  if(f.requests.length){f.succeed();await microtasks();const tx=f.transactions[0];if(tx){tx.read();tx.complete()}}",
      "  await microtasks();f.time.advance(101);f.time.flush();target.close();await pending;",
      "}",
      "for(const work of cleanups)await work();",
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
