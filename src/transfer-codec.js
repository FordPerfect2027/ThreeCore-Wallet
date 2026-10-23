/** Strict codecs for bounded ERC-20 Transfer observations. No provider access. */
import { identityObject, identityUnits, validateTokenMetadata } from "./token-identity-codec.js";
import { catalogToken } from "./token-catalog.js";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO_ADDRESS = "0x" + "0".repeat(40);
export const MAX_TRANSFER_BLOCKS = 2000;
export const MAX_TRANSFER_EVENTS = 500;
export const MAX_TRANSFER_BLOCK_HEADERS = 100;
export const TRANSFER_SCHEMA = "threecore.transfer-observation.v1";

export class TransferError extends Error {
  constructor(code) {
    super(code);
    this.name = "TransferError";
    this.code = code;
  }
}

export function transferFail(code) {
  throw new TransferError(code);
}

export function shape(value, fields) {
  try { identityObject(value, fields); }
  catch { transferFail("TRANSFER_SHAPE"); }
  return value;
}

export function transferAddress(value, allowZero = false) {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{40}$/.test(value)) {
    transferFail("TRANSFER_ADDRESS");
  }
  const address = value.toLowerCase();
  if (!allowZero && address === ZERO_ADDRESS) transferFail("TRANSFER_ADDRESS");
  return address;
}

export function transferHash(value) {
  if (typeof value !== "string" || !/^0x[\da-f]{64}$/i.test(value)) {
    transferFail("TRANSFER_HASH");
  }
  return value.toLowerCase();
}

export function transferUnits(value) {
  try { return identityUnits(value); }
  catch { transferFail("TRANSFER_INTEGER"); }
}

export function quantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][\da-f]{0,63})$/i.test(value)) {
    transferFail("TRANSFER_QUANTITY");
  }
  return BigInt(value).toString();
}

export function hexQuantity(value) {
  return "0x" + BigInt(transferUnits(value)).toString(16);
}

export function addressTopic(value) {
  return "0x" + "0".repeat(24) + transferAddress(value).slice(2);
}

function topicAddress(value) {
  if (typeof value !== "string" || !/^0x0{24}[\da-f]{40}$/i.test(value)) {
    transferFail("TRANSFER_TOPIC_ADDRESS");
  }
  return transferAddress("0x" + value.slice(26), true);
}

export function validateTransferContext(value) {
  shape(value, ["agent", "chainId", "account"]);
  let token;
  try { token = catalogToken({ agent: value.agent, chainId: value.chainId }); }
  catch { transferFail("TRANSFER_CONTEXT"); }
  return Object.freeze({
    agent: token.agent,
    chainId: token.chainId,
    account: transferAddress(value.account),
  });
}

export function transferContextKey(value) {
  return JSON.stringify(validateTransferContext(value));
}

export function validateTransferRequest(value = { fromBlock: null, toBlock: null, lookback: 250 }) {
  shape(value, ["fromBlock", "toBlock", "lookback"]);
  const fromBlock = value.fromBlock === null ? null : transferUnits(value.fromBlock);
  const toBlock = value.toBlock === null ? null : transferUnits(value.toBlock);
  if (!Number.isInteger(value.lookback) || value.lookback < 1 || value.lookback > MAX_TRANSFER_BLOCKS) {
    transferFail("TRANSFER_LOOKBACK");
  }
  if (fromBlock !== null && toBlock !== null) validateTransferRange(fromBlock, toBlock);
  return Object.freeze({ fromBlock, toBlock, lookback: value.lookback });
}

export function validateTransferRange(from, to) {
  const fromBlock = transferUnits(from);
  const toBlock = transferUnits(to);
  const width = BigInt(toBlock) - BigInt(fromBlock) + 1n;
  if (width < 1n || width > BigInt(MAX_TRANSFER_BLOCKS)) transferFail("TRANSFER_RANGE");
  return Object.freeze({ fromBlock, toBlock });
}

