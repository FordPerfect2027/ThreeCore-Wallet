import { open } from "node:fs/promises";

/** Read-only, bounded inspection of one opened file; no parsing or network use. */
export async function readBoundedLocalBytes(path, limit, { fail, sizeCode,
  changedCode = sizeCode, limitCode = sizeCode }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 96 * 1024 * 1024) fail(limitCode);
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > limit) fail(sizeCode);
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(64 * 1024, bytes.length - offset);
      const { bytesRead } = await handle.read(bytes, offset, length, offset);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > length) fail(changedCode);
      offset += bytesRead;
    }
    // Size equality alone cannot detect a same-length edit during inspection.
    const extra = await handle.read(new Uint8Array(1), 0, 1, bytes.length);
    const after = await handle.stat();
    if (extra.bytesRead !== 0 || !after.isFile() ||
        ["size", "mtimeMs", "ctimeMs", "ino", "dev"].some(key => after[key] !== before[key])) fail(changedCode);
    return bytes;
  } finally { await handle.close(); }
}
