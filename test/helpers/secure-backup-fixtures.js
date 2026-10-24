import { webcrypto } from "node:crypto";
import { draft, clone, bundle, gate, fileObject, tick } from "./workspace-fixtures.js";
import { backupHeader, prepareEncryptedEnvelope } from "../../src/secure-backup-format.js";
import { prepareWorkspaceFile } from "../../src/workspace-file.js";
import { createSecureBackupController } from "../../src/secure-backup-controller.js";
import { createSecureBackupRunner } from "../../src/secure-backup-runner.js";
import { encodeWorkspace } from "../../src/workspace-format.js";

export { draft, clone, bundle, gate, fileObject, tick, webcrypto };
export const PASSWORD = "synthetic only eleven purple moons";
export const OTHER_PASSWORD = "synthetic only twelve orange suns";

export function envelope(changes = {}) {
  const header = backupHeader(new Uint8Array(16).fill(7), new Uint8Array(12).fill(8));
  const value = JSON.parse(prepareEncryptedEnvelope(header, new Uint8Array(48).fill(9)).text);
  return { ...value, ...changes };
}
export const encryptedText = () => JSON.stringify(envelope());
export function fakePrepared() {
  const text = encryptedText();
  return Object.freeze({ text, byteLength: text.length,
    filename: "ThreeCore-workspace-encrypted.json", mimeType: "application/json;charset=utf-8" });
}
export function fakeDecoded(options) {
  const workspace = bundle(options);
  return { text: encodeWorkspace(workspace), workspace };
}

/** Deterministic controller adapter; real cryptography is tested separately. */
export function controllerFixture(overrides = {}) {
  let current = draft();
  const notifications = [];
  const staged = [];
  const calls = [];
  const controller = createSecureBackupController({
    readDraft: () => clone(current),
    onStage(text) { staged.push(text); return true; },
    onChange: state => notifications.push(state),
    runner: createSecureBackupRunner(),
    encrypt: async (workspace, password, options) => {
      calls.push({ kind: "encrypt", workspace, password, options });
      return fakePrepared();
    },
    decrypt: async (text, password, options) => {
      calls.push({ kind: "decrypt", text, password, options });
      return fakeDecoded();
    },
    ...overrides,
  });
  return { controller, notifications, staged, calls,
    get draft() { return clone(current); },
    setDraft(value) { current = clone(value); },
    change() { current[0].tokens = ""; },
    select: () => controller.select(fileObject(encryptedText())),
    seal: () => controller.seal(PASSWORD, PASSWORD),
    unlock: () => controller.unlock(PASSWORD),
  };
}

/** Trace native calls without replacing their cryptographic implementation. */
export function traceCrypto(overrides = {}) {
  const calls = [];
  const subtle = {};
  for (const name of ["digest", "importKey", "deriveKey", "encrypt", "decrypt"]) {
    subtle[name] = async (...args) => {
      calls.push({ name, args });
      if (overrides[name]) return overrides[name](...args);
      return webcrypto.subtle[name](...args);
    };
  }
  return { calls, crypto: { subtle, getRandomValues(array) {
    calls.push({ name: "random", length: array.length });
    return webcrypto.getRandomValues(array);
  } } };
}

export async function rawEnvelope(plaintext, password = PASSWORD, extra = {}) {
  const salt = new Uint8Array(16).fill(10);
  const iv = new Uint8Array(12).fill(11);
  const header = backupHeader(salt, iv);
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password),
    "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: 600_000, salt },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;
  const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128,
    additionalData: new TextEncoder().encode(JSON.stringify(header)), ...extra }, key, bytes);
  return prepareEncryptedEnvelope(header, new Uint8Array(ciphertext)).text;
}

export async function validPlaintext() {
  return (await prepareWorkspaceFile(bundle(), { subtle: webcrypto.subtle })).text;
}
