# State RPC cancellation repair

Maintenance source: `d253e8d`. This repairs the existing header/body cancellation path and adds zero continuation items; the completed count remains 515 / 600.

Both HTTP response stages now validate own-data cancellation options, subscribe through captured native signal operations, and use native aborted state throughout. Shadowed instance properties cannot hide cancellation or replace cleanup. Artificial events do not consume genuine cancellation. Registration, response metadata validation, reader acquisition and cleanup share protected exit paths. Interrupted promises are observed before a pre-cancelled signal can reject them. A header response arriving after cancellation is disposed; late rejection stays observed. Errors retain the fixed STATE_RPC_UNAVAILABLE diagnostic without raw exception text.

The body reader cancels whichever object currently owns the stream. In particular, cancellation inside getReader may happen after the stream is locked but before the reader is returned: the subsequent catch still cancels that newly obtained reader, then releases its lock. Per-target cancellation avoids repeated calls while allowing ownership to change. Byte/chunk/UTF-8/JSON limits and transport timeout policy remain unchanged. Native intrinsics are captured at module initialization; this is not a defense against a compromised realm before initialization.

## Validation

Before repair at 2d9481b, all 14 native-signal controls failed (516.0304 ms). The focused suite passed 65 cases (2606.0912 ms). Related Base state-provider and actual local relay/server integration passed 97 cases (5522.8605 ms). A frozen full-wallet run at d253e8d passed all 15,720 tests (403000.5522 ms), with zero failed/skipped/cancelled. This is the new clean full-wallet checkpoint, including the preceding batch-review and portfolio changes. The last native browser checkpoint remains 621a50b with 932 cases; no later native run is claimed for this maintenance.

[Evidence](evidence/2026-11-01-state-rpc-signal-repair/) contains header/body captures, abort during reader acquisition, failure reproduction and passing logs. Captures verify zero override invocation, no remaining abort listeners and released stream ownership. Its SHA-256 manifest is checked against committed Git blobs. All network integration used local synthetic services, not live chain endpoints. No signatures, transfers, approvals, secrets, publication, deployment or restart of the user's existing server occurred. Development counts are not mainnet readiness.
