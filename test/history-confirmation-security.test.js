import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioHistory } from "../src/portfolio-history.js";
import { createHistoryImportController } from "../src/history-import-controller.js";
import { validatePortfolioSnapshot } from "../src/portfolio-report.js";
import { captureDataRecord, captureDataArray } from "../src/security-data.js";
import { spawnSync } from "node:child_process";

const agents = ["DAT", "EMA", "CAWELON"];
function snapshot(agent = "DAT", block = "42") {
  return { agent, account: "0x" + "11".repeat(20), chainId: 84532,
    siteOrigin: "http://localhost:4184", connectionEpoch: 1, blockNumber: block,
    blockHash: "0x" + "ab".repeat(32), nativeBalanceBaseUnits: "16",
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: true,
      balanceBaseUnits: "42", notice: null }], readOnly: true, securityAudit: false };
}

test("a normal reviewed three-token archive roundtrips without changing exact units", () => {
  const source = createPortfolioHistory();
  for (const agent of agents) {
    const input = snapshot(agent);
    input.nativeBalanceBaseUnits = ((1n << 256n) - 1n).toString();
    source.add(input);
  }
  const text = source.exportText();
  const destination = createPortfolioHistory();
  const importer = createHistoryImportController(destination);
  const review = importer.preview(text);
  assert.equal(review.groups.length, 3);
  const result = importer.apply(review.previewId, text, { replace: false });
  assert.equal(result.added, 3);
  assert.equal(result.state.canAuthorizeConnection, false);
  assert.equal(result.state.canAuthorizeTransaction, false);
  assert.equal(destination.exportText(), text);
  assert.throws(() => importer.apply(review.previewId, text));
});

test("an explicitly undefined import option retains the existing safe merge default", () => {
  const history = createPortfolioHistory(); history.add(snapshot("DAT", "1"));
  const importer = createHistoryImportController(history);
  const text = archive("DAT", "2");
  const review = importer.preview(text, { replace: undefined });
  assert.equal(review.mode, "merge");
  importer.apply(review.previewId, text, { replace: undefined });
  assert.deepEqual(history.state().snapshots.map(row => row.blockNumber), ["1", "2"]);
});

