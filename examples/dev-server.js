import { SECURITY_HEADERS, inspectLocalRequest } from "./security-http.js";
import { createBaseStateRpcHandler } from "./base-state-rpc.js";
import { WALLET_DEMO_ASSET_FILES } from "../server/wallet-demo-assets.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicPaths = WALLET_DEMO_ASSET_FILES.map(({ path, file, contentType }) =>
  [path, { file, mime: contentType.replace(";charset=", "; charset=") }]);

function navigationGuidance(request, verdict) {
  const port = request.socket.localPort;
  const headers = request.headers;
  if (verdict.status !== 403 || verdict.reason !== "Cross-origin request refused" ||
      request.method !== "GET" || request.url !== "/" || headers.origin !== undefined ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      headers.host !== "127.0.0.1:" + port ||
      headers["sec-fetch-site"] !== "cross-site" || headers["sec-fetch-mode"] !== "navigate" ||
      headers["sec-fetch-dest"] !== "document" || headers["sec-fetch-user"] !== "?1") return null;
  // Presentation only: keep the denied request denied, without an app-launch link.
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ThreeCore — 直接開く / Open directly</title>
</head>
<body>
<main>
<h1>ThreeCoreをアドレスバーから直接開いてください</h1>
<p>ThreeCoreの保護機能により、外部からのページ移動を停止しました。</p>
<p><strong>この新しいタブのアドレスバーに次のアドレスを貼り付け、Enterを押してください。</strong></p>
<p><code>http://127.0.0.1:${port}/</code></p>
<p>以前から開いているThreeCoreのタブは、そのまま保持してください。</p>
<p>この案内ページはウォレットに接続せず、保存記録を読み書きしません。</p>
<section lang="en">
<h2>Open ThreeCore from the address bar</h2>
<p>ThreeCore blocked this page navigation from outside the app.</p>
<p>Copy the address above into the address bar of this new tab and press Enter.</p>
<p>Keep any previously open ThreeCore tabs unchanged.</p>
<p>This guide does not connect to a wallet or read or write saved records.</p>
</section>
</main>
</body>
</html>`;
}

export function createDemoServer({ uiTest = false, stateFetch = globalThis.fetch } = {}) {
  const serveBaseStateRpc = createBaseStateRpcHandler(stateFetch);
  const paths = new Map(publicPaths);
  if (uiTest) {
    for (const name of ['acceptance-fixture', 'acceptance-ui-tests', 'acceptance-demo']) {
      paths.set('/test/browser/' + name + '.js', { file: resolve(here, '../test/browser/' + name + '.js'), mime: 'text/javascript; charset=utf-8' });
    }
    paths.set('/test/browser/acceptance-demo/', { file: resolve(here, '../test/browser/acceptance-demo.html'), mime: 'text/html; charset=utf-8' });
    paths.set("/test/browser/access-lifecycle-ui-tests.js", { file: resolve(here, "../test/browser/access-lifecycle-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/access-lifecycle-demo/", { file: resolve(here, "../test/browser/access-lifecycle-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/access-lifecycle-demo.js", { file: resolve(here, "../test/browser/access-lifecycle-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/access-lifecycle-demo.css", { file: resolve(here, "../test/browser/access-lifecycle-demo.css"), mime: "text/css; charset=utf-8" });
    paths.set("/test/browser/storage-guard-demo/", { file: resolve(here, "../test/browser/storage-guard-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/storage-guard-demo.css", { file: resolve(here, "../test/browser/storage-guard-demo.css"), mime: "text/css; charset=utf-8" });
    for (const file of ["storage-guard-fixture.js", "storage-guard-ui-tests.js", "storage-guard-demo.js"]) {
      paths.set("/test/browser/" + file, { file: resolve(here, "../test/browser/" + file), mime: "text/javascript; charset=utf-8" });
    }
    paths.set("/test/browser/secure-lifecycle-demo/", { file: resolve(here, "../test/browser/secure-lifecycle-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/secure-lifecycle-demo.js", { file: resolve(here, "../test/browser/secure-lifecycle-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/secure-lifecycle-demo.css", { file: resolve(here, "../test/browser/secure-lifecycle-demo.css"), mime: "text/css; charset=utf-8" });
    for (const file of ["browser/secure-lifecycle-ui-tests.js", "browser/secure-lifecycle-fixture.js", "helpers/secure-lifecycle-time.js"]) {
      paths.set("/test/" + file, { file: resolve(here, "../test/" + file), mime: "text/javascript; charset=utf-8" });
    }
    paths.set("/test/browser/encrypted-library-ui-tests.js", { file: resolve(here, "../test/browser/encrypted-library-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/rpc-protection-demo/", { file: resolve(here, "../test/browser/rpc-protection-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/rpc-protection-demo.js", { file: resolve(here, "../test/browser/rpc-protection-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/file-boundary-demo/", { file: resolve(here, "../test/browser/file-boundary-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/file-boundary-demo.js", { file: resolve(here, "../test/browser/file-boundary-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/export-guard-demo/", { file: resolve(here, "../test/browser/export-guard-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/export-guard-demo.js", { file: resolve(here, "../test/browser/export-guard-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/export-guard-ui-tests.js", { file: resolve(here, "../test/browser/export-guard-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/file-read-ui-tests.js", { file: resolve(here, "../test/browser/file-read-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/rpc-supervisor-ui-tests.js", { file: resolve(here, "../test/browser/rpc-supervisor-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/tab-guard-ui-tests.js", { file: resolve(here, "../test/browser/tab-guard-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
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
    paths.set("/test/browser/history-download-boundary-ui-tests.js", { file: resolve(here, "../test/browser/history-download-boundary-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/history-ui-tests.js", { file: resolve(here, "../test/browser/history-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/progress-demo/", { file: resolve(here, "../test/browser/progress-demo.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/progress-demo.js", { file: resolve(here, "../test/browser/progress-demo.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/", { file: resolve(here, "../test/browser/index.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/observer-ui-tests.js", { file: resolve(here, "../test/browser/observer-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/restore-confirmation-ui-tests.js", { file: resolve(here, "../test/browser/restore-confirmation-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/storage-receipt-ui-tests.js", { file: resolve(here, "../test/browser/storage-receipt-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/export-receipt-fixtures.js", { file: resolve(here, "../test/helpers/export-receipt-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/encrypted-library-fixtures.js", { file: resolve(here, "../test/helpers/encrypted-library-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/checkpoint-fixtures.js", { file: resolve(here, "../test/helpers/checkpoint-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/history-fixtures.js", { file: resolve(here, "../test/helpers/history-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/helpers/workspace-fixtures.js", { file: resolve(here, "../test/helpers/workspace-fixtures.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/adapter-boundary-ui-tests.js", { file: resolve(here, "../test/browser/adapter-boundary-ui-tests.js"), mime: "text/javascript; charset=utf-8" });
    paths.set("/test/browser/ui-tests.js", { file: resolve(here, "../test/browser/ui-tests.js"), mime: "text/javascript; charset=utf-8" });
  }
  return createServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const verdict = inspectLocalRequest(request);
    if (verdict.status !== 200) {
      const guidance = navigationGuidance(request, verdict);
      response.writeHead(verdict.status, { "content-type": guidance === null ? "text/plain; charset=utf-8" : "text/html; charset=utf-8" });
      response.end(guidance ?? verdict.reason);
      return;
    }
    if (verdict.pathname === "/rpc/base-mainnet") {
      await serveBaseStateRpc(request, response);
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
      const body = verdict.pathname === "/"
        ? data.toString("utf8").replace('<html lang="ja">', '<html lang="ja" data-base-state-relay>')
        : data;
      response.end(body);
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









