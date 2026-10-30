# File-read ownership and full validation

Continuation items 359–360. Source revision `a4d6952`.

359. Cancelling the prior reader can invoke cleanup that starts or stops another selection. A versioned file-read scope now retires the superseded outer request before opening its payload and keeps cancellation attached to the newest read. Old worker settlement cannot detach a newer read.

360. Size/deadline options are captured only after the request owns cancellation. A stop or replacement during option access prevents the old payload from being opened. Invalid options release ownership, and later native File reads still work. The public cancel return remains unchanged.

## Validation

- Original regression set: 8 cases, 6 failed and 2 passing controls. Draft fix: all 8 passed.
- File scopes, page-wide file service and rehearsal file integration: **786 passed**, zero failed/skipped/cancelled; 5,353.8388 ms.
- Full wallet and local server suite at fixed source `a4d6952`: **14,181 passed**, zero failed/skipped/cancelled; **546,703.309 ms**.
- Native Chrome run at the same fixed source: **836 passed**, using a synthetic provider and no external RPC.
- The source and tests remained fixed throughout each broad run. The browser run followed completion of the full suite.
- Independently rehashed all **83 previously tracked evidence manifests**, covering **462 files / 28,522,090 bytes**: every checksum matched. This check predates the current batch manifest and does not claim to verify files generated afterward. The JSON result records the exact source revision and each checked manifest.
- Evidence and SHA-256 checksums are in `evidence/2026-10-31-file-read-scope/`.

The full and browser runs also cover the completed corrections through item 358, including native FileList handling, terminal protection faults and filename capture. Test counts and repeated validation do not add development items or represent a mainnet readiness percentage.

Local/synthetic operation only. No real wallet signature, transfer, approval, secret retrieval, publication, deployment, existing browser profile access or restart of the existing demo server.
