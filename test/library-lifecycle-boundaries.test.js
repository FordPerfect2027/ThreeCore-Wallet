import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { EncryptedLibraryError } from "../src/encrypted-library-model.js";
import { envelope, library, memoryStorage, gate, tick } from "./helpers/encrypted-library-fixtures.js";

const NOW = 1792820000000;

for (const action of ["cancel", "dispose", "select"]) {
  test(`library confirmation cannot use a review revoked by ${action} in its clock`, async t => {
    const initial = await library([1, 2]);
    const storage = memoryStorage(initial);
    let armed = false;
    const c = createEncryptedLibraryController({ storage, now() {
      if (armed) {
        armed = false;
        if (action === "select") c.select(initial.entries[1].id);
        else c[action]();
      }
      return NOW;
    } });
    t.after(() => c.dispose());
    await c.load();
    c.select(initial.entries[0].id);
    await c.prepareRemove();
    const ticket = c.state().review.ticket;
    armed = true;
    assert.equal(await c.confirm(ticket, true), false);
    assert.equal(storage.calls.writes, 0, "Revoked deletion must not reach storage");
    assert.deepEqual(storage.snapshot(), initial);
    assert.equal(c.state().review, null);
    assert.equal(c.state().phase, action === "select" ? "ready" : action === "dispose" ? "disposed" : "cancelled");
  });
}

for (const action of ["cancel", "dispose"]) {
  test(`library review cannot reappear after ${action} inside review timestamp`, async t => {
    const initial = await library();
    const storage = memoryStorage(initial);
    let armed = false;
    const c = createEncryptedLibraryController({ storage, reviewLifetimeMs: 20, now() {
      if (armed) { armed = false; c[action](); }
      return NOW;
    } });
    t.after(() => c.dispose());
    await c.load();
    c.select(initial.entries[0].id);
    armed = true;
    assert.equal(await c.prepareRemove(), false);
    assert.equal(c.state().review, null);
    assert.equal(c.state().summary, null);
    assert.equal(c.state().phase, action === "dispose" ? "disposed" : "cancelled");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(c.state().review, null);
    assert.deepEqual(storage.snapshot(), initial);
  });
}

for (const method of ["load", "prepareSave", "prepareRemove", "open", "prepareExport", "prepareArchive", "confirm"]) {
  test(`library ${method} does not return success after its final observer cancels`, async t => {
    const initial = await library();
    const storage = memoryStorage(initial);
    let armed = false, c, visible;
    c = createEncryptedLibraryController({ storage, onOpen: () => true, onChange(state) {
      visible = state;
      if (armed && !state.busy && state.phase !== "cancelled") {
        armed = false; c.cancel();
      }
    } });
    t.after(() => c.dispose());
    await c.load();
    c.select(initial.entries[0].id);
    if (method === "confirm") await c.prepareSave(envelope(2));
    const ticket = c.state().review?.ticket;
    armed = true;
    const result = method === "prepareSave" ? await c.prepareSave(envelope(2))
      : method === "confirm" ? await c.confirm(ticket, true) : await c[method]();
    assert.equal(result, false, "A stopped request cannot report success to its caller");
    assert.equal(visible.phase, "cancelled");
    assert.equal(c.state().review, null);
    assert.equal(c.state().canExport, false);
    assert.equal(storage.calls.writes, method === "confirm" ? 1 : 0);
  });
}

test("library abort listener sees cleared state and cannot start another read during cancellation", async t => {
  const initial = await library();
  const base = memoryStorage(initial), pending = gate();
  let armed = false, c, observed, nested, attempts = 0;
  const storage = { ...base, read(options) {
    attempts++;
    if (!armed) return base.read(options);
    options.signal.addEventListener("abort", () => {
      observed = c.state();
      nested = c.load();
    }, { once: true });
    return pending.promise;
  } };
  c = createEncryptedLibraryController({ storage });
  t.after(() => { pending.resolve(initial); c.dispose(); });
  await c.load();
  c.select(initial.entries[0].id);
  armed = true;
  const opening = c.open();
  c.cancel();
  pending.resolve(initial);
  assert.equal(await nested, false);
  assert.equal(attempts, 2);
  assert.equal(observed.phase, "cancelled");
  assert.equal(observed.loaded, false);
  assert.equal(observed.selected, null);
  assert.equal(await opening, false);
  assert.equal(c.state().phase, "cancelled");
});

test("library export cannot publish success onto a replacement selection", async t => {
  const initial = await library([1, 2]);
  const c = createEncryptedLibraryController({ storage: memoryStorage(initial) });
  t.after(() => c.dispose());
  await c.load();
  c.select(initial.entries[0].id);
  await c.prepareExport();
  assert.equal(c.offer(() => { c.select(initial.entries[1].id); return true; }), false);
  assert.equal(c.state().selected, initial.entries[1].id);
  assert.equal(c.state().result, null);
});

