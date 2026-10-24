import test from "node:test";
import assert from "node:assert/strict";
import { parseSecurityJson, inspectSecurityJson, boundedUtf8Length,
  JSON_SECURITY_LIMITS, SecurityJsonError } from "../src/security-json.js";

const rejects = (text, code, options) => assert.throws(() => parseSecurityJson(text, options),
  error => error instanceof SecurityJsonError && error.code === code);

for (const value of [null, true, false, 0, -1, 3.25, "", "日本語", "🚀", [], {},
  { a: [1, { b: "quotes \" slash \\ newline\n" }], c: null }]) {
  test("strict JSON preserves ordinary serialized data: " + JSON.stringify(value), () => {
    assert.deepEqual(parseSecurityJson(JSON.stringify(value)), value);
    assert.deepEqual(parseSecurityJson(" \n\t" + JSON.stringify(value) + "\r "), value);
  });
}

for (const text of [
  '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"\\u0061":1,"a":2}',
  '{"a":{"b":1,"b":2}}', '[{"a":1,"a":1}]', '{"x":[{"":1,"":2}]}',
  '{"schema":"old","schema":"new"}', '{"digest":"bad","digest":"good"}',
  '{"a\\/b":1,"a/b":2}', '{"\\ud83d\\ude80":1,"🚀":2}',
]) {
  test("ambiguous member is rejected before native parsing: " + text, () => {
    rejects(text, "JSON_DUPLICATE_KEY");
  });
}

test("the same member name in separate objects is legitimate", () => {
  const text = '{"left":{"a":1},"right":{"a":2},"items":[{"a":3},{"a":4}]}';
  assert.deepEqual(parseSecurityJson(text), JSON.parse(text));
});

for (const key of ["__proto__", "constructor", "prototype", "\\u005f_proto__", "constr\\u0075ctor"]) {
  test("prototype-related member is refused: " + key, () => {
    rejects('{"' + key + '":{"polluted":true}}', "JSON_UNSAFE_KEY");
    assert.equal({}.polluted, undefined);
  });
}

test("member restrictions do not censor text values", () => {
  assert.deepEqual(parseSecurityJson('{"note":"__proto__ constructor prototype"}'),
    { note: "__proto__ constructor prototype" });
});

for (const text of ["", " ", "undefined", "NaN", "Infinity", "+1", "01", "-01", ".1", "1.", "1e", "--1",
  "[1,]", '{"a":1,}', "[,1]", "[1 2]", '{"a" 1}', "{a:1}", "{", "[", '"unterminated',
  '"bad\\x20"', '"bad\\u123"', '"bad\\uZZZZ"', '"bad\n"', "null true", "{}{}", "[truefalse]",
  "/*comment*/{}", "\ufeff{}", "\u00a0{}", '{"a":}', "[}", '{"a":1]']) {
  test("invalid JSON fails closed: " + JSON.stringify(text), () => rejects(text, "JSON_SYNTAX"));
}

test("all standard escapes remain valid", () => {
  const raw = '"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0061"';
  assert.equal(parseSecurityJson(raw), JSON.parse(raw));
});

test("depth is checked before native object allocation", () => {
  assert.deepEqual(parseSecurityJson("[[0]]", { depth: 2 }), [[0]]);
  rejects("[[[0]]]", "JSON_DEPTH_LIMIT", { depth: 2 });
  rejects("[".repeat(10_000) + "0" + "]".repeat(10_000), "JSON_DEPTH_LIMIT");
});

test("object and array values share a bounded node budget", () => {
  assert.deepEqual(parseSecurityJson('[1,2]', { nodes: 3 }), [1, 2]);
  rejects('[1,2,3]', "JSON_NODE_LIMIT", { nodes: 3 });
  rejects('{"a":1,"b":2}', "JSON_NODE_LIMIT", { nodes: 2 });
});

