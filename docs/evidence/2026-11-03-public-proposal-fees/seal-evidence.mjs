import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectProposalFeeReviewFile } from '../../../src/proposal-fee-review.js';
const here = new URL('./', import.meta.url), root = new URL('../../../', here), sha = b => createHash('sha256').update(b).digest('hex');
const [originalPath, currentPath] = process.argv.slice(2); if (!originalPath || !currentPath) throw Error('TWO_DOWNLOAD_PATHS_REQUIRED');
await copyFile(originalPath, new URL('browser-original.json', here)); await copyFile(currentPath, new URL('browser-current.json', here));
const original = await readFile(new URL('../2026-11-03-isolated-aerodrome/DAT-buy-fee-review.json', here), 'utf8');
const downloaded = await readFile(new URL('browser-original.json', here), 'utf8'), current = await readFile(new URL('browser-current.json', here), 'utf8');
assert.equal(downloaded, original);
const a = await inspectProposalFeeReviewFile(downloaded), b = await inspectProposalFeeReviewFile(current); assert.deepEqual(a.files, b.files);
assert(b.recordedResult.reasons.includes('FEE_PLAN_BLOCKED')); assert(b.recordedResult.reasons.includes('FEE_OBSERVATION_EXPIRED')); assert.equal(b.recordedResult.totalFeeUpperBoundWei, null);
const names = ['src/base-fee-reader.js','src/proposal-fee-reader.js','src/proposal-fee-client.js','src/proposal-fee-request.js','src/state-rpc-http.js','examples/proposal-fee-http.js','examples/proposal-fee-page.js','examples/proposal-fee.html','examples/dev-server.js','scripts/read-proposal-fees.js','test/helpers/proposal-fee-rpc-fixture.js','test/proposal-fee-reader.test.js','test/proposal-fee-transport.test.js','test/proposal-fee-page.test.js','test/proposal-fee-cli.test.js','test/state-rpc-http.test.js'];
const sources = []; for (const path of names) { const bytes = await readFile(new URL(path, root)); sources.push({ path, bytes: bytes.length, sha256: sha(bytes) }); }
await writeFile(new URL('source-inventory.json', here), JSON.stringify({ baseCommit: '98fbd1d', sources }, null, 2) + '\n');
await writeFile(new URL('browser-verification.json', here), JSON.stringify({ browser: 'Codex in-app browser', url: 'http://127.0.0.1:4256/proposals/fees/', blockedSourceRetained: true, originalDownloadSha256: sha(downloaded), originalReexportByteIdentical: true, currentDownloadSha256: sha(current), originalSourceAndObservationPreserved: true, currentReasons: b.recordedResult.reasons, sourceEnvironment: a.recordedResult.environment, publicSwapSimulated: false, userWalletUsed: false }, null, 2) + '\n');
const lines = []; for (const name of (await readdir(here)).filter(n => n !== 'SHA256SUMS.txt').sort()) lines.push(sha(await readFile(new URL(name, here))) + '  ' + name);
await writeFile(new URL('SHA256SUMS.txt', here), lines.join('\n') + '\n'); console.log(JSON.stringify({ sourceFiles: sources.length, evidenceFiles: lines.length, browserDownloadsVerified: 2 }));