test("library consumes an open callback's then getter only once", async t => {
  const initial = await library();
  let reads = 0;
  const c = createEncryptedLibraryController({ storage: memoryStorage(initial), onOpen() {
    return { get then() { reads++; return resolve => resolve(true); } };
  } });
  t.after(() => c.dispose());
  await c.load();
  c.select(initial.entries[0].id);
  assert.equal(await c.open(), false);
  await tick();
  assert.equal(reads, 1);
  assert.equal(c.state().errorCode, "LIBRARY_STAGE");
});

for (const phase of ["loading", "ready", "review", "cancelled"]) {
  test(`library repeated stop from ${phase} observer stays bounded`, async t => {
    let c, calls = 0, armed = false;
    c = createEncryptedLibraryController({ storage: memoryStorage(), onChange(state) {
      calls++;
      if (armed && (state.phase === phase || state.phase === "cancelled")) c.cancel();
    } });
    t.after(() => c.dispose());
    armed = true;
    if (phase === "review") await c.prepareSave(envelope());
    else if (phase === "cancelled") c.cancel();
    else await c.load();
    assert.equal(c.state().phase, "cancelled");
    assert(calls <= 3, "Observer must not recursively fill the stack");
    const count = calls;
    await tick();
    assert.equal(calls, count, "No continuing notification microtasks");
  });
}

for (const kind of ["accessor", "unknown-code"]) {
  test(`library storage error ${kind} never evaluates or exposes private diagnostics`, async t => {
    let accesses = 0;
    const error = new EncryptedLibraryError("LIBRARY_STORAGE");
    if (kind === "accessor") Object.defineProperty(error, "code", { get() {
      accesses++; throw Error("synthetic private error details");
    } });
    else error.code = "synthetic private error details";
    const base = memoryStorage();
    const c = createEncryptedLibraryController({ storage: { ...base, read: async () => { throw error; } } });
    t.after(() => c.dispose());
    assert.equal(await c.load(), false);
    assert.equal(accesses, 0);
    assert.match(c.state().errorCode, /^LIBRARY_(STORAGE|INTERNAL)$/);
    assert(!JSON.stringify(c.state()).includes("private"));
  });
}

test("a stopped deletion can only be retried with a fresh review and acknowledgement", async t => {
  const initial = await library([1, 2]);
  const storage = memoryStorage(initial);
  let armed = false;
  const c = createEncryptedLibraryController({ storage, now() {
    if (armed) { armed = false; c.cancel(); }
    return NOW;
  } });
  t.after(() => c.dispose());
  await c.load(); c.select(initial.entries[0].id);
  await c.prepareRemove();
  const old = c.state().review.ticket;
  armed = true;
  assert.equal(await c.confirm(old, true), false);
  assert.equal(storage.calls.writes, 0);
  await c.load(); c.select(initial.entries[0].id);
  await c.prepareRemove();
  assert.notEqual(c.state().review.ticket, old);
  assert.equal(await c.confirm(c.state().review.ticket, false), false);
  assert.equal(storage.calls.writes, 0);
  await c.prepareRemove();
  assert.equal(await c.confirm(c.state().review.ticket, true), true);
  assert.equal(storage.calls.writes, 1);
  assert.deepEqual(storage.snapshot().entries, [initial.entries[1]]);
});

for (const kind of ["observer", "open", "clock", "close"]) {
  test(`library ${kind} rejected callback does not escape the process`, () => {
    const controllerURL = new URL("../src/encrypted-library-controller.js", import.meta.url).href;
    const fixturesURL = new URL("./helpers/encrypted-library-fixtures.js", import.meta.url).href;
    const script = `
      import { createEncryptedLibraryController } from ${JSON.stringify(controllerURL)};
      import { library, memoryStorage, envelope } from ${JSON.stringify(fixturesURL)};
      const kind = ${JSON.stringify(kind)}, initial = await library();
      const base = memoryStorage(initial);
      const fail = () => Promise.reject(Error('synthetic callback rejection'));
      const c = createEncryptedLibraryController({
        storage: kind === 'close' ? { ...base, close: fail } : base,
        onChange: kind === 'observer' ? fail : () => {},
        onOpen: kind === 'open' ? () => ({ async then() { throw Error('synthetic returned rejection'); } }) : () => true,
        now: kind === 'clock' ? fail : Date.now
      });
      let accepted;
      if (kind === 'clock') accepted = await c.prepareSave(envelope(2));
      else {
        await c.load(); c.select(initial.entries[0].id);
        accepted = await c.open();
      }
      c.dispose();
      await new Promise(resolve => setTimeout(resolve, 20));
      console.log(JSON.stringify({ accepted, phase: c.state().phase, writes: base.calls.writes }));
    `;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
      { timeout: 5000, encoding: "utf8", windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { accepted: !["open", "clock"].includes(kind), phase: "disposed", writes: 0 });
  });
}
