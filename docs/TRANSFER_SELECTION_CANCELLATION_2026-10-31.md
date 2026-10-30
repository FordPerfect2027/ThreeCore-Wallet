# Cooperative archive selection cancellation

Continuation items 317–318. Source revision `aca341b`.

317. Archive selection owns an abort signal until the selected record is staged. The archive exposes its cancel button during selection and retires selection on cancel, replacement, clear, invalidation or disposal. The final status leaves the preparation state after completion or cancellation.

318. The transfer panel forwards selection cancellation through encoding and the controller's file-validation phase. Parent actions abort the owned encoding; cancellation during staging cancels only that operation. Old cleanup cannot clear a newer selection, and cancellation callbacks cannot let a replacement action continue after disposal. A normal selection still requires an explicit preview/apply step.

## Validation

- Before: 12 cases, 8 failing and 4 passing controls.
- Focused after initial fix: 66 passed.
- Final focused suite, including replacement ownership and no-file chooser cancellation: 69 passed.
- Transfer, reconciliation and workspace integration: 1,637 passed, 0 failed/skipped/cancelled; 47,500.8371 ms.
- Evidence and SHA-256 manifest: `evidence/2026-10-31-transfer-selection-cancellation/`.

The stalled digest fixtures were released in test cleanup, but successful cancellation assertions occurred before release. Native hashing cannot be stopped internally; ownership and bounded waiting prevent a late result from being admitted. Arbitrary third-party onSelect callbacks must cooperate with the supplied signal; this batch verifies the actual transfer-panel integration. Only synthetic local records were used. No signature, transfer, approval, secret retrieval, publication or server restart. Latest full-suite snapshot remains source `23eb408` through item 300 (13,597 passed).
