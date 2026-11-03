// Synthetic address-mapped source records derived from the isolated EVM only.
// The accompanying runtime report always identifies this scope and mapping.
import {operationBudgetExample,USDC_OPERATION_BUDGET_SCHEMA,encodeOperationBudget} from '../../src/operation-budget.js';
import {BUDGET_EVIDENCE_SCHEMA,encodeBudgetEvidence} from '../../src/operation-budget-evidence.js';
import {prepareTokenIdentityFile} from '../../src/token-identity-report.js';
import {observation as tokenObservation} from '../../test/helpers/identity-fixtures.js';
import {PUBLIC_USDC_SCHEMA,preparePublicUsdcFile} from '../../src/public-usdc-model.js';
import {prepareManualOperationProposal} from '../../src/operation-proposal-draft.js';
import {AERODROME_QUOTE_SCHEMA,prepareAerodromeQuoteFile} from '../../src/aerodrome-quote-model.js';
import {prepareProposalQuoteReview} from '../../src/proposal-quote-file.js';
import {PROPOSAL_ALLOWANCE_SCHEMA,prepareProposalAllowanceReview} from '../../src/proposal-allowance.js';
import {prepareProposalSimulationPlan} from '../../src/proposal-simulation-plan.js';
import {AERODROME_BASE,THREECORE_BASE_TOKENS} from '../../src/aerodrome-readonly.js';
import {BASE_NATIVE_USDC} from '../../src/aerodrome-pools.js';
function units(raw,decimals){const text=raw.toString().padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'');}
export async function makeLocalProposalSource(s){
 const buy=s.direction==='buy',inputToken=buy?BASE_NATIVE_USDC:THREECORE_BASE_TOKENS[s.agent],outputToken=buy?THREECORE_BASE_TOKENS[s.agent]:BASE_NATIVE_USDC;
 const blockNumber=s.block.number.toString(),blockHash=s.block.hash,nowSeconds=Number(s.block.timestamp),account=s.account.toLowerCase(),decimals=buy?6:18;
 const budget=structuredClone(operationBudgetExample());budget.chainId=8453;budget.agent=s.agent;if(buy)budget.schema=USDC_OPERATION_BUDGET_SCHEMA;
 budget.token={decimals,balanceUnits:s.balance.toString(),reservedUnits:'0',reserveFloorUnits:'0',spendUnits:s.amountIn.toString()};
 budget.native={balanceWei:s.nativeBalance.toString(),reservedWei:'0',reserveFloorWei:'0',valueWei:'0'};
 budget.fees={gasLimit:'500000',maxFeePerGasWei:'100000000',l1FeeBudgetWei:'10000000000000',operatorFeeBudgetWei:'0',bufferWei:'10000000000000'};
 const metadata={...s.metadata,totalSupply:s.metadata.totalSupply.toString()};
 const sourceFile=buy?(await preparePublicUsdcFile({schema:PUBLIC_USDC_SCHEMA,chainId:8453,rpcUrl:AERODROME_BASE.rpcUrl,account,tokenAddress:inputToken,blockNumber,blockHash,blockTimestampSeconds:nowSeconds,observedAtSeconds:nowSeconds,metadata,balanceBaseUnits:s.balance.toString(),nativeBalanceBaseUnits:s.nativeBalance.toString(),hasCode:true,canonicalBlockRechecked:true,readOnly:true,walletConnected:false})).text:(await prepareTokenIdentityFile(tokenObservation({account,blockNumber,blockHash,metadata,balanceBaseUnits:s.balance.toString(),nativeBalanceBaseUnits:s.nativeBalance.toString()},s.agent,8453))).text;
 const evidence=encodeBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(budget),observationFiles:[sourceFile]});
 const proposal=await prepareManualOperationProposal({budgetEvidenceFile:evidence,agent:s.agent,proposalId:'isolated-'+s.agent+'-'+s.direction,label:'Isolated EVM fixture; address mapping, no public observation',rationale:'Synthetic full-flow record derived from an isolated EVM. Addresses are mapped for comparison testing; not a mainnet observation.',dappOrigin:'https://aerodrome.finance',dappContract:AERODROME_BASE.router,maxSpendAmount:units(s.amountIn,decimals),maxNativeAmount:'0',maxFeeAmount:'0.00007',lifetimeMinutes:'10'},{nowSeconds});
 const quote={schema:AERODROME_QUOTE_SCHEMA,agent:s.agent,chainId:8453,dappOrigin:'https://aerodrome.finance',routerAddress:AERODROME_BASE.router,factoryAddress:AERODROME_BASE.poolFactory,poolAddress:s.pool.toLowerCase(),direction:s.direction,inputToken,outputToken,inputDecimals:decimals,outputDecimals:buy?18:6,inputBaseUnits:s.amountIn.toString(),reserveInBaseUnits:s.reserveIn.toString(),reserveOutBaseUnits:s.reserveOut.toString(),feeBps:Number(s.feeBps),poolOutputBaseUnits:s.poolOut.toString(),routerOutputBaseUnits:s.routerOut.toString(),slippageBps:50,blockNumber,blockHash,blockTimestampSeconds:nowSeconds,observedAtSeconds:nowSeconds,canonicalBlockRechecked:true,readOnly:true};
 const quoteReview=await prepareProposalQuoteReview({proposalReviewFile:proposal.text,quoteFile:(await prepareAerodromeQuoteFile(quote)).text},{nowSeconds,maxQuoteAgeSeconds:600,maxBlockAgeSeconds:600,maxOutputShortfallBps:200,maxSlippageBps:50});
 const allowance=await prepareProposalAllowanceReview({quoteReviewFile:quoteReview.text,observation:{schema:PROPOSAL_ALLOWANCE_SCHEMA,agent:s.agent,direction:s.direction,chainId:8453,rpcUrl:AERODROME_BASE.rpcUrl,account,tokenAddress:inputToken,spenderAddress:AERODROME_BASE.router,blockNumber,blockHash,blockTimestampSeconds:nowSeconds,observedAtSeconds:nowSeconds,tokenHasCode:true,spenderHasCode:true,tokenBalanceBaseUnits:s.balance.toString(),allowanceBaseUnits:s.allowance.toString(),nativeBalanceBaseUnits:s.nativeBalance.toString(),canonicalBlockRechecked:true,readOnly:true,walletConnected:false}},{nowSeconds,maxAllowanceAgeSeconds:600});
 return prepareProposalSimulationPlan(allowance.text,{nowSeconds});
}
