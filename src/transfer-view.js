import {
  shape, transferContextKey, transferDirection, transferEventKey,
  transferFail, validateTransferSnapshot,
} from "./transfer-codec.js";

export const TRANSFER_DIRECTIONS = Object.freeze(["all", "incoming", "outgoing", "self", "mint", "burn"]);
export const DIRECTION_LABELS = Object.freeze({
  all: "すべて", incoming: "受信", outgoing: "送信", self: "自己送信", mint: "発行による受信", burn: "焼却",
});

/** Summed events may exceed uint256; no IEEE-754 rounding or implicit currency. */
export function formatTransferAmount(value, decimals = 18) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,80})$/.test(value) || value === "-0" ||
      !Number.isInteger(decimals) || decimals < 0 || decimals > 255) transferFail("TRANSFER_DISPLAY_AMOUNT");
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = sign ? value.slice(1) : value;
  if (!decimals) return sign + unsigned;
  const padded = unsigned.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return sign + padded.slice(0, -decimals) + (fraction ? "." + fraction : "");
}

export function summarizeTransfers(input) {
  const snapshot = validateTransferSnapshot(input);
  const counts = { incoming: 0, outgoing: 0, self: 0, mint: 0, burn: 0 };
  const amounts = { incoming: 0n, outgoing: 0n, self: 0n, mint: 0n, burn: 0n };
  const counterparties = new Set();
  const transactions = new Set();
  for (const event of snapshot.events) {
    const direction = transferDirection(event, snapshot.context.account);
    counts[direction]++;
    amounts[direction] += BigInt(event.amountBaseUnits);
    transactions.add(event.transactionHash);
    if (direction === "incoming") counterparties.add(event.from);
    if (direction === "outgoing") counterparties.add(event.to);
  }
  const received = amounts.incoming + amounts.mint;
  const sent = amounts.outgoing + amounts.burn;
  return Object.freeze({
    events: snapshot.events.length,
    transactions: transactions.size,
    counterparties: counterparties.size,
    counts: Object.freeze(counts),
    amounts: Object.freeze(Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value.toString()]))),
    receivedBaseUnits: received.toString(),
    sentBaseUnits: sent.toString(),
    netObservedBaseUnits: (received - sent).toString(),
    isBalance: false,
  });
}

export function validateTransferQuery(value = { direction: "all", search: "", order: "newest", page: 0, pageSize: 10 }) {
  shape(value, ["direction", "search", "order", "page", "pageSize"]);
  if (!TRANSFER_DIRECTIONS.includes(value.direction)) transferFail("TRANSFER_QUERY_DIRECTION");
  if (!["newest", "oldest"].includes(value.order)) transferFail("TRANSFER_QUERY_ORDER");
  if (typeof value.search !== "string" || value.search.length > 100 || /[\u0000-\u001f\u007f]/.test(value.search)) {
    transferFail("TRANSFER_QUERY_SEARCH");
  }
  if (!Number.isSafeInteger(value.page) || value.page < 0 ||
      !Number.isInteger(value.pageSize) || value.pageSize < 1 || value.pageSize > 100) transferFail("TRANSFER_QUERY_PAGE");
  return Object.freeze({ ...value, search: value.search.trim().toLowerCase() });
}

export function queryTransfers(input, filter) {
  const snapshot = validateTransferSnapshot(input);
  const query = validateTransferQuery(filter);
  const matches = snapshot.events.filter(event => {
    const direction = transferDirection(event, snapshot.context.account);
    const directionMatches = query.direction === "all" || direction === query.direction;
    const searchable = [event.transactionHash, event.from, event.to, event.blockNumber];
    return directionMatches && (!query.search || searchable.some(text => text.includes(query.search)));
  });
  if (query.order === "newest") matches.reverse();
  const pages = Math.max(1, Math.ceil(matches.length / query.pageSize));
  const page = Math.min(query.page, pages - 1);
  return Object.freeze({
    query: Object.freeze({ ...query, page }),
    total: snapshot.events.length,
    matched: matches.length,
    pages,
    hasPrevious: page > 0,
    hasNext: page + 1 < pages,
    rows: Object.freeze(matches.slice(page * query.pageSize, (page + 1) * query.pageSize).map(event => Object.freeze({
      ...event,
      direction: transferDirection(event, snapshot.context.account),
      formattedAmount: formatTransferAmount(event.amountBaseUnits, snapshot.metadata.decimals),
    }))),
  });
}

