import { readBoundedLocalBytes } from "./read-bounded-local-file.js";

export async function readSavedTextPath(path, limit) {
  const bytes = await readBoundedLocalBytes(path, limit, { fail: code => { throw Error(code); }, sizeCode: "FILE_SIZE", changedCode: "FILE_CHANGED" });
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
export function savedJSONPath(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("-") && /\.json$/i.test(value) && !value.includes("\0");
}
export function savedCLIError(error) {
  const code = error?.code ?? error?.message;
  return typeof code === "string" && /^(FILE|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "FILE_CLI_FAILED";
}
