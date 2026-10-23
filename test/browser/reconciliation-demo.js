import { mountReconciliationPanel } from "/examples/reconciliation-panel.js";
import { previewWorkspace, scenario } from "/test/helpers/reconciliation-fixtures.js";

function start() {
  return mountReconciliationPanel({
    document,
    parent: document.querySelector("#reconciliation-demo"),
    initial: previewWorkspace(),
    readObservation: agent => scenario(agent, {}, 84532).later,
    readArchive: agent => scenario(agent, {}, 84532).archive,
  });
}

let app = start();
window.addEventListener("pagehide", () => { app?.dispose(); app = null; });
window.addEventListener("pageshow", () => { if (!app) app = start(); });
