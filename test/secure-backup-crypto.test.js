import test from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync, createDecipheriv } from "node:crypto";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "../src/secure-backup-crypto.js";
import { inspectEncryptedBackup, encodeBackupBase64, SecureBackupError } from "../src/secure-backup-format.js";
import { encodeWorkspace } from "../src/workspace-format.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { bundle, PASSWORD, OTHER_PASSWORD, webcrypto, traceCrypto, rawEnvelope,
  validPlaintext, envelope } from "./helpers/secure-backup-fixtures.js";

const failure = code => error => error instanceof SecureBackupError && error.code === code;
let saved;
async function sample() {
  saved ??= encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: webcrypto });
  return saved;
}

test("real WebCrypto backup round trips all three wallet configurations and saved histories", async () => {
  const prepared = await sample();
  const result = await decryptWorkspaceBackup(prepared.text, PASSWORD, { crypto: webcrypto });
  assert.equal(result.text, encodeWorkspace(bundle()));
  assert.equal(result.passwordAuthenticated, true);
  assert.equal(result.checksumVerified, true);
  assert.equal(result.ownerVerified, false);
  assert(!prepared.text.includes(PASSWORD));
  assert(!prepared.text.includes("0x111111"));
  assert(!prepared.text.includes("nativeBalanceBaseUnits"));
  assert(!prepared.text.includes("history"));
});

test("independent Node crypto implementation decrypts the browser file", async () => {
  const file = inspectEncryptedBackup((await sample()).text);
  const key = pbkdf2Sync(PASSWORD, file.salt, 600000, 32, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", key, file.iv);
  decipher.setAAD(file.additionalData);
  decipher.setAuthTag(file.ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(file.ciphertext.subarray(0, -16)), decipher.final()]);
  const result = await decodeWorkspaceFile(new Uint8Array(plaintext), { subtle: webcrypto.subtle });
  assert.equal(result.text, encodeWorkspace(bundle()));
  key.fill(0);
  plaintext.fill(0);
});

test("two backups of identical data use different salt, IV and ciphertext", async () => {
  const first = inspectEncryptedBackup((await sample()).text);
  const second = inspectEncryptedBackup((await encryptWorkspaceBackup(bundle(), PASSWORD)).text);
  assert.notDeepEqual(first.salt, second.salt);
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
});

test("native encryption imports and derives nonextractable keys with one purpose", async () => {
  const trace = traceCrypto();
  await encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto });
  const imported = trace.calls.find(call => call.name === "importKey");
  assert.equal(imported.args[3], false);
  assert.deepEqual(imported.args[4], ["deriveKey"]);
  const derived = trace.calls.find(call => call.name === "deriveKey");
  assert.equal(derived.args[0].iterations, 600000);
  assert.equal(derived.args[3], false);
  assert.deepEqual(derived.args[4], ["encrypt"]);
  assert.deepEqual(derived.args[2], { name: "AES-GCM", length: 256 });
  const encrypted = trace.calls.find(call => call.name === "encrypt");
  assert.equal(encrypted.args[1].extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey("raw", encrypted.args[1]));
  assert.deepEqual(trace.calls.filter(call => call.name === "random").map(call => call.length), [16, 12]);
  assert(imported.args[1].every(byte => byte === 0), "owned password byte buffer cleared");
  assert(encrypted.args[2].every(byte => byte === 0), "owned plaintext byte buffer cleared");
});

test("native decryption uses decrypt-only key and clears owned decrypted buffer", async () => {
  let returned;
  const trace = traceCrypto({ decrypt: async (...args) => {
    returned = await webcrypto.subtle.decrypt(...args);
    return returned;
  } });
  await decryptWorkspaceBackup((await sample()).text, PASSWORD, { crypto: trace.crypto });
  const derived = trace.calls.find(call => call.name === "deriveKey");
  assert.deepEqual(derived.args[4], ["decrypt"]);
  assert(new Uint8Array(returned).every(byte => byte === 0));
  const imported = trace.calls.find(call => call.name === "importKey");
  assert(imported.args[1].every(byte => byte === 0));
});

test("incorrect password and modified authentication tag expose the same safe error", async () => {
  const prepared = await sample();
  await assert.rejects(decryptWorkspaceBackup(prepared.text, OTHER_PASSWORD), failure("SECURE_AUTH"));
  const value = JSON.parse(prepared.text);
  const bytes = inspectEncryptedBackup(prepared.text).ciphertext;
  bytes[bytes.length - 1] ^= 1;
  value.ciphertext = encodeBackupBase64(bytes);
  await assert.rejects(decryptWorkspaceBackup(JSON.stringify(value), PASSWORD), failure("SECURE_AUTH"));
});

for (const field of ["ciphertext", "salt", "iv"]) {
  test("authenticated decrypt rejects a bit change in " + field, async () => {
    const prepared = await sample();
    const value = JSON.parse(prepared.text);
    const inspected = inspectEncryptedBackup(prepared.text);
    const bytes = inspected[field];
    bytes[0] ^= 1;
    const owner = field === "salt" ? value.kdf : field === "iv" ? value.cipher : value;
    owner[field] = encodeBackupBase64(bytes);
    await assert.rejects(decryptWorkspaceBackup(JSON.stringify(value), PASSWORD), failure("SECURE_AUTH"));
  });
}

