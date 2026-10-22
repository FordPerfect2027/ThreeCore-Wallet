import test from "node:test";
import assert from "node:assert/strict";
import {
  validateHistoryFileText, decodeHistoryFileBytes, historyFileName,
  prepareHistoryDownload, createHistoryBackupTracker, HISTORY_FILE_LIMIT,
} from "../src/history-file.js";
import { archive, observation, bytes, MAX } from "./helpers/history-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("file validates for exactly its agent: " + agent, () => {
    const text = archive([observation("42", { agent })]);
    const result = validateHistoryFileText(text, agent);
    assert.equal(result.agent, agent);
    assert.equal(result.observationCount, 1);
    assert.equal(result.identityCount, 1);
    assert.equal(result.canAuthorizeTransaction, false);
    assert.equal(result.canAuthorizeConnection, false);
    assert.ok(Object.isFrozen(result));
  });
}

for (const agent of ["", "dat", "BTC", null, 1, {}, "../../DAT"]) {
  test("file refuses invalid agent " + String(agent), () => {
    assert.throws(() => validateHistoryFileText(archive(), agent), error => error.code === "INVALID_AGENT");
    assert.throws(() => historyFileName(agent, 0));
  });
}

for (const agent of ["EMA", "CAWELON"]) {
  test("another agent is not silently relabelled " + agent, () => {
    assert.throws(() => validateHistoryFileText(archive([observation("42", { agent })]), "DAT"),
      error => error.code === "AGENT_MISMATCH");
  });
}

test("mixed-agent archive is refused as a whole", () => {
  const text = archive([observation(), observation("43", { agent: "EMA" })]);
  assert.throws(() => validateHistoryFileText(text, "DAT"), error => error.code === "AGENT_MISMATCH");
});

test("empty archive remains a valid explicit replacement candidate", () => {
  const result = validateHistoryFileText(archive([]), "DAT");
  assert.equal(result.observationCount, 0);
  assert.equal(result.identityCount, 0);
});

test("UTF-8 BOM is supported without modifying observations", () => {
  const result = validateHistoryFileText("\ufeff" + archive(), "DAT");
  assert.equal(result.observationCount, 1);
  assert.equal(result.text.startsWith("\ufeff"), false);
});

test("byte decoder supports UTF-8 BOM", () => {
  const result = decodeHistoryFileBytes(bytes("\ufeff" + archive()), "DAT");
  assert.equal(result.observationCount, 1);
});

for (const invalid of [
  new Uint8Array([0xff]),
  new Uint8Array([0xc3, 0x28]),
  new Uint8Array([0xe2, 0x82]),
  new Uint8Array([0xed, 0xa0, 0x80]),
  new Uint8Array([0xc0, 0xaf]),
]) {
  test("fatal UTF-8 decoding refuses " + [...invalid], () => {
    assert.throws(() => decodeHistoryFileBytes(invalid, "DAT"), error => error.code === "FILE_ENCODING");
  });
}

for (const invalid of [null, [], "text", new ArrayBuffer(2), new Uint8Array(0), new Uint8Array(HISTORY_FILE_LIMIT + 1)]) {
  test("byte input type and capacity are enforced " + Object.prototype.toString.call(invalid), () => {
    assert.throws(() => decodeHistoryFileBytes(invalid, "DAT"), error => error.code === "FILE_SIZE");
  });
}

for (const text of ["", "null", "[]", "{}", "{", "<script>alert(1)</script>", "\ufeff\ufeff{}", "{\"schema\":\"other\"}"]) {
  test("malformed file text is not accepted " + text, () => {
    assert.throws(() => validateHistoryFileText(text, "DAT"));
  });
}

for (const text of [null, undefined, 1, {}, [], true]) {
  test("file text must be a string " + String(text), () => {
    assert.throws(() => validateHistoryFileText(text, "DAT"), error => error.code === "INVALID_FILE");
  });
}

for (const revision of [0, 1, 42, Number.MAX_SAFE_INTEGER]) {
  test("download name is safe for revision " + revision, () => {
    const filename = historyFileName("DAT", revision);
    assert.equal(filename, `ThreeCore-DAT-history-r${revision}.json`);
    assert.equal(/[\\/:\x00-\x1f]/.test(filename), false);
    assert.equal(filename.includes("0x"), false);
  });
}

