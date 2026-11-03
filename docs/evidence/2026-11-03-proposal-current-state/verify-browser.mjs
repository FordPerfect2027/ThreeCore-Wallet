import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectProposalStateReviewFile } from '../../../src/proposal-state-review.js';
const dir = new URL('.', import.meta.url), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['ThreeCore-proposal-state-review.json', 'ThreeCore-proposal-state-review (1).json', 'ThreeCore-proposal-state-review (2).json'];
const bytes = await Promise.all(files.map(name => readFile('C:/Users/aseet/Downloads/' + name)));
if (!bytes[0].equals(bytes[1])) throw Error('REEXPORT_CHANGED');
const saved = await Promise.all(bytes.map(b => inspectProposalStateReviewFile(b.toString('utf8'))));
const original = await readFile(new URL('../2026-11-03-proposal-simulation-plan/account2-blocked-plan.json', dir), 'utf8');
if (saved.some(s => s.files.simulationPlanFile !== original || s.recordedResult.environment !== 'public-rpc' || s.recordedResult.checksSatisfied || s.recordedResult.authorizesExecution)) throw Error('SOURCE_CONTEXT');
if (!saved[2].recordedResult.reasons.includes('STATE_STALE')) throw Error('EXPIRY_NOT_CHECKED');
if (JSON.stringify(saved[0].files.observation) !== JSON.stringify(saved[2].files.observation)) throw Error('OBSERVATION_REPLACED');
await writeFile(new URL('browser-review.json', dir), bytes[0], { flag: 'wx' });
await writeFile(new URL('browser-rechecked.json', dir), bytes[2], { flag: 'wx' });
const result = { browser: 'Codex in-app browser', origin: 'http://127.0.0.1:4260', sourceSha256: hash(original),
  records: files.map((filename, i) => ({ filename, bytes: bytes[i].length, sha256: hash(bytes[i]) })),
  block: saved[0].recordedResult.observation.blockNumber, reexportByteExact: true, originalSourceByteExact: true, localExpiryRecheckPreservedObservation: true,
  newRecheckReasons: saved[2].recordedResult.reasons, publicSwapSimulated: false, signed: false, transactionBroadcast: false };
await writeFile(new URL('browser-verification.json', dir), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(result));