export function resolveTransferRange(request, latest) {
  const plan = validateTransferRequest(request);
  const head = BigInt(transferUnits(latest));
  const end = plan.toBlock === null ? head : BigInt(plan.toBlock);
  if (end > head) transferFail("TRANSFER_FUTURE_BLOCK");
  const calculated = end - BigInt(plan.lookback) + 1n;
  const start = plan.fromBlock === null ? (calculated < 0n ? 0n : calculated) : BigInt(plan.fromBlock);
  return validateTransferRange(start.toString(), end.toString());
}

export function transferDirection(event, account) {
  const owner = transferAddress(account);
  const from = transferAddress(event.from, true);
  const to = transferAddress(event.to, true);
  if (from !== owner && to !== owner) transferFail("TRANSFER_UNRELATED_EVENT");
  if (from === owner && to === owner) return "self";
  if (from === ZERO_ADDRESS) return "mint";
  if (to === ZERO_ADDRESS) return "burn";
  return from === owner ? "outgoing" : "incoming";
}

export function transferEventKey(event) {
  return transferHash(event.transactionHash) + ":" + transferUnits(event.logIndex);
}

export function validateTransferEvent(value, context, range) {
  shape(value, ["blockNumber", "blockHash", "transactionHash", "transactionIndex", "logIndex", "from", "to", "amountBaseUnits"]);
  const event = {
    blockNumber: transferUnits(value.blockNumber),
    blockHash: transferHash(value.blockHash),
    transactionHash: transferHash(value.transactionHash),
    transactionIndex: transferUnits(value.transactionIndex),
    logIndex: transferUnits(value.logIndex),
    from: transferAddress(value.from, true),
    to: transferAddress(value.to, true),
    amountBaseUnits: transferUnits(value.amountBaseUnits),
  };
  transferDirection(event, context.account);
  if (BigInt(event.blockNumber) < BigInt(range.fromBlock) || BigInt(event.blockNumber) > BigInt(range.toBlock)) {
    transferFail("TRANSFER_OUTSIDE_RANGE");
  }
  return Object.freeze(event);
}

export function decodeTransferLog(value, context, range, direction) {
  shape(value, ["address", "topics", "data", "blockNumber", "blockHash", "transactionHash", "transactionIndex", "logIndex", "removed"]);
  const token = catalogToken({ agent: context.agent, chainId: context.chainId });
  if (transferAddress(value.address) !== token.address) transferFail("TRANSFER_WRONG_TOKEN");
  if (value.removed !== false) transferFail("TRANSFER_REMOVED_LOG");
  if (!Array.isArray(value.topics) || value.topics.length !== 3 || typeof value.topics[0] !== "string" || value.topics[0].toLowerCase() !== TRANSFER_TOPIC) {
    transferFail("TRANSFER_EVENT_TOPIC");
  }
  if (typeof value.data !== "string" || !/^0x[\da-f]{64}$/i.test(value.data)) transferFail("TRANSFER_EVENT_DATA");
  const from = topicAddress(value.topics[1]);
  const to = topicAddress(value.topics[2]);
  if ((direction === "outgoing" && from !== context.account) ||
      (direction === "incoming" && to !== context.account) ||
      !["incoming", "outgoing"].includes(direction)) transferFail("TRANSFER_FILTER_MISMATCH");
  return validateTransferEvent({
    blockNumber: quantity(value.blockNumber),
    blockHash: value.blockHash,
    transactionHash: value.transactionHash,
    transactionIndex: quantity(value.transactionIndex),
    logIndex: quantity(value.logIndex),
    from,
    to,
    amountBaseUnits: BigInt(value.data).toString(),
  }, context, range);
}

