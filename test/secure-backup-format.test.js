import test from "node:test";
import assert from "node:assert/strict";
import { inspectEncryptedBackup, encodeBackupBase64, decodeBackupBase64,
  backupPassphraseBytes, backupHeader, backupAdditionalData,
  prepareEncryptedEnvelope, SECURE_BACKUP_LIMIT, SECURE_BACKUP_ITERATIONS,
  SECURE_BACKUP_CODES, SecureBackupError, secureErrorCode } from "../src/secure-backup-format.js";
import { WORKSPACE_FILE_LIMIT } from "../src/workspace-file.js";
import { envelope, encryptedText, clone } from "./helpers/secure-backup-fixtures.js";

const rejects = (fn, code) => assert.throws(fn, error => error instanceof SecureBackupError && (!code || error.code === code));

test("encrypted format accepts exactly the v1 fixed cryptographic parameters", () => {
  const parsed = inspectEncryptedBackup(encryptedText());
  assert.equal(parsed.header.kdf.iterations, SECURE_BACKUP_ITERATIONS);
  assert.equal(parsed.header.cipher.tagLength, 128);
  assert.equal(parsed.header.cipher.keyLength, 256);
  assert.equal(parsed.salt.length, 16);
  assert.equal(parsed.iv.length, 12);
  assert.equal(parsed.ciphertext.length, 48);
  assert(Object.isFrozen(parsed.header.kdf));
  assert(Object.isFrozen(parsed.header.cipher));
});

test("encrypted metadata contains no original filename, account, timestamp or plaintext size", () => {
  assert.deepEqual(Object.keys(envelope()), ["schema", "kdf", "cipher", "ciphertext"]);
  const file = prepareEncryptedEnvelope(backupHeader(new Uint8Array(16), new Uint8Array(12)), new Uint8Array(20));
  assert.equal(file.filename, "ThreeCore-workspace-encrypted.json");
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).length);
  assert.equal(file.mimeType, "application/json;charset=utf-8");
  assert(Object.isFrozen(file));
});

for (const [name, mutate] of [
  ["unknown version", x => x.schema = "threecore-encrypted-workspace-v2"],
  ["missing version", x => delete x.schema],
  ["plaintext field", x => x.workspace = {}],
  ["filename field", x => x.filename = "private.json"],
  ["weaker KDF", x => x.kdf.name = "SHA-256"],
  ["alternate hash", x => x.kdf.hash = "SHA-1"],
  ["lower iteration count", x => x.kdf.iterations = 599999],
  ["higher iteration count", x => x.kdf.iterations = 600001],
  ["iteration DoS", x => x.kdf.iterations = 99999999],
  ["iteration string", x => x.kdf.iterations = "600000"],
  ["iteration null", x => x.kdf.iterations = null],
  ["iteration fraction", x => x.kdf.iterations = 600000.5],
  ["unknown KDF field", x => x.kdf.pepper = "x"],
  ["missing KDF field", x => delete x.kdf.hash],
  ["CBC mode", x => x.cipher.name = "AES-CBC"],
  ["short key", x => x.cipher.keyLength = 128],
  ["short tag", x => x.cipher.tagLength = 96],
  ["string tag", x => x.cipher.tagLength = "128"],
  ["unknown cipher field", x => x.cipher.aad = "x"],
  ["missing cipher field", x => delete x.cipher.iv],
  ["KDF array", x => x.kdf = []],
  ["cipher null", x => x.cipher = null],
  ["ciphertext array", x => x.ciphertext = [1, 2, 3]],
]) {
  test("encrypted format rejects " + name + " before cryptographic work", () => {
    const value = envelope();
    mutate(value);
    rejects(() => inspectEncryptedBackup(JSON.stringify(value)));
  });
}

for (const [name, text] of [
  ["duplicate root", encryptedText().replace('"schema":', '"schema":"ignored","schema":')],
  ["duplicate escaped key", encryptedText().replace('"salt":', '"s\\u0061lt":"ignored","salt":')],
  ["duplicate cipher", encryptedText().replace('"keyLength":', '"keyLength":128,"keyLength":')],
  ["proto property", encryptedText().replace('"schema":', '"__proto__":{},"schema":')],
  ["constructor property", encryptedText().replace('"schema":', '"constructor":{},"schema":')],
  ["trailing data", encryptedText() + "{}"],
  ["comment", "/* comment */" + encryptedText()],
  ["null", "null"],
  ["array", "[]"],
  ["string", '"test"'],
  ["empty", ""],
  ["BOM", "\ufeff" + encryptedText()],
  ["control character", encryptedText().replace("PBKDF2", "PBK\nDF2")],
]) {
  test("encrypted JSON rejects " + name, () => rejects(() => inspectEncryptedBackup(text)));
}

test("encrypted format bounds JSON before parsing large input", () => {
  rejects(() => inspectEncryptedBackup(" ".repeat(SECURE_BACKUP_LIMIT + 1)), "SECURE_FORMAT");
  rejects(() => inspectEncryptedBackup("[".repeat(100) + "0" + "]".repeat(100)), "SECURE_FORMAT");
});

