import { createRpcSupervisor } from "../../src/rpc-supervisor.js";
import { createStorageGuard } from "../../src/storage-guard.js";
import { createSecureBackupRunner } from "../../src/secure-backup-runner.js";
import { createFileReadService } from "../../src/file-read-service.js";
import { guardFixture, prepared, clockFixture } from "./export-fixtures.js";

export const tick = () => new Promise(resolve => setImmediate(resolve));
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const SERVICE_NAMES = ["rpc", "storage", "crypto", "file", "export"];

/** Synthetic pending work, with no extension, disk, RPC or native timers. */
export function serviceFixture(name) {
  const clock = clockFixture(), pending = deferred();
  const options = { now: clock.now, schedule: clock.schedule, unschedule: clock.unschedule };
  let service, started, stop, release;
  const results = [];
  const consume = promise => {
    const result = promise.then(value => ({ value }), error => ({ error: error.code }));
    results.push(result);
    return result;
  };
  if (name === "rpc") {
    service = createRpcSupervisor(options);
    let task;
    started = state => state.started > 0;
    release = () => pending.resolve(null);
    stop = () => task.cancel();
    return finish(() => {
      task = service.start({ provider: {}, invoke: () => pending.promise });
      consume(task.promise);
    });
  }
  if (name === "storage") {
    service = createStorageGuard();
    let lease;
    started = state => state.active > 0;
    stop = () => service.cancelAll();
    release = () => lease?.finish({ late: true });
    return finish(() => { lease = service.acquire(() => {}); });
  }
  if (name === "crypto") {
    service = createSecureBackupRunner(options);
    started = state => state.phase === "running";
    stop = () => service.cancel();
    release = () => pending.resolve(null);
    return finish(() => consume(service.run(() => pending.promise)));
  }
  if (name === "file") {
    service = createFileReadService(options);
    started = state => state.waiting > 0;
    stop = () => service.cancelAll();
    release = () => pending.resolve(new Uint8Array([65]).buffer);
    return finish(() => consume(service.readText({ size: 1, arrayBuffer: () => pending.promise })));
  }
  if (name === "export") {
    service = guardFixture().guard;
    started = state => state.active > 0;
    stop = () => service.clear();
    release = () => {};
    return finish(() => service.offer(prepared()));
  }
  throw Error("Unknown fixture");
  function finish(begin) {
    return { service, started, stop, release, begin, clock, results,
      async close() { service.dispose(); release(); await tick(); await Promise.all(results); } };
  }
}