export function compareTransferOrder(left, right) {
  for (const field of ["blockNumber", "transactionIndex", "logIndex"]) {
    const a = BigInt(left[field]), b = BigInt(right[field]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return left.transactionHash.localeCompare(right.transactionHash);
}

/** Identical self-transfer copies from the two account filters collapse once. */
export function normalizeTransferEvents(values, context, range) {
  if (!Array.isArray(values) || values.length > MAX_TRANSFER_EVENTS * 2) transferFail("TRANSFER_EVENT_LIMIT");
  const keys = new Map();
  const positions = new Map();
  const blocks = new Map();
  const transactions = new Map();
  const transactionSlots = new Map();
  for (const input of values) {
    const row = validateTransferEvent(input, context, range);
    const key = transferEventKey(row);
    const canonical = JSON.stringify(row);
    if (keys.has(key)) {
      if (JSON.stringify(keys.get(key)) !== canonical) transferFail("TRANSFER_CONFLICTING_DUPLICATE");
      continue;
    }
    const position = row.blockNumber + ":" + row.logIndex;
    if (positions.has(position)) transferFail("TRANSFER_LOG_POSITION");
    const transactionPosition = row.blockNumber + ":" + row.transactionIndex;
    if (transactionSlots.has(transactionPosition) && transactionSlots.get(transactionPosition) !== row.transactionHash) {
      transferFail("TRANSFER_TRANSACTION_POSITION");
    }
    if (transactions.has(row.transactionHash) && transactions.get(row.transactionHash) !== transactionPosition) {
      transferFail("TRANSFER_TRANSACTION_POSITION");
    }
    if (blocks.has(row.blockNumber) && blocks.get(row.blockNumber) !== row.blockHash) transferFail("TRANSFER_BLOCK_CHANGED");
    positions.set(position, key);
    transactions.set(row.transactionHash, transactionPosition);
    transactionSlots.set(transactionPosition, row.transactionHash);
    blocks.set(row.blockNumber, row.blockHash);
    keys.set(key, row);
    if (keys.size > MAX_TRANSFER_EVENTS || blocks.size > MAX_TRANSFER_BLOCK_HEADERS) transferFail("TRANSFER_EVENT_LIMIT");
  }
  const ordered = [...keys.values()].sort(compareTransferOrder);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1], next = ordered[index];
    if (previous.blockNumber === next.blockNumber && BigInt(previous.logIndex) >= BigInt(next.logIndex)) {
      transferFail("TRANSFER_LOG_ORDER");
    }
  }
  return Object.freeze(ordered);
}

export function validateTransferSnapshot(value) {
  shape(value, ["schema", "context", "tokenAddress", "metadata", "range", "fromBlockHash", "toBlockHash", "events",
    "readOnly", "completeHistory", "independentVerification"]);
  if (value.schema !== TRANSFER_SCHEMA || value.readOnly !== true || value.completeHistory !== false ||
      value.independentVerification !== false) transferFail("TRANSFER_SCHEMA");
  const context = validateTransferContext(value.context);
  const token = catalogToken({ agent: context.agent, chainId: context.chainId });
  if (transferAddress(value.tokenAddress) !== token.address) transferFail("TRANSFER_WRONG_TOKEN");
  let metadata;
  try { metadata = validateTokenMetadata(value.metadata); }
  catch { transferFail("TRANSFER_METADATA"); }
  if (metadata.symbol !== token.symbol || metadata.name !== token.name || metadata.decimals !== token.decimals) {
    transferFail("TRANSFER_METADATA_MISMATCH");
  }
  shape(value.range, ["fromBlock", "toBlock"]);
  const range = validateTransferRange(value.range.fromBlock, value.range.toBlock);
  const fromBlockHash = transferHash(value.fromBlockHash);
  const toBlockHash = transferHash(value.toBlockHash);
  if (range.fromBlock === range.toBlock && fromBlockHash !== toBlockHash) transferFail("TRANSFER_BLOCK_CHANGED");
  const events = normalizeTransferEvents(value.events, context, range);
  if (events.length !== value.events.length) transferFail("TRANSFER_DUPLICATE_FILE_EVENT");
  for (const event of events) {
    if ((event.blockNumber === range.fromBlock && event.blockHash !== fromBlockHash) ||
        (event.blockNumber === range.toBlock && event.blockHash !== toBlockHash)) transferFail("TRANSFER_BLOCK_CHANGED");
  }
  return Object.freeze({
    schema: TRANSFER_SCHEMA,
    context,
    tokenAddress: token.address,
    metadata,
    range,
    fromBlockHash,
    toBlockHash,
    events,
    readOnly: true,
    completeHistory: false,
    independentVerification: false,
  });
}
