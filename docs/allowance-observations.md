# Existing allowance observations (local development, 2026-10-23)

The wallet can observe existing ERC-20 allowances for an explicit list of spender
addresses. The same feature is available in DAT, EMA and CAWELON cards.

## User flow

1. Select the token's network and enter its official token address, or use the
   existing official-address selector. Connect the intended wallet.
2. Enter one spender address per line. An optional local label follows a pipe.
   Use full addresses, not names or shortened addresses.
3. Preview the list. Confirm its network, token and full addresses.
4. Apply the list, then explicitly read allowances.
5. Use filters/search to inspect zero, nonzero, maximum and unknown amounts.
6. Save the targets or observation as JSON. Downloading is an explicit operation.
7. Import a saved observation to view it offline. Imports are historical records
   and never connect a wallet or apply a new spender list.
8. Optionally select a baseline and compare a later observation of the same
   account, chain, origin and token.
9. When all three cards contain records, review and save the combined file.
   Combined-file imports have a separate display and do not replace card records.

A card's configuration changes invalidate its read results and applied target
review. Editing a target draft also invalidates the read result. A comparison
baseline can survive a target-draft edit, so adding or removing observed targets
can be distinguished from changes to previously observed amounts.

## Read semantics

- Maximum 20 explicitly specified, distinct spender addresses.
- Supported token scope comes from the local DAT/EMA/CAWELON catalog on
  Base Mainnet or Base Sepolia.
- Token code, metadata, balances and spender allowances use a pinned block hash.
- A final canonical block lookup rejects a changed reference block.
- The account, chain, site origin and session epoch must remain unchanged.
- Cancellation or timeout retires the pending operation. Late responses cannot
  populate the screen or start subsequent reads.
- Individual code or allowance failures remain unknown. They are not converted
  to zero. Loss of the underlying session aborts the entire observation.
- An address with no code can still have a nonzero allowance. Code presence is
  recorded separately and is not a safety verdict.
- Metadata mismatch withholds token-unit interpretation; raw integer amounts
  remain visible. All quantities and deltas use exact BigInt arithmetic.
- The maximum uint256 value is labelled explicitly. It is not interpreted as
  a guarantee of perpetual authorization.
- The smaller of balance and allowance is a reference value, not a guarantee
  that a transfer can succeed or an estimate of loss.
- Allowances overlap; no aggregate financial exposure is calculated.
- The interface has no approve, revoke, sign, send, swap or chain-switch action.

The reader does not discover all allowances. It does not inspect NFT approvals,
signed permits, account abstraction policies, operator roles or contract internals.
It is an observation tool, not an independent contract audit.

## Files and authenticity

Individual records use threecore-allowance-file-v1 with kind targets or observation.
A SHA-256 checksum covers the canonical kind and payload.
The maximum input file is 64 KiB. Decoding checks the UTF-8 format, exact schema,
catalog scope, quantities, error states, duplicates and row order.

Combined files use threecore-allowance-bundle-v1, contain exactly one observation
per token, and have a 192 KiB limit. Each inner record and the outer manifest are
checked. The manifest preserves each account, network and observation block.
The three observations are not claimed to be simultaneous.

A checksum detects accidental alteration. Anyone can regenerate a checksum; it
does not authenticate the file's author or prove the data is from the chain.
Files contain unencrypted public addresses, labels, token balances and allowances.
They do not contain secret keys, seed phrases or wallet permissions. The new
panels do not write automatically to localStorage or IndexedDB.

Changing a card after a combined-file preview requires another review before
saving. Cancellation, disposal and late file/hash results retire the previous
operation. Imports are parsed and validated completely before being displayed.

## Offline inspection

    node scripts/check-allowance-file.js "C:\path\ThreeCore-DAT-allowances-42.json"
    node scripts/check-allowance-file.js "C:\path\after.json" --baseline "C:\path\before.json" --json

This CLI accepts individual target/observation files, performs bounded reads, and
does not use a provider, make network requests or modify files. Inspect combined
files using the dedicated one-file import in the local UI.

## Verification

- Unit and state-machine checks: node --test test/allowance*.test.js
- Full unit regression: node --test test/*.test.js
- HTTP routes: node --test integration/*server.test.mjs
- Browser regression: /test/browser/ with server option --ui-test
- Focused browser cases: /test/browser/?suite=allowance
- Manual synthetic three-wallet demonstration: /test/browser/allowance-demo/

Synthetic fixtures never access a browser extension or a real wallet. They cover
successful observations, partial failures, code absence, maximum amounts,
cancellation, changed accounts/chains, block changes, file tampering and restoration.
The demonstration is explicitly labelled as synthetic and is available only in
test mode. Download/reload/import tests do not establish real-wallet integration
or deployed-contract correctness.

The source is included in the October 23 publication. This does not deploy a live site.
