# Manual proposal and condition authoring

The `/proposals/new/` screen lets a user create a manual proposal and comparison
conditions from saved budget evidence without editing JSON. It preserves the
original budget/source text in one existing review-file format, usable directly
by `/proposals/` and `/proposals/quote/`.

## Completed workflow

1. Import a budget/source comparison. Verify its checksums and balance consistency.
   Select the target agent in individual or shared budgets. Account, chain,
   spending-asset contract, precision, spending and native value come from that
   agent's original budget and observation; they cannot be silently substituted.
2. Enter a manual label, explanation and target HTTPS origin/contract. An explicit
   button fills the already-configured Base Aerodrome Router when appropriate.
3. Enter comparison ceilings and a lifetime of 1–1440 minutes. An explicit button
   copies budget values as ceilings; unknown fees remain blank. Imported sources
   never automatically overwrite these fields. A smaller ceiling remains smaller
   and produces a limit failure; the app does not raise it to manufacture success.
4. Generate the manual proposal and policy, run the existing source-linked review,
   and save the originals with the result. Insufficient but internally consistent
   budget records can be reviewed and retain their insufficiency result.
5. Reopen the saved file in the review screen and recheck at the current time.
   Rechecking preserves the proposal/policy bytes and original expiry.

Editing inputs, changing the source, cancellation, pagehide or disposal aborts
pending work and invalidates prior results. Source reads and validation that
complete late cannot restore old state. Save also checks the exact current form
and source before offering a download. This page has an offline `connect-src
'none'` policy; it does not call a model, wallet or external dApp.

## Verification

Final related checks passed **37/37**, including the 10 new model/UI/HTTP cases.
The initial test run had one incorrect test expectation (100 rather than the
existing fixture's 50-unit spend). The expectation was corrected against the
fixture. A browser review also found stale completion wording after source
replacement; the source-change message was corrected and verified in the final
tests. Test batches overlap and should not be summed as unique coverage.

Four actual browser files were independently recomputed:

- A synthetic 4-USDC EMA proposal passed at its recorded time.
- Reducing its ceiling to 3 USDC produced `TOKEN_SPEND_LIMIT` without modifying
  the entered ceiling or original 4-USDC spending amount.
- The real Account 2 source from block 53,457,078 retained budget insufficiency.
  Its new proposal and fee/reserve conditions are manual examples, not a trade.
- The first file was reopened, rechecked and saved in the existing review UI.
  All three original source texts and the proposal expiry were unchanged.

Evidence: `docs/evidence/2026-11-03-proposal-draft/`, including the original
synthetic input, actual browser exports, screenshots, verification program,
test logs, source inventory and SHA-256 manifest. A fresh ordinary server used
4253; earlier processes and saved data were retained.

This is manual proposal authoring, not product AI generation, authenticated
spending authority, replay prevention or transaction execution. AI remains
deferred by the user. The next integration is to bind existing allowance
observations to the proposal/quote context and then fee/execution preflight.
Publication remains local until the consolidated GitHub update.
