import { transferDirection, transferEventKey, compareTransferOrder, transferFail, shape } from "./transfer-codec.js";
import { describeTransferArchive, validateTransferArchive } from "./transfer-archive.js";
import { DIRECTION_LABELS, TRANSFER_DIRECTIONS, formatTransferAmount } from "./transfer-view.js";
import { VAULT_AGENTS, validateVaultBundle } from "./transfer-vault-model.js";

/** Dedupe only within one validated token/account archive. Never sum different assets. */
export function archiveEvents(input) {
  const archive = validateTransferArchive(input);
  const events = new Map();
  for (const record of archive.records) {
    for (const row of record.events) events.set(transferEventKey(row), row);
  }
  return Object.freeze([...events.values()].sort(compareTransferOrder));
}

export function validateActivityQuery(input = { agent: "all", direction: "all", search: "", order: "newest", page: 0, pageSize: 20 }) {
  shape(input, ["agent", "direction", "search", "order", "page", "pageSize"]);
  if (!["all", ...VAULT_AGENTS].includes(input.agent)) transferFail("TRANSFER_VAULT_QUERY");
  if (!TRANSFER_DIRECTIONS.includes(input.direction) || !["newest", "oldest"].includes(input.order)) transferFail("TRANSFER_VAULT_QUERY");
  if (typeof input.search !== "string" || input.search.length > 100 || /[\u0000-\u001f\u007f]/.test(input.search)) {
    transferFail("TRANSFER_VAULT_QUERY");
  }
  if (!Number.isSafeInteger(input.page) || input.page < 0 || !Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    transferFail("TRANSFER_VAULT_QUERY");
  }
  return Object.freeze({ ...input, search: input.search.trim().toLowerCase() });
}

function compareRows(a, b) {
  // Block height is comparable only within the same chain. Group by chain first.
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  return compareTransferOrder(a, b) || VAULT_AGENTS.indexOf(a.agent) - VAULT_AGENTS.indexOf(b.agent);
}

export function activityRows(input) {
  const bundle = validateVaultBundle(input);
  const rows = [];
  for (const { agent, archive } of bundle.slots) {
    if (!archive) continue;
    const { context, metadata, tokenAddress } = archive.records[0];
    for (const event of archiveEvents(archive)) {
      rows.push(Object.freeze({ ...event, agent, chainId: context.chainId, account: context.account,
        tokenAddress, direction: transferDirection(event, context.account),
        formattedAmount: formatTransferAmount(event.amountBaseUnits, metadata.decimals) }));
    }
  }
  return Object.freeze(rows.sort(compareRows));
}

function matchingActivity(input, query) {
  const filter = validateActivityQuery(query);
  const all = activityRows(input);
  const matches = all.filter(row => (filter.agent === "all" || filter.agent === row.agent) &&
    (filter.direction === "all" || filter.direction === row.direction) &&
    (!filter.search || [row.account, row.from, row.to, row.transactionHash, row.blockNumber, row.tokenAddress]
      .some(value => value.includes(filter.search))));
  if (filter.order === "newest") matches.reverse();
  return { filter, all, matches };
}

export function queryVaultActivity(input, query) {
  const { filter, all, matches } = matchingActivity(input, query);
  const pages = Math.max(1, Math.ceil(matches.length / filter.pageSize));
  const page = Math.min(filter.page, pages - 1);
  return Object.freeze({ query: Object.freeze({ ...filter, page }), total: all.length, matched: matches.length, pages,
    hasPrevious: page > 0, hasNext: page + 1 < pages,
    rows: Object.freeze(matches.slice(page * filter.pageSize, (page + 1) * filter.pageSize)) });
}

function totals(rows, account) {
  const counts = { incoming: 0, outgoing: 0, self: 0, mint: 0, burn: 0 };
  const amounts = { incoming: 0n, outgoing: 0n, self: 0n, mint: 0n, burn: 0n };
  const transactions = new Set();
  for (const row of rows) {
    const direction = transferDirection(row, account);
    counts[direction]++;
    amounts[direction] += BigInt(row.amountBaseUnits);
    transactions.add(row.transactionHash);
  }
  const received = amounts.incoming + amounts.mint, sent = amounts.outgoing + amounts.burn;
  return Object.freeze({ events: rows.length, transactions: transactions.size,
    counts: Object.freeze(counts), amounts: Object.freeze(Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, String(value)]))),
    receivedBaseUnits: String(received), sentBaseUnits: String(sent), netObservedBaseUnits: String(received - sent), isBalance: false });
}

