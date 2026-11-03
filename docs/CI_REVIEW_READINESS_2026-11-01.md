# Wait for completed report review before testing downloads

The first public checkpoint run at `9f4e5c54c246ef8445b76691f7f661ba7a88ba7c`
failed one of 15,954 unit cases: `report-review-save rejects thenable without a
success message or data loss`. The setup asserted that Save was ready after at
most 100 `setImmediate` turns. Event-loop turns are not a bound on native
WebCrypto completion. The failure occurred before the download behavior under
test. The three separate compiled-token integration jobs passed.

- [Original CI run](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41291369294)
- [Failed unit job](https://github.com/FordPerfect2027/ThreeCore-Wallet/actions/runs/41291369294/job/124803145866)

The download setup and the two related review tests now use the existing
two-second `until` helper to wait for the review's busy state to finish. Their
assertions that the save control is enabled, the receipt is correct and the
workspace/undo/pending restore are preserved remain unchanged. This does not
change application behavior, skip a test, or increase an application timeout.

## Controlled reproduction and validation

A test-process-only preload delays the real WebCrypto digest response by 40 ms.
It still executes the original native digest. On the original source the exact
CI case fails with `report-review-save is ready`; after the change the same
command passes. The three complete affected test files then pass 313 cases,
with zero failures, cancellations or skips on Node 24.19.0 / Windows.

```sh
node --import ./docs/evidence/2026-11-01-ci-review-readiness/delay-webcrypto.mjs --test --test-name-pattern='report-review-save rejects thenable' test/operation-rehearsal-download.test.js
node --test --test-concurrency=2 test/operation-rehearsal-download.test.js test/operation-rehearsal-review-panel.test.js test/operation-rehearsal-page.test.js
```

The preload is evidence for reproducing the timing condition, not an application
dependency or a production override. Its before/after logs and the focused run
are stored in [the evidence directory](evidence/2026-11-01-ci-review-readiness/)
with SHA-256 checksums. CI on the updated commit must still complete the full
unit, HTTP, browser and compiled-token jobs; these focused results alone do not
establish that outcome. The existing port 4231 server was not restarted.