for (const agent of agents) {
  test(`${agent}: holdings fields are copied from inspected descriptors`, () => {
    const input = snapshot(agent); let reads = 0;
    input.holdings[0] = new Proxy(input.holdings[0], { get() { reads++; throw Error("private-field"); } });
    assert.equal(validatePortfolioSnapshot(input).holdings[0].balanceBaseUnits, "42");
    assert.equal(reads, 0);
  });
  test(`${agent}: input array iteration methods and length getters are never invoked`, () => {
    const history = createPortfolioHistory(); let reads = 0;
    const inputs = new Proxy([snapshot(agent)], { get() { reads++; throw Error("private-array"); } });
    history.merge(inputs);
    assert.equal(history.state().size, 1);
    assert.equal(reads, 0);
  });
  test(`${agent}: invalid import options do not read getters or delete existing data`, () => {
    const history = createPortfolioHistory(); history.add(snapshot(agent)); let calls = 0;
    const before = history.exportText();
    assert.throws(() => history.importText(archive(agent, "99"), {
      get replace() { calls++; return true; },
    }));
    assert.equal(calls, 0);
    assert.equal(history.exportText(), before);
  });
  test(`${agent}: disposal inside apply capture prevents every writer call`, () => {
    const history = createPortfolioHistory(); let dispose = false, writes = 0, importer;
    importer = createHistoryImportController({ state() {
      if (dispose) importer.dispose(); return history.state();
    }, importText() { writes++; } });
    const text = archive(agent); const review = importer.preview(text);
    dispose = true;
    assert.throws(() => importer.apply(review.previewId, text));
    assert.equal(writes, 0);
    assert.equal(importer.state().disposed, true);
    assert.equal(importer.state().pending, false);
    assert.throws(() => importer.preview(text), { code: "IMPORT_DISPOSED" });
  });
  test(`${agent}: reentrant preview during apply invalidates both operations`, () => {
    const history = createPortfolioHistory(); let reenter = false, importer, writes = 0;
    const text = archive(agent);
    importer = createHistoryImportController({ state() {
      if (reenter) {
        reenter = false;
        assert.throws(() => importer.preview(text), { code: "IMPORT_BUSY" });
      }
      return history.state();
    }, importText(...args) { writes++; return history.importText(...args); } });
    const review = importer.preview(text); reenter = true;
    assert.throws(() => importer.apply(review.previewId, text));
    assert.equal(writes, 0);
    assert.equal(importer.state().pending, false);
    // A later explicit action after a pre-write cancellation remains possible.
    const fresh = importer.preview(text); importer.apply(fresh.previewId, text);
    assert.equal(writes, 1);
  });
  test(`${agent}: asynchronous writer locks reuse even after its late commit`, async () => {
    const history = createPortfolioHistory(); let finish;
    const importer = createHistoryImportController({ state: history.state,
      importText(text, options) { return new Promise(resolve => { finish = () => resolve(history.importText(text, options)); }); } });
    const text = archive(agent); const review = importer.preview(text);
    assert.throws(() => importer.apply(review.previewId, text), { code: "IMPORT_RECOVERY_REQUIRED" });
    assert.equal(history.state().size, 0);
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(history.state().size, 1);
    assert.throws(() => importer.preview(text), { code: "IMPORT_RECOVERY_REQUIRED" });
    assert.equal(importer.state().pending, false);
  });
  test(`${agent}: a partial writer preserves its resulting records and cannot report success`, () => {
    const history = createPortfolioHistory(); history.add(snapshot(agent, "1"));
    const importer = createHistoryImportController({ state: history.state,
      importText() { history.add(snapshot(agent, "99")); return true; } });
    const text = archive(agent); const review = importer.preview(text, { replace: true });
    assert.throws(() => importer.apply(review.previewId, text), { code: "IMPORT_WRITE_MISMATCH" });
    assert.deepEqual(history.state().snapshots.map(row => row.blockNumber), ["1", "99"]);
    assert.equal(importer.state().recoveryRequired, true);
    importer.cancel();
    assert.throws(() => importer.preview(text), { code: "IMPORT_RECOVERY_REQUIRED" });
  });
  test(`${agent}: cancellation during writer completion is never reported as success`, () => {
    const history = createPortfolioHistory(); let importer;
    importer = createHistoryImportController({ state: history.state, importText(text, options) {
      const result = history.importText(text, options); importer.cancel(); return result;
    } });
    const text = archive(agent); const review = importer.preview(text);
    assert.throws(() => importer.apply(review.previewId, text));
    assert.equal(history.state().size, 1);
    assert.equal(importer.state().recoveryRequired, true);
  });
}