for (const revision of [-1, 0.1, NaN, Infinity, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
  test("unsafe revision cannot become filename " + String(revision), () => {
    assert.throws(() => historyFileName("DAT", revision), error => error.code === "INVALID_REVISION");
  });
}

test("download payload has actual UTF-8 byte count and JSON MIME", () => {
  const prepared = prepareHistoryDownload(archive(), "DAT", 1);
  assert.equal(prepared.byteLength, bytes(prepared.text).length);
  assert.equal(prepared.mimeType, "application/json;charset=utf-8");
  assert.equal(prepared.observationCount, 1);
  assert.equal(prepared.revision, 1);
  assert.ok(Object.isFrozen(prepared));
});

test("canonical download strips whitespace but preserves exact uint256", () => {
  const text = archive([observation("42", { nativeBalanceBaseUnits: MAX })]);
  const first = prepareHistoryDownload(text, "DAT", 2);
  const second = prepareHistoryDownload(" \n" + text + "\n ", "DAT", 2);
  assert.equal(first.text, second.text);
  assert.equal(JSON.parse(first.text).reports[0].snapshot.nativeBalanceBaseUnits, MAX);
});

test("unknown code remains an unknown balance in a file", () => {
  const text = archive([observation("42", {
    holdings: [{ address: "0x" + "33".repeat(20), hasCode: false,
      balanceBaseUnits: null, notice: "TOKEN_CODE_MISSING" }],
  })]);
  const prepared = prepareHistoryDownload(text, "DAT", 1);
  assert.equal(JSON.parse(prepared.text).reports[0].snapshot.holdings[0].balanceBaseUnits, null);
});

test("download does not accept arbitrary extra snapshot fields", () => {
  const value = JSON.parse(archive());
  value.reports[0].snapshot.secret = "not exported";
  assert.throws(() => prepareHistoryDownload(JSON.stringify(value), "DAT", 1));
});

test("backup tracker initially makes no durable-save claim", () => {
  const tracker = createHistoryBackupTracker();
  const result = tracker.state(0);
  assert.equal(result.offeredRevision, null);
  assert.equal(result.currentDownloadOffered, false);
  assert.equal(result.needsNewDownload, true);
  assert.equal(result.diskSaveVerified, false);
});

test("starting a download still cannot prove a disk save", () => {
  const tracker = createHistoryBackupTracker();
  const result = tracker.offered(3);
  assert.equal(result.currentDownloadOffered, true);
  assert.equal(result.needsNewDownload, false);
  assert.equal(result.diskSaveVerified, false);
});

test("new history changes require another download", () => {
  const tracker = createHistoryBackupTracker();
  tracker.offered(3);
  const result = tracker.state(4);
  assert.equal(result.offeredRevision, 3);
  assert.equal(result.needsNewDownload, true);
  assert.equal(result.currentDownloadOffered, false);
});

test("a later download supersedes the earlier offered revision", () => {
  const tracker = createHistoryBackupTracker();
  tracker.offered(3);
  tracker.offered(5);
  assert.equal(tracker.state(5).currentDownloadOffered, true);
  assert.equal(tracker.state(3).currentDownloadOffered, false);
});

for (const revision of [-1, NaN, "3", 1.5, null, Infinity]) {
  test("backup state rejects invalid revision " + String(revision), () => {
    const tracker = createHistoryBackupTracker();
    assert.throws(() => tracker.offered(revision));
    assert.throws(() => tracker.state(revision));
    assert.equal(tracker.state(0).offeredRevision, null);
  });
}

test("canonicalization does not contact a wallet or write browser storage", () => {
  const original = globalThis.ethereum;
  let calls = 0;
  globalThis.ethereum = { request() { calls++; throw Error("No wallet calls"); } };
  try {
    prepareHistoryDownload(archive(), "DAT", 1);
    assert.equal(calls, 0);
  } finally {
    if (original === undefined) delete globalThis.ethereum;
    else globalThis.ethereum = original;
  }
});
