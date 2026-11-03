# Inspect one historical record and compare its actual predecessor

Items 583–584. Source: b3254c9.

583. A selected historical record now has an explicit detail view within history management. It shows account, chain, site origin, exact block/hash, native base units and each observed token balance or missing-code notice. Keyboard focus moves to the detail. This does not replace the current portfolio observation, import a record, connect a wallet or export anything. The shared validated plain-text formatter also adds the source site to current/past portfolio display. Selecting another record, changing history, invalidation and disposal clear the detail and retire old comparison exports.

584. A separate action selects and compares the immediately preceding saved observation for the selected later record's exact account/chain/site identity. It follows numeric block order, not archive order, and does not substitute a closer record from another account, network or site. The resulting explicit pair can use the existing portable comparison save. If no predecessor exists, stale comparison output and export eligibility are cleared. The UI states that adjacency of saved observations does not mean all intervening blocks were checked.

217 related tests passed (3905.0191 ms), followed by all 986 native browser cases using synthetic providers and no external RPC. [Evidence](evidence/2026-11-01-history-record-navigation/) retains a mixed-identity archive with block numbers above Number precision, the selected earlier detail, an exact uint256 comparison and the no-predecessor outcome. Native integration verifies detail focus, unchanged current observation/history and no extra provider reads. Source indices 2 and 0 are correctly paired despite intervening records from other identities.

Full browser checkpoint is now b3254c9 (986 cases). Last full-wallet checkpoint remains d253e8d (15,720 tests). These checks do not establish OS-picker use or a real-wallet connection. No existing-server restart, signature, transfer, approval, private-key retrieval, publication or deployment occurred.
