# Cleanup and observer failure containment

Continuation items 365–368. Source revision `4515f64`.

365. Page-wide file-reader cleanup now consumes malformed asynchronous callback results through the shared observer. A rejected promise returned by an asynchronous then method cannot escape as an unhandled rejection during cancellation.

366. Secure deadline expiry consumes the same malformed notification failures without changing the expired state or granting new authority.

367. HTTP header/body refusal, aborted reads, reader cancellation and lock release now consume both ordinary promise failures and malformed asynchronous cleanup results. Public Base diagnostic cleanup uses the same handling; the original read result or transport error remains authoritative.

368. Wallet read-scope eligibility/completion callbacks and wallet-card view/access/cleanup callbacks use one shared result classifier. Unconfirmed asynchronous eligibility cannot invoke a read or create a wallet session; completion observers cannot replace a successful result or leak their rejection.

## Validation

- Original regression set: 13 cases, 12 failed and 1 passing control. Draft fix: all 13 passed.
- Draft compatibility for deadlines, wallet scopes/cards and HTTP/public RPC: 160 passed.
- Final file service, callback, deadline, wallet-card and HTTP/RPC integration: **899 passed**, zero failed/skipped/cancelled; **6,523.4663 ms**.
- Native Chrome at fixed source `4515f64`: **836 passed**, with a synthetic provider and no external RPC. Source/tests were fixed during the browser run. After the integration run, existing mixed line endings in wallet-card-controller were restored without a semantic change.
- Evidence and checksums are in `evidence/2026-10-31-cleanup-observers/`.

The latest full-wallet checkpoint remains 14,181 passing tests at `a4d6952` through item 360. This batch does not claim a new full-suite run. All providers, callbacks and data in these tests are synthetic. No real signatures, transfers, approvals, secret retrieval, publishing, deployment or restart of an existing server.
