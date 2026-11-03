import {captureDataRecord} from './security-data.js';
import {boundedUtf8Length} from './security-json.js';
export const PROPOSAL_FEE_READ_LIMIT=524288;
export function validateProposalFeeReadRequest(value){
 const data=captureDataRecord(value,['simulationPlanFile']);boundedUtf8Length(data.simulationPlanFile,PROPOSAL_FEE_READ_LIMIT);return data;
}
