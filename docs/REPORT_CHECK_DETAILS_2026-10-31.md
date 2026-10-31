# Source-linked structured check details: item 458

Fixed source: `40c28e1`.

458. The saved report-set screen can now save its current filtered diagnostics as a structured viewing JSON. This includes exact contradictory observation hashes and integer-value strings, check/report references, range conventions, query/options, source-wide counts and continuity status. Its sourcePayloadDigest matches the canonical original report-set payload. The original source JSON stays separate; the detail file cannot be restored as a report set and contains no original event archive.

Default output omits notes and shortens structured account addresses. Full addresses and notes can be selected. Hashes and saved values remain exact, and the screen explains that this format contains them. Free-form labels/search can contain addresses despite shortening. The separate original report-set JSON still contains all original addresses, balances, histories and notes. All outputs are unencrypted. The common acknowledgement, delivery refusal, cancellation and retained-source behavior apply.

The detail schema is threecore.report-set-check-details.v1 with a 4 MiB output limit. An empty selection retains the source digest, stated query and unfiltered counts. The digest identifies a canonical payload, not exact original file formatting, authorship or current chain state. A checksum alone does not verify that the exported observations are truthful; keep the source for independent recomputation.

## Offline reproduction

```text
node scripts/export-report-checks.js saved-set.json --severity conflict --format details
node scripts/export-report-checks.js saved-set.json --search check-8 --format details
node scripts/export-report-checks.js saved-set.json --include-notes --full-addresses --format details
```

The existing csv and json formats retain their previous behavior; details is the new structured format. Strict --require-continuous still checks the whole source and returns exit 2 with output when it is not continuous. Invalid reads/checks produce exit 1 with no partial output; a successful export returns 0. The command only reads the specified source and writes stdout.

## Validation

- Focused detail, panel and CLI group: 40 passed, zero failed/skipped/cancelled (9,407.2823 ms).
- Related report-set, checklist, reference search, CLI and local-file group: 335 passed (36,236.7356 ms).
- Full wallet at 40c28e1: 14,968 passed, zero failed/skipped/cancelled (328,365.198 ms).
- Native Chrome: 870 UI cases passed with an isolated profile, a fresh ephemeral server, a synthetic provider and no external RPC. The user's existing server was not restarted.
- Previously tracked evidence: all 120 manifests, 729 files and 46,404,129 bytes matched; zero mismatched/unreadable files. This audit precedes the present folder.

Three standalone captures exactly reproduce the shared browser-export function executed under Node: six conflicting checks with shortened accounts/no notes; nine checks with full accounts/notes; and an empty selection retaining the demo source's 15 checks and strict exit 2. The source files are unchanged. Native Chrome separately exercises the screen controls with a captured download callback; this does not assert that an OS download dialog or the user's current tab was verified. Tests also cover exact long integers, original-digest equality, rejection as a backup, empty selections, asynchronous input capture, failed/cancelled hashing, acknowledgement and refused-delivery retry.

[Evidence](evidence/2026-10-31-report-check-details/) contains two synthetic original files, three structured detail outputs, capture metadata, scoped/full/native logs, prior evidence audit and SHA-256 checksums. These are local synthetic validations, not a mainnet completion percentage. No real signing, transfer, approval, secret acquisition, publication or deployment occurred. The complete browser/offline detail-export workflow counts as one development item.
