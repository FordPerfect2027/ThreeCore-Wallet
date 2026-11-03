# Native crypto cancellation test wait — November 2, 2026

The complete regression at `3961b5151bec3cadca44bf732628c2c6addabeac` passed
16,453 of 16,454 cases. One native decryption-cancellation case failed in the
test helper's two-second polling deadline while waiting for the already
cancelled key derivation to finish. The unchanged 12-case file then passed
alone. This supports a load-sensitive wait failure, not a claim that the full
initial run passed.

Commit `e5841f0d1b412b516b3e3eb4a81d75eabaf81edd` changes only that test file.
It subscribes to the existing runner's idle notification instead of spinning
with repeated immediate callbacks against a two-second limit. It still checks
immediate cancellation, no plaintext/file result, the occupied native slot,
late completion accounting and byte-copy clearing. The enclosing tests retain
a finite 60-second deadline. No product cryptography, iteration count, runner
timeout or cancellation guard was weakened.

Validation after the correction:

- The 12 native lifecycle cases passed.
- The full Node/HTTP command passed **16,454**, with zero failures, cancellations
  or skipped cases, in 464,749.0602 ms.
- The full synthetic browser harness passed **1,021** cases (511 + 510), including
  cleanup of its own isolated profiles. It used no real wallet or external RPC.

The application remains `96b59459a0f593246c60f0bed4b52052211a464a`, including
the RPC history-range correction. Unchanged token suites were not rerun.
Focused runs overlap the complete totals. Initial failure, unchanged isolated
pass, corrected focused pass, final full logs and the test diff are retained
in the [existing regression evidence folder](evidence/2026-11-02-release-regression/).
See [the structured result](evidence/2026-11-02-release-regression/candidate-regression-summary.json).
