#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedLocalBytes } from './read-bounded-local-file.js';
import { withDiagnosticInterrupt } from './public-diagnostic-interrupt.js';
import { SIMULATION_PLAN_FILE_LIMIT } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_STATE_FILE_LIMIT, inspectProposalStateReviewFile } from '../src/proposal-state-review.js';
import { readProposalStateReview } from '../src/proposal-state-reader.js';
export async function runReadProposalState(args, output = process.stdout, errors = process.stderr, { signal, read = readProposalStateReview } = {}) {
  try {
    if (args.length === 1 && args[0] === '--help') { output.write('Usage:\n  node scripts/read-proposal-state.js read PLAN_FILE\n  node scripts/read-proposal-state.js verify SAVED_REVIEW_FILE\nRead fixed public Base only, or replay offline. No signing or broadcast. Exit 0: checks passed; 2: blocked result saved; 1: read/validation error.\n'); return 0; }
    if (args.length !== 2 || !['read', 'verify'].includes(args[0]) || !args[1] || args[1].startsWith('--')) throw Error();
    const bytes = await readBoundedLocalBytes(resolve(args[1]), args[0] === 'read' ? SIMULATION_PLAN_FILE_LIMIT : PROPOSAL_STATE_FILE_LIMIT, { fail() { throw Error(); }, sizeCode: 'SIZE', changedCode: 'CHANGED' });
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (args[0] === 'read') { const r = await read(text, { signal }); output.write(r.review.text); return r.review.result.checksSatisfied ? 0 : 2; }
    const saved = await inspectProposalStateReviewFile(text, { signal }); output.write(JSON.stringify({ verified: true, historicalOnly: true, result: saved.recordedResult }, null, 2) + '\n'); return saved.recordedResult.checksSatisfied ? 0 : 2;
  } catch { errors.write('State read or saved-file validation failed. No transaction was sent.\n'); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await withDiagnosticInterrupt(signal => runReadProposalState(process.argv.slice(2), process.stdout, process.stderr, { signal }));
