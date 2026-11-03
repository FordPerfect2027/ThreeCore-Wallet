# Review exact token-list replacement impact before applying

Item 587. Source: ccc5acb.

Token configuration preview now compares the proposed list with the current input. It shows current/target counts, exact added and removed contract addresses, retained counts and the target order. These are configuration changes, not asset movements. Empty current input is a known empty list; malformed, duplicate or oversized current input yields unknown difference counts, never a false zero baseline. A valid proposed list can still explicitly replace invalid input after that limitation is shown.

The candidate retains the exact current input text as well as its proposed JSON. Preview and application capture/recheck context and current input. A changed baseline requires another preview, even if no DOM input event was dispatched. Reentrant invalidation, asynchronous source failures and disposal cannot establish or apply a stale candidate. The existing stage/file workflows use this same confirmation path.

154 related checks passed (2180.363 ms); 141 focused native browser cases passed. [Evidence](evidence/2026-11-01-token-plan-replacement/) captures a two-contract replacement with one addition, one removal and one retained address, rejected stale application, successful fresh review and explicitly unknown malformed-baseline counts. Neither preview nor apply makes a provider call.

Last full browser: b3254c9 (986 cases). Last full-wallet: d253e8d (15,720 tests). No existing-server restart, external RPC, signature, transfer, approval, private-key retrieval, publication or deployment occurred. Native synthetic checks do not establish a real-wallet connection.
