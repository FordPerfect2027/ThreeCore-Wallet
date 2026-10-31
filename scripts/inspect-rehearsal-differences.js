#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { RehearsalError } from '../src/operation-rehearsal.js';
import { readRehearsalReportFile } from './verify-rehearsal-report.js';
import { readRehearsalEvidenceFile } from './verify-rehearsal-evidence.js';
import { reviewRehearsalReport, reviewRehearsalEvidence, pageReviewedRehearsalDifferences,
  pageRehearsalEvidenceReceiptDifferences, inspectReviewedRehearsalDifference,
  inspectRehearsalEvidenceReceiptDifference } from '../src/operation-rehearsal-report-review.js';

export async function runRehearsalDifferencePage(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || ![1, 3, 5].includes(args.length) ||
        args.some(value => typeof value !== 'string' || !value) || args[0].startsWith('--') ||
        (args.length >= 3 && (!['--page', '--difference'].includes(args[1]) || !/^[1-9]\d{0,7}$/.test(args[2]))) ||
        (args.length === 5 && (args[3] !== '--evidence' || !['receipt', 'source'].includes(args[4]))))
      throw new RehearsalError('CLI_ARGUMENTS');
    const requested = args.length >= 3 ? Number(args[2]) : 1, offset = (requested - 1) * 40;
    const evidence = args[4] ?? null, detail = args[1] === '--difference';
    let inspected, report, receiptMatches = null;
    if (evidence) {
      const checked = await reviewRehearsalEvidence(await readRehearsalEvidenceFile(args[0]), { subtle: webcrypto.subtle });
      report = checked.reportReview; receiptMatches = checked.matchesReceipt;
      inspected = detail
        ? (evidence === 'receipt' ? inspectRehearsalEvidenceReceiptDifference(checked, requested - 1) : inspectReviewedRehearsalDifference(report, requested - 1))
        : (evidence === 'receipt' ? pageRehearsalEvidenceReceiptDifferences(checked, offset) : pageReviewedRehearsalDifferences(report, offset));
    } else {
      report = await reviewRehearsalReport(await readRehearsalReportFile(args[0]), { subtle: webcrypto.subtle });
      inspected = detail ? inspectReviewedRehearsalDifference(report, requested - 1) : pageReviewedRehearsalDifferences(report, offset);
    }
    if (!detail && requested > inspected.totalPages) throw new RehearsalError('REVIEW_DIFFERENCE_PAGE_OUT_OF_RANGE');
    const summary = { matchesReceipt: receiptMatches, matchesRecomputation: report.matchesRecomputation,
      checksumMatches: report.checksumMatches, reportOutcome: report.reportOutcome ?? null };
    output.write(JSON.stringify({ schema: detail ? 'threecore.operation-rehearsal-difference-detail.v1' : 'threecore.operation-rehearsal-difference-page.v1', simulationOnly: true,
      sourceVerified: false, authorizesExecution: false, target: evidence ? 'evidence-' + evidence : 'report',
      sourceSha256: report.sha256, summary, ...inspected }, null, 2) + '\n');
    return receiptMatches !== false && report.matchesRecomputation && report.checksumMatches !== false ? 0 : 2;
  } catch (error) {
    errors.write('Rehearsal difference inspection failed: ' + (error?.code ?? 'FILE_READ_FAILED') + '\n');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalDifferencePage(process.argv.slice(2));
