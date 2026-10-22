# Local token identity and exact balance workflow

This working copy adds a read-only identity observation panel for DAT, EMA and
CAWELON. The source is included in the October 23 publication. This does not deploy a public website.

## Use in the local wallet screen

1. Select the intended card, public wallet account and Base network.
2. Choose **公式アドレスを表示** to inspect the registered token address.
3. Choose **この公式アドレスを入力** to fill only the token field.
4. Explicitly connect the selected wallet using the existing connection button.
5. Choose **接続中のWalletで照合**.
6. Review the full account, contract, block hash and raw/formatted amounts.
7. Choose **照合記録をファイル保存** and check the browser download.
8. After reloading the page, select that JSON in the same token card.

Import is offline. It displays a historical record without connecting a wallet,
changing connection settings, or claiming that the imported balance is current.
The identity file is separate from the existing portfolio/workspace/checkpoint
formats. No existing history or checkpoint is rewritten by these controls.

A record can be selected as a comparison baseline. Read or import a later record,
then compare. Comparison requires the same token, network, account and site
origin. A one-base-unit change at 18 decimals remains visible as
0.000000000000000001. A change in balance is not identified as a transfer or
profit.

## Observation semantics

All RPC subreads use one block hash with requireCanonical. The collector checks
the numbered block again before accepting the result. It never silently retries
against latest or swaps providers, accounts, networks or token addresses.

The panel compares runtime name, symbol, decimals, totalSupply and balance
against the versioned catalog. Code existence is checked first. A missing
contract is unknown, not a zero token balance. Mismatched metadata leaves raw
units visible and suppresses trusted-symbol amount formatting.

The registered initial supply is an upper bound, not a demand for an unchanged
totalSupply. A reduced supply alone is not evidence of a burn transaction.
These are ERC-20 token records, separate from testnet training credits.

Matching metadata and code existence do not authenticate bytecode, ownership,
audit status or blockchain provenance. A provider or imported file may be
dishonest. The file checksum detects accidental or unapproved byte/content
changes; anyone can calculate a new checksum. No cryptographic signature or
independent chain verification is represented by the checksum.

## Local file checker

Requires Node 22 or later. No package installation, network or wallet is used.

    npm run identity:check -- path/to/ThreeCore-DAT-identity-42.json

For machine-readable results:

    npm run identity:check -- path/to/record.json --json

For a comparison:

    npm run identity:check -- path/to/later.json --baseline path/to/earlier.json

The checker only reads regular JSON files up to 32 KiB. Files contain public
accounts and balances; choose an appropriate local storage location.

## Tests and isolated demonstration

Unit tests:

    npm test

HTTP route coverage:

    npm run test:identity-server

The existing browser harness includes the new identity cases:

    /test/browser/?suite=identity
    /test/browser/

The isolated three-card demonstration is:

    /test/browser/token-identity-demo/

These test URLs are available only when the development server is started with
--ui-test. The demonstration uses deterministic in-process providers with three
distinct synthetic accounts. It never reads window.ethereum, makes network RPC,
uses real assets or opens the application's checkpoint database.

The standalone browser demo supports normal responses, metadata mismatch,
missing code, read failure and canonical-block change. Its simulated block
advance adds exactly one base unit so small-delta comparison can be reviewed.
The normal wallet screen remains at /.

## Explicit limits

- No real-world wallet observation was added to the evidence by these tests.
- Existing real-wallet validation remains a separate historical record.
- No sending, signing, approval, token import into an extension or chain switch.
- No swap, bridge, custody, autonomous trading or AGI implementation.
- No new automatic file persistence or background blockchain polling.
- Catalog addresses and metadata are versioned constants sourced from the
  project's public token repositories; keep source/version review explicit.
- Standard ABI dynamic strings are supported. Legacy bytes32 token name/symbol
  responses are rejected with guidance rather than guessed.