/** Two observations can differ without proving either is truthful or complete. */
export function compareTransferSnapshots(beforeInput, afterInput) {
  const before = validateTransferSnapshot(beforeInput);
  const after = validateTransferSnapshot(afterInput);
  if (transferContextKey(before.context) !== transferContextKey(after.context) ||
      JSON.stringify(before.range) !== JSON.stringify(after.range) || before.tokenAddress !== after.tokenAddress) {
    transferFail("TRANSFER_COMPARISON_CONTEXT");
  }
  const old = new Map(before.events.map(event => [transferEventKey(event), event]));
  const next = new Map(after.events.map(event => [transferEventKey(event), event]));
  const added = [], removed = [], changed = [];
  let unchanged = 0;
  for (const [key, event] of old) {
    if (!next.has(key)) removed.push(event);
    else if (JSON.stringify(event) !== JSON.stringify(next.get(key))) changed.push(Object.freeze({ before: event, after: next.get(key) }));
    else unchanged++;
  }
  for (const [key, event] of next) if (!old.has(key)) added.push(event);
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
    unchanged,
    boundaryChanged: before.fromBlockHash !== after.fromBlockHash || before.toBlockHash !== after.toBlockHash,
    metadataChanged: JSON.stringify(before.metadata) !== JSON.stringify(after.metadata),
    identical: JSON.stringify(before) === JSON.stringify(after),
    independentVerification: false,
  });
}

export function transferSummaryText(input, provenance = "imported") {
  const snapshot = validateTransferSnapshot(input);
  const summary = summarizeTransfers(snapshot);
  const amount = value => formatTransferAmount(value, snapshot.metadata.decimals) + " " + snapshot.metadata.symbol;
  return [
    snapshot.context.agent + " / " + (snapshot.context.chainId === 8453 ? "Base Mainnet" : "Base Sepolia（テストネット）"),
    "口座: " + snapshot.context.account,
    "トークン: " + snapshot.tokenAddress,
    "範囲: " + snapshot.range.fromBlock + " ～ " + snapshot.range.toBlock,
    "出所: " + (provenance === "live" ? "接続したWalletから今回読み取り" : "ファイルから読み込んだ記録（現在のチェーン状態は未確認）"),
    `${summary.events}件 / ${summary.transactions}取引 / ${summary.counterparties}相手先`,
    "受信・発行の合計: " + amount(summary.receivedBaseUnits),
    "送信・焼却の合計: " + amount(summary.sentBaseUnits),
    "観測した差額: " + amount(summary.netObservedBaseUnits),
    "自己送信: " + summary.counts.self + "件（差額には含めません）",
    "これは指定範囲で取得できたイベントです。残高・損益・全取引履歴を示すものではありません。",
    "取得元による省略を独立検証していません。少ない件数や0件でも、活動がないとは限りません。",
  ].join("\n");
}

export function transferComparisonText(result) {
  return [
    "同じ口座・トークン・ブロック範囲の記録比較",
    `追加 ${result.added.length}件 / 消失 ${result.removed.length}件 / 内容変更 ${result.changed.length}件 / 同一 ${result.unchanged}件`,
    "境界ブロック変更: " + (result.boundaryChanged ? "あり" : "なし"),
    "メタデータ変更: " + (result.metadataChanged ? "あり" : "なし"),
    "差分は取得内容の違いです。実際の送金やチェーン再編を断定しません。",
  ].join("\n");
}

export function transferCsv(input) {
  const snapshot = validateTransferSnapshot(input);
  const fields = ["agent", "chain_id", "account", "token", "range_start", "range_end", "block", "block_hash",
    "transaction_hash", "transaction_index", "log_index", "direction", "from", "to", "amount_base_units", "decimals", "amount"];
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const lines = [fields.map(quote).join(",")];
  for (const event of snapshot.events) {
    lines.push([
      snapshot.context.agent, snapshot.context.chainId, snapshot.context.account, snapshot.tokenAddress,
      snapshot.range.fromBlock, snapshot.range.toBlock, event.blockNumber, event.blockHash,
      event.transactionHash, event.transactionIndex, event.logIndex, transferDirection(event, snapshot.context.account),
      event.from, event.to, event.amountBaseUnits, snapshot.metadata.decimals,
      formatTransferAmount(event.amountBaseUnits, snapshot.metadata.decimals),
    ].map(quote).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
