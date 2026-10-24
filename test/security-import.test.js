import test from "node:test";
import assert from "node:assert/strict";
import { preparePeriodFile, decodePeriodFile, readPeriodFile } from "../src/period-file.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile, readPeriodLibraryFile } from "../src/period-library-file.js";
import { preparePeriodReportFile, decodePeriodReportFile, readPeriodReportFile } from "../src/period-report-file.js";
import { prepareReportHistoryFile, decodeReportHistoryFile, readReportHistoryFile } from "../src/report-history-file.js";
import { prepareReportSetFile, decodeReportSetFile, readReportSetFile } from "../src/report-set-file.js";
import { prepareReconciliationFile, decodeReconciliationFile, readReconciliationFile } from "../src/reconciliation-file.js";
import { prepareTransferDownload, decodeTransferFile, readTransferFile } from "../src/transfer-file.js";
import { prepareVaultFile, decodeVaultFile, readVaultFile } from "../src/transfer-vault-file.js";
import { checkpoint } from "./helpers/period-fixtures.js";
import { sampleLibrary } from "./helpers/period-library-fixtures.js";
import { reportInput } from "./helpers/period-report-fixtures.js";
import { sampleHistory } from "./helpers/report-history-fixtures.js";
import { sequenceSet } from "./helpers/report-set-fixtures.js";
import { previewWorkspace } from "./helpers/reconciliation-fixtures.js";
import { snapshot } from "./helpers/transfer-fixtures.js";
import { bundleFor } from "./helpers/vault-fixtures.js";

const cases = [
  ["period", preparePeriodFile, decodePeriodFile, readPeriodFile, checkpoint, "PERIOD_FILE_JSON"],
  ["period library", preparePeriodLibraryFile, decodePeriodLibraryFile, readPeriodLibraryFile, sampleLibrary, "PERIOD_FILE_JSON"],
  ["period report", preparePeriodReportFile, decodePeriodReportFile, readPeriodReportFile, reportInput, "PERIOD_FILE_JSON"],
  ["report history", prepareReportHistoryFile, decodeReportHistoryFile, readReportHistoryFile, sampleHistory, "PERIOD_FILE_JSON"],
  ["report set", prepareReportSetFile, decodeReportSetFile, readReportSetFile, sequenceSet, "PERIOD_FILE_JSON"],
  ["reconciliation", prepareReconciliationFile, decodeReconciliationFile, readReconciliationFile, previewWorkspace, "RECONCILIATION_FILE_JSON"],
  ["transfers", prepareTransferDownload, decodeTransferFile, readTransferFile, snapshot, "TRANSFER_FILE_JSON"],
  ["vault", prepareVaultFile, decodeVaultFile, readVaultFile, bundleFor, "TRANSFER_FILE_JSON"],
];
const bytes = text => new TextEncoder().encode(text);
const asFile = text => new File([text], "security-check.json", { type: "application/json" });

