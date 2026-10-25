import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";
import { createFileReadService } from "../src/file-read-service.js";
import { createExportGuard } from "../src/export-guard.js";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { createSecurityLock } from "../src/security-lock.js";
import { createSecureDeadline } from "../src/secure-deadline.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { deterministicCrypto, transportFixture, EPOCH } from "./helpers/tab-guard-fixtures.js";
import { prepared } from "./helpers/export-fixtures.js";
import { fallbackFile } from "./helpers/file-boundary-fixtures.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";

function outcome(work) {
  return Promise.resolve().then(work).then(value => ({ ok: true, value }),
    error => ({ ok: false, code: error.code }));
}

function subject(name, options) {
  let effects = 0;
  if (name === "rpc") {
    const service = createRpcSupervisor(options);
    return { run: () => outcome(() => service.start({ provider: {}, invoke() { effects++; return "result"; } }).promise),
      close: service.dispose, state: service.state, effects: () => effects, code: "RPC_TIMER" };
  }
  if (name === "file") {
    const service = createFileReadService(options), file = fallbackFile();
    return { run: () => outcome(() => service.readText(file.file)), close: service.dispose,
      state: service.state, effects: file.calls, code: "FILE_READ" };
  }
  if (name === "export") {
    const service = createExportGuard({ ...options,
      createResource: () => ({ activate() { effects++; }, release() { return true; } }) });
    return { run: () => outcome(() => service.offer(prepared())), close: service.dispose,
      state: service.state, effects: () => effects, code: "EXPORT_FAILED" };
  }
  if (name === "tab") {
    const wire = transportFixture();
    const service = createTabGuard({ ...options, transport: wire.transport,
      crypto: deterministicCrypto(), onStop: () => true });
    service.start();
    return { run: async () => ({ ok: service.stop(), code: service.state().errorCode }),
      close: service.dispose, state: service.state, effects: () => wire.posts.length, code: "TAB_CONFIG" };
  }
  if (name === "lock") {
    const service = createSecurityLock(options);
    return { run: async () => ({ ok: service.check(), code: service.state().fault }),
      close: service.dispose, state: service.state, effects: () => 0, code: "timer" };
  }
  if (name === "deadline") {
    const service = createSecureDeadline(options);
    return { run: async () => ({ ok: service.arm(), code: service.state().fault }),
      close: service.dispose, state: service.state, effects: () => 0, code: "SECURE_TIMER" };
  }
  const service = createSecureBackupRunner(options);
  return { run: () => outcome(() => service.run(() => { effects++; return "result"; })),
    close: service.dispose, state: service.state, effects: () => effects, code: "SECURE_TIMER" };
}

const names = ["rpc", "file", "export", "tab", "lock", "deadline", "crypto"];
const invalidResults = {
  missing: () => undefined,
  null: () => null,
  false: () => false,
  promise: id => Promise.resolve(id),
  thenable: id => ({ then(resolve) { resolve(id); } }),
  rejecting: () => ({ then(_resolve, reject) { reject(Error("synthetic private adapter")); } }),
  getter: () => ({ get then() { throw Error("synthetic private accessor"); } }),
};

for (const name of names) {
  for (const [kind, result] of Object.entries(invalidResults)) {
    test(`adapter matrix: ${name} refuses ${kind} timer before effects`, async t => {
      const time = manualTime(EPOCH);
      // Missing handles represent no registration; asynchronous values carry
      // a real synthetic handle so late cleanup is separately observable.
      const registered = ["promise", "thenable"].includes(kind);
      const service = subject(name, { ...time.options,
        schedule(fn, ms) { return result(registered ? time.schedule(fn, ms) : 7); } });
      t.after(service.close);
      const actual = await service.run();
      await microtasks();
      assert.equal(actual.ok, false);
      assert.equal(actual.code, service.code);
      assert.equal(service.effects(), 0, "No protected side effect before timer validation");
      assert.equal(time.pending, 0, "Late registration must be released");
      assert(!JSON.stringify(service.state()).includes("synthetic private"));
    });
  }
}

for (const name of names) {
  test(`adapter matrix: ${name} still accepts synchronous timer handle zero`, async t => {
    const time = manualTime(EPOCH);
    const service = subject(name, { ...time.options, schedule: () => 0 });
    t.after(service.close);
    const actual = await service.run();
    assert.equal(actual.ok, true);
  });
}

for (const name of names) {
  test(`adapter matrix: late ${name} timer settles after disposal without revival`, async () => {
    const time = manualTime(EPOCH);
    let resolveHandle, id;
    const promise = new Promise(resolve => { resolveHandle = resolve; });
    const service = subject(name, { ...time.options,
      schedule(fn, ms) { id = time.schedule(fn, ms); return promise; } });
    const result = await service.run();
    service.close();
    const before = service.state();
    resolveHandle(id);
    await microtasks();
    assert(time.removed.includes(id));
    time.fire(id, { stale: true });
    assert.equal(result.ok, false);
    assert.equal(service.effects(), 0);
    assert.deepEqual(service.state(), before);
    assert.equal(time.pending, 0);
  });
}

const imports = {
  rpc: ["rpc-supervisor.js", "createRpcSupervisor"],
  file: ["file-read-service.js", "createFileReadService"],
  export: ["export-guard.js", "createExportGuard"],
  tab: ["tab-guard-controller.js", "createTabGuard"],
  lock: ["security-lock.js", "createSecurityLock"],
  deadline: ["secure-deadline.js", "createSecureDeadline"],
  crypto: ["secure-backup-runner.js", "createSecureBackupRunner"],
};

for (const name of names) {
  for (const fault of ["clock", "schedule", "cleanup"]) {
    test(`adapter rejection: native ${name} ${fault} rejection stays contained`, () => {
      const [filename, factory] = imports[name];
      const url = new URL("../src/" + filename, import.meta.url).href;
      const script = `
        import { ${factory} as create } from ${JSON.stringify(url)};
        const fault = ${JSON.stringify(fault)}, name = ${JSON.stringify(name)};
        const bad = () => Promise.reject(Error("synthetic rejected adapter"));
        const options = {
          now: fault === "clock" ? bad : () => 1000,
          schedule: fault === "schedule" ? bad : () => 7,
          unschedule: fault === "cleanup" ? bad : () => {},
          createResource: () => ({ activate() {}, release() { return true; } }),
          transport: { subscribe() { return true; }, post() { return true; }, close() {} },
          onStop: () => true
        };
        let service;
        try {
          service = create(options);
          if (name === "rpc") await service.start({provider: {}, invoke: () => "ok"}).promise;
          if (name === "file") await service.readText({size: 1, arrayBuffer: async () => new Uint8Array([65]).buffer});
          if (name === "export") service.offer({text:"{}",filename:"test.json",mimeType:"application/json"});
          if (name === "tab") { service.start(); service.stop(); }
          if (name === "deadline") service.arm();
          if (name === "crypto") await service.run(() => "ok");
        } catch {}
        service?.dispose();
        setTimeout(() => console.log("contained"), 15);
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
