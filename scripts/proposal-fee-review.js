#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedLocalBytes } from './read-bounded-local-file.js';
import { withDiagnosticInterrupt } from './public-diagnostic-interrupt.js';
import { parseSecurityJson } from '../src/security-json.js';
import { SIMULATION_PLAN_FILE_LIMIT } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_FEE_FILE_LIMIT, ProposalFeeError, prepareProposalFeeReview, inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
const fail = code => { throw new ProposalFeeError(code); };
const usage = 'Usage:\n  node scripts/proposal-fee-review.js prepare SIMULATION_PLAN_FILE FEE_OBSERVATION_FILE\n  node scripts/proposal-fee-review.js verify FEE_REVIEW_FILE\nOffline comparison only. Supplied fee evidence is not an authenticated RPC read.\n';
export async function runProposalFeeReview(args, output = process.stdout, errors = process.stderr, { signal } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === '--help') { output.write(usage); return 0; }
    if (!Array.isArray(args) || !['prepare', 'verify'].includes(args[0]) || args.length !== (args[0] === 'prepare' ? 3 : 2) || args.slice(1).some(s => typeof s !== 'string' || !s || s.startsWith('--'))) fail('CLI_ARGUMENTS');
    const read = async (file, limit) => {
      const bytes = await readBoundedLocalBytes(resolve(file), limit, { fail, sizeCode: 'FILE_TOO_LARGE', changedCode: 'FILE_CHANGED' });
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('INVALID_UTF8'); }
    };
    if (args[0] === 'prepare') {
      const simulationPlanFile = await read(args[1], SIMULATION_PLAN_FILE_LIMIT), observation = parseSecurityJson(await read(args[2], 8192));
      const prepared = await prepareProposalFeeReview({ simulationPlanFile, observation }, { signal });
      output.write(prepared.text); return prepared.result.checksSatisfied ? 0 : 2;
    }
    const checked = await inspectProposalFeeReviewFile(await read(args[1], PROPOSAL_FEE_FILE_LIMIT), { signal });
    output.write(JSON.stringify(checked, null, 2) + '\n'); return 0;
  } catch (error) {
    errors.write('Fee comparison failed: ' + (error instanceof ProposalFeeError ? error.code : 'SOURCE_VALIDATION_FAILED') + '\n'); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await withDiagnosticInterrupt(signal => runProposalFeeReview(process.argv.slice(2), process.stdout, process.stderr, { signal }));
