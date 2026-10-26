import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createWalletSetupFileReader, prepareWalletSetupFile } from "../src/wallet-setup-file.js";
import { createWorkspaceFileReader, prepareWorkspaceFile } from "../src/workspace-file.js";
import { createHistoryFileReader } from "../src/history-file-reader.js";
import { WalletSetupError } from "../src/wallet-setup.js";
import { WorkspaceError } from "../src/workspace-format.js";
import { HistoryFileError } from "../src/history-file.js";
import { setup } from "./helpers/setup-fixtures.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { archive } from "./helpers/history-fixtures.js";

const formats = [
  { name: "settings", create: createWalletSetupFileReader, error: WalletSetupError,
    module: "wallet-setup-file", factory: "createWalletSetupFileReader", stopped: "idle",
    known: "SETUP_SIZE", fallback: "SETUP_FILE", text: prepareWalletSetupFile(setup()).text },
  { name: "workspace", create: createWorkspaceFileReader, error: WorkspaceError,
    module: "workspace-file", factory: "createWorkspaceFileReader", stopped: "cancelled",
    known: "WORKSPACE_FILE_SIZE", fallback: "WORKSPACE_FILE_READ", text: (await prepareWorkspaceFile(bundle())).text },
  { name: "history", create: options => createHistoryFileReader({ agent: "DAT", ...options }), error: HistoryFileError,
    module: "history-file-reader", factory: "createHistoryFileReader", stopped: "cancelled",
    known: "FILE_SIZE", fallback: "INVALID_FILE", text: archive() },
];
const payload = state => state.text ?? state.result ?? null;

