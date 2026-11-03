import { PUBLIC_TOKEN_BATCH_SCHEMA } from "../../src/public-token-batch-model.js";
import { catalogToken } from "../../src/token-catalog.js";
import { ACCOUNT, HASH } from "./identity-fixtures.js";
export function publicBatchFixture() {
  return { schema: PUBLIC_TOKEN_BATCH_SCHEMA, chainId: 84532, rpcUrl: "https://sepolia.base.org", account: ACCOUNT,
    blockNumber: "42", blockHash: HASH, nativeBalanceBaseUnits: "10000000000000000",
    tokens: ["DAT", "EMA", "CAWELON"].map(agent => { const t = catalogToken({agent,chainId:84532});
      return { agent,tokenAddress:t.address,hasCode:true,metadata:{name:t.name,symbol:t.symbol,decimals:t.decimals,totalSupply:t.initialSupply},balanceBaseUnits:"1000000000000000000000" }; }),
    readOnly:true,walletConnected:false,canonicalBlockRechecked:true,securityAudit:false };
}