test("encoded member spelling cannot bypass decoded key length", () => {
  assert.deepEqual(parseSecurityJson('{"abc":1}', { keyCharacters: 3 }), { abc: 1 });
  rejects('{"abcd":1}', "JSON_STRING_LIMIT", { keyCharacters: 3 });
  rejects('{"a\\u0062cd":1}', "JSON_STRING_LIMIT", { keyCharacters: 3 });
});

test("individual string size is bounded independently of file size", () => {
  assert.equal(parseSecurityJson('"abc"', { stringCharacters: 3 }), "abc");
  rejects('"abcd"', "JSON_STRING_LIMIT", { stringCharacters: 3 });
});

test("byte budget accounts for Japanese text and surrogate pairs", () => {
  assert.equal(boundedUtf8Length("aéあ🚀", 10), 10);
  assert.throws(() => boundedUtf8Length("aéあ🚀", 9), { code: "JSON_SIZE" });
  assert.equal(boundedUtf8Length("\ud800", 3), 3);
  assert.equal(boundedUtf8Length("\udc00", 3), 3);
  assert.equal(boundedUtf8Length("\ud800a", 4), 4);
  rejects('"あ"', "JSON_SIZE", { bytes: 4 });
  assert.equal(parseSecurityJson('"あ"', { bytes: 5 }), "あ");
});

for (const text of ["1e309", "-1e999", "9".repeat(129)]) {
  test("numeric resource overflow is refused: " + text.slice(0, 20), () => rejects(text, "JSON_NUMBER_LIMIT"));
}

test("scientific and negative zero spellings match JSON semantics", () => {
  for (const raw of ["1e+2", "-0", "0.5", "1E-2", "1e-999"]) {
    assert.ok(Object.is(parseSecurityJson(raw), JSON.parse(raw)));
  }
});

test("statistics contain only sizes, never raw evidence or keys", () => {
  const summary = inspectSecurityJson('{"secret-label":[1,{"public-account":"0xabc"}]}');
  assert.deepEqual(Object.keys(summary), ["bytes", "nodes", "members", "maximumDepth"]);
  assert.equal(summary.nodes, 5);
  assert.equal(summary.maximumDepth, 3);
  assert.equal(summary.members, 2);
  assert.equal(JSON.stringify(summary).includes("0xabc"), false);
  assert.equal(Object.isFrozen(summary), true);
});

test("errors expose only a bounded static code", () => {
  const secret = "fake-private-value";
  try { parseSecurityJson('{"' + secret + '":1,"' + secret + '":2}'); }
  catch (error) {
    assert.equal(error.message, "JSON_DUPLICATE_KEY");
    assert.equal(error.stack.includes(secret), false);
  }
});

for (const options of [{ depth: 0 }, { nodes: -1 }, { bytes: Infinity }, { depth: 65 }, { max: 1 },
  { bytes: JSON_SECURITY_LIMITS.bytes + 1 }, { keyCharacters: 0.5 }, null, []]) {
  test("callers cannot disable the security limits: " + JSON.stringify(options), () => rejects("{}", "JSON_OPTIONS", options));
}

test("options getters cannot execute while checking limits", () => {
  let read = 0;
  rejects("{}", "JSON_OPTIONS", { get depth() { read++; return 1; } });
  assert.equal(read, 0);
});

test("deterministic mixed-document corpus agrees with the native parser", () => {
  let seed = 1471;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  function make(depth) {
    if (depth > 3) return [null, true, false, next() % 100, "字\\\"" + next()][next() % 5];
    if (next() % 2) return Array.from({ length: next() % 6 }, () => make(depth + 1));
    return Object.fromEntries(Array.from({ length: next() % 6 }, (_, i) => ["key" + i, make(depth + 1)]));
  }
  for (let i = 0; i < 250; i++) {
    const raw = JSON.stringify(make(0), null, i % 2 ? 2 : 0);
    assert.deepEqual(parseSecurityJson(raw), JSON.parse(raw));
  }
});
