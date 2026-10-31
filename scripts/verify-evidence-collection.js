#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceManifestError } from './evidence-manifest.js';
import { verifyEvidenceCollection } from './evidence-collection.js';
export async function runEvidenceCollectionVerification(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string' || !args[0] || args[0].startsWith('--'))
      throw new EvidenceManifestError('CLI_ARGUMENTS');
    const result = await verifyEvidenceCollection(args[0]);
    output.write(JSON.stringify(result, null, 2) + '\n');
    return result.summary.failedManifests ? 1 : result.allMatched ? 0 : 2;
  } catch (error) {
    errors.write('Evidence collection verification failed: ' + (error instanceof EvidenceManifestError ? error.code : 'REPOSITORY_READ_FAILED') + '\n');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runEvidenceCollectionVerification(process.argv.slice(2));
