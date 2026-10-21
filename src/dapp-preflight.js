/**
 * Read-only preflight for a ThreeCore Wallet session before using a dApp.
 * No signatures, approvals, account requests, transfers, or chain switches.
 * The wallet session must already be explicitly connected to its user account.
 * These checks are NOT a security audit of the dApp or contract addresses.
 */
const AGENTS = new Set(["DAT", "EMA", "CAWELON"]);
const MAX_UINT256 = (1n << 256n) - 1n;

export class DappPreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DappPreflightError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DappPreflightError(code, message);
}

function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_ADDRESS", "A complete 20-byte EVM address is required");
  }
  return value.toLowerCase();
}

function sessionSnapshot(session) {
  const state = session?.state;
  if (!state || !AGENTS.has(state.agent) ||
      typeof session.getBlockSnapshot !== "function" ||
      typeof session.getContractCode !== "function" ||
      typeof session.getTokenBalance !== "function" ||
      typeof session.getTokenAllowance !== "function") {
    fail("INVALID_SESSION", "A ThreeCore read-only wallet session is required");
  }
  if (!state.connected || !state.account) {
    fail("DISCONNECTED", "Connect the assigned wallet before inspecting a dApp");
  }
  if (state.canSign !== false ||
      state.canSendTransactions !== false || state.canBridge !== false) {
    fail("UNSAFE_CAPABILITIES", "Preflight requires a read-only session");
  }
  if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 0 ||
      !Number.isSafeInteger(state.chainId) ||
      typeof state.siteOrigin !== "string") {
    fail("INVALID_SESSION", "Expected a valid connection epoch, chain and site origin");
  }
  return Object.freeze({
    agent: state.agent,
    account: address(state.account),
    chainId: state.chainId,
    siteOrigin: state.siteOrigin,
    connectionEpoch: state.connectionEpoch,
  });
}

function assertSameSession(session, initial) {
  const state = session?.state;
  if (!state || !state.connected ||
      state.agent !== initial.agent ||
      state.chainId !== initial.chainId ||
      state.siteOrigin !== initial.siteOrigin ||
      state.connectionEpoch !== initial.connectionEpoch ||
      state.account?.toLowerCase() !== initial.account ||
      state.canSign !== false ||
      state.canSendTransactions !== false ||
      state.canBridge !== false) {
    fail("SESSION_CHANGED", "Wallet state changed during read-only preflight");
  }
}

function checkContractCode(result, expected) {
  if (!result || result.address !== expected ||
      typeof result.deployed !== "boolean") {
    fail("INVALID_READ_RESULT", "Invalid contract-code response");
  }
  return result.deployed;
}

function checkAmount(value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX_UINT256) {
    fail("INVALID_READ_RESULT", "Expected raw ERC-20 units within uint256");
  }
  return value.toString();
}

function checkBlock(result) {
  if (!result || typeof result.number !== "string" ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(result.number) ||
      typeof result.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result.hash)) {
    fail("INVALID_READ_RESULT", "Expected a mined block number and hash");
  }
  // Copy scalars: a custom adapter must not mutate the selected snapshot later.
  return Object.freeze({
    number: "0x" + BigInt(result.number).toString(16), hash: result.hash.toLowerCase(),
  });
}

/**
 * Read contract-code presence, token balance and existing spender allowance.
 * Addresses must be verified outside this API. Presence of bytecode does not
 * prove safety. Pin state reads by hash (EIP-1898) and recheck the block at its
 * height before reporting. Unsupported providers fail without a latest fallback.
 * Results are raw base units, returned as JSON-safe strings.
 */
export async function inspectDappSpender(
  session, { tokenAddress, spenderAddress } = {},
) {
  const initial = sessionSnapshot(session);
  const token = address(tokenAddress);
  const spender = address(spenderAddress);
  const read = async (fn) => {
    assertSameSession(session, initial);
    const result = await fn();
    assertSameSession(session, initial);
    return result;
  };

  const block = checkBlock(await read(() => session.getBlockSnapshot()));
  const tokenHasCode = checkContractCode(
    await read(() => session.getContractCode(token, block.hash)), token,
  );
  const spenderHasCode = checkContractCode(
    await read(() => session.getContractCode(spender, block.hash)), spender,
  );
  const notices = [];
  if (!tokenHasCode) notices.push("TOKEN_CODE_MISSING");
  if (!spenderHasCode) notices.push("SPENDER_CODE_MISSING");

  // An address without bytecode is not a verified token contract. Do not
  // misreport empty RPC data as a balance of 0 or an allowance of 0.
  const balance = tokenHasCode
    ? checkAmount(await read(() => session.getTokenBalance(token, block.hash))) : null;
  const allowance = tokenHasCode
    ? checkAmount(await read(() => session.getTokenAllowance(token, spender, block.hash))) : null;

  const current = checkBlock(await read(() => session.getBlockSnapshot(block.number)));
  if (current.number !== block.number || current.hash !== block.hash) {
    fail("BLOCK_CHANGED", "The selected block changed during preflight; start a fresh inspection");
  }

  return Object.freeze({
    ...initial,
    blockNumber: BigInt(block.number).toString(),
    blockHash: block.hash,
    tokenAddress: token,
    spenderAddress: spender,
    tokenHasCode,
    spenderHasCode,
    tokenBalanceBaseUnits: balance,
    existingAllowanceBaseUnits: allowance,
    notices: Object.freeze(notices),
    readOnly: true,
    securityAudit: false,
  });
}