for (const field of Object.keys(snapshot())) {
  test(`snapshot accessor ${field} is rejected with no invocation`, () => {
    const input = snapshot(); let calls = 0;
    Object.defineProperty(input, field, { get() { calls++; throw Error("not-for-output"); } });
    assert.throws(() => validatePortfolioSnapshot(input), { code: "INVALID_PORTFOLIO_REPORT" });
    assert.equal(calls, 0);
  });
}
for (const key of ["map", "constructor", "toJSON", "privateKey", Symbol("secret")]) {
  test(`holdings extra field ${String(key)} is rejected without invocation`, () => {
    const input = snapshot(); let calls = 0;
    Object.defineProperty(input.holdings, key, { get() { calls++; throw Error("private-extra"); } });
    assert.throws(() => validatePortfolioSnapshot(input));
    assert.equal(calls, 0);
  });
}
for (const options of [null, [], true, { replace: 1 }, { replace: "true" }, { extra: false }, Object.create({ replace: true })]) {
  test(`invalid mode shape revokes preview: ${String(options)}`, () => {
    const history = createPortfolioHistory(); const importer = createHistoryImportController(history);
    const text = archive("DAT"); importer.preview(text);
    assert.throws(() => importer.preview(text, options));
    assert.equal(importer.state().pending, false);
  });
}
for (const defect of ["schema", "size", "revision", "capacity", "snapshots", "canAuthorizeConnection"]) {
  test(`malformed destination ${defect} cannot authorize a write`, () => {
    const history = createPortfolioHistory(); let bad = false, writes = 0;
    const importer = createHistoryImportController({ state() {
      const state = { ...history.state() };
      if (bad) state[defect] = defect === "canAuthorizeConnection" ? true : null;
      return state;
    }, importText() { writes++; } });
    const text = archive("DAT"); const review = importer.preview(text); bad = true;
    assert.throws(() => importer.apply(review.previewId, text), { code: "IMPORT_ADAPTER" });
    assert.equal(writes, 0);
    assert.equal(importer.state().pending, false);
  });
}
test("captured adapter methods cannot be replaced after preview", () => {
  const history = createPortfolioHistory(); let replacement = 0;
  const adapter = { state: history.state, importText: history.importText };
  const importer = createHistoryImportController(adapter);
  const text = archive("DAT"); const review = importer.preview(text);
  adapter.importText = () => { replacement++; };
  importer.apply(review.previewId, text);
  assert.equal(replacement, 0);
  assert.equal(history.state().size, 1);
});
test("cancelled preview releases its public metadata without invoking adapter reads", () => {
  const history = createPortfolioHistory(); let reads = 0;
  const importer = createHistoryImportController({ state() { reads++; return history.state(); }, importText: history.importText });
  importer.preview(archive("DAT")); const capturedReads = reads;
  importer.cancel(); importer.dispose(); importer.state();
  assert.equal(importer.state().preview, null);
  assert.equal(reads, capturedReads);
});
test("record and array captures support null-prototype data and frozen arrays", () => {
  const record = Object.assign(Object.create(null), { value: 4 });
  assert.equal(captureDataRecord(record, ["value"]).value, 4);
  assert.deepEqual(captureDataArray(Object.freeze([record]), 1), [record]);
  assert.ok(Object.isFrozen(captureDataArray([], 1)));
});
for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
  test(`reflection failure ${trap} contains external messages`, () => {
    const input = new Proxy({ value: 1 }, { [trap]() { throw Error("private-reflection-text"); } });
    assert.throws(() => captureDataRecord(input, ["value"]), error => error.message === "INVALID_DATA");
  });
}
test("array capture rejects sparse, oversized and extra-index data", () => {
  for (const data of [Array(1), [1, 2], Object.assign([1], { "01": 2 })]) {
    assert.throws(() => captureDataArray(data, 1));
  }
});
test("rejected asynchronous adapter results are consumed under strict rejection handling", () => {
  const imports = JSON.stringify(new URL("../src/history-import-controller.js", import.meta.url).href);
  const models = JSON.stringify(new URL("../src/portfolio-history.js", import.meta.url).href);
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
    import { createHistoryImportController } from ${imports};
    import { createPortfolioHistory } from ${models};
    const history = createPortfolioHistory();
    const text = history.exportText();
    for (const stage of ['read', 'write']) {
      const controller = createHistoryImportController({
        state: () => stage === 'read' ? Promise.reject(Error('read-failed')) : history.state(),
        importText: () => Promise.reject(Error('write-failed'))
      });
      try { const review = controller.preview(text); controller.apply(review.previewId, text); } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  `], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
});
function archive(agent, block = "43") {
  const source = createPortfolioHistory(); source.add(snapshot(agent, block));
  return source.exportText();
}
for (const agent of agents) {
  test(`${agent}: snapshot values are copied from inspected data, never reread through a proxy`, () => {
    let reads = 0;
    const input = new Proxy(snapshot(agent), { get(target, key) {
      reads++; return key === "agent" ? "OTHER" : Reflect.get(target, key);
    } });
    const result = validatePortfolioSnapshot(input);
    assert.equal(result.agent, agent);
    assert.equal(reads, 0);
  });
  test(`${agent}: holdings cannot replace the validator with a custom map`, () => {
    const input = snapshot(agent); let calls = 0;
    input.holdings.map = () => { calls++; return [{ privateKey: "synthetic-secret" }]; };
    assert.throws(() => validatePortfolioSnapshot(input));
    assert.equal(calls, 0);
  });
  test(`${agent}: holdings index accessor is rejected without running it`, () => {
    const input = snapshot(agent); const row = input.holdings[0]; let calls = 0;
    Object.defineProperty(input.holdings, "0", { get() { calls++; return row; } });
    assert.throws(() => validatePortfolioSnapshot(input));
    assert.equal(calls, 0);
  });
  for (const operation of ["clear", "add", "replace"]) {
    test(`${agent}: ${operation} during snapshot capture cannot be overwritten by the outer batch`, () => {
      const history = createPortfolioHistory(); history.add(snapshot(agent, "1"));
      let fired = false;
      const input = new Proxy(snapshot(agent, "2"), { getOwnPropertyDescriptor(target, key) {
        if (!fired) {
          fired = true;
          if (operation === "clear") history.clear(history.state().revision);
          if (operation === "add") history.add(snapshot(agent, "3"));
          if (operation === "replace") history.importText(archive(agent, "4"), { replace: true });
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      } });
      assert.throws(() => history.merge([input]), { code: "STALE_HISTORY" });
      assert.deepEqual(history.state().snapshots.map(row => row.blockNumber),
        operation === "clear" ? [] : operation === "add" ? ["1", "3"] : ["4"]);
    });
  }
  for (const phase of ["preview", "apply"]) {
    test(`${agent}: cancel inside the ${phase} state callback revokes the operation`, () => {
      const history = createPortfolioHistory(); const text = archive(agent);
      let controller, stop = false, writes = 0;
      controller = createHistoryImportController({ state() {
        if (stop) controller.cancel(); return history.state();
      }, importText(...args) { writes++; return history.importText(...args); } });
      let preview;
      if (phase === "apply") preview = controller.preview(text);
      stop = true;
      assert.throws(() => phase === "preview" ? controller.preview(text)
        : controller.apply(preview.previewId, text));
      assert.equal(controller.state().pending, false);
      assert.equal(writes, 0);
      assert.equal(history.state().size, 0);
    });
  }
  test(`${agent}: invalid preview options revoke the older review before inspecting options`, () => {
    const history = createPortfolioHistory(); const controller = createHistoryImportController(history);
    const text = archive(agent); controller.preview(text); let calls = 0;
    assert.throws(() => controller.preview(text, { get replace() { calls++; throw Error("private-value"); } }));
    assert.equal(calls, 0);
    assert.equal(controller.state().pending, false);
    assert.equal(history.state().size, 0);
  });
  test(`${agent}: an unsuccessful writer cannot claim a successful import`, () => {
    const history = createPortfolioHistory();
    const controller = createHistoryImportController({ state: history.state, importText: () => ({ changed: true }) });
    const text = archive(agent); const preview = controller.preview(text);
    assert.throws(() => controller.apply(preview.previewId, text), { code: "IMPORT_WRITE_MISMATCH" });
    assert.equal(history.state().size, 0);
  });
  test(`${agent}: visible merge mode must still match the confirmed preview`, () => {
    const history = createPortfolioHistory(); history.add(snapshot(agent, "1"));
    const controller = createHistoryImportController(history);
    const text = archive(agent); const preview = controller.preview(text, { replace: true });
    assert.throws(() => controller.apply(preview.previewId, text, { replace: false }), { code: "CHANGED_IMPORT" });
    assert.deepEqual(history.state().snapshots.map(row => row.blockNumber), ["1"]);
  });
}
