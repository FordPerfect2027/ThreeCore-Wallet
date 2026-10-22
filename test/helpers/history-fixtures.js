import { createPortfolioHistory } from "../../src/portfolio-history.js";

export const ACCOUNT = "0x" + "11".repeat(20);
export const OTHER = "0x" + "22".repeat(20);
export const TOKEN = "0x" + "33".repeat(20);
export const MAX = ((1n << 256n) - 1n).toString();
export function observation(block = "42", changes = {}) {
  return {
    agent: "DAT",
    account: ACCOUNT,
    chainId: 84532,
    siteOrigin: "http://localhost:4184",
    connectionEpoch: 1,
    blockNumber: block,
    blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: "16",
    holdings: [{ address: TOKEN, hasCode: true, balanceBaseUnits: "42", notice: null }],
    readOnly: true,
    securityAudit: false,
    ...changes,
  };
}
export function archive(rows = [observation()]) {
  const history = createPortfolioHistory();
  history.merge(rows);
  return history.exportText();
}
export function bytes(text = archive()) {
  return new TextEncoder().encode(text);
}
export function file(text = archive(), changes = {}) {
  return { name: "history.json", size: bytes(text).length, ...changes };
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
