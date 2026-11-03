import { captureDataRecord } from "./security-data.js";
import { identityAddress, identityUnits } from "./token-identity-codec.js";
import { failPublicTokenBatch as fail } from "./public-token-batch-model.js";

/** Only a public account, supported chain and optional explicit height cross HTTP. */
export function validatePublicBatchRequest(input) {
  let data;
  try { data = captureDataRecord(input, ["chainId", "account", "blockNumber"]); }
  catch { fail("BATCH_REQUEST"); }
  if (![8453, 84532].includes(data.chainId)) fail("BATCH_REQUEST");
  return Object.freeze({ chainId: data.chainId, account: identityAddress(data.account),
    blockNumber: data.blockNumber === null ? null : identityUnits(data.blockNumber) });
}
