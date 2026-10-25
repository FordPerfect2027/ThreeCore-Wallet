import { createRpcSupervisor } from "/src/rpc-supervisor.js";
import { createStorageGuard } from "/src/storage-guard.js";
import { createSecureBackupRunner } from "/src/secure-backup-runner.js";
import { createFileReadService } from "/src/file-read-service.js";
import { createExportGuard } from "/src/export-guard.js";
import { mountRpcStatusPanel } from "/examples/rpc-status-panel.js";
import { mountStorageGuardPanel } from "/examples/storage-guard-panel.js";
import { mountSecureOperationPanel } from "/examples/secure-operation-panel.js";
import { mountFileReadPanel } from "/examples/file-read-panel.js";
import { mountExportGuardPanel } from "/examples/export-guard-panel.js";
import { describeRpcStatus } from "/src/rpc-status.js";
import { describeStorageStatus } from "/src/storage-guard-status.js";
import { describeSecureOperationCounts } from "/src/secure-backup-status.js";
import { describeFileReadStatus } from "/src/file-read-status.js";
import { describeExportStatus } from "/src/export-status.js";

const assert = (condition, text) => { if (!condition) throw Error(text); };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const options = { now: () => 0, schedule: () => 1, unschedule: () => {} };

function fixture(name, parent) {
  const pending = deferred(), results = [];
  let service, begin, stop, release = () => pending.resolve(null), isActive;
  let mount, prefix, describe;
  const consume = value => results.push(value.catch(error => error.code));
  if (name === "rpc") {
    service = createRpcSupervisor(options);
    let task;
    begin = () => { task = service.start({ provider: {}, invoke: () => pending.promise }); consume(task.promise); };
    stop = () => task.cancel(); isActive = value => value.started > 0;
    mount = () => mountRpcStatusPanel({ document, parent, supervisor: service });
    prefix = "rpc-status"; describe = value => describeRpcStatus(value).counts;
  } else if (name === "storage") {
    service = createStorageGuard();
    let lease;
    begin = () => { lease = service.acquire(() => {}); };
    stop = () => service.cancelAll(); release = () => lease?.finish({ late: true });
    isActive = value => value.active > 0;
    mount = () => mountStorageGuardPanel({ document, parent, guard: service });
    prefix = "storage-guard"; describe = value => describeStorageStatus(value).counts;
  } else if (name === "crypto") {
    service = createSecureBackupRunner(options);
    begin = () => consume(service.run(() => pending.promise));
    stop = () => service.cancel(); isActive = value => value.phase === "running";
    mount = () => mountSecureOperationPanel({ document, parent, runner: service });
    prefix = "secure-operation"; describe = describeSecureOperationCounts;
  } else if (name === "file") {
    service = createFileReadService(options);
    begin = () => consume(service.readText({ size: 1, arrayBuffer: () => pending.promise }));
    stop = () => service.cancelAll(); release = () => pending.resolve(new Uint8Array([65]).buffer);
    isActive = value => value.waiting > 0;
    mount = () => mountFileReadPanel({ document, parent, service });
    prefix = "file-read"; describe = value => describeFileReadStatus(value).counts;
  } else {
    service = createExportGuard({ ...options, createResource: () => ({ activate() {}, release() {} }) });
    begin = () => service.offer({ text: "{}", filename: "synthetic.json", mimeType: "application/json;charset=utf-8" });
    stop = () => service.clear(); isActive = value => value.active > 0;
    mount = () => mountExportGuardPanel({ document, parent, guard: service });
    prefix = "export-guard"; describe = value => describeExportStatus(value).counts;
  }
  return { service, begin, stop, isActive, mount, prefix, describe,
    async close() { service.dispose(); release(); await tick(); await Promise.all(results); } };
}

export function registerObserverUITests(test) {
  for (const name of ["rpc", "storage", "crypto", "file", "export"]) {
    test(`observer: ${name} panel shows the stop before a later subscriber runs`, async () => {
      const parent = document.createElement("section"); document.querySelector("#grid").append(parent);
      const f = fixture(name, parent);
      let stopped = false, inspected = 0, mismatch = false, panel;
      try {
        f.service.subscribe(value => {
          if (!stopped && f.isActive(value)) { stopped = true; f.stop(); }
        });
        panel = f.mount();
        f.service.subscribe(() => {
          if (!stopped) return;
          inspected++;
          if (parent.querySelector("." + f.prefix + "-counts").textContent !== f.describe(f.service.state())) mismatch = true;
        });
        f.begin(); await tick();
        assert(stopped && inspected > 0, "Stop boundary was not exercised");
        assert(!mismatch, "Panel transiently displayed the pre-stop state");
        assert(parent.querySelector("." + f.prefix + "-counts").textContent === f.describe(f.service.state()), "Final state is stale");
      } finally { panel?.dispose(); await f.close(); parent.remove(); }
    });
  }

  test("observer: file stop button prevents a read from its own notification", async () => {
    const parent = document.createElement("section"); document.querySelector("#grid").append(parent);
    const pending = deferred(), service = createFileReadService(options);
    const panel = mountFileReadPanel({ document, parent, service });
    let attempted = false, io = 0, next;
    const initial = service.readText({ size: 1, arrayBuffer: () => pending.promise }).catch(error => error.code);
    try {
      await tick();
      service.subscribe(value => {
        if (value.cancelled && !attempted) {
          attempted = true;
          next = service.readText({ size: 1, arrayBuffer() { io++; return Promise.resolve(new ArrayBuffer(1)); } })
            .then(() => "unexpected result", error => error.code);
        }
      });
      parent.querySelector(".file-read-stop").click(); await tick();
      assert(attempted && io === 0, "A read escaped the stop button");
      assert(await next === "FILE_BUSY", "Reentrant read was not refused");
      assert(await initial === "FILE_CANCELLED", "Original read was not cancelled");
      assert(parent.querySelector(".file-read-action").textContent.includes("1件"), "Wrong stopped count");
    } finally { panel.dispose(); service.dispose(); pending.resolve(new ArrayBuffer(1)); await tick(); parent.remove(); }
  });
}
