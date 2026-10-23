import { MAX_TRANSFER_BLOCKS, transferFail, validateTransferRequest, validateTransferSnapshot } from "./transfer-codec.js";

/** Draft changes only: callers must still press Read to query the Wallet. */
export function planTransferWindow(input, action) {
  const record = validateTransferSnapshot(input);
  const from = BigInt(record.range.fromBlock);
  const to = BigInt(record.range.toBlock);
  const width = to - from + 1n;
  if (action === "pin") {
    return validateTransferRequest({ ...record.range, lookback: Number(width) });
  }
  if (action === "latest") {
    return validateTransferRequest({ fromBlock: null, toBlock: null, lookback: Number(width) });
  }
  if (action === "previous") {
    if (from === 0n) transferFail("TRANSFER_WINDOW_GENESIS");
    const end = from - 1n;
    const start = from > width ? from - width : 0n;
    return validateTransferRequest({ fromBlock: start.toString(), toBlock: end.toString(), lookback: Number(width) });
  }
  if (action === "narrow") {
    if (width === 1n) transferFail("TRANSFER_WINDOW_MINIMUM");
    const smaller = (width + 1n) / 2n;
    return validateTransferRequest({ fromBlock: (to - smaller + 1n).toString(), toBlock: to.toString(), lookback: Number(smaller) });
  }
  transferFail("TRANSFER_WINDOW_ACTION");
}

/** Inspect a draft without resolving latest or contacting a provider. */
export function describeTransferWindow(input) {
  const request = validateTransferRequest(input);
  if (request.fromBlock !== null && request.toBlock !== null) {
    const blocks = (BigInt(request.toBlock) - BigInt(request.fromBlock) + 1n).toString();
    return Object.freeze({ mode: "fixed", blocks, text: `${request.fromBlock} ～ ${request.toBlock}（${blocks}ブロック）。取得ボタンを押すと確認します。` });
  }
  if (request.fromBlock !== null) {
    return Object.freeze({ mode: "open-end", blocks: null,
      text: `開始 ${request.fromBlock} ～ 最新。取得時に${MAX_TRANSFER_BLOCKS}ブロック以内か確認します。` });
  }
  return Object.freeze({ mode: "recent", blocks: String(request.lookback),
    text: `${request.toBlock === null ? "最新" : request.toBlock}までの直近${request.lookback}ブロック。開始が0未満になる場合は0まで確認します。` });
}
