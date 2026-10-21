// Counterfactual diagnostic ONLY: replace one response in a disposable browser.
// This never modifies Aerodrome's server or the ThreeCore production connector.
import { createHash } from "node:crypto";
export const EXPERIMENT_URL = "https://aerodrome.finance/assets/index-8N6caatx.js";
export const EXPERIMENT_SHA256 = "1ab822229f1f4b7e20c1e7b4780cceb1afca995a31d8d4ef7f3a7a4ec8a94a38";
const needle = "r.slice(0,_0e).map(o=>o.name===\"Injected\"";
const replacement = "r.map(o=>o.name===\"Injected\"";
const choiceNeedle = 'r.slice(0,_0e).map(o=>o.name==="Injected"?{...o,name:"Browser Wallet"}:o)';
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function replaceUniqueConnectorLimit(source) {
  if (typeof source !== "string" || source.split(needle).length !== 2) {
    throw Error("Expected exactly one known connector-list expression");
  }
  return source.replace(needle, replacement);
}

export function replaceUniqueWalletChoices(source) {
  if (typeof source !== "string" || source.split(choiceNeedle).length !== 2) throw Error("Expected one known chooser expression");
  return source.replace(choiceNeedle, "window.__threecoreExperimentalChoices.map(r,_0e,Oc)");
}

export function patchPinnedConnectorAsset(url, bytes, kind = "connector-list") {
  if (!["connector-list", "wallet-choice"].includes(kind)) throw Error("Unknown experiment kind");
  if (url !== EXPERIMENT_URL || !Buffer.isBuffer(bytes) || bytes.length !== 2026768 || sha256(bytes) !== EXPERIMENT_SHA256) {
    throw Error("Unrecognized Aerodrome asset; counterfactual experiment refused");
  }
  const patched = Buffer.from((kind === "wallet-choice" ? replaceUniqueWalletChoices : replaceUniqueConnectorLimit)(bytes.toString("utf8")));
  return { bytes: patched, kind, originalSha256: sha256(bytes), modifiedSha256: sha256(patched), replacements: 1 };
}

export async function fulfillConnectorExperiment(event, cmd, evidence) {
  if (event.request?.url !== EXPERIMENT_URL || event.responseStatusCode !== 200 || evidence.status !== "pending") {
    throw Error("Unexpected response or repeated experimental replacement");
  }
  // Claim the single replacement before yielding to CDP. Concurrent responses
  // must not both observe a pending experiment while the first body is loading.
  evidence.status = "verifying";
  try {
    const response = await cmd("Fetch.getResponseBody", { requestId: event.requestId });
    const original = Buffer.from(response.body, response.base64Encoded ? "base64" : "utf8");
    const { bytes, ...audit } = patchPinnedConnectorAsset(event.request.url, original, evidence.kind ?? "connector-list");
    // CDP returns decoded bytes: do not retain compression or stale length headers.
    const responseHeaders = (event.responseHeaders ?? []).filter(h =>
      !["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5"].includes(h.name.toLowerCase()));
    await cmd("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders, body: bytes.toString("base64") });
    Object.assign(evidence, audit, { status: "applied", url: EXPERIMENT_URL });
  } catch (error) {
    Object.assign(evidence, { status: "refused", error: error.message });
    throw error;
  }
}
