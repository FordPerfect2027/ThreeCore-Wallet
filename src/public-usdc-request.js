import { captureDataRecord } from './security-data.js';
import { identityAddress,identityUnits } from './token-identity-codec.js';
import { failPublicUsdc as fail } from './public-usdc-model.js';
export function validatePublicUsdcRequest(input){
 let data;try{data=captureDataRecord(input,['account','blockNumber']);}catch{fail('USDC_REQUEST');}
 return Object.freeze({account:identityAddress(data.account),blockNumber:data.blockNumber===null?null:identityUnits(data.blockNumber)});
}
