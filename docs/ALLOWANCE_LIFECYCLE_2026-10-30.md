# Allowance controller lifecycle and review ownership

Continuation items **211–213**, source `9ceb9ad`:

211. Bound observer callbacks, consume malformed asynchronous thenables, close observers before disposal, and keep each cancellation attached to its own read. Reentrant abort/context callbacks cannot resurrect a cancelled read or erase a newer read's abort handle.
212. Keep the reviewed allowance target plan through apply, recheck ownership after context evaluation, and preserve a newer review when an old apply or outer context failure returns.
213. Capture own context/progress fields and diagnostic codes, avoid accessors, and check cancellation again after observation or diagnostic reflection before publishing.

All **17 new regressions fail before the fix** and all 54 controller/lifecycle tests pass afterward. The first broader run passed 569/570: an older invariant expected a spender-code getter to run and change the account. Item 207 now rejects that getter without execution, so that expectation was obsolete. The invariant now verifies zero getter calls and an explicit INVALID_RESPONSE partial row. A separate reflection test retains the original account-change rejection check. The final **571-test allowance/notifier/callback suite passes**, with zero failures, skips or cancellations.

Evidence: [before](evidence/2026-10-30-allowance-lifecycle/before.log), [targets](evidence/2026-10-30-allowance-lifecycle/related.log), [initial integration](evidence/2026-10-30-allowance-lifecycle/integration.log), [final integration](evidence/2026-10-30-allowance-lifecycle/integration-fixed.log), [checksums](evidence/2026-10-30-allowance-lifecycle/SHA256SUMS.txt).

These are synthetic adapters and local unit/integration checks. No token approval, signature, transaction or private-key access occurred. This does not add real-chain coverage or establish mainnet readiness. The previous full-wallet suite predates this source change.
