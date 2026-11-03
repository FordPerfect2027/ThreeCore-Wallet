import { validatePublicBatchRequest } from "./public-token-batch-request.js";
import { validatePublicTokenBatch, encodePublicTokenBatch, failPublicTokenBatch as fail } from "./public-token-batch-model.js";
import { fetchStateRpcResponse, readStateRpcJson } from "./state-rpc-http.js";
import { subscribeReadAbort } from "./security-abort.js";

export async function requestPublicTokenBatch(input, { fetchImpl = globalThis.fetch, signal, timeoutMs = 125000 } = {}) {
  const data = validatePublicBatchRequest(input);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 125000) fail("BATCH_CLIENT_TIMEOUT");
  const controller = new AbortController(); let cancellation, timer;
  try {
    cancellation = subscribeReadAbort(signal, () => controller.abort());
    if (controller.signal.aborted) fail("BATCH_CANCELLED");
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetchStateRpcResponse(fetchImpl, "/rpc/public-token-batch", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
      credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
    });
    const batch = validatePublicTokenBatch(await readStateRpcJson(response, { signal: controller.signal }));
    encodePublicTokenBatch(batch); // Apply the smaller batch size limit after the bounded HTTP parser.
    if (controller.signal.aborted) fail("BATCH_CANCELLED");
    if (batch.account !== data.account || batch.chainId !== data.chainId ||
        (data.blockNumber !== null && batch.blockNumber !== data.blockNumber)) fail("BATCH_RESPONSE_CONTEXT");
    return batch;
  } finally { clearTimeout(timer); cancellation?.dispose(); controller.abort(); }
}
