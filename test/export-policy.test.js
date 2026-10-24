import test from "node:test";
import assert from "node:assert/strict";
import { EXPORT_CODES, ExportSecurityError, exportFail, exportErrorCode,
  requireSyncExport, consumeExportCallback } from "../src/export-policy.js";
import { guardFixture, PRIVATE } from "./helpers/export-fixtures.js";

for (const code of EXPORT_CODES) {
  test("export diagnostic round trip has only a fixed code: " + code, () => {
    const error = new ExportSecurityError(code);
    assert.equal(error.name, "ExportSecurityError");
    assert.equal(error.message, code);
    assert.equal(exportErrorCode(error), code);
    assert.throws(() => exportFail(code), { code, message: code });
    assert.equal(error.cause, undefined);
  });
}

for (const value of [PRIVATE, new Error(PRIVATE), { code: "EXPORT_BUSY", message: PRIVATE },
  { name: "ExportSecurityError", code: "EXPORT_SIZE" }, null, undefined, 1, true]) {
  test("export diagnostics do not trust foreign error-shaped data " + typeof value, () => {
    assert.equal(exportErrorCode(value), "EXPORT_FAILED");
  });
}

test("error code constructor never interpolates an arbitrary object", () => {
  let calls = 0;
  const error = new ExportSecurityError({ toString() { calls++; return PRIVATE; } });
  assert.equal(error.message, "EXPORT_FAILED");
  assert.equal(calls, 0);
});

test("a throwing error code getter cannot escape sanitization", () => {
  const error = new ExportSecurityError("EXPORT_BUSY");
  Object.defineProperty(error, "code", { get() { throw Error(PRIVATE); } });
  assert.equal(exportErrorCode(error), "EXPORT_FAILED");
});

test("a revoked error proxy cannot escape sanitization", () => {
  const pair = Proxy.revocable(new ExportSecurityError("EXPORT_BUSY"), {});
  pair.revoke();
  assert.equal(exportErrorCode(pair.proxy), "EXPORT_FAILED");
});

for (const value of [undefined, null, true, 0, "", {}, () => {}]) {
  test("synchronous void-compatible operation preserves its return " + typeof value, () => {
    assert.equal(requireSyncExport(value), value);
  });
}

test("explicit negative completion is refused with the supplied fixed error", () => {
  assert.throws(() => requireSyncExport(false, "EXPORT_CLEANUP"), { code: "EXPORT_CLEANUP" });
});

for (const kind of ["fulfilled", "rejected", "thenable", "function-thenable"]) {
  test("asynchronous completion cannot be counted synchronously: " + kind, async () => {
    let value;
    if (kind === "fulfilled") value = Promise.resolve(true);
    if (kind === "rejected") value = Promise.reject(Error(PRIVATE));
    if (kind === "thenable") value = { then(resolve, reject) { reject(Error(PRIVATE)); } };
    if (kind === "function-thenable") {
      value = () => {};
      value.then = (resolve, reject) => reject(Error(PRIVATE));
    }
    assert.throws(() => requireSyncExport(value, "EXPORT_CLEANUP"), { code: "EXPORT_CLEANUP" });
    await new Promise(resolve => setImmediate(resolve));
  });
}

test("then getter exceptions produce the configured error without leaking details", () => {
  const value = Object.defineProperty({}, "then", { get() { throw Error(PRIVATE); } });
  assert.throws(() => requireSyncExport(value, "EXPORT_CLEANUP"), { code: "EXPORT_CLEANUP" });
});

test("diagnostic callbacks consume both synchronous and asynchronous failures", async () => {
  assert.doesNotThrow(() => consumeExportCallback(() => { throw Error(PRIVATE); }));
  assert.doesNotThrow(() => consumeExportCallback(() => Promise.reject(Error(PRIVATE))));
  assert.doesNotThrow(() => consumeExportCallback(() => ({ then(resolve, reject) { reject(Error(PRIVATE)); } })));
  await new Promise(resolve => setImmediate(resolve));
});

for (const kind of ["promise", "reject", "false", "then-getter"]) {
  test("invalid scheduler completion prevents resource activation: " + kind, async () => {
    let activations = 0, releases = 0;
    const f = guardFixture({ schedule() {
      if (kind === "promise") return Promise.resolve(1);
      if (kind === "reject") return Promise.reject(Error(PRIVATE));
      if (kind === "false") return false;
      return Object.defineProperty({}, "then", { get() { throw Error(PRIVATE); } });
    }, createResource: () => ({ activate() { activations++; }, release() { releases++; } }) });
    assert.throws(() => f.offer(), { code: "EXPORT_FAILED" });
    assert.equal(activations, 0);
    assert(releases >= 1);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().offered, 0);
    await new Promise(resolve => setImmediate(resolve));
  });
}
