import { prepareWorkspaceFile, decodeWorkspaceFile, WORKSPACE_FILE_LIMIT } from "./workspace-file.js";
import { backupPassphraseBytes, backupHeader, backupAdditionalData,
  inspectEncryptedBackup, prepareEncryptedEnvelope, secureFail,
  SecureBackupError } from "./secure-backup-format.js";

function environment(crypto) {
  if (!crypto || typeof crypto.getRandomValues !== "function" ||
      !crypto.subtle || ["importKey", "deriveKey", "encrypt", "decrypt", "digest"]
        .some(name => typeof crypto.subtle[name] !== "function")) secureFail("SECURE_UNAVAILABLE");
  return crypto.subtle;
}

function checkpoint(guard) {
  if (guard() !== true) secureFail("SECURE_CANCELLED");
}

async function derive(subtle, bytes, salt, usage, guard) {
  checkpoint(guard);
  const material = await subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
  checkpoint(guard);
  const key = await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256",
    iterations: 600_000, salt }, material,
  { name: "AES-GCM", length: 256 }, false, [usage]);
  checkpoint(guard);
  return key;
}

/** Native WebCrypto only. No password, key, or plaintext is returned with the file. */
export async function encryptWorkspaceBackup(workspace, passphrase, {
  crypto = globalThis.crypto, guard = () => true,
} = {}) {
  let password;
  let plaintext;
  let key;
  try {
    checkpoint(guard);
    const subtle = environment(crypto);
    password = backupPassphraseBytes(passphrase);
    passphrase = undefined;
    const prepared = await prepareWorkspaceFile(workspace, { subtle });
    checkpoint(guard);
    plaintext = new TextEncoder().encode(prepared.text);
    if (!plaintext.length || plaintext.length > WORKSPACE_FILE_LIMIT) secureFail("SECURE_SIZE");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const header = backupHeader(salt, iv);
    key = await derive(subtle, password, salt, "encrypt", guard);
    const encrypted = await subtle.encrypt({ name: "AES-GCM", iv,
      additionalData: backupAdditionalData(header), tagLength: 128 }, key, plaintext);
    checkpoint(guard);
    return prepareEncryptedEnvelope(header, new Uint8Array(encrypted));
  } catch (error) {
    if (error instanceof SecureBackupError) throw error;
    secureFail("SECURE_CONTENT");
  } finally {
    password?.fill(0);
    plaintext?.fill(0);
    key = undefined;
    passphrase = undefined;
  }
}

/** AES-GCM authentication is necessary but not sufficient: validate the inner file too. */
export async function decryptWorkspaceBackup(text, passphrase, {
  crypto = globalThis.crypto, guard = () => true,
} = {}) {
  let password;
  let plaintext;
  let key;
  try {
    checkpoint(guard);
    const envelope = inspectEncryptedBackup(text);
    const subtle = environment(crypto);
    password = backupPassphraseBytes(passphrase);
    passphrase = undefined;
    key = await derive(subtle, password, envelope.salt, "decrypt", guard);
    let buffer;
    try {
      buffer = await subtle.decrypt({ name: "AES-GCM", iv: envelope.iv,
        additionalData: envelope.additionalData, tagLength: 128 }, key, envelope.ciphertext);
    } catch { secureFail("SECURE_AUTH"); }
    plaintext = new Uint8Array(buffer);
    checkpoint(guard);
    let decoded;
    try { decoded = await decodeWorkspaceFile(plaintext, { subtle }); }
    catch { secureFail("SECURE_CONTENT"); }
    checkpoint(guard);
    return Object.freeze({ text: decoded.text, workspace: decoded.workspace,
      checksumVerified: true, passwordAuthenticated: true, ownerVerified: false });
  } catch (error) {
    if (error instanceof SecureBackupError) throw error;
    secureFail("SECURE_CONTENT");
  } finally {
    password?.fill(0);
    plaintext?.fill(0);
    key = undefined;
    passphrase = undefined;
  }
}