for (const [name, prepare, decode, read, value, jsonCode] of cases) {
  test(name + ": new streaming path restores existing valid evidence exactly", async () => {
    const input = value(), before = JSON.stringify(input), file = await prepare(input);
    const fromText = await decode(file.text);
    const fromNativeFile = await read(asFile(file.text));
    assert.deepEqual(fromNativeFile, fromText);
    assert.equal(fromNativeFile.authenticated, false);
    assert.equal(JSON.stringify(input), before);
  });

  for (const property of ["schema", "algorithm", "digest"]) {
    test(name + ": checksum cannot hide a duplicate envelope member " + property, async () => {
      const good = await prepare(value());
      const attack = '{"' + property + '":"discarded-value",' + good.text.trim().slice(1);
      // Native parsing discards the attacker value and yields the valid file.
      assert.deepEqual(JSON.parse(attack), JSON.parse(good.text));
      await assert.rejects(decode(attack), error => error.code === jsonCode);
      await assert.rejects(read(asFile(attack)), error => error.code === jsonCode);
      assert.deepEqual(await read(asFile(good.text)), await decode(good.text));
    });
  }

  test(name + ": escaped key collision is rejected without changing source data", async () => {
    const good = await prepare(value());
    const attack = '{"sche\\u006da":"discarded",' + good.text.trim().slice(1);
    await assert.rejects(decode(attack), error => error.code === jsonCode);
    assert.deepEqual(await decode(good.text), await read(asFile(good.text)));
  });

  test(name + ": deep hostile envelope does not reach checksum computation", async () => {
    let cryptoCalls = 0;
    const text = '{"padding":' + "[".repeat(100) + "0" + "]".repeat(100) + "}";
    await assert.rejects(decode(text, { subtle: { digest() { cryptoCalls++; throw Error(); } } }),
      error => error.code === jsonCode);
    assert.equal(cryptoCalls, 0);
  });

  test(name + ": cancellation of a native stream does not consume the file", async () => {
    const good = await prepare(value()), aborter = new AbortController(); aborter.abort();
    await assert.rejects(read(asFile(good.text), { signal: aborter.signal }));
    assert.deepEqual(await read(asFile(good.text)), await decode(good.text));
  });

  test(name + ": an unresponsive reader cannot keep the UI waiting forever", async () => {
    let settle;
    const file = { name: "stalled.json", size: 4,
      arrayBuffer: () => new Promise(resolve => { settle = resolve; }) };
    await assert.rejects(read(file, { timeoutMs: 5 }), error => /FILE_READ$/.test(error.code));
    // The new page budget intentionally retains timed-out native work. Finish
    // this synthetic adapter so the next independent format has a clean scope.
    settle(new ArrayBuffer(4));
    await new Promise(resolve => setImmediate(resolve));
  });

  test(name + ": an actual-size overflow stops the stream before a checksum", async () => {
    let readCalls = 0, cancelled = 0, cryptoCalls = 0;
    const file = {
      name: "overflow.json", size: 2, arrayBuffer() { throw Error("fallback not expected"); },
      stream: () => ({ getReader: () => ({
        async read() { readCalls++; return { done: false, value: bytes("abcd") }; },
        cancel() { cancelled++; }, releaseLock() {},
      }) }),
    };
    await assert.rejects(read(file, { subtle: { digest() { cryptoCalls++; } } }), error => /SIZE$/.test(error.code));
    assert.equal(readCalls, 1);
    assert.ok(cancelled > 0);
    assert.equal(cryptoCalls, 0);
  });

  test(name + ": invalid UTF-8 is refused even when it splits across chunks", async () => {
    let index = 0;
    const chunks = [Uint8Array.of(0xf0), Uint8Array.of(0x28, 0x8c, 0xbc)];
    const file = { name: "encoding.json", size: 4, arrayBuffer() { throw Error(); },
      stream: () => ({ getReader: () => ({
        async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
        cancel() {}, releaseLock() {},
      }) }),
    };
    await assert.rejects(read(file), error => /FILE_ENCODING$/.test(error.code));
  });
}

test("a duplicate nested evidence member cannot be legitimized with the original checksum", async () => {
  const good = await prepareReportSetFile(sequenceSet());
  const attack = good.text.replace('"title":', '"title":"discarded misleading title","title":');
  assert.deepEqual(JSON.parse(attack), JSON.parse(good.text));
  await assert.rejects(decodeReportSetFile(attack), { code: "PERIOD_FILE_JSON" });
});

test("native file content survives stream splitting at every UTF-8 boundary", async () => {
  const good = await prepareReportSetFile(sequenceSet());
  const data = bytes(good.text);
  let offset = 0;
  const file = { name: "small-chunks.json", size: data.length, arrayBuffer() { throw Error(); },
    stream: () => ({ getReader: () => ({
      async read() {
        if (offset >= data.length) return { done: true };
        const value = data.slice(offset, offset + 31); offset += value.length;
        return { done: false, value };
      }, cancel() {}, releaseLock() {},
    }) }),
  };
  assert.deepEqual(await readReportSetFile(file), await decodeReportSetFile(good.text));
});
