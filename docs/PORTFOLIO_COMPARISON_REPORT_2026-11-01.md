# Save and independently recompute a portfolio comparison

Item 577. Source: 47c3d26.

The portfolio comparison view can now save its completed arithmetic together with both normalized source observations. The bounded 128 KiB format preserves exact integer units, missing-contract and unobserved-holding distinctions, account/network/site scope and block hashes. It preserves observation data, not original source-file formatting. All authority, authentication, audit, transfer-proof and profit-proof flags remain false.

A separate file input reopens the comparison even without a current target. It recomputes every derived value, rejects changed arithmetic or unsupported fields and leaves current target, baseline text and saved history untouched. Successful review can save the same canonical package. Changed inputs, cancelled reads, target changes and disposal retire old output and export eligibility; failed or asynchronous downloads cannot claim success. A silent baseline change also requires another comparison before saving.

The shared file guide and existing offline inspector validate this format through the same recomputation. They classify it as structure-only, not an authenticated original; CLI exit 2 reflects that distinction. Navigation reaches the wallet-card section; selecting the dedicated comparison-review input remains explicit and the report is not imported.

178 related tests passed (4783.512 ms); 135 focused native browser file-read cases passed. Coverage includes exact uint256 signed deltas, absent-versus-zero holdings, changed source identities, modified results and authority flags, source capture, malformed/bounded JSON, file cancellation, stale UI completion and unchanged current observation/history. [Evidence](evidence/2026-11-01-portfolio-comparison-report/) captures exact UI/API/CLI results, an altered comparison rejected by the UI, and a near-uint256 example with +4 base units and unknown token balances. These are synthetic/native-browser checks, not a real-wallet or OS-picker acceptance test.

Last full-browser checkpoint: 431dcfd (980 cases). Last full-wallet checkpoint: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. The format, save/reopen flow and common inspection integration comprise one complete portable-comparison capability.
