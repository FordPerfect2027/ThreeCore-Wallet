# Extract one original token entry from a saved report: item 480

Source: `7ab0bcd`.

480. The three-token period report can export one explicitly selected original DAT, EMA or CAWELON entry as an existing period-library JSON file. Every original entry field survives: identifier, label, creation/update times, archive marker, requires-new-plan marker and complete draft. The portable library revision resets to zero; the original entry itself is unchanged. Missing slots cannot be substituted with another token. Other token entries and the combined report conclusions are not included. Counterparty addresses present in the selected token's original events remain original evidence.

The collapsed UI shows the chosen token, account, range and restriction/archive state before a separate save acknowledgement. Changing the token or accepted source clears that acknowledgement; the report-wide save checkbox does not grant it. Accepted and pending reports remain intact. Export performs no storage operation and does not resume collection. The file enters the existing library import review, followed by its separate restore review if the user later chooses to restore it; the restriction survives both steps. Empty and partial drafts remain empty and partial.

The standalone command `node scripts/extract-period-report-entry.js report.json --agent DAT` (also `npm run period-report:extract-entry -- ...`) verifies the original report wrapper checksum and emits only the selected library JSON to stdout. Exit 0 means extraction succeeded, not acquisition completeness or permission to execute. Invalid source checksums, UTF-8, tokens and missing slots produce no partial original output. No RPC, source writes, automatic imports or private material access are performed.

## Validation

78 focused checks passed (4,160.0842 ms). The first run contained one incorrect test assumption that another account's address could not occur as a legitimate counterparty in the selected original events. That assertion was corrected to verify excluded entries by identifier; production data preservation was not weakened. Its failed log is retained. The related fixed-source suite passed 1712 tests (73049.8336 ms), with zero failures, skips or cancellations. Native Chrome passed 890 UI cases using synthetic providers and no external RPC. The new native case verifies the dedicated acknowledgement, retained restrictions and pending source, missing-token handling and acknowledgement reset. Downloads are captured callbacks, not OS dialogs or proof of connection to the user's existing browser.

[Four reproducible captures](evidence/2026-10-31-original-period-entry-extraction/) retain complete DAT, partial EMA, empty CAWELON and restricted archived DAT sources and extracted files. Standalone CLI bytes exactly match the shared exporter. Each extracted entry matches its original field for field and the source stays unchanged. Synthetic library import/restore proves no storage write before import confirmation, no handoff before restore confirmation and the original requires-new-plan flag in the handoff. This development test changes only its isolated in-memory fixture.

Latest full checkpoint remains 15,227 tests at 5cc20fe (item 479). No real signatures, transfers, approvals, secrets, publication, deployment or restart of the existing server occurred.

## Evidence collection checkpoint

At committed record feb7ad9, all 143 tracked manifests and all 1069 referenced files matched their SHA-256 checksums (64,959,806 bytes). The read-only audit is retained as `prior-evidence-audit.log`. That observation predates adding this audit log itself and regenerating this folder’s manifest; it does not authenticate authorship or current chain state. This record-only update adds no development item.
