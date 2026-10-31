import {encodeTransferFile} from '../../src/transfer-file.js';
import {prepareTransferArchive} from '../../src/transfer-archive-file.js';
import {prepareVaultFile} from '../../src/transfer-vault-file.js';
import {prepareTokenIdentityFile} from '../../src/token-identity-report.js';
import {prepareAllowanceFile} from '../../src/allowance-file.js';
import {prepareReconciliationFile} from '../../src/reconciliation-file.js';
import {snapshot} from './transfer-fixtures.js';
import {bundleFor,archiveFor} from './vault-fixtures.js';
import {observation} from './identity-fixtures.js';
import {targets,record} from './allowance-fixtures.js';
import {previewWorkspace} from './reconciliation-fixtures.js';

// Fictional local observations. No provider, connection or network is invoked.
export async function savedObservationFixtures(){return [
 {name:'transfer.json',target:'transfer',text:await encodeTransferFile(snapshot()),counts:{transferRecordReferences:1,eventReferences:1}},
 {name:'archive.json',target:'transfer-archive',text:(await prepareTransferArchive(archiveFor())).text,counts:{archiveReferences:1,transferRecordReferences:1,eventReferences:1}},
 {name:'vault.json',target:'transfer-vault',text:(await prepareVaultFile(bundleFor())).text,counts:{archiveReferences:3,transferRecordReferences:3,eventReferences:3}},
 {name:'identity.json',target:'identity',text:(await prepareTokenIdentityFile(observation())).text,counts:{identityObservationReferences:1}},
 {name:'allowance-targets.json',target:'allowance',text:(await prepareAllowanceFile('targets',targets())).text,counts:{allowanceTargetReferences:2}},
 {name:'allowance-observation.json',target:'allowance',text:(await prepareAllowanceFile('observation',record())).text,counts:{identityObservationReferences:1,allowanceTargetReferences:2,allowanceObservationReferences:2}},
 {name:'reconciliation.json',target:'reconciliation',text:(await prepareReconciliationFile(previewWorkspace())).text,counts:{identityObservationReferences:6,archiveReferences:3,transferRecordReferences:4,eventReferences:6}},
];}
