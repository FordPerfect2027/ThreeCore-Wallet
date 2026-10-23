import {
  shape, transferContextKey, transferEventKey, transferFail, validateTransferSnapshot,
} from "./transfer-codec.js";

export const TRANSFER_ARCHIVE_SCHEMA = "threecore.transfer-archive.v1";
export const MAX_TRANSFER_ARCHIVE_RECORDS = 12;

function rangeOrder(left, right) {
  for (const field of ["fromBlock", "toBlock"]) {
    const a = BigInt(left.range[field]), b = BigInt(right.range[field]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function recordKey(record) {
  return record.range.fromBlock + ":" + record.range.toBlock;
}

function assertCompatible(left, right) {
  const start = BigInt(left.range.fromBlock) > BigInt(right.range.fromBlock) ? left.range.fromBlock : right.range.fromBlock;
  const end = BigInt(left.range.toBlock) < BigInt(right.range.toBlock) ? left.range.toBlock : right.range.toBlock;
  if (BigInt(start) > BigInt(end)) return;
  const inOverlap = event => BigInt(event.blockNumber) >= BigInt(start) && BigInt(event.blockNumber) <= BigInt(end);
  const a = left.events.filter(inOverlap);
  const b = right.events.filter(inOverlap);
  if (JSON.stringify(a) !== JSON.stringify(b)) transferFail("TRANSFER_ARCHIVE_OVERLAP");
}

/**
 * Retain original observations, rather than inventing one continuous chain read.
 * A covered interval means it was requested, not independently verified complete.
 * Overlap inconsistencies fail the whole addition/import; existing data stays put.
 */
export function validateTransferArchive(input) {
  shape(input, ["schema", "records", "readOnly", "completeHistory"]);
  if (input.schema !== TRANSFER_ARCHIVE_SCHEMA || input.readOnly !== true || input.completeHistory !== false) {
    transferFail("TRANSFER_ARCHIVE_SCHEMA");
  }
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > MAX_TRANSFER_ARCHIVE_RECORDS) {
    transferFail("TRANSFER_ARCHIVE_LIMIT");
  }
  const records = input.records.map(validateTransferSnapshot).sort(rangeOrder);
  const selected = transferContextKey(records[0].context);
  const keys = new Set();
  const headers = new Map();
  const eventIdentities = new Map();
  for (const record of records) {
    if (transferContextKey(record.context) !== selected) transferFail("TRANSFER_ARCHIVE_CONTEXT");
    const key = recordKey(record);
    if (keys.has(key)) transferFail("TRANSFER_ARCHIVE_DUPLICATE_RANGE");
    keys.add(key);
    const blockEntries = [
      [record.range.fromBlock, record.fromBlockHash],
      [record.range.toBlock, record.toBlockHash],
      ...record.events.map(event => [event.blockNumber, event.blockHash]),
    ];
    for (const [number, hash] of blockEntries) {
      if (headers.has(number) && headers.get(number) !== hash) transferFail("TRANSFER_ARCHIVE_BLOCK_CONFLICT");
      headers.set(number, hash);
    }
    for (const event of record.events) {
      const key = transferEventKey(event);
      const canonical = JSON.stringify(event);
      if (eventIdentities.has(key) && eventIdentities.get(key) !== canonical) transferFail("TRANSFER_ARCHIVE_EVENT_CONFLICT");
      eventIdentities.set(key, canonical);
    }
  }
  for (let left = 0; left < records.length; left++) {
    for (let right = left + 1; right < records.length; right++) assertCompatible(records[left], records[right]);
  }
  return Object.freeze({ schema: TRANSFER_ARCHIVE_SCHEMA, records: Object.freeze(records), readOnly: true, completeHistory: false });
}

export function addTransferArchiveRecord(input, record) {
  const previous = input === null ? [] : validateTransferArchive(input).records;
  return validateTransferArchive({ schema: TRANSFER_ARCHIVE_SCHEMA, records: [...previous, record], readOnly: true, completeHistory: false });
}

export function removeTransferArchiveRecord(input, index) {
  const archive = validateTransferArchive(input);
  if (!Number.isInteger(index) || index < 0 || index >= archive.records.length) transferFail("TRANSFER_ARCHIVE_INDEX");
  const records = archive.records.filter((record, position) => position !== index);
  return records.length ? validateTransferArchive({ ...archive, records }) : null;
}

export function describeTransferArchive(input) {
  const archive = validateTransferArchive(input);
  const ranges = [];
  const events = new Map();
  const transactions = new Set();
  for (const record of archive.records) {
    const from = BigInt(record.range.fromBlock), to = BigInt(record.range.toBlock);
    const last = ranges.at(-1);
    if (last && from <= last.to + 1n) {
      if (to > last.to) last.to = to;
    } else ranges.push({ from, to });
    for (const event of record.events) {
      events.set(transferEventKey(event), event);
      transactions.add(event.transactionHash);
    }
  }
  const gaps = [];
  for (let index = 1; index < ranges.length; index++) {
    gaps.push(Object.freeze({ fromBlock: (ranges[index - 1].to + 1n).toString(), toBlock: (ranges[index].from - 1n).toString() }));
  }
  const requestedBlocks = ranges.reduce((total, range) => total + range.to - range.from + 1n, 0n);
  return Object.freeze({
    context: archive.records[0].context,
    records: archive.records.length,
    uniqueEvents: events.size,
    transactions: transactions.size,
    requestedBlocks: requestedBlocks.toString(),
    ranges: Object.freeze(ranges.map(range => Object.freeze({ fromBlock: range.from.toString(), toBlock: range.to.toString() }))),
    gaps: Object.freeze(gaps),
    completeHistory: false,
    independentlyVerified: false,
  });
}

export function transferArchiveText(input) {
  const description = describeTransferArchive(input);
  return [
    description.context.agent + " / chain " + description.context.chainId,
    description.context.account,
    `${description.records}記録 / 重複を除いて${description.uniqueEvents}イベント / ${description.transactions}取引`,
    "問い合わせた範囲（合計" + description.requestedBlocks + "ブロック）:",
    ...description.ranges.map(range => range.fromBlock + " ～ " + range.toBlock),
    "記録の間の未確認範囲:",
    ...(description.gaps.length ? description.gaps.map(range => range.fromBlock + " ～ " + range.toBlock) : ["この記録間にはありません。"]),
    "範囲の前後や取得元による省略は未確認です。全履歴を確認したことにはなりません。",
    "各記録は別々の時点で取得した内容です。現在のチェーン状態とは異なる場合があります。",
  ].join("\n");
}
