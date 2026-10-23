import { validateReconciliationWorkspace, reconciliationAgent } from "./reconciliation-model.js";
import { reconcileWorkspace, formatReconciliationAmount } from "./reconciliation-engine.js";
import { suggestReconciliationWindows } from "./reconciliation-query.js";
import { reconciliationCsvCell } from "./reconciliation-view.js";
import { transferEventKey } from "./transfer-codec.js";

/** Keep a trace from every counted event back to the imported records that contained it. */
export function reconciliationEvidence(input, agent) {
  reconciliationAgent(agent);
  const workspace = validateReconciliationWorkspace(input);
  const slot = workspace.slots.find(value => value.agent === agent);
  const report = reconcileWorkspace(workspace).slots.find(value => value.agent === agent);
  const eventSources = new Map();
  const records = (slot.archive?.records ?? []).map((record, index) => {
    const id = "period-" + (index + 1);
    for (const event of record.events) {
      const key = transferEventKey(event);
      if (!eventSources.has(key)) eventSources.set(key, []);
      eventSources.get(key).push(id);
    }
    const included = report.events.filter(event => BigInt(event.blockNumber) >= BigInt(record.range.fromBlock) &&
      BigInt(event.blockNumber) <= BigInt(record.range.toBlock));
    return Object.freeze({
      id,
      agent,
      account: record.context.account,
      chainId: record.context.chainId,
      tokenAddress: record.tokenAddress,
      fromBlock: record.range.fromBlock,
      toBlock: record.range.toBlock,
      fromBlockHash: record.fromBlockHash,
      toBlockHash: record.toBlockHash,
      rawEvents: record.events.length,
      countedEvents: included.length,
      completeHistory: false,
      independentlyVerified: false,
    });
  });
  const events = report.events.map(event => Object.freeze({
    key: transferEventKey(event),
    blockNumber: event.blockNumber,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    sourcePeriods: Object.freeze([...(eventSources.get(transferEventKey(event)) ?? [])]),
    countedTimes: 1,
  }));
  return Object.freeze({
    agent,
    status: report.status,
    earlier: slot.earlier,
    later: slot.later,
    records: Object.freeze(records),
    events: Object.freeze(events),
    independentlyVerified: false,
  });
}

/** Group only included events, retaining exact running balance and gap context. */
export function reconciliationBlockLedger(input, agent) {
  reconciliationAgent(agent);
  const row = reconcileWorkspace(input).slots.find(value => value.agent === agent);
  if (!row.totals) return Object.freeze({ agent, available: false, rows: Object.freeze([]), status: row.status });
  const blocks = new Map();
  for (const event of row.events) {
    if (!blocks.has(event.blockNumber)) blocks.set(event.blockNumber, {
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      transactions: new Set(),
      events: 0,
      received: 0n,
      sent: 0n,
      minted: 0n,
      burned: 0n,
      selfEvents: 0,
      zeroEvents: 0,
      opening: BigInt(event.impliedBalanceBaseUnits) - BigInt(event.deltaBaseUnits),
      closing: 0n,
    });
    const block = blocks.get(event.blockNumber);
    const amount = BigInt(event.amountBaseUnits);
    block.transactions.add(event.transactionHash);
    block.events++;
    if (event.to === row.account) block.received += amount;
    if (event.from === row.account) block.sent += amount;
    if (event.direction === "mint") block.minted += amount;
    if (event.direction === "burn") block.burned += amount;
    if (event.direction === "self") block.selfEvents++;
    if (amount === 0n) block.zeroEvents++;
    block.closing = BigInt(event.impliedBalanceBaseUnits);
  }
  const output = [...blocks.values()].map(block => Object.freeze({
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    transactionCount: block.transactions.size,
    eventCount: block.events,
    receivedBaseUnits: block.received.toString(),
    sentBaseUnits: block.sent.toString(),
    mintedBaseUnits: block.minted.toString(),
    burnedBaseUnits: block.burned.toString(),
    netBaseUnits: (block.received - block.sent).toString(),
    openingImpliedBaseUnits: block.opening.toString(),
    closingImpliedBaseUnits: block.closing.toString(),
    selfTransferCount: block.selfEvents,
    zeroValueCount: block.zeroEvents,
    earlierGaps: row.coverage.gaps.filter(gap => BigInt(gap.fromBlock) <= BigInt(block.blockNumber)).length,
    independentlyVerified: false,
  }));
  return Object.freeze({
    agent, available: true, account: row.account, chainId: row.chainId, status: row.status,
    symbol: row.totals.symbol, decimals: row.totals.decimals,
    rows: Object.freeze(output),
    balanceIsInferred: true,
    independentlyVerified: false,
  });
}

