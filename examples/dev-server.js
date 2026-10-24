import { SECURITY_HEADERS, inspectLocalRequest } from "./security-http.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicPaths = [
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
  ...["json", "file", "rpc", "provider-error"].map(name =>
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
  ["/src/wallet-session.js", { file: resolve(here, "../src/wallet-session.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-registry.js", { file: resolve(here, "../src/provider-registry.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/provider-error.js", { file: resolve(here, "../src/provider-error.js"), mime: "text/javascript; charset=utf-8" }],
  ["/src/dapp-preflight.js", { file: resolve(here, "../src/dapp-preflight.js"), mime: "text/javascript; charset=utf-8" }],
];

export function createDemoServer({ uiTest = false } = {}) {
  const paths = new Map(publicPaths);
  if (uiTest) {
    paths.set("/test/browser/security-demo/", { file: resolve(here, "../test/browser/security-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/security-demo.js", { file: resolve(here, "../test/browser/security-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/security-ui-tests.js", { file: resolve(here, "../test/browser/security-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/report-set-demo/", { file: resolve(here, "../test/browser/report-set-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/report-set-demo.js", { file: resolve(here, "../test/browser/report-set-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/report-set-ui-tests.js", { file: resolve(here, "../test/browser/report-set-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/report-set-fixtures.js", { file: resolve(here, "../test/helpers/report-set-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/report-history-demo/", { file: resolve(here, "../test/browser/report-history-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/report-history-demo.js", { file: resolve(here, "../test/browser/report-history-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/report-history-ui-tests.js", { file: resolve(here, "../test/browser/report-history-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/report-history-fixtures.js", { file: resolve(here, "../test/helpers/report-history-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-report-demo/", { file: resolve(here, "../test/browser/period-report-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/period-report-demo.js", { file: resolve(here, "../test/browser/period-report-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-report-ui-tests.js", { file: resolve(here, "../test/browser/period-report-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/period-report-fixtures.js", { file: resolve(here, "../test/helpers/period-report-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-library-demo/", { file: resolve(here, "../test/browser/period-library-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/period-library-demo.js", { file: resolve(here, "../test/browser/period-library-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-library-ui-tests.js", { file: resolve(here, "../test/browser/period-library-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/period-library-fixtures.js", { file: resolve(here, "../test/helpers/period-library-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-ui-tests.js", { file: resolve(here, "../test/browser/period-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/period-fixtures.js", { file: resolve(here, "../test/helpers/period-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/period-demo/", { file: resolve(here, "../test/browser/period-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/period-demo.js", { file: resolve(here, "../test/browser/period-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/reconciliation-ui-tests.js", { file: resolve(here, "../test/browser/reconciliation-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/reconciliation-fixtures.js", { file: resolve(here, "../test/helpers/reconciliation-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/reconciliation-demo/", { file: resolve(here, "../test/browser/reconciliation-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/reconciliation-demo.js", { file: resolve(here, "../test/browser/reconciliation-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/transfer-vault-ui-tests.js", { file: resolve(here, "../test/browser/transfer-vault-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/vault-fixtures.js", { file: resolve(here, "../test/helpers/vault-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/transfer-vault-demo/", { file: resolve(here, "../test/browser/transfer-vault-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/transfer-vault-demo.js", { file: resolve(here, "../test/browser/transfer-vault-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/transfer-ui-tests.js", { file: resolve(here, "../test/browser/transfer-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/transfer-demo/", { file: resolve(here, "../test/browser/transfer-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/transfer-demo.js", { file: resolve(here, "../test/browser/transfer-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/transfer-fixtures.js", { file: resolve(here, "../test/helpers/transfer-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/allowance-bundle-ui-tests.js", { file: resolve(here, "../test/browser/allowance-bundle-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/allowance-demo/", { file: resolve(here, "../test/browser/allowance-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/allowance-demo.js", { file: resolve(here, "../test/browser/allowance-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/allowance-ui-tests.js", { file: resolve(here, "../test/browser/allowance-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/token-identity-demo/", { file: resolve(here, "../test/browser/token-identity-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/token-identity-demo.js", { file: resolve(here, "../test/browser/token-identity-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/token-identity-ui-tests.js", { file: resolve(here, "../test/browser/token-identity-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/checkpoint-demo/", { file: resolve(here, "../test/browser/checkpoint-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/checkpoint-demo.js", { file: resolve(here, "../test/browser/checkpoint-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/checkpoint-ui-tests.js", { file: resolve(here, "../test/browser/checkpoint-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/secure-backup-ui-tests.js", { file: resolve(here, "../test/browser/secure-backup-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/workspace-ui-tests.js", { file: resolve(here, "../test/browser/workspace-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/wallet-setup-ui-tests.js", { file: resolve(here, "../test/browser/wallet-setup-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/history-recovery-ui-tests.js", { file: resolve(here, "../test/browser/history-recovery-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/history-review-ui-tests.js", { file: resolve(here, "../test/browser/history-review-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/history-file-ui-tests.js", { file: resolve(here, "../test/browser/history-file-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/history-ui-tests.js", { file: resolve(here, "../test/browser/history-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/progress-demo/", { file: resolve(here, "../test/browser/progress-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/progress-demo.js", { file: resolve(here, "../test/browser/progress-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/", { file: resolve(here, "../test/browser/index.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/ui-tests.js", { file: resolve(here, "../test/browser/ui-tests.js"), mime: "text/javascript; charset=utf-8" });
  }
  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const verdict = inspectLocalRequest(request);
    if (verdict.status !== 200) {
      response.writeHead(verdict.status, { "content-type": "text/plain; charset=utf-8" });
      response.end(verdict.reason);
      return;
    }
    const item = paths.get(verdict.pathname);
    if (request.method !== "GET" || !item) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    try {
      const data = await readFile(item.file);
      response.writeHead(200, {
        "content-type": item.mime,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(data);
    } catch {
      response.writeHead(500);
      response.end("Unable to read demo file");
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--ui-test")) throw Error("Only --ui-test is supported");
  const port = Number(process.env.THREECORE_DEMO_PORT ?? "4173");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("THREECORE_DEMO_PORT must be an unprivileged TCP port");
  }
  createDemoServer({ uiTest: args.includes("--ui-test") }).listen(port, "127.0.0.1", () => {
    console.log("ThreeCore demo: http://127.0.0.1:" + port);
    console.log("Read-only wallet connector. No transaction/signing APIs.");
  });
}









