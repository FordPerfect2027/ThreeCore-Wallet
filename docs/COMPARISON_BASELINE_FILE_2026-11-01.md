# Choose a saved balance observation as the comparison baseline

Item 575. Source: 39ce850.

The portfolio comparison panel accepts a saved UTF-8 observation file directly, bounded to 64 KiB. It validates and stages the exact source text without replacing the displayed observation or running a comparison. The user still explicitly compares; existing account/agent/network/site matching, block ordering and same-block consistency checks remain in force. A baseline can be loaded before displaying a target.

Cancelled selection preserves an existing comparison. Malformed, over-limit or undecodable files preserve the prior baseline text. Reading clears obsolete comparison output and temporarily disables comparison; stop, text edits, clearing, target replacement and disposal cancel the pending file and suppress delayed completion. File input resets after selection so the same file can be selected again.

120 related tests passed (1788.4444 ms); 133 focused native browser file-read cases passed. [Evidence](evidence/2026-11-01-comparison-baseline-file/) records exact staged before/after reports and identical UI/API comparison output. The example compares native balances near uint256's maximum with an exact +4 base-unit difference and retains missing-contract balances as unknown. No balance change is described as profit or a verified transfer. Native selection uses synthetic File/DataTransfer, not the OS picker or an actual wallet.

Last full-browser checkpoint remains 431dcfd (980 cases); last full-wallet checkpoint remains d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. This is one complete comparison-baseline file workflow.