export function reconciliationLedgerText(input, agent) {
  const ledger = reconciliationBlockLedger(input, agent);
  if (!ledger.available) return agent + ": 比較可能な残高を入れてから照合してください。";
  if (!ledger.rows.length) return agent + ": この照合区間で数えたイベントはありません。履歴の不足や差額は上の結果を確認してください。";
  const amount = value => formatReconciliationAmount(value, ledger.decimals);
  return [
    agent + " / " + ledger.account + " / chain " + ledger.chainId,
    "履歴から推定した値です。各ブロックで残高を読み直した結果ではありません。",
    ...ledger.rows.slice(0, 25).map(row =>
      `block ${row.blockNumber}: ${row.eventCount}イベント / ${row.transactionCount}取引\n` +
      `受取 ${amount(row.receivedBaseUnits)} / 送出 ${amount(row.sentBaseUnits)} / 増減 ${amount(row.netBaseUnits)} ${ledger.symbol}\n` +
      `推定残高 ${amount(row.openingImpliedBaseUnits)} → ${amount(row.closingImpliedBaseUnits)} / ここまでの未取得期間 ${row.earlierGaps}`),
    ...(ledger.rows.length > 25 ? [`先頭25ブロックを表示しています。全${ledger.rows.length}ブロックはCSVに保存できます。`] : []),
  ].join("\n\n");
}

function csv(rows) {
  return "\ufeff" + rows.map(row => row.map(reconciliationCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function reconciliationLedgerCsv(input) {
  const workspace = validateReconciliationWorkspace(input);
  const rows = [["agent", "account", "chain_id", "status", "block", "block_hash", "transactions", "events",
    "received_base_units", "sent_base_units", "minted_base_units", "burned_base_units", "net_base_units",
    "opening_implied_base_units", "closing_implied_base_units", "earlier_gap_count", "independently_verified"]];
  for (const slot of workspace.slots) {
    const ledger = reconciliationBlockLedger(workspace, slot.agent);
    for (const row of ledger.rows) rows.push([
      ledger.agent, ledger.account, ledger.chainId, ledger.status, row.blockNumber, row.blockHash,
      row.transactionCount, row.eventCount, row.receivedBaseUnits, row.sentBaseUnits, row.mintedBaseUnits,
      row.burnedBaseUnits, row.netBaseUnits, row.openingImpliedBaseUnits, row.closingImpliedBaseUnits, row.earlierGaps, false,
    ]);
  }
  return csv(rows);
}

export function reconciliationWindowsCsv(input) {
  const workspace = validateReconciliationWorkspace(input);
  const report = reconcileWorkspace(workspace);
  const rows = [["agent", "account", "chain_id", "token_address", "from_block", "to_block", "remaining_blocks_after_plan", "automatic_request"]];
  for (const slot of report.slots) {
    const plan = suggestReconciliationWindows(workspace, slot.agent);
    for (const range of plan.windows) rows.push([slot.agent, slot.account, slot.chainId, slot.tokenAddress,
      range.fromBlock, range.toBlock, plan.remainingBlocks, false]);
  }
  return csv(rows);
}

export function reconciliationEvidenceText(input, agent) {
  const evidence = reconciliationEvidence(input, agent);
  const lines = [agent + "の計算に使う元記録"];
  for (const [label, value] of [["前", evidence.earlier], ["後", evidence.later]]) {
    lines.push(value ? `${label}: block ${value.blockNumber}\nhash ${value.blockHash}\n取得サイト ${value.siteOrigin} / 接続回 ${value.connectionEpoch}` : label + ": 未登録");
  }
  for (const record of evidence.records) lines.push(
    `${record.id}: ${record.fromBlock} ～ ${record.toBlock}\n${record.rawEvents}イベント（照合区間で計算対象 ${record.countedEvents}）\n` +
    `開始hash ${record.fromBlockHash}\n終了hash ${record.toBlockHash}`);
  const duplicates = evidence.events.filter(event => event.sourcePeriods.length > 1);
  lines.push(`複数期間に重複していた計算対象イベント: ${duplicates.length}件。計算は各1回です。`);
  lines.push("元記録の出所は独立検証していません。ハッシュの一致は保存した記録同士の照合です。");
  return lines.join("\n\n");
}
