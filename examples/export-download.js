import { createExportGuard } from "../src/export-guard.js";
import { exportFail, exportErrorCode, ExportSecurityError } from "../src/export-policy.js";
import { createBrowserExportResource } from "./export-resource.js";

const guards = new WeakMap();

/** One budget per document, shared by every application download button. */
export function getDocumentExportGuard(document) {
  try { return obtainGuard(document); }
  catch (error) { throw new ExportSecurityError(exportErrorCode(error)); }
}

function obtainGuard(document) {
  if (!document || typeof document !== "object") exportFail("EXPORT_UNAVAILABLE");
  let guard = guards.get(document);
  if (guard) return guard;
  const view = document.defaultView;
  const schedule = view?.setTimeout, unschedule = view?.clearTimeout;
  const add = view?.addEventListener, remove = view?.removeEventListener;
  const clock = view?.performance, now = clock?.now;
  if ([schedule, unschedule, add, remove, now].some(value => typeof value !== "function")) exportFail("EXPORT_UNAVAILABLE");
  guard = createExportGuard({
    createResource: (payload, current) => createBrowserExportResource(document, payload, current),
    schedule: (action, delay) => schedule.call(view, action, delay),
    unschedule: id => unschedule.call(view, id),
    now: () => now.call(clock),
  });
  // pagehide may precede BFCache restoration. Clear leases without permanently
  // disposing the document's guard, so explicit later exports remain possible.
  const clear = () => { guard.clear(); };
  try {
    add.call(view, "pagehide", clear);
    add.call(view, "pageshow", clear);
  } catch {
    for (const type of ["pagehide", "pageshow"]) {
      try { remove.call(view, type, clear); } catch {}
    }
    guard.dispose(); exportFail("EXPORT_UNAVAILABLE");
  }
  guards.set(document, guard);
  return guard;
}

export function offerWalletDownload({ document, prepared }) {
  return getDocumentExportGuard(document).offer(prepared);
}
