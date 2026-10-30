# Provider observer boundaries

Continuation items 372–374. Source revision `a08160b`.

372. Listener registration and removal use the shared asynchronous-result observer, including malformed async then methods that reject their own returned native promise. Registration still fails closed and all attempted listeners are removed. An EventEmitter-style return of the provider itself remains exempt from then inspection.

373. Owner-currentness callbacks consume asynchronous failure while granting authority only to a synchronous true result. Disposal during the callback or its result inspection is checked again before inspecting an event payload. Late notifications cannot reauthorize delivery.

374. The provider event-budget clock rejects asynchronous values without leaking rejection and fails closed on reentrant clock evaluation. A nested rejection cannot allow the outer call to increment the budget or reopen a stopped gate. Ordinary numeric monotonic clocks and exact window renewal remain supported.

## Validation

- Original new regression set: 14 tests, 8 failed and 6 passing controls. Failure output is retained.
- Focused provider tests: 158 passed.
- Final provider, wallet-card, shared callback, cleanup and compatibility integration: **340 passed**, zero failed/skipped/cancelled; **3,595.9365 ms**.
- Evidence and SHA-256 checksums: `evidence/2026-10-31-provider-observer-boundaries/`.

The latest full-wallet checkpoint remains 14,181 tests at `a4d6952` through item 360. Latest native Chrome checkpoint remains 836 at `4515f64` through item 368. No additional full/browser run is claimed here. Tests used synthetic providers only. No signatures, transfers, approvals, secrets, external RPC, publication, deployment or existing-server restart.
