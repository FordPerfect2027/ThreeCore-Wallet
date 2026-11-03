# Shared-account correction: source and evidence

Final source: `34d173112d7f45475c52fb64553cfa8b369699d2`.
Previous source used for the four failing reproductions: `b2270b25e32dfe1c6e13f0512df4ea30d961efb3`.

See [the acceptance record](../../SHARED_ACCOUNT_ACCEPTANCE_2026-11-02.md) for behavior, scope and pending real-PC steps.

- before.log: four failures before the shared-account correction.
- focused.log: 624 affected Node cases passed on the intermediate working tree.
- browser-intermediate-failure.log: 510/511 first-shard passes; the remaining Connect handler still rejected sharing. Overall failed; the second shard was not executed.
- focused-browser.log: 13 acceptance cases after the Connect handler correction.
- node-final.log: 16,451 Node/HTTP cases passed on the final source.
- browser-final.log: all 1,021 synthetic browser cases passed on the final source.
- *-compile.log / *-compatibility.log and token-build-receipts.json: fresh compilation of three pinned token sources, then 50 local-EVM compatibility cases each. Dependencies were reused, not freshly installed.
- public-read-redacted.json: six actual read-only Base Sepolia observations at one canonical block; account addresses are omitted. The digest identifies the separate private raw record. This summary alone cannot support independent account-specific verification and does not verify MetaMask permission.
- source-scope.json: exact totals, source and limits. Focused runs overlap full-suite totals.

Initial failures and raw log bytes are preserved. The locally compiled contracts may perform synthetic transactions in isolated test EVMs; no real user wallet was used and no public transaction was submitted. No percentage is inferred from these counts. No GitHub publication occurred.

Verify this directory with:

```powershell
node scripts/verify-evidence-manifest.js docs/evidence/2026-11-02-shared-account-acceptance/SHA256SUMS.txt
```
