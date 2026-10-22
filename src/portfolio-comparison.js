import { validatePortfolioSnapshot } from "./portfolio-report.js";

export class PortfolioComparisonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PortfolioComparisonError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PortfolioComparisonError(code, message);
}

// Signed decimal output is computed in base units. Never coerce to Number,
// infer decimals from a symbol, add unrelated assets, or estimate fiat prices.
function difference(before, after) {
  const delta = BigInt(after) - BigInt(before);
  return Object.freeze({
    deltaBaseUnits: delta.toString(),
    direction: delta > 0n ? "increased" : delta < 0n ? "decreased" : "unchanged",
  });
}

/**
 * Compare two already-observed snapshots locally. Neither snapshot is evidence
 * of a current wallet connection, ownership, a transaction or investment return.
 * Different accounts, chains and site origins are intentionally not comparable.
 */
export function comparePortfolioSnapshots(earlierInput, laterInput) {
  const earlier = validatePortfolioSnapshot(earlierInput);
  const later = validatePortfolioSnapshot(laterInput);
  for (const field of ["agent", "account", "chainId", "siteOrigin"]) {
    if (earlier[field] !== later[field]) {
      fail("IDENTITY_MISMATCH", "Compare the same agent, account, chain and site origin");
    }
  }
  const firstHeight = BigInt(earlier.blockNumber);
  const lastHeight = BigInt(later.blockNumber);
  if (firstHeight > lastHeight) fail("REVERSED_BLOCKS", "The baseline must not be newer than the target");
  const sameBlock = firstHeight === lastHeight;
  if (sameBlock && earlier.blockHash !== later.blockHash) {
    fail("BLOCK_CONFLICT", "Different hashes at the same height cannot be compared");
  }
  if (sameBlock && earlier.nativeBalanceBaseUnits !== later.nativeBalanceBaseUnits) {
    fail("OBSERVATION_CONFLICT", "Different native balances were reported for the same block");
  }
  const before = new Map(earlier.holdings.map(row => [row.address, row]));
  const after = new Map(later.holdings.map(row => [row.address, row]));
  // Keep baseline order, then append newly observed contracts. Absent entries
  // mean not observed; they must never be interpreted as a zero token balance.
  const addresses = [...before.keys(), ...[...after.keys()].filter(address => !before.has(address))];
  const holdings = addresses.map(address => {
    const first = before.get(address);
    const last = after.get(address);
    if (sameBlock && first && last &&
        (first.hasCode !== last.hasCode || first.balanceBaseUnits !== last.balanceBaseUnits)) {
      fail("OBSERVATION_CONFLICT", "Different token observations were reported for the same block");
    }
    let availability;
    let delta = null;
    let direction = "unknown";
    if (!first) availability = "not_observed_before";
    else if (!last) availability = "not_observed_after";
    else if (!first.hasCode || !last.hasCode) availability = "contract_code_missing";
    else {
      availability = "comparable";
      const value = difference(first.balanceBaseUnits, last.balanceBaseUnits);
      delta = value.deltaBaseUnits;
      direction = value.direction;
    }
    return Object.freeze({
      address,
      earlierBalanceBaseUnits: first?.balanceBaseUnits ?? null,
      laterBalanceBaseUnits: last?.balanceBaseUnits ?? null,
      deltaBaseUnits: delta,
      direction,
      availability,
    });
  });
  return Object.freeze({
    agent: later.agent,
    account: later.account,
    chainId: later.chainId,
    siteOrigin: later.siteOrigin,
    earlierBlockNumber: earlier.blockNumber,
    earlierBlockHash: earlier.blockHash,
    laterBlockNumber: later.blockNumber,
    laterBlockHash: later.blockHash,
    sameBlock,
    native: Object.freeze({
      earlierBalanceBaseUnits: earlier.nativeBalanceBaseUnits,
      laterBalanceBaseUnits: later.nativeBalanceBaseUnits,
      ...difference(earlier.nativeBalanceBaseUnits, later.nativeBalanceBaseUnits),
    }),
    holdings: Object.freeze(holdings),
    historicalObservation: true,
    readOnly: true,
    securityAudit: false,
    provesTransfers: false,
    provesProfit: false,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
  });
}

const AVAILABILITY = Object.freeze({
  not_observed_before: "前の記録では未確認",
  not_observed_after: "後の記録では未確認",
  contract_code_missing: "契約コードがなく比較できません",
});

/** Text rendering accepts snapshots, not an arbitrary prebuilt comparison. */
export function describePortfolioComparison(earlier, later) {
  const result = comparePortfolioSnapshots(earlier, later);
  const signed = value => BigInt(value) > 0n ? "+" + value : value;
  const lines = [
    "保存記録の比較（現在の残高・送金履歴・利益の証明ではありません）",
    result.agent + " / " + result.account,
    "チェーン: " + result.chainId,
    "比較ブロック: " + result.earlierBlockNumber + " → " + result.laterBlockNumber,
    "前のブロックハッシュ: " + result.earlierBlockHash,
    "後のブロックハッシュ: " + result.laterBlockHash,
    "ETH残高差（wei）: " + signed(result.native.deltaBaseUnits),
  ];
  for (const row of result.holdings) {
    lines.push(row.address);
    if (row.availability === "comparable") {
      lines.push("残高差（最小単位）: " + signed(row.deltaBaseUnits));
    } else lines.push(AVAILABILITY[row.availability]);
  }
  lines.push("資産間の合算・価格換算は行っていません。");
  return lines.join("\n");
}