test("plaintext encrypted without the specified authenticated header is rejected", async () => {
  const text = await rawEnvelope(await validPlaintext(), PASSWORD, { additionalData: new Uint8Array() });
  await assert.rejects(decryptWorkspaceBackup(text, PASSWORD), failure("SECURE_AUTH"));
});

for (const [name, make] of [
  ["invalid JSON", async () => "not workspace JSON"],
  ["unknown plaintext schema", async () => JSON.stringify({ schema: "other", a: "a".repeat(20) })],
  ["corrupt inner checksum", async () => { const value = JSON.parse(await validPlaintext()); value.digest = "0".repeat(64); return JSON.stringify(value); }],
  ["duplicate plaintext key", async () => (await validPlaintext()).replace('"schema":', '"schema":"ignored","schema":')],
  ["invalid UTF8", async () => new Uint8Array([0xff, 0xfe, ...new Array(20).fill(1)])],
]) {
  test("authenticated but invalid content: " + name, async () => {
    const text = await rawEnvelope(await make());
    await assert.rejects(decryptWorkspaceBackup(text, PASSWORD), failure("SECURE_CONTENT"));
  });
}

test("untrusted iteration count is rejected before native key import", async () => {
  const trace = traceCrypto();
  const value = envelope();
  value.kdf.iterations = 99999999;
  await assert.rejects(decryptWorkspaceBackup(JSON.stringify(value), PASSWORD, { crypto: trace.crypto }), failure("SECURE_FORMAT"));
  assert.equal(trace.calls.length, 0);
});

test("invalid passphrases fail without native work or random generation", async () => {
  const trace = traceCrypto();
  await assert.rejects(encryptWorkspaceBackup(bundle(), "short", { crypto: trace.crypto }), failure("SECURE_PASSPHRASE"));
  assert.equal(trace.calls.length, 0);
});

test("invalid workspace fails before key derivation and secret bytes are cleared", async () => {
  const trace = traceCrypto();
  await assert.rejects(encryptWorkspaceBackup({}, PASSWORD, { crypto: trace.crypto }), failure("SECURE_CONTENT"));
  assert(!trace.calls.some(call => call.name === "deriveKey" || call.name === "random"));
});

for (const crypto of [null, {}, { subtle: {} }, { subtle: webcrypto.subtle }]) {
  test("unsupported crypto capability fails closed", async () => {
    await assert.rejects(encryptWorkspaceBackup(bundle(), PASSWORD, { crypto }), failure("SECURE_UNAVAILABLE"));
  });
}

for (const method of ["digest", "importKey", "deriveKey", "encrypt"]) {
  test("encrypt sanitizes backend failure at " + method, async () => {
    const trace = traceCrypto({ [method]: async () => { throw Error(PASSWORD); } });
    await assert.rejects(encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto }), error => {
      assert.equal(error.code, "SECURE_CONTENT");
      assert(!String(error).includes(PASSWORD));
      return true;
    });
    const imported = trace.calls.find(call => call.name === "importKey");
    if (imported) assert(imported.args[1].every(byte => byte === 0));
  });
}

for (const after of ["digest", "importKey", "deriveKey", "encrypt"]) {
  test("cancelled encryption cannot proceed beyond " + after, async () => {
    let allowed = true;
    const trace = traceCrypto({ [after]: async (...args) => {
      const result = await webcrypto.subtle[after](...args);
      allowed = false;
      return result;
    } });
    await assert.rejects(encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto, guard: () => allowed }), failure("SECURE_CANCELLED"));
    const names = trace.calls.filter(call => call.name !== "random").map(call => call.name);
    assert.equal(names.at(-1), after);
  });
}

for (const after of ["importKey", "deriveKey", "decrypt", "digest"]) {
  test("cancelled decryption cannot release content after " + after, async () => {
    let allowed = true;
    const trace = traceCrypto({ [after]: async (...args) => {
      const result = await webcrypto.subtle[after](...args);
      allowed = false;
      return result;
    } });
    await assert.rejects(decryptWorkspaceBackup((await sample()).text, PASSWORD,
      { crypto: trace.crypto, guard: () => allowed }), failure("SECURE_CANCELLED"));
    assert.equal(trace.calls.at(-1).name, after);
  });
}

test("already cancelled encryption avoids all native operations", async () => {
  const trace = traceCrypto();
  await assert.rejects(encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto, guard: () => false }), failure("SECURE_CANCELLED"));
  assert.equal(trace.calls.length, 0);
});

test("exact Unicode password restores and normalized alternative does not", async () => {
  const password = "é".repeat(12);
  const prepared = await encryptWorkspaceBackup(bundle({ populated: false }), password);
  const restored = await decryptWorkspaceBackup(prepared.text, password);
  assert.equal(restored.text, encodeWorkspace(bundle({ populated: false })));
  await assert.rejects(decryptWorkspaceBackup(prepared.text, password.normalize("NFD")), failure("SECURE_AUTH"));
});