for (const format of formats) {
  const data = new TextEncoder().encode(format.text);
  const file = () => ({ name: "synthetic.json", size: data.length });

  test(`import stop state: ${format.name} cancellation hides ready content before abort cleanup`, async t => {
    let reader, observed;
    reader = format.create({ readBytes(input, { signal }) {
      signal.addEventListener("abort", () => { observed = reader.state(); }, { once: true });
      return data;
    } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.notEqual(payload(reader.state()), null);
    reader.cancel();
    assert.equal(observed.phase, format.stopped);
    assert.equal(payload(observed), null, "cleanup must not observe the previous import");
    assert.equal(payload(reader.state()), null);
  });

  test(`import stop state: ${format.name} replacement clears ready content before abort cleanup`, async t => {
    let reader, observed, reads = 0;
    reader = format.create({ readBytes(input, { signal }) {
      if (++reads === 1) signal.addEventListener("abort", () => { observed = reader.state(); }, { once: true });
      return data;
    } });
    t.after(() => reader.dispose());
    await reader.load(file());
    await reader.load(file());
    assert.equal(observed.phase, "reading");
    assert.equal(payload(observed), null);
    assert.equal(reader.state().phase, "ready", "explicit replacement still succeeds");
    assert.equal(reads, 2);
  });

  test(`import stop state: ${format.name} repeated stop notifications are bounded`, async t => {
    let reader, calls = 0, reads = 0;
    reader = format.create({ readBytes() { reads++; return data; }, onChange() {
      // Bound the old implementation as well so the regression cannot overflow.
      if (++calls < 16) reader.cancel();
    } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert(calls <= 3, `expected bounded notifications, got ${calls}`);
    assert.equal(reads, 0);
    assert.equal(reader.state().phase, format.stopped);
  });

  test(`import stop state: ${format.name} stop in filename lookup avoids the next metadata callback`, async t => {
    let reader, sizes = 0, reads = 0;
    reader = format.create({ readBytes() { reads++; return data; } });
    t.after(() => reader.dispose());
    await reader.load({ get name() { reader.cancel(); return "synthetic.json"; },
      get size() { sizes++; return data.length; } });
    assert.equal(sizes, 0);
    assert.equal(reads, 0);
    assert.equal(reader.state().phase, format.stopped);
  });

  test(`import stop state: ${format.name} error accessors cannot throw out of load`, async t => {
    let accesses = 0;
    const failure = new format.error(format.known);
    Object.defineProperty(failure, "code", { get() { accesses++; throw Error("synthetic private diagnostics"); } });
    const reader = format.create({ readBytes() { throw failure; } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.equal(accesses, 0);
    assert.equal(reader.state().phase, "error");
    assert.equal(reader.state().errorCode, format.fallback);
  });

  test(`import stop state: ${format.name} error inspection cannot overwrite a newer stop`, async t => {
    let reader;
    const failure = new Proxy(new format.error(format.known), {
      get(target, key, receiver) {
        if (key === "code") { reader.cancel(); return format.known; }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "code") reader.cancel();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    reader = format.create({ readBytes() { throw failure; } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.equal(reader.state().phase, format.stopped);
    assert.equal(reader.state().errorCode, null);
    assert.equal(payload(reader.state()), null);
  });

  test(`import stop state: ${format.name} unknown typed error codes cannot expose private diagnostics`, async t => {
    const failure = new format.error("synthetic private diagnostics");
    const reader = format.create({ readBytes() { throw failure; } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.equal(reader.state().errorCode, format.fallback);
    assert(!JSON.stringify(reader.state()).includes("private"));
  });

  test(`import stop state: ${format.name} asynchronous observer rejection stays contained`, () => {
    const url = new URL(`../src/${format.module}.js`, import.meta.url).href;
    const script = `
      import { ${format.factory} as create } from ${JSON.stringify(url)};
      const data = new TextEncoder().encode(${JSON.stringify(format.text)});
      const reader = create({ agent: 'DAT', readBytes: () => data,
        onChange: () => Promise.reject(Error('synthetic observer rejection')) });
      await reader.load({ name: 'synthetic.json', size: data.length });
      const phase = reader.state().phase;
      reader.dispose();
      await new Promise(resolve => setTimeout(resolve, 20));
      console.log(JSON.stringify({ phase, disposed: reader.state().phase }));
    `;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
      { windowsHide: true, encoding: "utf8", timeout: 5000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.deepEqual(JSON.parse(child.stdout), { phase: "ready", disposed: "disposed" });
  });

  test(`import stop state: ${format.name} stop notification cannot open a replacement file`, async t => {
    let reader, nested, armed = false, reads = 0;
    reader = format.create({ readBytes() { reads++; return data; }, onChange(state) {
      if (armed && state.phase === format.stopped) { armed = false; nested = reader.load(file()); }
    } });
    t.after(() => reader.dispose());
    await reader.load(file());
    armed = true;
    reader.cancel();
    await nested;
    assert.equal(reads, 1, "stopping notification cannot authorize new IO");
    assert.equal(payload(reader.state()), null);
    await reader.load(file());
    assert.equal(reads, 2, "a later explicit selection can read normally");
    assert.equal(reader.state().phase, "ready");
  });

  test(`import stop state: ${format.name} deferred stop notification cannot reopen a file`, async t => {
    let reader, reads = 0, nested, stopped = false;
    reader = format.create({ readBytes() { reads++; return data; }, onChange(state) {
      if (state.phase === "reading" && !stopped) { stopped = true; reader.cancel(); }
      else if (state.phase === format.stopped) nested = reader.load(file());
    } });
    t.after(() => reader.dispose());
    await reader.load(file());
    await nested;
    assert.equal(reads, 0, "delayed delivery of the stop remains a cleanup callback");
    assert.equal(reader.state().phase, format.stopped);
    assert.equal(payload(reader.state()), null);
  });

  for (const mode of ["dispose", "replace"]) {
    test(`import stop state: ${format.name} ${mode} during descriptor inspection wins over the old error`, async t => {
      let reader, replacement, reads = 0;
      const failure = new Proxy({}, { getOwnPropertyDescriptor(target, key) {
        if (key === "code") {
          if (mode === "dispose") reader.dispose();
          else replacement = reader.load(file());
          return { configurable: true, enumerable: true, writable: true, value: format.known };
        }
      } });
      reader = format.create({ readBytes() {
        if (++reads === 1) throw failure;
        return data;
      } });
      t.after(() => reader.dispose());
      await reader.load(file());
      await replacement;
      assert.equal(reader.state().phase, mode === "dispose" ? "disposed" : "ready");
      assert.equal(reader.state().errorCode, null);
      assert.equal(reads, mode === "dispose" ? 1 : 2);
    });
  }

  test(`import stop state: ${format.name} known errors retain their static diagnostic code`, async t => {
    const reader = format.create({ readBytes() { throw new format.error(format.known); } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.equal(reader.state().phase, "error");
    assert.equal(reader.state().errorCode, format.known);
    assert.equal(payload(reader.state()), null);
  });

  test(`import stop state: ${format.name} hostile error reflection safely falls back`, async t => {
    let reads = 0;
    const failure = new Proxy({}, {
      getOwnPropertyDescriptor() { reads++; throw Error("synthetic inaccessible error"); },
      get() { throw Error("must not invoke arbitrary property access"); },
      getPrototypeOf() { throw Error("must not perform instanceof inspection"); },
    });
    const reader = format.create({ readBytes() { throw failure; } });
    t.after(() => reader.dispose());
    await reader.load(file());
    assert.equal(reads, 1);
    assert.equal(reader.state().errorCode, format.fallback);
  });
}

test("import stop state: resetting history clears payload before cleanup and remains usable", async t => {
  const text = archive(), data = new TextEncoder().encode(text);
  let reader, observed, nested, reads = 0;
  reader = createHistoryFileReader({ agent: "DAT", readBytes(file, { signal }) {
    if (++reads === 1) signal.addEventListener("abort", () => {
      observed = reader.state();
      nested = reader.load(file);
    }, { once: true });
    return data;
  } });
  t.after(() => reader.dispose());
  const file = { name: "synthetic.json", size: data.length };
  await reader.load(file);
  assert.equal(reader.reset().phase, "idle");
  await nested;
  assert.equal(observed.phase, "idle");
  assert.equal(payload(observed), null);
  assert.equal(reads, 1);
  await reader.load(file);
  assert.equal(reader.state().phase, "ready");
  assert.equal(reads, 2);
});