export function summarizeVaultActivity(input) {
  return Object.freeze(validateVaultBundle(input).slots.map(({ agent, archive }) => {
    if (!archive) return Object.freeze({ agent, present: false });
    const { context, metadata } = archive.records[0];
    return Object.freeze({ agent, present: true, context, decimals: metadata.decimals,
      coverage: describeTransferArchive(archive), ...totals(archiveEvents(archive), context.account) });
  }));
}

/** Groups are public counterparty observations, not contact identities or trust scores. */
export function vaultCounterparties(input, agent) {
  if (!VAULT_AGENTS.includes(agent)) transferFail("TRANSFER_VAULT_QUERY");
  const archive = validateVaultBundle(input).slots.find(slot => slot.agent === agent).archive;
  if (!archive) return Object.freeze([]);
  const { context, metadata } = archive.records[0];
  const groups = new Map();
  for (const row of archiveEvents(archive)) {
    const direction = transferDirection(row, context.account);
    if (!["incoming", "outgoing"].includes(direction)) continue;
    const address = direction === "incoming" ? row.from : row.to;
    if (!groups.has(address)) groups.set(address, []);
    groups.get(address).push(row);
  }
  return Object.freeze([...groups].map(([address, events]) => {
    const summary = totals(events, context.account);
    return Object.freeze({ address, ...summary, firstBlock: events[0].blockNumber, lastBlock: events.at(-1).blockNumber,
      received: formatTransferAmount(summary.receivedBaseUnits, metadata.decimals),
      sent: formatTransferAmount(summary.sentBaseUnits, metadata.decimals) });
  }).sort((a, b) => b.events - a.events || a.address.localeCompare(b.address)));
}

export function vaultActivityText(input) {
  const lines = ["ThreeCore — 保存履歴の集計", "取得済みの範囲だけの集計です。残高・損益・完全な取引履歴ではありません。"];
  for (const row of summarizeVaultActivity(input)) {
    lines.push("", row.agent);
    if (!row.present) { lines.push("記録なし（残高ゼロを意味しません）"); continue; }
    lines.push("チェーン " + row.context.chainId, row.context.account,
      `${row.events}イベント / ${row.transactions}取引 / ${row.coverage.records}期間`,
      "受信: " + formatTransferAmount(row.receivedBaseUnits, row.decimals) + " " + row.agent,
      "送信: " + formatTransferAmount(row.sentBaseUnits, row.decimals) + " " + row.agent,
      "記録上の差額: " + formatTransferAmount(row.netObservedBaseUnits, row.decimals) + " " + row.agent,
      "問い合わせ済み: " + row.coverage.requestedBlocks + "ブロック",
      "期間の間の未確認範囲: " + row.coverage.gaps.length + "か所");
    for (const gap of row.coverage.gaps) lines.push("  " + gap.fromBlock + " ～ " + gap.toBlock);
  }
  lines.push("", "異なるチェーン・トークンの金額は合算しません。現在のチェーン状態は未確認です。");
  return lines.join("\n");
}

function csvCell(value) {
  const text = String(value);
  const safe = /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function rowsCsv(rows) {
  const columns = ["agent", "chainId", "account", "tokenAddress", "blockNumber", "blockHash", "transactionHash",
    "transactionIndex", "logIndex", "direction", "from", "to", "amountBaseUnits", "formattedAmount"];
  return "\ufeff" + [columns.map(csvCell).join(","), ...rows.map(row => columns.map(key => csvCell(row[key])).join(","))].join("\r\n") + "\r\n";
}

export function vaultActivityCsv(input) {
  return rowsCsv(activityRows(input));
}

/** Export every matching row, not just the current page; never mutate the bundle. */
export function vaultFilteredActivityCsv(input, query) {
  const { filter, all, matches } = matchingActivity(input, query);
  return Object.freeze({ text: rowsCsv(matches), matched: matches.length, total: all.length,
    query: filter, scope: "all-matches", completeHistory: false });
}

export function activityRowText(row) {
  return `${row.agent} / chain ${row.chainId} / block ${row.blockNumber}\n${DIRECTION_LABELS[row.direction]} ${row.formattedAmount} ${row.agent}\n${row.from} → ${row.to}\n${row.transactionHash} / log ${row.logIndex}`;
}
