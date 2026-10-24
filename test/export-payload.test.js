import test from "node:test";
import assert from "node:assert/strict";
import { exportTextBytes, inspectExportFilename, inspectExportPayload } from "../src/export-payload.js";
import { EXPORT_LIMITS } from "../src/export-policy.js";
import { prepared, PRIVATE } from "./helpers/export-fixtures.js";

const refuses = (action, code) => assert.throws(action, error => {
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(error.message.includes(PRIVATE), false);
  return true;
});

test("payload snapshots primitive transport fields and ignores mutable metadata", () => {
  const input = prepared({ metadata: { owner: PRIVATE }, byteLength: 16 });
  const result = inspectExportPayload(input);
  input.text = "changed";
  input.filename = "different.json";
  input.metadata.owner = "changed";
  assert.equal(result.text, '{"example":true}');
  assert.equal(result.byteLength, 16);
  assert.equal(result.kind, "json");
  assert.equal(result.metadata, undefined);
  assert(Object.isFrozen(result));
  assert.throws(() => { result.byteLength = 1; }, TypeError);
});

for (const [kind, mime] of [["json", "application/json"], ["csv", "text/csv"],
  ["txt", "text/plain"], ["html", "text/html"]]) {
  for (const suffix of ["", ";charset=utf-8", "; charset=utf-8"]) {
    test(`payload keeps approved ${kind} type ${JSON.stringify(suffix)}`, () => {
      const result = inspectExportPayload(prepared({ filename: "ThreeCore-DAT." + kind, mimeType: mime + suffix }));
      assert.equal(result.mimeType, mime + ";charset=utf-8");
      assert.equal(result.kind, kind);
    });
  }
}

for (const filename of ["../private.json", "C:\\private.json", "/tmp/file.json", ".json", "-a.json",
  "_a.json", "file.JSON", "file.json.exe", "file.svg", "file.js", "file.pdf", "file.zip",
  "file.html ", " file.json", "a b.json", "a\tb.json", "a\nb.json", "a\rb.json", "a\0b.json",
  "a:b.json", "a/b.json", "a\\b.json", "a?b.json", "a#b.json", "a%b.json", "a+b.json",
  "a@b.json", "a[b].json", "a\"b.json", "a'b.json", "a;b.json", "a,b.json", "a..json",
  "a.b.json", "a\u202eb.json", "a\u200bb.json", "Ａ.json", "é.json", "保存.json", "😀.json",
  "con.json", "CON.txt", "nul.csv", "aux.html", "PRN.json", "com0.json", "COM1.txt", "lpt9.csv",
  "lpt0.html", "a".repeat(176) + ".json", "", null, undefined, 42, {}, []]) {
  test("payload refuses unsafe filename " + JSON.stringify(filename), () => {
    refuses(() => inspectExportFilename(filename), "EXPORT_NAME");
  });
}

for (const filename of ["a.json", "0.csv", "ThreeCore-DAT_8453.txt", "ThreeCore-EMA-report.html",
  "a".repeat(175) + ".json", "CON-summary.json", "com10.json", "nulBackup.json"]) {
  test("payload accepts bounded literal filename " + filename.slice(0, 35), () => {
    assert.match(inspectExportFilename(filename), /^(json|csv|txt|html)$/);
  });
}

for (const mimeType of ["text/html", "application/octet-stream", "application/json; charset=UTF-8",
  "application/json;charset=utf-16", "application/json;charset=utf-8;foo=bar", "application/JSON",
  " application/json", "application/json\n", "application/json\r\nX: 1", "application/json;",
  "application/json; charset=utf-8 ", "application/json; charset= utf-8", "", null, undefined, {}, 3]) {
  test("payload refuses mismatched or ambiguous MIME " + JSON.stringify(mimeType), () => {
    refuses(() => inspectExportPayload(prepared({ mimeType })), "EXPORT_TYPE");
  });
}

for (const text of ["a", "hello\nworld", "\0", "é", "\u07ff", "\u0800", "日本語", "😀",
  "a😀b日本c", "\ufeff{}", "\ud7ff", "\ue000", "\uffff", "\udbff\udfff", "e\u0301"]) {
  test("payload UTF-8 accounting matches encoder " + JSON.stringify(text), () => {
    const expected = new TextEncoder().encode(text).length;
    assert.equal(exportTextBytes(text), expected);
    assert.equal(exportTextBytes(text, expected), expected);
    if (expected > 1) refuses(() => exportTextBytes(text, expected - 1), "EXPORT_SIZE");
  });
}

