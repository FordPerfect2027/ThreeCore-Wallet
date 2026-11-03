# Offline operation-ledger browser evidence — October 29, 2026

This is a local development record for the [ten-item batch](../../OPERATION_LEDGER_2026-10-29.md). All amounts, addresses and events are fictional rehearsal inputs. No wallet signing, transfers, token approvals or private-key access occurred. These files do not authenticate on-chain activity, authorize execution or establish mainnet readiness.

The browser sequence ran against `http://127.0.0.1:4231/rehearsal/`, using source commit `221ac373eb96db6eac13c832ffc6d34be1cdf41e`. The browser connection was recovered by attaching to the newly opened tab displaying the page. The local server's origin restrictions were not changed.

## Files

- [Chrome JSON download](chrome-DAT-ledger-v2.json): the three applied records after settlement, allocation and undo of a release.
- [Chrome CSV download](chrome-DAT-ledger-v2.csv): exact base-unit values; import monetary columns as text in spreadsheet software. This is not an importable ledger.
- [Sixteen browser observations](chrome-ledger-validation.json): rendered state during the actual UI sequence, including preview, cancellation, release, undo, editing and reload/import.
- [Offline file-check result](chrome-download-offline-check.json): recalculation of the actual downloaded JSON, plus an exact comparison of the CSV to the recalculated export.
- [Restored result screenshot](chrome-ledger-result.png) and [full page screenshot](chrome-ledger-restored.png).
- [Batch checkpoint](batch-validation.json): completion status, test outcomes and hashes of the locally retained logs and evidence. Full test logs and separately generated three-agent fixtures remain in the local `ten-step-development` evidence folder; they are not copied into this folder.
- [SHA-256 checksums](SHA256SUMS.txt): checksums of the seven evidence files above, excluding this index and the checksum file itself.

## Recalculate the saved result

From the repository root with Node.js 22 or later:

```sh
node scripts/check-rehearsal.js docs/evidence/2026-10-29-operation-ledger/chrome-DAT-ledger-v2.json --json --sha256 7d719172ede0bb3c54812d8c29850798177a821b25e773bdd98b91717848f1c9
```

Expected: exit 0, three accepted records, cash `1028000000`, realized P&L `28000000`, fees `2000000`, reserved allocation `2800000`, available cash `1025200000` and remaining allocation `0`, all in six-decimal SIM base units. `sourceVerified` and `authorizesExecution` remain false. A hash match confirms byte equality, not provenance or authenticity.

The actual JSON download is 1,581 bytes; the CSV is 786 bytes. Evidence files retain their exact bytes through Git checkout, including the CSV's original CRLF line endings. The restored screen shows cash 1,028 SIM, realized P&L 28 SIM, reserved allocation 2.8 SIM and available cash 1,025.2 SIM. Reload/import preserves applied records and recomputes the result; in-memory undo history intentionally does not survive reload.

The final focused automated suite passed 130 tests. The full unit rerun passed 11,707 tests and the integration suite passed 406. These counts overlap; see the batch report for the two late-added reentrancy tests, the initial timing-sensitive failure and its successful reruns, and the excluded token-contract compatibility suite.
