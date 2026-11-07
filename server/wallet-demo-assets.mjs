/** Fixed normal-demo assets; no directory serving, bootstrap or automatic start. */
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { captureDataRecord } from "../src/security-data.js";
import { createProposalApplicationHost } from "./proposal-http-host.mjs";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "../examples");
const publicPaths = [
  ["/examples/wallet-demo.css", { file: resolve(here, "wallet-demo.css"), mime: "text/css; charset=utf-8" }],
  ...["base-state-provider", "state-rpc-http"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ...["agent-read-proposal", "agent-read-policy-registry", "agent-proposal-record", "agent-proposal-client"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/agent-proposal-panel.js", { file: resolve(here, "agent-proposal-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/security-abort.js", { file: resolve(here, "../src/security-abort.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/security-callback.js", { file: resolve(here, "../src/security-callback.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/state-notifier.js", { file: resolve(here, "../src/state-notifier.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/wallet-read-scope.js", { file: resolve(here, "../src/wallet-read-scope.js"), mime: "text/javascript; charset=utf-8" }],
  ...["storage-guard", "storage-guard-policy", "storage-guard-status"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/storage-guard-panel.js", { file: resolve(here, "storage-guard-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/secure-backup-status.js", { file: resolve(here, "../src/secure-backup-status.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/secure-operation-panel.js", { file: resolve(here, "secure-operation-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/secure-deadline.js", { file: resolve(here, "../src/secure-deadline.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/export-policy.js", { file: resolve(here, "../src/export-policy.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/export-payload.js", { file: resolve(here, "../src/export-payload.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/export-guard.js", { file: resolve(here, "../src/export-guard.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/export-status.js", { file: resolve(here, "../src/export-status.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/export-resource.js", { file: resolve(here, "../examples/export-resource.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/export-download.js", { file: resolve(here, "../examples/export-download.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/export-guard-panel.js", { file: resolve(here, "../examples/export-guard-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/file-read-policy.js", { file: resolve(here, "../src/file-read-policy.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/file-read-source.js", { file: resolve(here, "../src/file-read-source.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/file-read-service.js", { file: resolve(here, "../src/file-read-service.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/file-read-status.js", { file: resolve(here, "../src/file-read-status.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/file-read-panel.js", { file: resolve(here, "file-read-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-event-gate.js", { file: resolve(here, "../src/provider-event-gate.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-events.js", { file: resolve(here, "../src/provider-events.js"), mime: "text/javascript; charset=utf-8" }],
  ...["capacity", "supervisor", "status"].map(name =>
    ["/src/rpc-" + name + ".js", { file: resolve(here, "../src/rpc-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/rpc-status-panel.js", { file: resolve(here, "rpc-status-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/protection-batch.js", { file: resolve(here, "../src/protection-batch.js"), mime: "text/javascript; charset=utf-8" }],
  ...["protocol", "transport", "controller"].map(name =>
    ["/src/tab-guard-" + name + ".js", { file: resolve(here, "../src/tab-guard-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/tab-guard-panel.js", { file: resolve(here, "tab-guard-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["model", "storage", "controller", "archive"].map(name =>
    ["/src/encrypted-library-" + name + ".js", { file: resolve(here, "../src/encrypted-library-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/encrypted-library-panel.js", { file: resolve(here, "encrypted-library-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/wallet-entry.js", { file: resolve(here, "wallet-entry.js"), mime: "text/javascript; charset=utf-8" }],
  ...["format", "crypto", "runner", "controller"].map(name =>
    ["/src/secure-backup-" + name + ".js", { file: resolve(here, "../src/secure-backup-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/secure-backup-panel.js", { file: resolve(here, "secure-backup-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/secure-backup.css", { file: resolve(here, "secure-backup.css"), mime: "text/css; charset=utf-8" }],
  ["/src/security-journal.js", { file: resolve(here, "../src/security-journal.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/security-journal-panel.js", { file: resolve(here, "security-journal-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/security-lock.js", { file: resolve(here, "../src/security-lock.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/security-panel.js", { file: resolve(here, "security-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/security.css", { file: resolve(here, "security.css"), mime: "text/css; charset=utf-8" }],
  ...["json", "data", "file", "rpc", "provider-error"].map(name =>
    ["/src/security-" + name + ".js", { file: resolve(here, "../src/security-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ...["model", "engine", "file", "view", "export", "controller", "diagnostics", "timeline"].map(name =>
    ["/src/report-set-" + name + ".js", { file: resolve(here, "../src/report-set-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/report-set-panel.js", { file: resolve(here, "report-set-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/report-set-timeline-panel.js", { file: resolve(here, "report-set-timeline-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/report-set.css", { file: resolve(here, "report-set.css"), mime: "text/css; charset=utf-8" }],
  ...["model", "storage", "file", "query", "view", "controller", "sources", "continuity"].map(name =>
    ["/src/report-history-" + name + ".js", { file: resolve(here, "../src/report-history-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/report-history-panel.js", { file: resolve(here, "report-history-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/report-history.css", { file: resolve(here, "report-history.css"), mime: "text/css; charset=utf-8" }],
  ...["model", "engine", "file", "query", "view", "export", "controller", "comparison"].map(name =>
    ["/src/period-report-" + name + ".js", { file: resolve(here, "../src/period-report-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/period-report-panel.js", { file: resolve(here, "period-report-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/period-report.css", { file: resolve(here, "period-report.css"), mime: "text/css; charset=utf-8" }],
  ...["model", "storage", "file", "query", "view", "controller"].map(name =>
    ["/src/period-library-" + name + ".js", { file: resolve(here, "../src/period-library-" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/period-library-panel.js", { file: resolve(here, "period-library-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/period-library.css", { file: resolve(here, "period-library.css"), mime: "text/css; charset=utf-8" }],
  ...["period-plan", "period-draft", "period-reader", "period-file", "period-view", "period-controller", "period-recovery", "period-progress"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/period-panel.js", { file: resolve(here, "period-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/period.css", { file: resolve(here, "period.css"), mime: "text/css; charset=utf-8" }],
  ...["reconciliation-model", "reconciliation-engine", "reconciliation-file", "reconciliation-view", "reconciliation-query", "reconciliation-controller", "reconciliation-ledger"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/reconciliation-panel.js", { file: resolve(here, "reconciliation-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/reconciliation.css", { file: resolve(here, "reconciliation.css"), mime: "text/css; charset=utf-8" }],
  ...["transfer-vault-timeline", "transfer-vault-collection", "transfer-vault-model", "transfer-vault-file", "transfer-vault-analytics", "transfer-vault-storage", "transfer-vault-controller", "transfer-vault-messages"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/transfer-vault-panel.js", { file: resolve(here, "transfer-vault-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["transfer-codec", "transfer-reader", "transfer-view", "transfer-file", "transfer-controller", "transfer-messages",
    "transfer-archive", "transfer-archive-file", "transfer-archive-controller", "transfer-window"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/transfer-panel.js", { file: resolve(here, "transfer-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/transfer-archive-panel.js", { file: resolve(here, "transfer-archive-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["allowance-targets", "allowance-observation", "allowance-reader", "allowance-file",
    "allowance-controller", "allowance-view", "allowance-overview", "allowance-bundle"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/allowance-panel.js", { file: resolve(here, "allowance-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/allowance-bundle-panel.js", { file: resolve(here, "allowance-bundle-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["token-identity-codec", "token-catalog", "token-identity-model", "token-identity-reader",
    "token-identity-report", "token-identity-view", "token-identity-controller", "identity-overview"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/token-identity-panel.js", { file: resolve(here, "token-identity-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["checkpoint-model", "checkpoint-storage", "checkpoint-controller", "checkpoint-transfer"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/checkpoint-panel.js", { file: resolve(here, "checkpoint-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["workspace-format", "workspace-controller", "workspace-file", "workspace-overview", "workspace-review"].map(name => ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/workspace-panel.js", { file: resolve(here, "workspace-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["wallet-setup", "wallet-setup-file"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/examples/wallet-setup-panel.js", { file: resolve(here, "wallet-setup-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/history-recovery-panel.js", { file: resolve(here, "history-recovery-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/history-review-panel.js", { file: resolve(here, "history-review-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/history-files.js", { file: resolve(here, "history-files.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/history-panel.js", { file: resolve(here, "history-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/token-plan-panel.js", { file: resolve(here, "token-plan-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/comparison-panel.js", { file: resolve(here, "comparison-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ["/examples/portfolio-panel.js", { file: resolve(here, "portfolio-panel.js"), mime: "text/javascript; charset=utf-8" }],
  ...["portfolio-snapshot", "portfolio-controller", "portfolio-report", "agent-portfolios", "portfolio-comparison", "token-plan", "portfolio-progress", "portfolio-history", "history-import-controller", "portfolio-history-summary", "history-file", "history-file-reader", "history-query", "history-review", "history-recovery", "history-recovery-report"].map(name =>
    ["/src/" + name + ".js", { file: resolve(here, "../src/" + name + ".js"), mime: "text/javascript; charset=utf-8" }]),
  ["/", { file: resolve(here, "index.html"), mime: "text/html; charset=utf-8" }],
  ["/examples/wallet-demo.js", { file: resolve(here, "wallet-demo.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/wallet-card-controller.js", { file: resolve(here, "../src/wallet-card-controller.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/wallet-connection-guidance.js", { file: resolve(here, "../src/wallet-connection-guidance.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/wallet-session.js", { file: resolve(here, "../src/wallet-session.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-registry.js", { file: resolve(here, "../src/provider-registry.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-error.js", { file: resolve(here, "../src/provider-error.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/dapp-preflight.js", { file: resolve(here, "../src/dapp-preflight.js"), mime: "text/javascript; charset=utf-8" }],
];

// Share only the coded normal allowlist. Tests, server code and arbitrary
// filesystem roots are not accepted as inputs to this module.
export const WALLET_DEMO_ASSET_FILES = Object.freeze(publicPaths.map(([path, item]) =>
  Object.freeze({ path, file: item.file, contentType: item.mime.replace("; charset=", ";charset=") })));
const MAX_FILE_BYTES = 131072, MAX_TOTAL_BYTES = 4194304;
const HOST_OPTIONS = new Set(["enabled", "createService", "port", "maxConnections", "maxConcurrentRequests", "requestTimeoutMs"]);
const fail = code => { throw Object.assign(new Error(code), { code }); };

function captureHostOptions(input) {
  try {
    const names = Reflect.ownKeys(input);
    if (names.some(name => !HOST_OPTIONS.has(name))) fail("INVALID_WALLET_DEMO_CONFIG");
    const options = captureDataRecord(input, names);
    if (typeof options.createService !== "function") fail("INVALID_WALLET_DEMO_CONFIG");
    return options;
  } catch { fail("INVALID_WALLET_DEMO_CONFIG"); }
}

async function readPublicText(file) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0 || info.size > MAX_FILE_BYTES)
      fail("WALLET_DEMO_ASSET_UNAVAILABLE");
    // Read at most the observed size plus one byte. Growth, truncation and an
    // invalid UTF-8 file fail before there is any listener or service callback.
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== info.size) fail("WALLET_DEMO_ASSET_UNAVAILABLE");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, offset));
  } finally { await handle.close(); }
}

/** Explicit asynchronous capture; does not bind, register or create a service. */
export async function captureWalletDemoPublicAssets() {
  try {
    if (WALLET_DEMO_ASSET_FILES.length === 0 || WALLET_DEMO_ASSET_FILES.length > 256)
      fail("WALLET_DEMO_ASSET_UNAVAILABLE");
    const result = [], paths = new Set();
    let bytes = 0;
    for (const file of WALLET_DEMO_ASSET_FILES) {
      if (paths.has(file.path)) fail("WALLET_DEMO_ASSET_UNAVAILABLE");
      paths.add(file.path);
      const body = await readPublicText(file.file);
      bytes += Buffer.byteLength(body, "utf8");
      if (bytes > MAX_TOTAL_BYTES) fail("WALLET_DEMO_ASSET_UNAVAILABLE");
      result.push(Object.freeze({ path: file.path, contentType: file.contentType, body }));
    }
    return Object.freeze(result);
  } catch { fail("WALLET_DEMO_ASSET_UNAVAILABLE"); }
}

/** Fixed assets + existing owned host. createService is required; enabled defaults false. */
export async function createWalletDemoApplicationHost(options = {}) {
  // Capture own data before the first await so edits during file reading cannot
  // replace the factory, enable the host or move its requested port.
  const captured = captureHostOptions(options);
  const publicAssets = await captureWalletDemoPublicAssets();
  return createProposalApplicationHost({ ...captured, publicAssets });
}
