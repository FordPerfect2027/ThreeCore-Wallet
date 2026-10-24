import { exportFail, requireSyncExport } from "../src/export-policy.js";

const NativeURL = globalThis.URL;
function method(owner, name) {
  const value = owner?.[name];
  if (typeof value !== "function") exportFail("EXPORT_UNAVAILABLE");
  return (...args) => value.apply(owner, args);
}
function documentOrigin(document) {
  const href = document.location?.href;
  let parsed;
  try { parsed = new NativeURL(href); } catch { exportFail("EXPORT_UNAVAILABLE"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) exportFail("EXPORT_UNAVAILABLE");
  return parsed.origin;
}
export function inspectExportURL(value, origin) {
  if (typeof value !== "string" || value.length > 512 ||
      !value.startsWith("blob:" + origin + "/")) exportFail("EXPORT_FAILED");
  const suffix = value.slice(("blob:" + origin + "/").length);
  if (!/^[A-Za-z0-9-]{1,128}$/.test(suffix)) exportFail("EXPORT_FAILED");
  let parsed;
  try { parsed = new NativeURL(value); } catch { exportFail("EXPORT_FAILED"); }
  if (parsed.protocol !== "blob:" || parsed.origin !== origin) exportFail("EXPORT_FAILED");
  return value;
}

/** No URL or DOM allocation until activate; release is captured beforehand. */
export function createBrowserExportResource(document, input, isCurrent) {
  const view = document.defaultView;
  const origin = documentOrigin(document);
  const BlobType = view?.Blob;
  if (typeof BlobType !== "function" || typeof isCurrent !== "function") exportFail("EXPORT_UNAVAILABLE");
  const createURL = method(view.URL, "createObjectURL");
  const revokeURL = method(view.URL, "revokeObjectURL");
  const createElement = method(document, "createElement");
  const append = method(document.body, "append");
  let payload = input, url = null, anchor = null, remove = null;
  let closed = false, activated = false, activating = false, cleaning = false;
  function checkpoint() {
    if (closed || !isCurrent()) exportFail("EXPORT_CANCELLED");
  }
  function removeAnchor() {
    if (!anchor) return;
    if (!remove) remove = method(anchor, "remove");
    requireSyncExport(remove(), "EXPORT_CLEANUP");
    // append/click may synchronously trigger a stop, then continue using the
    // captured node. Retain it until that stack unwinds and remove it again.
    if (!activating) { anchor = null; remove = null; }
  }
  function release() {
    closed = true; payload = null;
    if (cleaning) return false;
    cleaning = true;
    let ok = true;
    try {
      try { removeAnchor(); } catch { ok = false; }
      if (url !== null) {
        try { requireSyncExport(revokeURL(url), "EXPORT_CLEANUP"); url = null; }
        catch { ok = false; }
      }
    } finally { cleaning = false; }
    return ok;
  }
  function activate() {
    checkpoint();
    if (activated) exportFail("EXPORT_FAILED");
    activated = true;
    activating = true;
    const prepared = payload;
    try {
      const blob = new BlobType([prepared.text], { type: prepared.mimeType });
      checkpoint();
      if (blob.size !== prepared.byteLength || blob.type !== prepared.mimeType) exportFail("EXPORT_FAILED");
      // Store before validation: even an invalid returned string must be revoked.
      url = createURL(blob);
      inspectExportURL(url, origin); checkpoint();
      anchor = createElement("a");
      checkpoint();
      remove = method(anchor, "remove");
      const click = method(anchor, "click");
      checkpoint();
      anchor.hidden = true; checkpoint();
      anchor.rel = "noopener noreferrer"; checkpoint();
      anchor.referrerPolicy = "no-referrer"; checkpoint();
      anchor.download = prepared.filename; checkpoint();
      anchor.href = url; checkpoint();
      requireSyncExport(append(anchor)); checkpoint();
      requireSyncExport(click()); checkpoint();
    } finally {
      activating = false;
      payload = null;
      removeAnchor();
    }
  }
  return Object.freeze({ activate, release });
}
