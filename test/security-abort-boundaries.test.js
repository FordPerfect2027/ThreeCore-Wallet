import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createFileReadService } from "../src/file-read-service.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));
function fixture(t, name) {
  const time = manualTime();
  const service = name === "file" ? createFileReadService(time.options) : createSecureBackupRunner(time.options);
  t.after(service.dispose);
  let calls = 0;
  const run = (signal, wait) => name === "file" ? service.readText({ size: 1,
    async arrayBuffer() { calls++; if (wait) await wait; return new Uint8Array([65]).buffer; }
  }, { signal }) : service.run(async () => { calls++; if (wait) await wait; return "A"; }, { signal });
  return { service, time, run, calls: () => calls, cancelled: name === "file" ? "FILE_CANCELLED" : "SECURE_CANCELLED",
    invalid: name === "file" ? "FILE_READ" : "SECURE_INTERNAL" };
}

for (const name of ["file", "crypto"]) {
  test(`abort boundary: ${name} uses native state even with a shadowed aborted property`, async t => {
    const f = fixture(t, name), abort = new AbortController();
    Object.defineProperty(abort.signal, "aborted", { value: false });
    abort.abort();
    assert.deepEqual(await outcome(f.run(abort.signal)), { code: f.cancelled });
    assert.equal(f.calls(), 0);
  });

  for (const phase of ["before-dispatch", "after-dispatch"]) {
    test(`abort boundary: ${name} detects silent native abort ${phase}`, async t => {
      const f = fixture(t, name), abort = new AbortController(), gate = deferred();
      // A host listener wrapper can lose an event without changing native state.
      abort.signal.addEventListener = () => {};
      Object.defineProperty(abort.signal, "aborted", { value: false });
      const pending = outcome(f.run(abort.signal, gate.promise));
      if (phase === "after-dispatch") await microtasks();
      abort.abort(); gate.resolve();
      assert.deepEqual(await pending, { code: f.cancelled });
      assert.equal(f.calls(), phase === "before-dispatch" ? 0 : 1);
      assert.equal(f.service.state().completed, 0);
      assert.equal(f.time.pending, 0);
    });

    test(`abort boundary: ${name} detects silent adapter abort ${phase}`, async t => {
      const f = fixture(t, name), gate = deferred();
      const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
      const pending = outcome(f.run(signal, gate.promise));
      if (phase === "after-dispatch") await microtasks();
      signal.aborted = true; gate.resolve();
      assert.deepEqual(await pending, { code: f.cancelled });
      assert.equal(f.calls(), phase === "before-dispatch" ? 0 : 1);
      assert.equal(f.service.state().completed, 0);
    });
  }

  for (const kind of ["promise", "thenable", "false", "getter", "changing-getter"]) {
    test(`abort boundary: ${name} rejects ${kind} listener registration before work`, async t => {
      const f = fixture(t, name);
      let removals = 0, getterReads = 0;
      const signal = { aborted: false,
        addEventListener() {
          if (kind === "promise") return Promise.resolve();
          if (kind === "thenable") return { then(resolve) { resolve(); } };
          if (kind === "false") return false;
          if (kind === "getter") return { get then() { throw Error("synthetic adapter detail"); } };
          return { get then() { getterReads++; return getterReads === 1 ? resolve => resolve() : undefined; } };
        },
        removeEventListener() { removals++; }
      };
      assert.deepEqual(await outcome(f.run(signal)), { code: f.invalid });
      await microtasks();
      assert.equal(f.calls(), 0);
      assert(removals >= 1);
      assert.equal(f.time.pending, 0);
      if (kind === "changing-getter") assert.equal(getterReads, 1);
    });
  }

  test(`abort boundary: ${name} releases listener installed after local refusal`, async t => {
    const f = fixture(t, name), gate = deferred(), listeners = new Set();
    const signal = { aborted: false,
      addEventListener(_name, listener) { return gate.promise.then(() => listeners.add(listener)); },
      removeEventListener(_name, listener) { listeners.delete(listener); }
    };
    const pending = outcome(f.run(signal));
    await microtasks();
    assert.equal(f.calls(), 0);
    f.service.dispose();
    gate.resolve();
    assert.deepEqual(await pending, { code: f.invalid });
    await microtasks();
    assert.equal(listeners.size, 0);
    assert.equal(f.time.pending, 0);
  });

  for (const field of ["addEventListener", "removeEventListener", "aborted"]) {
    test(`abort boundary: ${name} consumes rejected ${field} adapter result`, () => {
      const module = name === "file" ? "file-read-service.js" : "secure-backup-runner.js";
      const factory = name === "file" ? "createFileReadService" : "createSecureBackupRunner";
      const url = new URL("../src/" + module, import.meta.url).href;
      const script = `
        import { ${factory} as create } from ${JSON.stringify(url)};
        const name=${JSON.stringify(name)}, field=${JSON.stringify(field)};
        const bad=()=>Promise.reject(Error("synthetic private signal detail"));
        const service=create({now:()=>100,schedule:()=>1,unschedule:()=>{}});
        const signal={aborted:false, addEventListener(){}, removeEventListener(){}};
        if(field==='aborted')Object.defineProperty(signal,field,{get:bad});
        else signal[field]=bad;
        try {
          if(name==='file')await service.readText({size:1,arrayBuffer:async()=>new Uint8Array([65]).buffer},{signal});
          else await service.run(()=>"A",{signal});
        }catch{}
        service.dispose();setTimeout(()=>console.log('contained'),15);
      `;
      const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
        { timeout: 10000, encoding: "utf8", windowsHide: true });
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.equal(child.stdout.trim(), "contained");
    });
  }
}
