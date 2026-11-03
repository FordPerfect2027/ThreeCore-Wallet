import { parseSecurityJson } from "../src/security-json.js";
import { validatePublicBatchRequest } from "../src/public-token-batch-request.js";
import { readPublicTokenBatch } from "../src/public-token-batch-reader.js";
import { encodePublicTokenBatch } from "../src/public-token-batch-model.js";

const MAX_BODY = 1024;
/** Called only after inspectLocalRequest. No upstream URL, RPC method or credentials from the caller. */
export function createPublicBatchHandler(fetchImpl = globalThis.fetch) {
  let active = 0;
  return async (request, response) => {
    const send = (status, text) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      response.end(text);
    };
    const error = (status, code) => send(status, JSON.stringify({ error: code }));
    if (request.method !== "POST" || request.headers.origin !== "http://" + request.headers.host ||
        request.headers["content-type"] !== "application/json") { error(403, "BATCH_ORIGIN"); return; }
    if (active >= 3) { error(429, "BATCH_BUSY"); return; }
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
      error(413, "BATCH_REQUEST_SIZE"); return;
    }
    active++;
    const controller = new AbortController(), close = () => controller.abort();
    response.once("close", close);
    // Stop slow request bodies as well as slow upstream responses.
    const bodyTimer = setTimeout(() => {
      controller.abort(); error(408, "BATCH_REQUEST_TIMEOUT"); request.destroy();
    }, 5000);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) { error(413, "BATCH_REQUEST_SIZE"); return; }
        if (controller.signal.aborted) return;
        chunks.push(chunk);
      }
      clearTimeout(bodyTimer);
      let data;
      try {
        data = validatePublicBatchRequest(parseSecurityJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
          { bytes: MAX_BODY, depth: 3, nodes: 10, stringCharacters: 120 }));
      } catch { error(400, "BATCH_REQUEST"); return; }
      if (controller.signal.aborted) return;
      const batch = await readPublicTokenBatch({ ...data, blockNumber: data.blockNumber ?? undefined,
        fetchImpl, signal: controller.signal });
      if (!controller.signal.aborted) send(200, encodePublicTokenBatch(batch));
    } catch {
      error(controller.signal.aborted ? 504 : 502, "BATCH_UNAVAILABLE");
    } finally {
      clearTimeout(bodyTimer); controller.abort(); response.removeListener("close", close); active--;
    }
  };
}
