import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { WORKSPACE_FILE_LIMIT } from "./workspace-file.js";

/** Versioned, bounded file format. No wallet, network or storage capability. */
export const SECURE_BACKUP_SCHEMA = "threecore-encrypted-workspace-v1";
export const SECURE_BACKUP_LIMIT = 12 * 1024 * 1024;
export const SECURE_BACKUP_ITERATIONS = 600_000;
export const SECURE_BACKUP_FILENAME = "ThreeCore-workspace-encrypted.json";
export const SECURE_BACKUP_MIN_PASSPHRASE = 12;
export const SECURE_BACKUP_MAX_PASSPHRASE = 1024;
export const SECURE_BACKUP_CODES = Object.freeze([
  "SECURE_FORMAT", "SECURE_SIZE", "SECURE_BASE64", "SECURE_PASSPHRASE",
  "SECURE_MISMATCH", "SECURE_UNAVAILABLE", "SECURE_AUTH", "SECURE_CONTENT",
  "SECURE_BUSY", "SECURE_CANCELLED", "SECURE_TIMEOUT", "SECURE_STALE",
  "SECURE_NOT_READY", "SECURE_STAGE", "SECURE_DOWNLOAD", "SECURE_READ",
  "SECURE_DISPOSED", "SECURE_INTERNAL",
]);

export class SecureBackupError extends Error {
  constructor(code) {
    const safe = SECURE_BACKUP_CODES.includes(code) ? code : "SECURE_INTERNAL";
    super(safe);
    this.name = "SecureBackupError";
    this.code = safe;
  }
}

export function secureFail(code) { throw new SecureBackupError(code); }
export function secureErrorCode(error, fallback = "SECURE_INTERNAL") {
  return error instanceof SecureBackupError ? error.code : fallback;
}

function exactObject(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length) secureFail("SECURE_FORMAT");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) secureFail("SECURE_FORMAT");
  }
}

export function encodeBackupBase64(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > WORKSPACE_FILE_LIMIT + 16) {
    secureFail("SECURE_SIZE");
  }
  const parts = [];
  // Avoid spreading a multi-megabyte file onto the JS argument stack.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(parts.join(""));
}

export function decodeBackupBase64(value, minimum, maximum) {
  if (typeof value !== "string" || !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) || minimum < 0 || maximum < minimum ||
      maximum > WORKSPACE_FILE_LIMIT + 16) secureFail("SECURE_BASE64");
  if (value.length < Math.ceil(minimum / 3) * 4 ||
      value.length > Math.ceil(maximum / 3) * 4 || value.length % 4 !== 0) {
    secureFail("SECURE_BASE64");
  }
  // Linear scan: a large regex repetition can overflow some engines' stacks.
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  for (let i = 0; i < value.length - padding; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || code === 43 || code === 47)) {
      secureFail("SECURE_BASE64");
    }
  }
  const length = value.length / 4 * 3 - padding;
  if (length < minimum || length > maximum) secureFail("SECURE_BASE64");
  let binary;
  try { binary = atob(value); } catch { secureFail("SECURE_BASE64"); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Reject nonzero unused pad bits and alternate representations.
  if (bytes.length !== length || encodeBackupBase64(bytes) !== value) {
    bytes.fill(0);
    secureFail("SECURE_BASE64");
  }
  return bytes;
}

/** No normalization: the exact Unicode passphrase is required to restore. */
export function backupPassphraseBytes(value) {
  if (typeof value !== "string" || value.length < SECURE_BACKUP_MIN_PASSPHRASE ||
      value.length > SECURE_BACKUP_MAX_PASSPHRASE || !value.trim()) {
    secureFail("SECURE_PASSPHRASE");
  }
  let characters = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) secureFail("SECURE_PASSPHRASE");
    } else if (code >= 0xdc00 && code <= 0xdfff) secureFail("SECURE_PASSPHRASE");
    if (code < 32 || code === 127) secureFail("SECURE_PASSPHRASE");
    characters++;
  }
  if (characters < SECURE_BACKUP_MIN_PASSPHRASE) secureFail("SECURE_PASSPHRASE");
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > SECURE_BACKUP_MAX_PASSPHRASE) {
    bytes.fill(0);
    secureFail("SECURE_PASSPHRASE");
  }
  return bytes;
}

/** The fixed parameters are part of the version, never a file-selected cost. */
export function backupHeader(salt, iv) {
  if (!(salt instanceof Uint8Array) || salt.length !== 16 ||
      !(iv instanceof Uint8Array) || iv.length !== 12) secureFail("SECURE_FORMAT");
  return Object.freeze({
    schema: SECURE_BACKUP_SCHEMA,
    kdf: Object.freeze({ name: "PBKDF2", hash: "SHA-256",
      iterations: SECURE_BACKUP_ITERATIONS, salt: encodeBackupBase64(salt) }),
    cipher: Object.freeze({ name: "AES-GCM", keyLength: 256, tagLength: 128,
      iv: encodeBackupBase64(iv) }),
  });
}

export function backupAdditionalData(header) {
  // Always reconstruct the validated header: object key order on disk is irrelevant.
  const salt = decodeBackupBase64(header.kdf.salt, 16, 16);
  const iv = decodeBackupBase64(header.cipher.iv, 12, 12);
  return new TextEncoder().encode(JSON.stringify(backupHeader(salt, iv)));
}

export function inspectEncryptedBackup(text) {
  let value;
  try {
    boundedUtf8Length(text, SECURE_BACKUP_LIMIT);
    value = parseSecurityJson(text, {
      bytes: SECURE_BACKUP_LIMIT, depth: 4, nodes: 32, keyCharacters: 32,
      stringCharacters: SECURE_BACKUP_LIMIT, numberCharacters: 8,
    });
  } catch { secureFail("SECURE_FORMAT"); }
  exactObject(value, ["schema", "kdf", "cipher", "ciphertext"]);
  exactObject(value.kdf, ["name", "hash", "iterations", "salt"]);
  exactObject(value.cipher, ["name", "keyLength", "tagLength", "iv"]);
  if (value.schema !== SECURE_BACKUP_SCHEMA || value.kdf.name !== "PBKDF2" ||
      value.kdf.hash !== "SHA-256" || value.kdf.iterations !== SECURE_BACKUP_ITERATIONS ||
      value.cipher.name !== "AES-GCM" || value.cipher.keyLength !== 256 ||
      value.cipher.tagLength !== 128) secureFail("SECURE_FORMAT");
  const salt = decodeBackupBase64(value.kdf.salt, 16, 16);
  const iv = decodeBackupBase64(value.cipher.iv, 12, 12);
  const ciphertext = decodeBackupBase64(value.ciphertext, 17, WORKSPACE_FILE_LIMIT + 16);
  const header = backupHeader(salt, iv);
  return Object.freeze({ header, salt, iv, ciphertext,
    additionalData: backupAdditionalData(header), byteLength: new TextEncoder().encode(text).length });
}

export function prepareEncryptedEnvelope(header, ciphertext) {
  const text = JSON.stringify({ ...header, ciphertext: encodeBackupBase64(ciphertext) });
  const inspected = inspectEncryptedBackup(text);
  return Object.freeze({ text, byteLength: inspected.byteLength,
    filename: SECURE_BACKUP_FILENAME, mimeType: "application/json;charset=utf-8" });
}
