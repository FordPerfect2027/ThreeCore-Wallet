import { randomUUID } from "node:crypto";

/** Receipt endpoint for a disposable test server, never the normal demo server. */
export function installBrowserCompletion(server, { timeoutMs = 90000, maxBytes = 1024 * 1024 } = {}) {
  const nonce = randomUUID();
  const pathname = "/test/browser/ci-result/" + nonce;
  const listeners = server.listeners("request");
  if (listeners.length !== 1) throw Error("Expected exactly one demo request handler");
  const original = listeners[0];
  let settled = false, disposed = false, resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  const timer = setTimeout(() => fail(Error("Browser did not report a completed suite")), timeoutMs);
  function fail(error) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(error);
  }
  function handler(request, response) {
    if (request.url !== pathname) return original(request, response);
    const expectedOrigin = "http://127.0.0.1:" + server.address().port;
    if (settled || request.method !== "POST" || request.headers.origin !== expectedOrigin ||
        request.headers["content-type"] !== "text/html") {
      response.writeHead(403); response.end(); return;
    }
    const chunks = [];
    let size = 0;
    request.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        response.writeHead(413); response.end(); request.destroy();
        fail(Error("Oversized browser completion receipt"));
      } else chunks.push(chunk);
    });
    request.on("error", fail);
    request.on("end", () => {
      if (settled) return;
      if (!size) { response.writeHead(400); response.end(); fail(Error("Empty browser completion receipt")); return; }
      settled = true;
      clearTimeout(timer);
      response.writeHead(204); response.end();
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  }
  server.removeListener("request", original);
  server.on("request", handler);
  return { nonce, pathname, result, fail, dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    server.removeListener("request", handler);
    server.on("request", original);
  } };
}