for (const text of ["\ud800", "\udfff", "a\ud800b", "\ud800\ud800", "\udfff\ud800", "\udbffx",
  "valid😀then\udc00", "\udc00\udc00", "\ud800\ud7ff", "\udbff\ue000"]) {
  test("payload does not silently replace a malformed surrogate " + JSON.stringify(text), () => {
    refuses(() => exportTextBytes(text), "EXPORT_ENCODING");
  });
}

test("JSON escaped surrogate text remains literal bytes for its format parser", () => {
  assert.equal(exportTextBytes('"\\ud800"'), 8);
});

for (const value of ["", null, undefined, 0, false, {}, [], new String("hello")]) {
  test("payload text must be a nonempty primitive string " + typeof value, () => {
    refuses(() => exportTextBytes(value), "EXPORT_SIZE");
  });
}

for (const limit of [0, -1, 1.1, NaN, Infinity, "5", null, EXPORT_LIMITS.fileBytes + 1]) {
  test("payload rejects invalid counting limit " + String(limit), () => {
    refuses(() => exportTextBytes("x", limit), "EXPORT_SIZE");
  });
}

for (const byteLength of [0, -1, 15, 17, 16.5, NaN, Infinity, "16", null, {}, 16n]) {
  test("payload declared bytes must match UTF-8 " + String(byteLength), () => {
    refuses(() => inspectExportPayload(prepared({ byteLength })), "EXPORT_SIZE");
  });
}

test("payload explicitly undefined optional byte count means no declaration", () => {
  assert.equal(inspectExportPayload(prepared({ byteLength: undefined })).byteLength, 16);
});

for (const field of ["text", "filename", "mimeType", "byteLength"]) {
  test("payload rejects getter without invoking it: " + field, () => {
    let reads = 0;
    const input = prepared();
    Object.defineProperty(input, field, { get() { reads++; throw Error(PRIVATE); } });
    refuses(() => inspectExportPayload(input), "EXPORT_FORMAT");
    assert.equal(reads, 0);
  });
}

test("payload never reads unrelated metadata getters or symbol values", () => {
  let reads = 0;
  const input = prepared();
  Object.defineProperty(input, "metadata", { get() { reads++; throw Error(PRIVATE); } });
  Object.defineProperty(input, Symbol("private"), { get() { reads++; throw Error(PRIVATE); } });
  assert.equal(inspectExportPayload(input).byteLength, 16);
  assert.equal(reads, 0);
});

for (const field of ["text", "filename", "mimeType"]) {
  test("payload rejects a missing required own field: " + field, () => {
    const input = prepared();
    delete input[field];
    refuses(() => inspectExportPayload(input), "EXPORT_FORMAT");
  });
}

for (const input of [null, undefined, [], true, "file", 1, new Date(), Object.create(prepared())]) {
  test("payload rejects non-record or inherited input " + typeof input, () => {
    refuses(() => inspectExportPayload(input), "EXPORT_FORMAT");
  });
}

test("payload accepts a null-prototype own-data record", () => {
  const result = inspectExportPayload(Object.assign(Object.create(null), prepared()));
  assert.equal(result.byteLength, 16);
});

for (const trap of ["getPrototypeOf", "getOwnPropertyDescriptor"]) {
  test("payload sanitizes throwing proxy trap " + trap, () => {
    const input = new Proxy(prepared(), { [trap]() { throw Error(PRIVATE); } });
    refuses(() => inspectExportPayload(input), "EXPORT_FORMAT");
  });
}

test("payload treats revoked proxies as malformed, without exception details", () => {
  const pair = Proxy.revocable(prepared(), {});
  pair.revoke();
  refuses(() => inspectExportPayload(pair.proxy), "EXPORT_FORMAT");
});

test("payload does not invoke coercion on hostile text, name, MIME or size", () => {
  let calls = 0;
  const value = { toString() { calls++; throw Error(PRIVATE); }, valueOf() { calls++; throw Error(PRIVATE); } };
  for (const field of ["text", "filename", "mimeType", "byteLength"]) {
    assert.throws(() => inspectExportPayload(prepared({ [field]: value })));
  }
  assert.equal(calls, 0);
});

test("UTF-8 accounting covers every scalar boundary without allocating twice", () => {
  const points = [0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xffff, 0x10000, 0x10ffff];
  const text = points.map(value => String.fromCodePoint(value)).join("");
  assert.equal(exportTextBytes(text), new TextEncoder().encode(text).length);
});

test("fixed limits cannot be changed by an export caller", () => {
  assert(Object.isFrozen(EXPORT_LIMITS));
  assert.throws(() => { EXPORT_LIMITS.active = 1000; }, TypeError);
  assert.equal(EXPORT_LIMITS.active, 4);
});
