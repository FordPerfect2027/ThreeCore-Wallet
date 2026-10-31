#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyEvidenceManifest, EvidenceManifestError } from './evidence-manifest.js';

export async function runEvidenceManifestVerification(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string' || !args[0] || args[0].startsWith('--'))
      throw new EvidenceManifestError('CLI_ARGUMENTS');
    const result = await verifyEvidenceManifest(args[0]);
    output.write(JSON.stringify(result, null, 2) + '\n');
    return result.summary.unreadable ? 1 : result.allMatched ? 0 : 2;
  } catch (error) {
    const code = error instanceof EvidenceManifestError ? error.code : 'MANIFEST_READ_FAILED';
    const line = error instanceof EvidenceManifestError && Number.isSafeInteger(error.line) ? ' at line ' + error.line : '';
    errors.write('Evidence verification failed: ' + code + line + '\n');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runEvidenceManifestVerification(process.argv.slice(2));
