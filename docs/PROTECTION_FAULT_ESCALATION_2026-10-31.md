# Terminal protection faults after an ordinary stop

Continuation items 353–354. Final source revision `565f960`; initial protection fix `4564556`.

353. An explicit clock or timer fault received while access is already stopped now remains terminal. Resume stays disabled even after cleanup succeeds. Escalation closes the gate without recursively repeating cleanup; ordinary repeated stops preserve their existing behavior.

354. The protection panel retains faults raised during cleanup and does not allow a reentrant eligibility check to overwrite a newer warning or disposed controls. Malformed asynchronous observer results are consumed without authorizing resume.

## Validation

- Original protection regression set: 11 cases, 10 failed and 1 passing control. Focused set after correction: 69 passed.
- Protection, access, RPC and wallet integration at `4564556`: **1,523 passed**, zero failed/skipped/cancelled; 10,662.8084 ms.
- The first native Chrome run completed 836 cases with 835 passing and one failed encrypted-library archive import. The failure is retained in `browser-ui.log`, not reported as success. It exposed an item-352 regression: clearing an input also clears its live native FileList.
- Correction `565f960` captures the selected File before clearing the picker, while preserving a replacement selection made by a later callback. A regression test reproduced the failure before the fix. This correction does not add another development item.
- Final protection/encrypted library/archive checks: **403 passed**, zero failed/skipped/cancelled; 15,019.2572 ms.
- Native Chrome rerun at fixed source `565f960`: **836 passed**, using a disposable profile, synthetic provider and no external RPC.
- The source tree remained fixed during each integration/browser run. Evidence and SHA-256 checksums are in `evidence/2026-10-31-protection-fault-escalation/`.

The latest full-suite checkpoint remains 13,948 tests at `5aa4a25`. No real wallet signatures, transfers, approvals, secrets, publication, deployment or restart of the existing demo server.