test("key order and insignificant whitespace preserve canonical authenticated header", () => {
  const first = envelope();
  const second = {
    ciphertext: first.ciphertext,
    cipher: { iv: first.cipher.iv, tagLength: 128, keyLength: 256, name: "AES-GCM" },
    kdf: { salt: first.kdf.salt, iterations: 600000, hash: "SHA-256", name: "PBKDF2" },
    schema: first.schema,
  };
  assert.deepEqual(inspectEncryptedBackup(JSON.stringify(first)).additionalData,
    inspectEncryptedBackup(JSON.stringify(second, null, 2)).additionalData);
});

for (const length of [0, 1, 2, 3, 11, 12, 15, 16, 17, 31, 32, 127, 8191, 8192, 8193, 32768]) {
  test("canonical base64 round trip at length " + length, () => {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    const text = encodeBackupBase64(bytes);
    assert.deepEqual(decodeBackupBase64(text, length, length), bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64"));
  });
}

for (const text of ["A", "AAA", "AAAA=", "=AAA", "A=AA", "AA=A", "====", "AA--", "AA__",
  "AA A", "AA\nA", "AA\tA", "ＡAAA", "AB==", "AAB=", "A===", "AAA\u0000"]) {
  test("base64 rejects noncanonical form " + JSON.stringify(text), () => {
    rejects(() => decodeBackupBase64(text, 1, 20), "SECURE_BASE64");
  });
}

test("base64 enforces decoded length, not just encoded length", () => {
  rejects(() => decodeBackupBase64("AA==", 2, 2), "SECURE_BASE64");
  rejects(() => decodeBackupBase64("AAAA", 1, 2), "SECURE_BASE64");
  rejects(() => decodeBackupBase64("", 1, 1), "SECURE_BASE64");
  rejects(() => decodeBackupBase64("AA==", -1, 2), "SECURE_BASE64");
  rejects(() => decodeBackupBase64("AA==", 0, WORKSPACE_FILE_LIMIT + 17), "SECURE_BASE64");
  rejects(() => encodeBackupBase64([]), "SECURE_SIZE");
});

for (const [field, size] of [["salt", 15], ["salt", 17], ["iv", 11], ["iv", 13], ["ciphertext", 16]]) {
  test("envelope rejects incorrect " + field + " byte length " + size, () => {
    const value = envelope();
    const owner = field === "salt" ? value.kdf : field === "iv" ? value.cipher : value;
    owner[field] = encodeBackupBase64(new Uint8Array(size));
    rejects(() => inspectEncryptedBackup(JSON.stringify(value)), "SECURE_BASE64");
  });
}

test("header generation checks IV and salt shape", () => {
  rejects(() => backupHeader(new Uint8Array(15), new Uint8Array(12)), "SECURE_FORMAT");
  rejects(() => backupHeader(new Uint8Array(16), new Uint8Array(13)), "SECURE_FORMAT");
  rejects(() => backupHeader([], new Uint8Array(12)), "SECURE_FORMAT");
  const header = backupHeader(new Uint8Array(16), new Uint8Array(12));
  assert.equal(new TextDecoder().decode(backupAdditionalData(header)), JSON.stringify(header));
});

for (const value of [null, undefined, 12345, {}, [], "", "a".repeat(11), " ".repeat(12),
  "a".repeat(1025), "a".repeat(11) + "\n", "a".repeat(11) + "\t", "a".repeat(11) + "\0",
  "a".repeat(11) + "\x7f", "a".repeat(11) + "\ud800", "a".repeat(11) + "\udc00",
  "a".repeat(11) + "\ud800x", "😀".repeat(6), "あ".repeat(342)]) {
  test("passphrase rejects invalid input " + String(value).slice(0, 30), () => {
    rejects(() => backupPassphraseBytes(value), "SECURE_PASSPHRASE");
  });
}

for (const value of ["a".repeat(12), "a".repeat(1024), "😀".repeat(12), "あ".repeat(12),
  " leading and trailing ", "e\u0301".repeat(12), "é".repeat(12), "あ".repeat(341)]) {
  test("passphrase preserves exact valid Unicode bytes " + value.slice(0, 24), () => {
    assert.equal(new TextDecoder().decode(backupPassphraseBytes(value)), value);
  });
}

test("passphrase normalization and whitespace are never silently changed", () => {
  assert.notDeepEqual(backupPassphraseBytes("é".repeat(12)), backupPassphraseBytes("e\u0301".repeat(12)));
  assert.notDeepEqual(backupPassphraseBytes("a".repeat(12)), backupPassphraseBytes(" " + "a".repeat(12)));
});

test("error serialization cannot carry external messages or arbitrary codes", () => {
  const secret = "not-for-status password account";
  const error = new SecureBackupError(secret);
  assert.equal(error.message, "SECURE_INTERNAL");
  assert.equal(error.code, "SECURE_INTERNAL");
  assert(!JSON.stringify(error).includes(secret));
  assert.equal(secureErrorCode({ code: "SECURE_AUTH", message: secret }), "SECURE_INTERNAL");
  for (const code of SECURE_BACKUP_CODES) assert.equal(secureErrorCode(new SecureBackupError(code)), code);
});
