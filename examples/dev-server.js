import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicPaths = [
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
    paths.set("/test/browser/", { file: resolve(here, "../test/browser/index.html"), mime: "text/html; charset=utf-8" });
    paths.set("/test/browser/ui-tests.js", { file: resolve(here, "../test/browser/ui-tests.js"), mime: "text/javascript; charset=utf-8" });
  }
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const item = paths.get(url.pathname);
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
