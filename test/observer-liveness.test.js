import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// A child is deliberate: the old implementation could starve the event loop,
// preventing an in-process timeout from firing. The parent bounds that failure.
test("storage: repeated stop notifications do not starve the event loop", () => {
  const source = `
    import { createStorageGuard } from ${JSON.stringify(new URL("../src/storage-guard.js", import.meta.url).href)};
    const guard = createStorageGuard();
    let calls = 0;
    guard.subscribe(() => { calls++; guard.cancelAll(); });
    const lease = guard.acquire(() => {});
    setTimeout(() => {
      console.log(JSON.stringify({ calls, state: guard.state() }));
      lease.finish({ late: true }); guard.dispose();
    }, 20);
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  assert.equal(child.error, undefined, "Status delivery starved a normal timer");
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim());
  assert(result.calls >= 1 && result.calls <= 2);
  assert.equal(result.state.cancelled, 1);
  assert.equal(result.state.draining, 1);
});
