import { captureDataRecord } from './security-data.js';
import { subscribeReadAbort } from './security-abort.js';
import { fetchStateRpcResponse, readStateRpcJson } from './state-rpc-http.js';
import { validateProposalFeeReadRequest } from './proposal-fee-request.js';
import { inspectProposalStateReviewFile } from './proposal-state-review.js';
export async function requestProposalStateReview(simulationPlanFile, { fetchImpl = globalThis.fetch, signal, timeoutMs = 125000 } = {}) {
  const data = validateProposalFeeReadRequest({ simulationPlanFile });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 125000) throw Error('STATE_CLIENT_TIMEOUT');
  const c = new AbortController(); let timer, sub;
  try {
    sub = subscribeReadAbort(signal, () => c.abort()); if (c.signal.aborted) throw Error('STATE_CANCELLED'); timer = setTimeout(() => c.abort(), timeoutMs);
    const response = await fetchStateRpcResponse(fetchImpl, '/rpc/proposal-state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: c.signal });
    const packet = captureDataRecord(await readStateRpcJson(response, { signal: c.signal, stringCharacters: 2 * 1024 * 1024 }), ['reviewFile']);
    const checked = await inspectProposalStateReviewFile(packet.reviewFile, { signal: c.signal });
    if (checked.files.simulationPlanFile !== simulationPlanFile || checked.recordedResult.environment !== 'public-rpc') throw Error('STATE_RESPONSE_CONTEXT');
    if (c.signal.aborted) throw Error('STATE_CANCELLED'); return packet.reviewFile;
  } finally { clearTimeout(timer); sub?.dispose(); c.abort(); }
}
