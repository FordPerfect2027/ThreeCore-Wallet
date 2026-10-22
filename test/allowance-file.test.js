import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareAllowanceFile, decodeAllowanceFile, readAllowanceFile, ALLOWANCE_FILE_LIMIT } from "../src/allowance-file.js";
import { targets, record, saved, clone, code, deferred } from "./helpers/allowance-fixtures.js";

const bytes = text => new TextEncoder().encode(text);
for (const kind of ["targets", "observation"]) {
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    for (const chain of [8453, 84532]) {
      test("allowance file: round trip " + kind + "/" + agent + "/" + chain, async () => {
        const input = kind === "targets" ? targets(agent, chain) : record({}, agent, chain);
        const file = await prepareAllowanceFile(kind, input);
        const result = await decodeAllowanceFile(bytes(file.text));
        assert.deepEqual(result.payload, input);
        assert.equal(result.kind, kind);
        assert.equal(result.authenticated, false);
        assert.equal(result.checksumVerified, true);
        assert.equal(file.byteLength, bytes(file.text).length);
        assert(file.filename.startsWith("ThreeCore-" + agent));
        const canonical = JSON.stringify({ kind, payload: result.payload }, null, 2);
        assert.equal(file.digest, createHash("sha256").update(canonical).digest("hex"));
        assert(Object.isFrozen(result));
      });
    }
  }
}
test("allowance file: independent read from File-like value", async () => {
  const result = await readAllowanceFile(await saved());
  assert.deepEqual(result.payload, record());
});
for (const change of [
  f => { f.payload.rows[0].allowanceBaseUnits = "1"; },
  f => { f.payload.identity.account = "0x" + "22".repeat(20); },
  f => { f.payload.rows[0].label = f.payload.targets.targets[0].label = "tampered"; },
  f => { f.digest = "0".repeat(64); },
]) {
  test("allowance file: checksum detects changed payload " + change.toString(), async () => {
    const file = JSON.parse((await prepareAllowanceFile("observation", record())).text);
    change(file);
    await assert.rejects(decodeAllowanceFile(bytes(JSON.stringify(file))), code("ALLOWANCE_CHECKSUM"));
  });
}
for (const change of [
  f => { f.schema = "v2"; }, f => { f.algorithm = "MD5"; },
  f => { f.digest = f.digest.toUpperCase(); }, f => { f.digest = "abc"; },
  f => { f.secret = true; }, f => { f.kind = "execute"; }, f => { delete f.payload; },
]) {
  test("allowance file: reject unsupported wrapper " + change.toString(), async () => {
    const file = JSON.parse((await prepareAllowanceFile("observation", record())).text);
    change(file);
    await assert.rejects(decodeAllowanceFile(bytes(JSON.stringify(file))));
  });
}
test("allowance file: formatting/object order changes preserve canonical checksum", async () => {
  const prepared = await prepareAllowanceFile("observation", record());
  const source = JSON.parse(prepared.text);
  source.payload = Object.fromEntries(Object.entries(source.payload).reverse());
  const result = await decodeAllowanceFile(bytes(JSON.stringify(source)));
  assert.equal(result.digest, prepared.digest);
});
for (const input of [new Uint8Array(), new Uint8Array(ALLOWANCE_FILE_LIMIT + 1), [], "{}", null]) {
  test("allowance file: reject nonbytes/size " + String(input).slice(0, 15), async () => {
    await assert.rejects(decodeAllowanceFile(input), code("ALLOWANCE_FILE_SIZE"));
  });
}
test("allowance file: invalid UTF8 is not replaced silently", async () => {
  await assert.rejects(decodeAllowanceFile(new Uint8Array([0xc3, 0x28])), code("ALLOWANCE_FILE_ENCODING"));
});
for (const text of ["{", "undefined", '{"a":']) {
  test("allowance file: invalid JSON " + text, async () => {
    await assert.rejects(decodeAllowanceFile(bytes(text)), code("ALLOWANCE_FILE_JSON"));
  });
}
for (const name of ["", "../a.json", "a\\b.json", "a.txt", "a.json.exe", "a\n.json", "x".repeat(241) + ".json"]) {
  test("allowance file: invalid basename " + name.slice(0, 20), async () => {
    let reads = 0;
    const file = await saved("observation", record(), { name, arrayBuffer() { reads++; } });
    await assert.rejects(readAllowanceFile(file), code("ALLOWANCE_FILENAME"));
    assert.equal(reads, 0);
  });
}
for (const size of [0, -1, 1.5, NaN, ALLOWANCE_FILE_LIMIT + 1, "10"]) {
  test("allowance file: invalid declared size " + size, async () => {
    let reads = 0;
    const file = await saved("observation", record(), { size, arrayBuffer() { reads++; } });
    await assert.rejects(readAllowanceFile(file), code("ALLOWANCE_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}
test("allowance file: actual and declared size must agree", async () => {
  const file = await saved();
  file.size++;
  await assert.rejects(readAllowanceFile(file), code("ALLOWANCE_FILE_SIZE"));
});
test("allowance file: read failures do not expose filenames/provider details", async () => {
  const file = await saved("observation", record(), { arrayBuffer() { throw Error("secret path"); } });
  await assert.rejects(readAllowanceFile(file), error => {
    assert.equal(error.code, "ALLOWANCE_FILE_READ");
    assert(!error.message.includes("secret"));
    return true;
  });
});
for (const subtle of [null, {}, { digest: () => { throw Error("crypto"); } },
  { digest: async () => new ArrayBuffer(31) }, { digest: async () => "bad" }]) {
  test("allowance file: unavailable/invalid SHA256 provider " + JSON.stringify(subtle), async () => {
    await assert.rejects(prepareAllowanceFile("targets", targets(), { subtle }), code("ALLOWANCE_CRYPTO"));
  });
}
test("allowance file: deep copy before asynchronous hashing", async () => {
  const gate = deferred();
  const input = record();
  const expected = clone(input);
  const promise = prepareAllowanceFile("observation", input, {
    subtle: { async digest(algorithm, value) { await gate.promise; return crypto.subtle.digest(algorithm, value); } },
  });
  input.rows[0].allowanceBaseUnits = "99";
  input.targets.targets[0].label = "changed";
  gate.resolve();
  const result = await decodeAllowanceFile(bytes((await promise).text));
  assert.deepEqual(result.payload, expected);
});
test("allowance file: changing source bytes while digest awaits has no effect", async () => {
  const gate = deferred();
  const prepared = await prepareAllowanceFile("observation", record());
  const input = bytes(prepared.text);
  const promise = decodeAllowanceFile(input, {
    subtle: { async digest(algorithm, value) { await gate.promise; return crypto.subtle.digest(algorithm, value); } },
  });
  input.fill(0);
  gate.resolve();
  assert.equal((await promise).digest, prepared.digest);
});
test("allowance file: no silent authentication from recomputed checksum", async () => {
  const changed = record();
  changed.rows[0].allowanceBaseUnits = "999";
  const prepared = await prepareAllowanceFile("observation", changed);
  const result = await decodeAllowanceFile(bytes(prepared.text));
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
});
